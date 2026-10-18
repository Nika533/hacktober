import { AI_ERROR_CODES, type AiErrorCode } from '@hoot/core'

export interface ChatErrorCopy {
  code: AiErrorCode
  /** What happened and what to do, in one or two short sentences. */
  message: string
  /** The single action that can fix it, if any. */
  action: 'add-key' | 'open-settings' | 'retry' | null
  actionLabel: string | null
}

const KNOWN: ReadonlySet<string> = new Set(AI_ERROR_CODES)

/** Narrows anything (e.g. an old persisted value) to a core code. */
export function toAiErrorCode(raw: string | undefined): AiErrorCode {
  return raw && KNOWN.has(raw) ? (raw as AiErrorCode) : 'unknown'
}

/** User-facing copy for a failed answer. Errors say what happened and how to fix it. */
export function describeChatError(raw: AiErrorCode | string | undefined): ChatErrorCopy {
  const code = toAiErrorCode(raw)
  switch (code) {
    case 'no_key':
      return {
        code,
        message: 'Hoot needs a Claude API key before it can answer.',
        action: 'add-key',
        actionLabel: 'Add API key'
      }
    case 'auth':
      return {
        code,
        message: 'Anthropic rejected the API key. Check it in Settings.',
        action: 'open-settings',
        actionLabel: 'Open Settings'
      }
    case 'rate_limited':
      return {
        code,
        message: 'Claude’s rate limit was reached. Wait a moment, then retry.',
        action: 'retry',
        actionLabel: 'Retry'
      }
    case 'busy':
      return {
        code,
        message: 'Claude is busy right now. Retry in a few seconds.',
        action: 'retry',
        actionLabel: 'Retry'
      }
    case 'network':
      return {
        code,
        message: 'Hoot couldn’t reach Claude. Check your connection, then retry.',
        action: 'retry',
        actionLabel: 'Retry'
      }
    case 'blocked':
      return {
        code,
        message: 'Claude declined to answer this. Try asking in a different way.',
        action: null,
        actionLabel: null
      }
    default:
      return {
        code,
        message: 'The answer didn’t come through.',
        action: 'retry',
        actionLabel: 'Retry'
      }
  }
}
