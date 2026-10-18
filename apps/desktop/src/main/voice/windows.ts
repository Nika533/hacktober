import type { VoiceProblem } from '@hoot/core'
import type { Logger } from '../log'
import { createHelper, powerShell, type Helper, type Reply } from '../textAccess/helper'
import type { SpeechEngine, SpeechEvent } from './engine'
import { VOICE_SCRIPT, VOICE_TYPES, VOICE_TYPES_ENV } from './script'

/** The first listen spawns PowerShell and compiles the C# half: give it time. */
const LISTEN_TIMEOUT_MS = 20_000
const COMMAND_TIMEOUT_MS = 3_000

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
const str = (v: unknown): string => (typeof v === 'string' ? v : '')

/** One helper line → an engine event (levels 0–100 → 0–1); null for anything else. */
export function toSpeechEvent(msg: Reply): SpeechEvent | null {
  switch (msg['event']) {
    case 'partial':
      return { type: 'partial', text: str(msg['text']), peak: num(msg['peak']) / 100 }
    case 'final':
      return {
        type: 'final',
        text: str(msg['text']),
        confidence: num(msg['confidence']),
        peak: num(msg['peak']) / 100
      }
    case 'rejected':
      return { type: 'rejected' }
    case 'level':
      return { type: 'level', value: Math.min(1, num(msg['value']) / 100) }
    case 'stopped':
      return msg['error'] ? { type: 'stopped', error: str(msg['error']) } : { type: 'stopped' }
    default:
      return null
  }
}

/**
 * Windows speech through the voice helper (script.ts): System.Speech
 * dictation in, Windows voices out. One helper process, spawned on first use
 * and restarted by the transport if it crashes.
 */
export function createWindowsSpeechEngine(deps: { log: Logger; helper?: Helper }): SpeechEngine {
  const helper =
    deps.helper ??
    createHelper({
      log: deps.log,
      name: 'voice',
      spawn: powerShell(VOICE_SCRIPT, { [VOICE_TYPES_ENV]: VOICE_TYPES })
    })
  const listeners = new Set<(event: SpeechEvent) => void>()
  const speaking = new Map<number, (done: boolean) => void>()
  let listening = false
  let nextUtterance = 1

  const emit = (event: SpeechEvent): void => {
    for (const listener of [...listeners]) listener(event)
  }

  const finishAll = (): void => {
    for (const done of [...speaking.values()]) done(false)
  }

  helper.listen((msg) => {
    // A restarted helper forgot what it was doing.
    if (msg['ready'] === true) {
      finishAll()
      if (listening) {
        listening = false
        emit({ type: 'stopped', error: 'the speech helper restarted' })
      }
      return
    }
    if (msg['event'] === 'spoken') {
      speaking.get(num(msg['utterance']))?.(msg['cancelled'] !== true)
      return
    }
    const event = toSpeechEvent(msg)
    if (!event) return
    if (event.type === 'stopped') listening = false
    emit(event)
  })

  return {
    async listen() {
      const reply = await helper.call('listen', {}, LISTEN_TIMEOUT_MS)
      if (!reply) return helper.running() ? 'failed' : 'unavailable'
      const problem = str(reply['problem'])
      if (problem === '') {
        listening = true
        return null
      }
      if (problem === 'unavailable' || problem === 'no_microphone') return problem
      deps.log.warn(`voice: listen failed: ${problem}`)
      return 'failed' satisfies VoiceProblem
    },

    stopListening(finish) {
      void helper.call('stop', { finish }, COMMAND_TIMEOUT_MS)
    },

    speak(text, rate) {
      const utterance = nextUtterance++
      return new Promise<boolean>((resolve) => {
        // Never wait forever on a lost event: a generous bound on how long it takes to say.
        const timer = setTimeout(() => done(false), 15_000 + text.length * 120)
        function done(ok: boolean): void {
          clearTimeout(timer)
          if (!speaking.delete(utterance)) return
          resolve(ok)
        }
        speaking.set(utterance, done)
        void helper.call('speak', { text, utterance, rate }, LISTEN_TIMEOUT_MS).then((reply) => {
          if (!reply) done(false)
        })
      })
    },

    hush() {
      void helper.call('hush', {}, COMMAND_TIMEOUT_MS)
    },

    on(listener) {
      listeners.add(listener)
      return () => void listeners.delete(listener)
    },

    prewarm() {
      helper.start()
    },

    dispose() {
      finishAll()
      listeners.clear()
      helper.dispose()
    }
  }
}
