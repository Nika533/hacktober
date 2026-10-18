import { randomUUID } from 'node:crypto'
import { Notification } from 'electron'
import {
  bboxOfPoints,
  LIVE_SCREEN_NOTE,
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
/** Live mode: the compositor needs a frame to drop the overlay from captures. */
export const EXCLUDE_SETTLE_MS = 60

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
  /**
   * The live overlay (off under HOOT_TEST): transparent over the real, moving
   * screen, open after a commit so the user chats about it in place, and a
   * fresh full-screen frame goes with every message (`attachLiveScreen`).
   */
  live?: boolean
  /** Live mode: each committed shape starts a fresh chat about it. */
  newChat?(): void | Promise<void>
  /**
   * Live mode: keep the overlay out of the frames sent to the model (default).
   * Off for a recorded demo, where each grab would blank it in the recording.
   */
  excludeFromGrabs?: boolean
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
   * Live overlay open: grab the current screen (without the overlay in it),
   * add it to `chat.pendingAttachments` and return the note for the model;
   * null otherwise. The chat service calls it right before each send.
   */
  attachLiveScreen(): Promise<string | null>
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
  /** Live mode: the start grab is still unused (later shapes need a new one). */
  fresh: boolean
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
  const live = deps.live ?? false
  const overlay =
    deps.overlay ??
    createOverlayWindow({ windows, onDismiss: () => void service.cancel(), live, log })
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
  let committing = false
  /** Grabs in flight that need the overlay out of the picture (they can overlap). */
  let excluding = 0
  /** Attachments the live overlay added, dropped on close if still unsent. */
  const liveIds = new Set<string>()
  const exclude = deps.excludeFromGrabs ?? true

  /** The display now, without the live overlay in the picture. */
  const liveGrab = async (displayId: number): Promise<Grab | null> => {
    if (!exclude) return grabber.grab(displayId)
    if (excluding++ === 0) overlay.setCaptureExcluded?.(true)
    try {
      await wait(EXCLUDE_SETTLE_MS)
      return await grabber.grab(displayId)
    } finally {
      if (--excluding === 0) overlay.setCaptureExcluded?.(false)
    }
  }

  /** Closing the live overlay never leaves its captures to ride along with a later send. */
  const discardLive = (): void => {
    const pending = store.get('chat').pendingAttachments
    const drop = pending.filter((a) => liveIds.has(a.id))
    liveIds.clear()
    if (drop.length === 0) return
    store.update('chat', { pendingAttachments: pending.filter((a) => !drop.includes(a)) })
    for (const a of drop) {
      void persistence
        .deleteAttachment(a.id)
        .catch((e: unknown) => log.warn(`capture: dropping ${a.id} failed: ${String(e)}`))
    }
  }

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
    if (live) {
      // The chat happened in the overlay: no card, but put back what was hidden.
      discardLive()
      if (hidden.studio) studio.open(hidden.studio)
      else surfaces?.restore(false)
    } else if (hidden.studio) {
      // A new capture shows in the chat composer; onboarding is never cut short.
      studio.open(added && hidden.studio !== 'onboarding' ? 'chat' : hidden.studio)
    } else surfaces?.restore(added)
    hidden = { studio: null }
    busy = false
  }

  /**
   * Live mode keeps the overlay open: each shape becomes a fresh chat with the
   * circled region attached, and redrawing starts over with a new grab.
   */
  const commitLive = async (current: Open, commit: OverlayCommit): Promise<void> => {
    if (committing) return
    committing = true
    try {
      // The new chat first, so the old conversation never shows over the new shape.
      await deps.newChat?.()
      const grab = current.fresh ? current.grab : await liveGrab(current.grab.display.id)
      current.fresh = false
      if (open !== current) return
      if (!grab || grab.image.isBlank()) {
        notify(COPY.failed)
        return
      }
      const { image, display } = grab
      const dip = cropFor(commit, display.bounds)
      const crop =
        dip && physicalCropRect(dip, image.width / display.bounds.width, image.width, image.height)
      if (!crop || crop.width < 2 || crop.height < 2) return
      const added = await addImageAttachment(attachmentDeps, image.crop(crop), 'capture')
      liveIds.add(added.id)
    } catch (e) {
      log.error(`capture: saving failed: ${String(e)}`)
      notify(COPY.failed)
    } finally {
      committing = false
    }
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
          fresh: true,
          init: {
            // Live: '' tells the overlay to show the real screen, not a still.
            imageDataUrl: live ? '' : grab.image.toJpegDataUrl(90),
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
      if (live) {
        await commitLive(current, commit)
        return
      }
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

    async attachLiveScreen() {
      const current = open
      if (!live || !current) return null
      if (store.get('chat').pendingAttachments.length >= MAX_PENDING) return null
      try {
        const grab = await liveGrab(current.grab.display.id)
        if (!grab || grab.image.isBlank() || open !== current) return null
        const added = await addImageAttachment(attachmentDeps, grab.image, 'capture')
        liveIds.add(added.id)
        return LIVE_SCREEN_NOTE
      } catch (e) {
        log.warn(`capture: live frame failed: ${String(e)}`)
        return null
      }
    },

    prewarm() {
      overlay.prepare()
      grabber.prewarm()
    }
  }
  return service
}
