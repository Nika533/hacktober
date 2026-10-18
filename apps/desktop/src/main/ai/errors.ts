import type { AiErrorCode } from '@hoot/core'

/** A provider failure with the code every surface renders. */
export class AiError extends Error {
  constructor(
    readonly code: AiErrorCode,
    message: string = code
  ) {
    super(message)
    this.name = 'AiError'
  }
}

/** Gemini refused: the prompt was blocked, or the answer was withheld. */
export class AiBlockedError extends AiError {
  constructor(readonly reason: string) {
    super('blocked', `Response blocked: ${reason}`)
    this.name = 'AiBlockedError'
  }
}

/** The model answered, but not with JSON matching the requested schema. */
export class AiOutputError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AiOutputError'
  }
}

/** Finish reasons that mean Gemini refused to answer. */
export const BLOCKED_FINISH_REASONS: ReadonlySet<string> = new Set([
  'SAFETY',
  'RECITATION',
  'BLOCKLIST',
  'PROHIBITED_CONTENT',
  'SPII',
  'IMAGE_SAFETY',
  'IMAGE_PROHIBITED_CONTENT'
])

export function isAbortError(e: unknown): boolean {
  return (e as { name?: string })?.name === 'AbortError'
}

export function mapAiError(e: unknown): AiErrorCode {
  if (e instanceof AiError) return e.code
  const err = e as { status?: number; message?: string; name?: string; code?: string }
  const msg = String(err?.message ?? '').toLowerCase()
  if (err?.name === 'TimeoutError') return 'busy'
  // Gemini answers a bad key with 400 API_KEY_INVALID, not 401.
  if (err?.status === 401 || err?.status === 403) return 'auth'
  if (err?.status === 400 && (msg.includes('api key') || msg.includes('api_key_invalid'))) {
    return 'auth'
  }
  if (err?.status === 429) return 'rate_limited'
  if (err?.status === 500 || err?.status === 503 || err?.status === 504) return 'busy'
  if (msg.includes('overloaded') || msg.includes('unavailable')) return 'busy'
  if (
    err?.code === 'ENOTFOUND' ||
    err?.code === 'ECONNREFUSED' ||
    err?.code === 'ECONNRESET' ||
    err?.code === 'ETIMEDOUT' ||
    err?.name === 'TypeError' ||
    msg.includes('fetch failed') ||
    msg.includes('network')
  ) {
    return 'network'
  }
  return 'unknown'
}
