/**
 * A voice chat loops listen → think (the answer streams) → speak → listen
 * until the user ends it. 'starting' covers the speech engine's first launch.
 */
export type VoicePhase = 'off' | 'starting' | 'listening' | 'thinking' | 'speaking'

/** Why the last voice turn didn't work, until the next start. */
export type VoiceProblem = 'unavailable' | 'no_microphone' | 'not_heard' | 'failed'

export const VOICE_PROBLEM_TEXT: Record<VoiceProblem, string> = {
  unavailable:
    'Voice needs Windows speech recognition, which isn’t set up on this PC (Settings → Time & language → Speech).',
  no_microphone:
    'Hoot can’t hear a microphone. Plug one in, and let desktop apps use it (Settings → Privacy & security → Microphone).',
  not_heard: 'Hoot didn’t catch that. Press the mic and try again.',
  failed: 'Voice stopped working. Press the mic to try again.'
}

export interface VoiceSlice {
  phase: VoicePhase
  /** What Hoot heard so far this turn (a live guess while listening). */
  heard: string
  /** Microphone level 0–1 while listening, for the mic ring. */
  level: number
  problem: VoiceProblem | null
}

export const VOICE_OFF: VoiceSlice = { phase: 'off', heard: '', level: 0, problem: null }

/** Speaking speed in voice chats, Windows' SAPI scale (-10 … 10). */
export const VOICE_RATES = { min: -5, max: 5 } as const
