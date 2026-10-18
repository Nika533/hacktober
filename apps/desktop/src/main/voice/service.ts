import {
  VOICE_OFF,
  nextSpeech,
  speakableText,
  type Unsubscribe,
  type VoiceProblem,
  type VoiceSlice
} from '@hoot/core'
import type { Logger } from '../log'
import type { Store } from '../store/store'
import type { SpeechEngine } from './engine'

export const VOICE_TIMING = {
  /** Quiet after the last phrase that ends the user's turn. */
  pauseMs: 900,
  /** Nothing said this long after listening starts: the voice chat ends. */
  silenceMs: 8_000,
  /** A turn never runs longer than this. */
  turnMs: 45_000,
  /** `finish` waits this long for the phrase in progress. */
  finishMs: 1_500,
  /** A send must start an answer this soon. */
  answerMs: 6_000,
  /** The streaming answer is re-read for speech at most this often. */
  readEveryMs: 150
}

/** A phrase never louder than this (0–1) is room noise the recognizer made words of. */
export const NOISE_PEAK = 0.05
/**
 * Windows dictation scores phrases it made up from noise at ~0 (measured: a
 * fan at 0.18 peak became "It into a total of", confidence 0.00); speech
 * scores far higher. Below this a finished phrase is dropped, unless the
 * user pressed "done talking" on it.
 */
export const MIN_CONFIDENCE = 0.1

export interface VoiceServiceDeps {
  store: Pick<Store, 'get' | 'update' | 'onChange'>
  engine: SpeechEngine
  /** Send what the user said to the active chat, as a voice message. */
  send(text: string): Promise<void>
  /** Stop the answer streaming now (the user talked over it). */
  stopAnswer(): Promise<void>
  log: Logger
  timing?: Partial<typeof VOICE_TIMING>
}

export interface VoiceService {
  /** Start a voice chat; while Hoot speaks or thinks, cut it off and listen now. */
  start(): Promise<void>
  /** Send what was heard now, without waiting for a pause. */
  finish(): Promise<void>
  /** End the voice chat. */
  stop(): Promise<void>
  /** Read one assistant message of the active chat aloud. */
  speak(messageId: string): Promise<void>
  /**
   * A question was just sent for the user by voice (the extension's popup):
   * read the answer aloud, then keep the voice chat going.
   */
  answerAloud(): void
  prewarm(): void
  dispose(): void
}

type Timer = ReturnType<typeof setTimeout>

interface Turn {
  finals: string[]
  partial: string
  heardAny: boolean
  finishing: boolean
  timers: Set<Timer>
  pause: Timer | null
  silence: Timer | null
}

interface Reply {
  /** The answer being read; null until its stream starts. */
  messageId: string | null
  /** How much of its speakable text was handed to the engine. */
  spoken: number
  /** Utterances still being said. */
  pending: number
  aloud: boolean
  /** The answer has finished streaming. */
  done: boolean
  failed: boolean
  lastRead: number
  /** A throttled re-read of the streaming answer is scheduled. */
  reading: Timer | null
  timers: Set<Timer>
}

/**
 * The voice chat: listen → send what was heard to the active chat → read the
 * answer aloud sentence by sentence as it streams → listen again, until the
 * user ends it or says nothing. A turn ends after a short pause. Main owns it,
 * so Studio, the card and the live overlay show the same `voice` slice.
 * A message typed while Hoot listens is answered aloud too.
 */
