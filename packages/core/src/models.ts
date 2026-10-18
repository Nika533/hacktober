/**
 * Gemini models Hoot uses. Chat models are user-selectable in Settings;
 * Lens models are chosen by the engine (hoot-lens.md §7.2).
 */

export const CHAT_MODEL_IDS = [
  'gemini-3.5-flash-lite',
  'gemini-3.8-flash',
  'gemini-4-argon'
] as const

export type ChatModelId = (typeof CHAT_MODEL_IDS)[number]

export const DEFAULT_CHAT_MODEL: ChatModelId = 'gemini-3.8-flash'

export interface ChatModelInfo {
  id: ChatModelId
  label: string
  sub: string
  /** Not available on the Gemini API free tier. */
  paidOnly: boolean
}

export const CHAT_MODELS: readonly ChatModelInfo[] = [
  { id: 'gemini-3.5-flash-lite', label: 'Flash-Lite', sub: 'fastest', paidOnly: false },
  { id: 'gemini-3.8-flash', label: 'Flash', sub: 'balanced', paidOnly: false },
  { id: 'gemini-4-argon', label: 'Argon', sub: 'smartest', paidOnly: true }
]

export const isChatModelId = (v: unknown): v is ChatModelId =>
  typeof v === 'string' && (CHAT_MODEL_IDS as readonly string[]).includes(v)

export const LENS_MODELS = {
  /** Gray-zone difficulty check */
  assess: 'gemini-3.5-flash-lite',
  /** define / expand / translate / example, and short simplify or unpack */
  rewriteFast: 'gemini-3.5-flash-lite',
  /** simplify / unpack on longer spans */
  rewriteStrong: 'gemini-3.8-flash'
} as const

/** Spans longer than this many words use `rewriteStrong` for simplify/unpack. */
export const STRONG_REWRITE_MIN_WORDS = 25
