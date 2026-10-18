import type {
  AssessResult,
  LensContext,
  LensEvent,
  ProfileSnapshot,
  RewriteOutcome,
  RewriteRequest
} from '../types/lens'
import type { LensSettings, LensSettingsPatch } from '../types/settings'
import type { BridgeErrorCode } from './bridge'

export type Unsubscribe = () => void

export interface LensCallOptions {
  /** Aborting sends `cancel`; the call then resolves `skipped: cancelled`. */
  signal?: AbortSignal
}

/**
 * Everything in-page Lens code (lens-dom) needs from the app. Implemented by
 * the extension (service worker → hoot-bridge → app), the Reader window
 * (preload IPC) and `createFakeLensBackend` for tests.
 */
export interface LensBackend {
  assess(ctx: LensContext, opts?: LensCallOptions): Promise<AssessResult>
  rewrite(req: RewriteRequest, opts?: LensCallOptions): Promise<RewriteOutcome>
  feedback(event: LensEvent): Promise<void>
  /** "Explain more": opens the Hoot card with the span and its paragraph. */
  explainMore(ctx: LensContext): Promise<void>
  getProfile(): Promise<ProfileSnapshot>
  getSettings(): Promise<LensSettings>
  patchSettings(patch: LensSettingsPatch): Promise<LensSettings>
  onSettings(cb: (lens: LensSettings) => void): Unsubscribe
  onProfile(cb: (profile: ProfileSnapshot) => void): Unsubscribe
}

/** Rejection reason for every LensBackend method. */
export class LensBackendError extends Error {
  constructor(
    readonly code: BridgeErrorCode,
    message: string = code
  ) {
    super(message)
    this.name = 'LensBackendError'
  }
}
