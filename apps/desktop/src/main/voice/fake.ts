import type { SpeechEngine, SpeechEvent } from './engine'

export interface FakeSpeechOptions {
  /** What the "user" says, one phrase per listen, round and round. */
  phrases?: readonly string[]
  /** ms between the words of a phrase, and per spoken character. */
  wordMs?: number
  charMs?: number
}

export const FAKE_PHRASES = ['What can you help me with?', 'Thanks, that helps.'] as const

/**
 * A scripted speech engine for HOOT_FAKE_VOICE=1 (offline demos, e2e): each
 * listen "hears" the next phrase word by word, with a microphone level, and
 * speaking takes time in proportion to the text. No audio either way.
 */
export function createFakeSpeechEngine(opts: FakeSpeechOptions = {}): SpeechEngine {
  const phrases = opts.phrases?.length ? opts.phrases : FAKE_PHRASES
  const wordMs = opts.wordMs ?? 180
  const charMs = opts.charMs ?? 12
  const listeners = new Set<(event: SpeechEvent) => void>()
  const timers = new Set<ReturnType<typeof setTimeout>>()
  const speaking = new Set<(done: boolean) => void>()
  let turn = 0
  let listening = false

  const emit = (event: SpeechEvent): void => {
    for (const listener of [...listeners]) listener(event)
  }
  const later = (ms: number, fn: () => void): void => {
    const t = setTimeout(() => {
      timers.delete(t)
      fn()
    }, ms)
    timers.add(t)
  }
  const clear = (): void => {
    for (const t of timers) clearTimeout(t)
    timers.clear()
  }

  return {
    async listen() {
      if (listening) return null
      listening = true
      const words = (phrases[turn++ % phrases.length] ?? '').split(' ')
      words.forEach((_, i) =>
        later(wordMs * (i + 1), () => {
          emit({ type: 'level', value: 0.4 + 0.2 * (i % 2) })
          emit({ type: 'partial', text: words.slice(0, i + 1).join(' '), peak: 0.6 })
        })
      )
      later(wordMs * (words.length + 1), () => {
        emit({ type: 'level', value: 0 })
        emit({ type: 'final', text: words.join(' '), confidence: 0.9, peak: 0.6 })
      })
      return null
    },
    stopListening() {
      if (!listening) return
      listening = false
      clear()
      emit({ type: 'stopped' })
    },
    speak(text) {
      return new Promise((resolve) => {
        const done = (ok: boolean): void => {
          if (!speaking.delete(done)) return
          resolve(ok)
        }
        speaking.add(done)
        setTimeout(() => done(true), Math.min(4000, text.length * charMs))
      })
    },
    hush() {
      for (const done of [...speaking]) done(false)
    },
    on(listener) {
      listeners.add(listener)
      return () => void listeners.delete(listener)
    },
    prewarm: () => undefined,
    dispose() {
      clear()
      listeners.clear()
    }
  }
}