export function createVoiceService(deps: VoiceServiceDeps): VoiceService {
  const { store, engine, log } = deps
  const timing = { ...VOICE_TIMING, ...deps.timing }
  let conversation = false
  /** Turns completed in this voice chat; the first silence says "didn't catch that". */
  let turns = 0
  /** Bumped by every start and end: late engine results from before are ignored. */
  let gen = 0
  let engineUp = false
  let turn: Turn | null = null
  let reply: Reply | null = null
  let lastStream = store.get('chat').stream?.messageId ?? null

  const set = (patch: Partial<VoiceSlice>): void => store.update('voice', patch)
  const phase = (): VoiceSlice['phase'] => store.get('voice').phase
  const later = (bag: Set<Timer>, ms: number, fn: () => void): Timer => {
    const t = setTimeout(() => {
      bag.delete(t)
      fn()
    }, ms)
    bag.add(t)
    return t
  }
  const clearAll = (bag: Set<Timer>): void => {
    for (const t of bag) clearTimeout(t)
    bag.clear()
  }
  const cancel = (bag: Set<Timer>, t: Timer | null): null => {
    if (t) {
      clearTimeout(t)
      bag.delete(t)
    }
    return null
  }

  const dropTurn = (): void => {
    const t = turn
    if (!t) return
    turn = null
    clearAll(t.timers)
    if (!t.finishing) engine.stopListening(false)
  }

  const dropReply = (): void => {
    const r = reply
    if (!r) return
    reply = null
    clearAll(r.timers)
    if (r.pending > 0) engine.hush()
  }

  function end(problem: VoiceProblem | null): void {
    gen += 1
    conversation = false
    turns = 0
    dropTurn()
    dropReply()
    set({ ...VOICE_OFF, problem })
  }

  const showHeard = (t: Turn): void =>
    set({ heard: [...t.finals, t.partial].join(' ').replace(/\s+/g, ' ').trim() })

  const armSilence = (t: Turn): void => {
    t.silence = cancel(t.timers, t.silence)
    t.heardAny = false
    t.silence = later(t.timers, timing.silenceMs, () => {
      if (turn === t && !t.heardAny) end(turns === 0 ? 'not_heard' : null)
    })
  }

  async function listen(): Promise<void> {
    const mine = ++gen
    dropTurn()
    dropReply()
    const t: Turn = {
      finals: [],
      partial: '',
      heardAny: false,
      finishing: false,
      timers: new Set(),
      pause: null,
      silence: null
    }
    turn = t
    set({ phase: engineUp ? 'listening' : 'starting', heard: '', level: 0, problem: null })
    let problem: VoiceProblem | null
    try {
      problem = await engine.listen()
    } catch (e) {
      log.warn(`voice: listen threw: ${String(e)}`)
      problem = 'failed'
    }
    if (mine !== gen || turn !== t) {
      if (!problem) engine.stopListening(false)
      return
    }
    if (problem) return end(problem)
    engineUp = true
    set({ phase: 'listening' })
    armSilence(t)
    later(t.timers, timing.turnMs, () => finishTurn(t))
  }

  function finishTurn(t: Turn): void {
    if (turn !== t || t.finishing) return
    t.finishing = true
    clearAll(t.timers)
    // A phrase in progress completes (and arrives as `final`) before `stopped`.
    engine.stopListening(t.partial !== '')
    later(t.timers, timing.finishMs, () => void completeTurn(t))
  }

  async function completeTurn(t: Turn): Promise<void> {
    if (turn !== t) return
    turn = null
    clearAll(t.timers)
    const text = [...t.finals, t.partial].join(' ').replace(/\s+/g, ' ').trim()
    if (!text) return end(turns === 0 ? 'not_heard' : null)
    turns += 1
    const mine = gen
    set({ phase: 'thinking', heard: text, level: 0 })
    if (store.get('chat').stream) await deps.stopAnswer()
    if (mine !== gen) return
    awaitAnswer()
    try {
      await deps.send(text)
    } catch (e) {
      log.warn(`voice: send failed: ${String(e)}`)
      if (mine === gen) end('failed')
    }
  }

  /** The next answer (or the one streaming now) is read aloud. */
  function awaitAnswer(): void {
    const r: Reply = {
      messageId: null,
      spoken: 0,
      pending: 0,
      aloud: store.get('settings').settings.voiceReplies,
      done: false,
      failed: false,
      lastRead: 0,
      reading: null,
      timers: new Set()
    }
    reply = r
    later(r.timers, timing.answerMs, () => {
      if (reply === r && r.messageId === null) end(null)
    })
  }

  function say(r: Reply, text: string): void {
    r.pending += 1
    if (phase() !== 'speaking') set({ phase: 'speaking', heard: '', level: 0 })
    const rate = store.get('settings').settings.voiceRate
    void engine
      .speak(text, rate)
      .catch(() => false)
      .then(() => {
        if (reply !== r) return
        r.pending -= 1
        settleReply(r)
      })
  }

  function settleReply(r: Reply): void {
    if (reply !== r || !r.done || r.pending > 0) return
    reply = null
    clearAll(r.timers)
    if (r.failed || !conversation) return end(null)
    void listen()
  }

  function readAnswer(r: Reply, force = false): void {
    if (reply !== r || r.messageId === null) return
    const chat = store.get('chat')
    const message = chat.session?.messages.find((m) => m.id === r.messageId)
    if (!message) {
      // Another chat was opened: this answer isn't on screen anymore.
      if (chat.stream?.messageId !== r.messageId) {
        r.done = true
        settleReply(r)
      }
      return
    }
    const streaming = message.status === 'streaming'
    if (message.status === 'error') r.failed = true
    if (r.aloud && !r.failed) {
      const wait = r.lastRead + timing.readEveryMs - Date.now()
      if (streaming && !force && wait > 0) {
        r.reading ??= later(r.timers, wait, () => {
          r.reading = null
          readAnswer(r, true)
        })
        return
      }
      r.lastRead = Date.now()
      const next = nextSpeech(speakableText(message.text, streaming), r.spoken, !streaming)
      if (next) {
        r.spoken = next.end
        say(r, next.text)
      }
    }
    if (!streaming) {
      r.done = true
      settleReply(r)
    }
  }

  const unwatch: Unsubscribe = store.onChange((changed) => {
    if (!changed.has('chat')) return
    const stream = store.get('chat').stream
    const started = stream && stream.messageId !== lastStream ? stream.messageId : null
    lastStream = stream?.messageId ?? null
    // Typed while Hoot listens: answer that aloud, then listen again.
    if (started && !reply && turn && !turn.finishing && phase() === 'listening') {
      dropTurn()
      awaitAnswer()
      set({ phase: 'thinking', heard: '', level: 0 })
    }
    const r = reply
    if (!r) return
    if (r.messageId === null) {
      if (!started) return
      r.messageId = started
    }
    readAnswer(r)
  })

  const unlisten = engine.on((e) => {
    const t = turn
    if (!t) return
    switch (e.type) {
      case 'level': {
        const level = store.get('voice').level
        if (phase() === 'listening' && (Math.abs(e.value - level) >= 0.05 || e.value === 0)) {
          set({ level: e.value })
        }
        return
      }
      case 'partial':
        if (e.peak < NOISE_PEAK || !e.text.trim() || t.finishing) return
        t.partial = e.text.trim()
        t.heardAny = true
        t.pause = cancel(t.timers, t.pause)
        t.silence = cancel(t.timers, t.silence)
        showHeard(t)
        return
      case 'final':
        t.partial = ''
        if (
          e.peak >= NOISE_PEAK &&
          e.text.trim() &&
          (e.confidence >= MIN_CONFIDENCE || t.finishing)
        ) {
          t.finals.push(e.text.trim())
          t.heardAny = true
          t.silence = cancel(t.timers, t.silence)
        }
        showHeard(t)
        if (t.finishing) return
        if (t.finals.length === 0) return armSilence(t)
        t.pause = cancel(t.timers, t.pause)
        t.pause = later(t.timers, timing.pauseMs, () => finishTurn(t))
        return
      case 'rejected':
        t.partial = ''
        showHeard(t)
        if (!t.finishing && t.finals.length === 0) armSilence(t)
        return
      case 'stopped':
        if (t.finishing || t.finals.length > 0) {
          t.finishing = true
          void completeTurn(t)
          return
        }
        if (e.error) log.warn(`voice: listening stopped: ${e.error}`)
        end(e.error ? 'failed' : null)
        return
    }
  })

  return {
    async start() {
      const p = phase()
      if (p === 'listening' || p === 'starting') return
      if (p === 'off') turns = 0
      conversation = true
      await listen()
    },

    async finish() {
      if (turn && phase() === 'listening') finishTurn(turn)
    },

    async stop() {
      end(null)
    },

    async speak(messageId) {
      const message = store.get('chat').session?.messages.find((m) => m.id === messageId)
      if (!message || message.role !== 'assistant' || !message.text.trim()) return
      end(null)
      awaitAnswer()
      const r = reply as Reply | null
      if (!r) return
      r.aloud = true
      r.messageId = messageId
      readAnswer(r, true)
    },

    answerAloud() {
      end(null)
      conversation = true
      turns = 1
      awaitAnswer()
      set({ phase: 'thinking' })
      const r = reply as Reply | null
      const stream = store.get('chat').stream
      if (r && stream) {
        r.messageId = stream.messageId
        readAnswer(r)
      }
    },

    prewarm() {
      engine.prewarm()
    },

    dispose() {
      end(null)
      unwatch()
      unlisten()
      engine.dispose()
    }
  }
}
