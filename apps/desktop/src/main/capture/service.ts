import { randomUUID } from 'node:crypto'
import { Notification } from 'electron'
import {
  bboxOfPoints,
  liveScreenNote,
  physicalCropRect,
  screenTextBlock,
  type CaptureMode,
  type OverlayCommit,
  type OverlayInit,
  type Point,
  type Rect,
  type ScreenBox,
  type StudioView,
  type Unsubscribe
} from '@hoot/core'
import type { CodeWindowInfo } from '@hoot/core/code'
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
/** Live mode: the longest a send waits for the text under the shape. */
export const REGION_TEXT_WAIT_MS = 1500
/** Live mode: the longest a send waits for a shape still being saved. */
export const COMMIT_WAIT_MS = 3000

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
  /** Live mode: the chat was minimized into the owl; show the owl (default: `restore(false)`). */
  minimize?(): void
  /** Live mode: the minimized chat is coming back; put the owl away (default: `hide()`). */
  unminimize?(): void
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
  /**
   * Live mode: the readable text under a committed shape (screen DIP), from
   * the app's accessibility tree; it goes with the first message about it.
   */
  readScreenText?(rect: Rect): Promise<string | null>
  /** Live mode: left-click a screen point (DIP) for the user ("Click for me"). */
  clickScreen?(at: Point): Promise<boolean>
  /** Live mode: every left click anywhere on screen (screen DIP), while the overlay is open. */
  onScreenClick?(listener: (at: Point) => void): Unsubscribe
  /** Live mode: the owl's anchor (screen DIP), for a minimized chat to shrink into. */
  owlAnchor?(): Point
  /**
   * Live mode: the VS Code window in front when the overlay opens (the code
   * link). Messages then carry its code as text instead of a screen grab.
   */
  codeWindow?(): CodeWindowInfo | null
  /** Live mode: the code note for that window's next message; null falls back to a screen grab. */
  codeNote?(windowId: string): Promise<string | null>
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
  /** Live overlay open: click this display-local spot (DIP) on the real screen. */
  click(at: Point): Promise<boolean>
  /** Live overlay open: hide it into the owl; the chat and the shape stay as they are. */
  minimize(): Promise<void>
  /**
   * Bring a minimized overlay back (`draw`: straight to drawing a new shape).
   * False when nothing is minimized, so the caller does what it meant to.
   */
  restore(draw?: boolean): boolean
  isMinimized(): boolean
  isCapturing(): boolean
  /**
   * Live overlay open: grab the current screen (without the overlay in it),
   * add it to `chat.pendingAttachments` and return the note for the model;
   * null otherwise. When VS Code was in front, the note carries its code
   * instead and nothing is grabbed. The chat service calls it right before each send.
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
  /** Live mode: the text under the last shape, until the first message about it takes it. */
  regionText: Promise<string | null> | null
  /** Live mode: what the chat is about, in display DIP; null for the whole screen. */
  focus: Rect | null
  /** Live mode: the VS Code window Hoot reads instead of the screen; null when there's none. */
  code: CodeWindowInfo | null
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

