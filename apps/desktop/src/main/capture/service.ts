import type { CaptureMode, OverlayCommit, OverlayInit } from '@hoot/core'
import type { Logger } from '../log'
import type { Persistence } from '../store/persistence'
import type { Store } from '../store/store'
import type { WindowRegistry } from '../windows/base'

/** Captures one message may carry (the composer's chips). */
export const MAX_PENDING = 4

/**
 * What Hoot shows on screen. Capture hides it before the grab, so it isn't in
 * the picture, and restores it afterwards. d1's buddy machine provides this;
 * without it, capture only hides and re-shows Studio.
 */
export interface CaptureSurfaces {
  hide(): void
  /** `added` is true when a capture went into the composer (the card should open). */
  restore(added: boolean): void
}

export interface CaptureDeps {
  store: Store
  windows: WindowRegistry
  /** Captures are saved as attachments (PNG) and listed in `chat.pendingAttachments`. */
  persistence: Persistence
  log: Logger
  surfaces?: CaptureSurfaces
}

export interface CaptureService {
  /**
   * Grab the display under the cursor and open the overlay on it. Does nothing
   * while an overlay is open or when MAX_PENDING captures are already waiting.
   */
  start(mode?: CaptureMode): Promise<void>
  /** What the overlay shows; null when no capture is open. */
  getInit(): OverlayInit | null
  /** Crop to the lasso, rectangle or full display and add it to the composer. */
  commit(commit: OverlayCommit): Promise<void>
  /** Close the overlay without capturing. */
  cancel(): Promise<void>
  isCapturing(): boolean
  /** Warm up the screen grabber once at idle (the first grab takes about 3 s cold). */
  prewarm(): void
}

/**
 * Screen capture (d2, F-D2-3). This is the skeleton from F-D2-0: the API d1
 * wires is final, and every call is a no-op until the overlay lands.
 */
export function createCaptureService(deps: CaptureDeps): CaptureService {
  return {
    async start(mode = 'lasso') {
      deps.log.info(`capture (${mode}) isn't available yet`)
    },
    getInit: () => null,
    async commit() {
      return undefined
    },
    async cancel() {
      return undefined
    },
    isCapturing: () => false,
    prewarm: () => undefined
  }
}
