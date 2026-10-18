import type { Unsubscribe, VoiceProblem } from '@hoot/core'

/** What the speech engine reports while it listens. Levels are 0–1. */
export type SpeechEvent =
  /** A live guess at the phrase being spoken; `peak` is its loudest level so far. */
  | { type: 'partial'; text: string; peak: number }
  /** A finished phrase. */
  | { type: 'final'; text: string; confidence: number; peak: number }
  /** A phrase it couldn't make out. */
  | { type: 'rejected' }
  | { type: 'level'; value: number }
  /** Listening ended: asked to, or the microphone went away (`error`). */
  | { type: 'stopped'; error?: string }

/** Speech in and out (Windows speech, or the fake under HOOT_FAKE_VOICE). */
export interface SpeechEngine {
  /** Start listening to the default microphone: null once it listens, else why not. */
  listen(): Promise<VoiceProblem | null>
  /** Stop listening; `finish` lets the phrase in progress complete first. */
  stopListening(finish: boolean): void
  /** Say `text`; true when it was said to the end, false when cut off or failed. */
  speak(text: string, rate: number): Promise<boolean>
  /** Cut off everything being said or queued. */
  hush(): void
  on(listener: (event: SpeechEvent) => void): Unsubscribe
  /** Start the engine ahead of the first use (it takes a moment). */
  prewarm(): void
  dispose(): void
}

/** Off Windows (and in e2e runs): every voice chat ends with 'unavailable'. */
export const unavailableEngine: SpeechEngine = {
  listen: async () => 'unavailable',
  stopListening: () => undefined,
  speak: async () => false,
  hush: () => undefined,
  on: () => () => undefined,
  prewarm: () => undefined,
  dispose: () => undefined
}
