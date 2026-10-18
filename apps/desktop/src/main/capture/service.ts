import { randomUUID } from 'node:crypto'
import { Notification } from 'electron'
import {
  bboxOfPoints,
  physicalCropRect,
  type CaptureMode,
  type OverlayCommit,
  type OverlayInit,
  type Rect,
  type StudioView
} from '@hoot/core'
import type { Logger } from '../log'
import type { Persistence } from '../store/persistence'
import type { Store } from '../store/store'
import type { WindowRegistry } from '../windows/base'
import type { StudioWindow } from '../windows/studio'
import { addImageAttachment } from './attachments'
import { createScreenGrabber, type Grab, type ScreenGrabber } from './grab'
import { createOverlayWindow, type OverlayHost } from './overlay'

/** Captures one message may carry (the composer's chips). */
export const MAX_PENDING = 4
/** Hidden windows need a moment to leave the screen before the grab. */
export const HIDE_DELAY_MS = 120
/** A lasso is cropped to its bounding box plus this margin (DIP). */
export const LASSO_PADDING = 8
/** Shapes smaller than this (DIP, either side) are treated as a stray click. */
export const MIN_SHAPE = 8

export const COPY = {
  full: 'Up to 4 captures per message. Send this one first, or remove a capture.',
  failed: 'Hoot couldn’t capture this screen. Some apps block screen capture.'
} as const

/**
 * What Hoot shows on screen. Capture hides it before the grab, so it isn't in
 * the picture, and restores it afterwards. d1's buddy machine provides this;
 * without it, capture only hides and re-shows Studio.
 */
export interface CaptureSurfaces {
  /**
   * Resolve once the owl is off the screen (an animated hide counts only when
   * its window is hidden); capture then waits HIDE_DELAY_MS for the compositor.
   */
  hide(): void | Promise<void>
  /** `added` is true when a capture went into the composer (the card should open). */
  restore(added: boolean): void
}

export interface CaptureDeps {
  store: Store
  windows: WindowRegistry
  /** A capture started from Studio hides it for the grab and reopens it on the same view. */
  studio: Pick<StudioWindow, 'open' | 'isVisible'>
  /** Captures are saved as attachments (PNG) and listed in `chat.pendingAttachments`. */
  persistence: Persistence
  log: Logger
  surfaces?: CaptureSurfaces
  /** Seams for tests; the defaults use Electron. */
  grabber?: ScreenGrabber
  overlay?: OverlayHost
  notify?(message: string): void
  wait?(ms: number): Promise<void>
  newId?(): string
  now?(): number
}

export interface CaptureService {
  /**
   * Grab the display under the cursor and open the overlay on it. Does nothing
   * while a capture is under way, and only explains when MAX_PENDING captures
   * are already waiting.
   */
  start(mode?: CaptureMode): Promise<void>
  /** What the overlay shows; null when no capture is open. */
  getInit(): OverlayInit | null
  /** Crop to the lasso, rectangle or full display and add it to the composer. */
  commit(commit: OverlayCommit): Promise<void>
  /** Close the overlay without capturing. */
  cancel(): Promise<void>
  isCapturing(): boolean
  /**
   * Create the overlay window now; the screen grabber warms up once the app has
   * settled (its first grab blocks main). Safe to call at startup.
   */
  prewarm(): void
}

interface Open {
  grab: Grab
  /** Image px per DIP, from the size Electron actually returned (D1-00). */
  ratio: number
  init: OverlayInit
}

/** Where to put things back: Studio on its view, or the surfaces hook. */
type Hidden = { studio: StudioView } | { studio: null }

/** The crop, in display DIP, for what the user drew; null when it's too small. */
export function cropFor(commit: OverlayCommit, display: Rect): Rect | null {
  const local: Rect = { x: 0, y: 0, width: display.width, height: display.height }
  const rect =
    commit.kind === 'full'
      ? local
      : commit.kind === 'rect'
        ? commit.rect
        : bboxOfPoints(commit.points, LASSO_PADDING, local)
  if (!rect || rect.width < MIN_SHAPE || rect.height < MIN_SHAPE) return null
  return rect
}

