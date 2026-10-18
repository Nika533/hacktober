/**
 * Claude models Hoot uses (Anthropic). Chat models are user-selectable in
 * Settings; Lens models are chosen by the engine (hoot-lens.md §7.2).
 */

export const CHAT_MODEL_IDS = ['claude-haiku-5-5', 'claude-sonnet-5-5', 'claude-opus-5-5'] as const

export type ChatModelId = (typeof CHAT_MODEL_IDS)[number]

export const DEFAULT_CHAT_MODEL: ChatModelId = 'claude-sonnet-5-5'

export interface ChatModelInfo {
  id: ChatModelId
  label: string
  sub: string
  /** Needs a paid plan (no Claude model does; kept for the Settings UI). */
  paidOnly: boolean
}

export const CHAT_MODELS: readonly ChatModelInfo[] = [
  { id: 'claude-haiku-5-5', label: 'Haiku', sub: 'fastest', paidOnly: false },
  { id: 'claude-sonnet-5-5', label: 'Sonnet', sub: 'balanced', paidOnly: false },
  { id: 'claude-opus-5-5', label: 'Opus', sub: 'smartest', paidOnly: false }
]

export const isChatModelId = (v: unknown): v is ChatModelId =>
  typeof v === 'string' && (CHAT_MODEL_IDS as readonly string[]).includes(v)

/**
 * Gemini models Hoot used before it moved to Claude, mapped to the Claude
 * model with the same role, so a saved choice survives the move.
 */
export const LEGACY_CHAT_MODELS: Readonly<Record<string, ChatModelId>> = {
  'gemini-3.5-flash-lite': 'claude-haiku-5-5',
  'gemini-3.8-flash': 'claude-sonnet-5-5',
  'gemini-4-argon': 'claude-opus-5-5'
}

export const LENS_MODELS = {
  /** Gray-zone difficulty check */
  assess: 'claude-haiku-5-5',
  /** define / expand / translate / example, and short simplify or unpack */
  rewriteFast: 'claude-haiku-5-5',
  /**
   * simplify / unpack on longer spans. Haiku too: Sonnet took about 3.9 s on
   * long legal sentences against about 1.4 s for Haiku (spec §7.2 latency).
   */
  rewriteStrong: 'claude-haiku-5-5'
} as const

/** Spans longer than this many words use `rewriteStrong` for simplify/unpack. */
export const STRONG_REWRITE_MIN_WORDS = 25
