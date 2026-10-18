import type { BridgeErrorCode, SkipReason } from '@hoot/core'

const ERRORS: Record<BridgeErrorCode, string> = {
  app_unavailable: 'Hoot isn’t running. Start Hoot, then retry.',
  unauthorized:
    'Hoot refused VS Code. Restart Hoot (it needs a version that knows Hoot Lens for VS Code), then retry.',
  version_mismatch: 'Hoot and Hoot Lens for VS Code speak different versions. Update both.',
  no_key: 'Add your Claude key in Hoot settings.',
  auth: 'Claude rejected your key. Check it in Hoot settings.',
  lens_off: 'Hoot Lens is off. Turn it on in Hoot settings (Reading).',
  rate_limited: 'Claude is rate limiting Hoot. Try again in a moment.',
  busy: 'Hoot is busy. Try again in a moment.',
  network: 'Hoot can’t reach Claude. Check your connection.',
  blocked: 'Hoot won’t change this text.',
  bad_request: 'Hoot couldn’t use this selection.',
  cancelled: 'Cancelled.',
  internal: 'Something went wrong in Hoot.'
}

/** What to tell the user when a request fails with `code`. */
export const errorMessage = (code: BridgeErrorCode): string => ERRORS[code]

/** Errors the user fixes by starting or restarting Hoot: worth a Retry button. */
export const isConnectionError = (code: BridgeErrorCode): boolean =>
  code === 'app_unavailable' || code === 'unauthorized'

/** Status bar text for a skipped rewrite; null when nothing should show. */
export function skipMessage(reason: SkipReason): string | null {
  if (reason === 'cancelled') return null
  if (reason === 'lens_off') return 'Hoot Lens is off. Turn it on in Hoot settings (Reading).'
  return 'Hoot: nothing to change'
}