/** Screen capture (d2, F-D2-3): circle anything, crop it, attach it to the next message. */
export function createCaptureService(deps: CaptureDeps): CaptureService {
  const { store, windows, studio, persistence, log, surfaces } = deps
  const notify = deps.notify ?? ((body: string) => new Notification({ title: 'Hoot', body }).show())
  const wait = deps.wait ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
  const grabber = deps.grabber ?? createScreenGrabber(log)
  const overlay =
    deps.overlay ?? createOverlayWindow({ windows, onDismiss: () => void service.cancel() })
  const attachmentDeps = {
    store,
    persistence,
    newId: deps.newId ?? randomUUID,
    now: deps.now ?? Date.now
  }

  /** Set synchronously at start, cleared only when the capture is over. */
  let busy = false
  let hidden: Hidden = { studio: null }
  let open: Open | null = null

  const hide = async (): Promise<Hidden> => {
    if (studio.isVisible()) {
      const view = store.get('studio').view
      windows.get('studio')?.hide()
      return { studio: view }
    }
    await surfaces?.hide()
    return { studio: null }
  }

  const finish = (added: boolean): void => {
    open = null
    overlay.hide()
    // A new capture shows in the chat composer; onboarding is never cut short.
    if (hidden.studio) studio.open(added && hidden.studio !== 'onboarding' ? 'chat' : hidden.studio)
    else surfaces?.restore(added)
    hidden = { studio: null }
    busy = false
  }

  const service: CaptureService = {
    async start(mode = 'lasso') {
      if (busy) return
      if (store.get('chat').pendingAttachments.length >= MAX_PENDING) {
        notify(COPY.full)
        return
      }
      busy = true
      try {
        hidden = await hide()
        await wait(HIDE_DELAY_MS)
        const grabStarted = Date.now()
        const grab = await grabber.grab()
        log.info(
          `capture: ${mode}, grab ${grab ? `${grab.image.width}×${grab.image.height}` : 'none'} in ${Date.now() - grabStarted} ms`
        )
        if (!grab || grab.image.isBlank()) {
          log.warn(`capture: ${grab ? 'blank image' : 'no screen source'}`)
          notify(COPY.failed)
          finish(false)
          return
        }
        const { bounds } = grab.display
        open = {
          grab,
          ratio: grab.image.width / bounds.width,
          init: {
            imageDataUrl: grab.image.toJpegDataUrl(90),
            displayWidth: bounds.width,
            displayHeight: bounds.height,
            mode,
            accentColor: store.get('system').accentColor,
            pendingCount: store.get('chat').pendingAttachments.length
          }
        }
        overlay.show(bounds)
      } catch (e) {
        log.error(`capture failed: ${String(e)}`)
        notify(COPY.failed)
        finish(false)
      }
    },

    getInit: () => open?.init ?? null,

    async commit(commit) {
      const current = open
      if (!current) return
      // Taken now, so a second commit (double click, Enter + click) does nothing.
      open = null
      const { image, display } = current.grab
      const dip = cropFor(commit, display.bounds)
      const crop = dip && physicalCropRect(dip, current.ratio, image.width, image.height)
      if (!crop || crop.width < 2 || crop.height < 2) {
        finish(false)
        return
      }
      try {
        await addImageAttachment(attachmentDeps, image.crop(crop), 'capture')
        finish(true)
      } catch (e) {
        log.error(`capture: saving failed: ${String(e)}`)
        notify(COPY.failed)
        finish(false)
      }
    },

    async cancel() {
      if (open) finish(false)
    },

    isCapturing: () => busy,

    prewarm() {
      overlay.prepare()
      grabber.prewarm()
    }
  }
  return service
}