/** A display-local rect (DIP) in the model's 0–1000 coordinates of the full-screen frame. */
export function screenBoxFor(rect: Rect, display: Rect): ScreenBox {
  const nx = (x: number): number =>
    Math.round(Math.min(1000, Math.max(0, (x / display.width) * 1000)))
  const ny = (y: number): number =>
    Math.round(Math.min(1000, Math.max(0, (y / display.height) * 1000)))
  return {
    x1: nx(rect.x),
    y1: ny(rect.y),
    x2: nx(rect.x + rect.width),
    y2: ny(rect.y + rect.height)
  }
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
  /** Live mode: hidden into the owl; `open` (and the overlay page) stay as they were. */
  let minimized = false
  /**
   * Live shapes are saved one at a time, in order, and only the newest one
   * waiting runs: a shape drawn while the last is still saving is never lost.
   */
  let commitChain: Promise<void> = Promise.resolve()
  let commitSeq = 0
  /** Grabs in flight that need the overlay out of the picture (they can overlap). */
  let excluding = 0
  let unwatchClicks: Unsubscribe | null = null
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
    minimized = false
    unwatchClicks?.()
    unwatchClicks = null
    overlay.hide()
    if (live) {
      // The chat happened in the overlay: no card, but put back what was hidden,
      // unless the chat moved to Studio ("Open in chat").
      discardLive()
      if (studio.isVisible()) log.info('capture: closed into Studio')
      else if (hidden.studio) studio.open(hidden.studio)
      else surfaces?.restore(false)
    } else if (hidden.studio) {
      // A new capture shows in the chat composer; onboarding is never cut short.
      studio.open(added && hidden.studio !== 'onboarding' ? 'chat' : hidden.studio)
    } else surfaces?.restore(added)
    hidden = { studio: null }
    busy = false
  }

  /**
   * Live mode keeps the overlay open: each shape becomes a fresh chat about
   * it. A region goes in as a crop (taken without the overlay in it) and
   * becomes the chat's focus; the whole screen needs no crop of its own,
   * because a fresh frame goes with every message anyway.
   */
  const commitLive = async (current: Open, commit: OverlayCommit): Promise<void> => {
    try {
      // The new chat first, so the old conversation never shows over the new shape.
      await deps.newChat?.()
      if (open !== current) return
      const { bounds, id } = current.grab.display
      const dip = cropFor(commit, bounds)
      if (!dip) return
      current.focus = commit.kind === 'full' ? null : dip
      // Read alongside the save; the first send waits for it (briefly).
      current.regionText =
        deps
          .readScreenText?.({ ...dip, x: bounds.x + dip.x, y: bounds.y + dip.y })
          .catch(() => null) ?? null
      const fresh = current.fresh
      current.fresh = false
      if (commit.kind === 'full') return
      const grab = fresh ? current.grab : await liveGrab(id)
      if (open !== current) return
      if (!grab || grab.image.isBlank()) {
        notify(COPY.failed)
        return
      }
      const { image, display } = grab
      const crop = physicalCropRect(
        dip,
        image.width / display.bounds.width,
        image.width,
        image.height
      )
      if (crop.width < 2 || crop.height < 2) return
      const added = await addImageAttachment(attachmentDeps, image.crop(crop), 'capture')
      liveIds.add(added.id)
    } catch (e) {
      log.error(`capture: saving failed: ${String(e)}`)
      notify(COPY.failed)
    }
  }

  /** The current full screen as the message's last image; true when it went in. */
  const attachFrame = async (current: Open): Promise<boolean> => {
    if (store.get('chat').pendingAttachments.length >= MAX_PENDING) return false
    try {
      const grab = await liveGrab(current.grab.display.id)
      if (!grab || grab.image.isBlank() || open !== current) return false
      const added = await addImageAttachment(attachmentDeps, grab.image, 'capture')
      liveIds.add(added.id)
      return true
    } catch (e) {
      log.warn(`capture: live frame failed: ${String(e)}`)
      return false
    }
  }

  /** The owl on the overlay's display (overlay-local DIP), or null when it's elsewhere. */
  const owlOn = (display: Rect): Point | null => {
    const a = deps.owlAnchor?.()
    if (!a) return null
    const p = { x: a.x - display.x, y: a.y - display.y }
    return p.x >= 0 && p.y >= 0 && p.x < display.width && p.y < display.height ? p : null
  }

  const service: CaptureService = {
    async start(mode = 'lasso') {
      // Circling again while the chat sits in the owl: bring it back, ready to draw.
      if (service.restore(true)) return
      if (busy) return
      if (store.get('chat').pendingAttachments.length >= MAX_PENDING) {
        notify(COPY.full)
        return
      }
      busy = true
      // Before anything of ours takes focus: was VS Code in front?
      const code = live ? (deps.codeWindow?.() ?? null) : null
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
          regionText: null,
          focus: null,
          code,
          init: {
            // Live: '' tells the overlay to show the real screen, not a still.
            imageDataUrl: live ? '' : grab.image.toJpegDataUrl(90),
            displayWidth: bounds.width,
            displayHeight: bounds.height,
            mode,
            accentColor: store.get('system').accentColor,
            pendingCount: store.get('chat').pendingAttachments.length,
            ...(live ? { owlAt: owlOn(bounds), code: code && { name: code.name } } : {})
          }
        }
        overlay.show(bounds)
        if (live && deps.onScreenClick) {
          unwatchClicks?.()
          unwatchClicks = deps.onScreenClick((at) => {
            if (!open || minimized) return
            const b = open.grab.display.bounds
            const local = { x: at.x - b.x, y: at.y - b.y }
            if (local.x < 0 || local.y < 0 || local.x >= b.width || local.y >= b.height) return
            overlay.userClicked?.(local)
          })
        }
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
        const seq = ++commitSeq
        const run = commitChain.then(() =>
          seq === commitSeq && open === current ? commitLive(current, commit) : undefined
        )
        commitChain = run.catch(() => undefined)
        await run
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

    async click(at) {
      const current = open
      if (!live || !current || !deps.clickScreen) return false
      const { bounds } = current.grab.display
      const x = Math.min(Math.max(0, at.x), bounds.width - 1)
      const y = Math.min(Math.max(0, at.y), bounds.height - 1)
      return deps.clickScreen({ x: bounds.x + x, y: bounds.y + y })
    },

    async minimize() {
      if (!live || !open || minimized) return
      minimized = true
      overlay.minimize?.()
      if (surfaces?.minimize) surfaces.minimize()
      else surfaces?.restore(false)
    },

    restore(draw = false) {
      const current = open
      if (!minimized || !current) return false
      minimized = false
      if (surfaces?.unminimize) surfaces.unminimize()
      else void surfaces?.hide()
      overlay.restore?.({ owlAt: owlOn(current.grab.display.bounds), draw })
      return true
    },

    isMinimized: () => minimized,

    isCapturing: () => busy,

    async attachLiveScreen() {
      // A shape still being saved goes with this message (never wait forever).
      await Promise.race([commitChain, wait(COMMIT_WAIT_MS)])
      const current = open
      // Minimized: a message from the owl's card is a plain chat message.
      if (!live || !current || minimized) return null
      const pendingText = current.regionText
      current.regionText = null
      const regionText = pendingText
        ? Promise.race([pendingText, wait(REGION_TEXT_WAIT_MS).then(() => null)])
        : null
      // VS Code was in front: its code goes as text, no screen grab.
      if (current.code && deps.codeNote) {
        const [note, text] = await Promise.all([
          deps.codeNote(current.code.id).catch(() => null),
          regionText
        ])
        if (open !== current) return null
        if (note)
          return [note, text?.trim() ? screenTextBlock(text) : null].filter(Boolean).join('\n\n')
        log.warn('capture: VS Code didn’t answer; sending the screen instead')
      }
      const [framed, text] = await Promise.all([attachFrame(current), regionText])
      if (open !== current) return null
      const region = current.focus && screenBoxFor(current.focus, current.grab.display.bounds)
      const notes = [
        framed ? liveScreenNote(region) : null,
        text?.trim() ? screenTextBlock(text) : null
      ].filter(Boolean)
      return notes.length ? notes.join('\n\n') : null
    },

    prewarm() {
      overlay.prepare()
      grabber.prewarm()
    }
  }
  return service
}
