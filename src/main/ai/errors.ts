/**
 * Provider error → the short code stored on `Message.error` and rendered by
 * the Transcript. The codes predate the Gemini switch and are kept so
 * persisted sessions still render: '401' = key rejected, '429' = rate
 * limited, '529' = provider busy.
 */
export type AiErrorCode = '401' | '429' | '529' | 'blocked' | 'network' | 'unknown'

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

export class AiBlockedError extends Error {
  constructor(readonly reason: string) {
    super(`Response blocked: ${reason}`)
    this.name = 'AiBlockedError'
  }
}

export function mapAiError(e: unknown): AiErrorCode {
  if (e instanceof AiBlockedError) return 'blocked'
  const err = e as { status?: number; message?: string; name?: string; code?: string }
  const msg = String(err?.message ?? '').toLowerCase()
  // Gemini answers a bad key with 400 API_KEY_INVALID, not 401.
  if (err?.status === 401 || err?.status === 403) return '401'
  if (err?.status === 400 && (msg.includes('api key') || msg.includes('api_key_invalid'))) {
    return '401'
  }
  if (err?.status === 429) return '429'
  if (err?.status === 500 || err?.status === 503 || err?.status === 504) return '529'
  if (msg.includes('overloaded') || msg.includes('unavailable')) return '529'
  if (
    err?.code === 'ENOTFOUND' ||
    err?.code === 'ECONNREFUSED' ||
    err?.code === 'ETIMEDOUT' ||
    err?.name === 'TypeError' ||
    msg.includes('fetch failed') ||
    msg.includes('network')
  ) {
    return 'network'
  }
  return 'unknown'
}
