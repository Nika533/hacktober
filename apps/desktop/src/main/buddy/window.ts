import { screen as electronScreen } from 'electron'
import {
  clampAnchor,
  greetingFor,
  HOOT_API_ROUTES,
  type BuddyMode,
  type DragEnd,
  type ModeLayout,
  type Point,
  type Rect,
  type RequestedMode,
  type Unsubscribe
} from '@hoot/core'
import type { Logger } from '../log'
import type { Store } from '../store/store'
import { createSecureWindow, loadRenderer, type WindowRegistry } from '../windows/base'
import { fixedLayout, anchorAfterDrag, cursorInRegions } from './hitTest'
import { initialMachine, reduce, type BuddyEvent, type MachineState } from './machine'

const TRANSITION_FALLBACK_MS = 450
const CURSOR_POLL_MS = 50 // 20 Hz
const ANCHOR_INSET = 40

const TRANSITION_CHANNEL = HOOT_API_ROUTES.buddy.onTransition.channel
const CURSOR_CHANNEL = HOOT_API_ROUTES.buddy.onCursor.channel

/** The part of Electron's `screen` the buddy needs. */
export interface BuddyScreen {
  getCursorScreenPoint(): Point
  getDisplayNearestPoint(p: Point): { workArea: Rect }
  getPrimaryDisplay(): { workArea: Rect }
}

/** The slice of BrowserWindow the controller uses; tests inject a fake. */
export interface BuddyWindowLike {
  show(): void
  hide(): void
  focus(): void
  isVisible(): boolean
  isFocused(): boolean
  isDestroyed(): boolean
  setIgnoreMouseEvents(ignore: boolean, opts?: { forward?: boolean }): void
  setPosition(x: number, y: number): void
  setBounds(bounds: Rect): void
  getBounds(): Rect
  on(event: 'focus' | 'blur' | 'closed', listener: () => void): unknown
  webContents: {
    send(channel: string, payload: unknown): void
    invalidate(): void
  }
}

export interface BuddyTimers {
  setTimeout(fn: () => void, ms: number): unknown
  clearTimeout(handle: unknown): void
  setInterval(fn: () => void, ms: number): unknown
  clearInterval(handle: unknown): void
}

export interface BuddyDeps {
  store: Store
  windows: WindowRegistry
  log: Logger
  screen?: BuddyScreen
  /** Default: a real secure BrowserWindow. Tests inject a fake. */
  createWindow?: (bounds: Rect) => BuddyWindowLike
  timers?: BuddyTimers
  now?: () => number
}

export interface BuddyWindow {
  summon(): void
  toggle(): void
  hide(): void
  request(mode: RequestedMode): void
  transitionDone(id: number): void
  /** Renderer hover hint (`buddy.setIgnoreMouse`); OR-ed with hit-region polling. */
  setIgnoreMouse(ignore: boolean): void
  setHitRegions(rects: Rect[]): void
  dragStart(): void
  dragMove(): void
  dragEnd(v: DragEnd): void
  /** Eyes follow the cursor only while on; hit-testing never stops. */
  setCursorTracking(on: boolean): void
  dismissGreeting(): void
  setAnchor(p: Point): void
  /** The owl's current anchor (screen DIP): live position or the saved default. */
  anchor(): Point
  mode(): BuddyMode
  isFocused(): boolean
  onModeChange(cb: (mode: BuddyMode) => void): Unsubscribe
  dispose(): void
}

const defaultTimers: BuddyTimers = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (h) => clearTimeout(h as NodeJS.Timeout),
  setInterval: (fn, ms) => setInterval(fn, ms),
  clearInterval: (h) => clearInterval(h as NodeJS.Timeout)
}

const samePoint = (a: Point, b: Point): boolean => a.x === b.x && a.y === b.y

const sameLayout = (a: ModeLayout | null, b: ModeLayout | null): boolean =>
  a === b ||
  (a !== null &&
    b !== null &&
    a.openX === b.openX &&
    a.openY === b.openY &&
    a.bounds.x === b.bounds.x &&
    a.bounds.y === b.bounds.y &&
    a.bounds.width === b.bounds.width &&
    a.bounds.height === b.bounds.height &&
    samePoint(a.owl, b.owl))

const sameRects = (a: Rect, b: Rect): boolean =>
  a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height

/**
 * Main-side buddy: one fixed card-sized transparent window, the pure mode
 * machine, a 20 Hz cursor poller for click-through and eye tracking, and
 * legacy 1:1 drag + flick-and-snap. Main owns all timing: it sends
 * `buddy:transition` and the renderer acks with `transitionDone`.
 */
export function createBuddyWindow(deps: BuddyDeps): BuddyWindow {
  const { store, log } = deps
  const scr = deps.screen ?? (electronScreen as BuddyScreen)
  const t = deps.timers ?? defaultTimers
  const now = deps.now ?? (() => Date.now())

  let win: BuddyWindowLike | null = null
  let machine: MachineState = initialMachine
  let liveAnchor: Point | null = null
  let lastLayout: ModeLayout | null = null

  let ignoreMouse = true
  let regionsInside = false
  let rendererInside = false
  let hitRects: Rect[] = []
  let cursorTracking = true
  let dragging = false
  let animating = false
  let focused = false
  let dragOffset: Point = { x: 0, y: 0 }

  let collapseTimer: unknown = null
  let transitionTimer: unknown = null
  let pollTimer: unknown = null
  let animTimer: unknown = null

  const modeCbs = new Set<(mode: BuddyMode) => void>()

  const workAreaFor = (p: Point): Rect => scr.getDisplayNearestPoint(p).workArea

  const defaultAnchor = (): Point => {
    const wa = scr.getPrimaryDisplay().workArea
    return { x: wa.x + wa.width - ANCHOR_INSET, y: wa.y + wa.height - ANCHOR_INSET }
  }

  const resolvedAnchor = (): Point => {
    const saved = store.get('settings').settings.pillAnchor ?? defaultAnchor()
    return clampAnchor(saved, workAreaFor(saved), ANCHOR_INSET)
  }

  const anchor = (): Point => liveAnchor ?? resolvedAnchor()

  const isInside = (): boolean => dragging || rendererInside || regionsInside

  const applyIgnore = (): void => {
    if (!win || win.isDestroyed()) return
    const ignore = !isInside()
    if (ignore === ignoreMouse) return
    ignoreMouse = ignore
    win.setIgnoreMouseEvents(ignore, { forward: true })
  }

  const send = (channel: string, payload: unknown): void => {
    if (win && !win.isDestroyed()) win.webContents.send(channel, payload)
  }

  // ---- collapse to dot ---------------------------------------------------

  const clearCollapse = (): void => {
    if (collapseTimer !== null) {
      t.clearTimeout(collapseTimer)
      collapseTimer = null
    }
  }

  const collapseBlocked = (): boolean =>
    machine.mode !== 'pill' ||
    machine.pending !== null ||
    isInside() ||
    focused ||
    dragging ||
    store.get('chat').stream !== null

  const scheduleCollapse = (): void => {
    clearCollapse()
    if (collapseBlocked()) return
    const delay = store.get('settings').settings.collapseToDotAfterMs
    if (delay <= 0) return // "Never"
    collapseTimer = t.setTimeout(() => {
      collapseTimer = null
      if (!collapseBlocked()) dispatch({ type: 'collapse' })
    }, delay)
  }

  // ---- layout ------------------------------------------------------------

  /** Push mode + layout into the slice and move the window to the anchor. */
  const syncSlice = (): void => {
    const a = anchor()
    const layout = machine.mode === 'hidden' ? null : fixedLayout(a, workAreaFor(a))
    const buddy = store.get('buddy')
    const patch: Partial<typeof buddy> = {}
    if (buddy.mode !== machine.mode) patch.mode = machine.mode
    if (!sameLayout(buddy.layout, layout)) patch.layout = layout
    if (machine.mode === 'hidden' && buddy.greeting !== null) patch.greeting = null
    if (Object.keys(patch).length > 0) store.update('buddy', patch)
    lastLayout = layout
    if (layout !== null && win && !win.isDestroyed() && !dragging && !animating) {
      if (!sameRects(layout.bounds, win.getBounds())) win.setBounds(layout.bounds)
    }
  }

  // ---- effects -----------------------------------------------------------

  const lastSession = (): { title: string; updatedAt: number } | undefined => {
    const chat = store.get('chat')
    const active = chat.session
    if (active && active.messages.length > 0)
      return { title: active.title, updatedAt: active.updatedAt }
    const list = store.get('sessions').list
    if (list.length === 0) return undefined
    const newest = list.reduce((a, b) => (b.updatedAt > a.updatedAt ? b : a))
    return { title: newest.title, updatedAt: newest.updatedAt }
  }

  const applyEffect = (fx: ReturnType<typeof reduce>['effects'][number]): void => {
    switch (fx.kind) {
      case 'show':
        if (win && !win.isDestroyed() && !win.isVisible()) {
          win.show()
          // Transparent windows re-show with a blank frame without this.
          win.webContents.invalidate()
        }
        break
      case 'hideWindow':
        if (win && !win.isDestroyed()) win.hide()
        break
      case 'focus':
        if (win && !win.isDestroyed()) win.focus()
        break
      case 'transition':
        send(TRANSITION_CHANNEL, { id: fx.id, from: fx.from, to: fx.to })
        if (transitionTimer !== null) t.clearTimeout(transitionTimer)
        transitionTimer = t.setTimeout(() => {
          transitionTimer = null
          dispatch({ type: 'transitionTimeout', id: fx.id })
        }, TRANSITION_FALLBACK_MS)
        break
      case 'greet':
        store.update('buddy', {
          greeting: greetingFor(
            new Date(now()),
            lastSession(),
            store.get('chat').clipboardHint !== null
          )
        })
        break
      case 'clearAnswerReady':
        store.update('buddy', { answerReady: false })
        break
      case 'startCollapseTimer':
        scheduleCollapse()
        break
      case 'stopCollapseTimer':
        clearCollapse()
        break
    }
  }

  const dispatch = (e: BuddyEvent): void => {
    const prev = machine.mode
    const { state, effects } = reduce(machine, e)
    if (state === machine && effects.length === 0) return
    machine = state
    syncSlice()
    for (const fx of effects) applyEffect(fx)
    if (machine.pending === null && transitionTimer !== null) {
      t.clearTimeout(transitionTimer)
      transitionTimer = null
    }
    syncPoll()
    scheduleCollapse()
    if (machine.mode !== prev) for (const cb of modeCbs) cb(machine.mode)
  }

  // ---- cursor poller -------------------------------------------------------

  const tick = (): void => {
    if (!win || win.isDestroyed() || !win.isVisible()) return
    const cursor = scr.getCursorScreenPoint()
    const bounds = win.getBounds()
    const layout = store.get('buddy').layout
    if (cursorTracking && layout && (machine.mode === 'dot' || machine.mode === 'pill')) {
      send(CURSOR_CHANNEL, {
        x: cursor.x - (bounds.x + layout.owl.x),
        y: cursor.y - (bounds.y + layout.owl.y)
      })
    }
    regionsInside = cursorInRegions(cursor, bounds, hitRects)
    applyIgnore()
  }

  const syncPoll = (): void => {
    const want = win !== null && !win.isDestroyed() && win.isVisible()
    if (want && pollTimer === null) pollTimer = t.setInterval(tick, CURSOR_POLL_MS)
    else if (!want && pollTimer !== null) {
      t.clearInterval(pollTimer)
      pollTimer = null
    }
  }

  // ---- drag + spring -------------------------------------------------------

  const animateAnchorTo = (
    from: Point,
    to: Point,
    v0: { vx: number; vy: number },
    dampingRatio: number,
    done: () => void
  ): void => {
    if (animTimer !== null) t.clearInterval(animTimer)
    const layout = lastLayout
    if (!win || !layout) {
      animating = false
      liveAnchor = { ...to }
      done()
      return
    }
    const owl = layout.owl
    const wn = (2 * Math.PI) / 0.45 // ~0.45 s spring response
    const k = wn * wn
    const c = 2 * dampingRatio * wn
    let x = from.x
    let y = from.y
    let vx = v0.vx
    let vy = v0.vy
    const dt = 0.016
    let elapsed = 0
    animating = true
    animTimer = t.setInterval(() => {
      elapsed += dt
      const ax = -k * (x - to.x) - c * vx
      const ay = -k * (y - to.y) - c * vy
      vx += ax * dt
      vy += ay * dt
      x += vx * dt
      y += vy * dt
      liveAnchor = { x, y }
      if (win && !win.isDestroyed()) {
        win.setPosition(Math.round(x - owl.x), Math.round(y - owl.y))
      }
      const settled =
        (Math.abs(x - to.x) < 0.5 && Math.abs(y - to.y) < 0.5 && Math.hypot(vx, vy) < 8) ||
        elapsed > 0.9
      if (settled) {
        if (animTimer !== null) t.clearInterval(animTimer)
        animTimer = null
        animating = false
        liveAnchor = { ...to }
        done()
      }
    }, 16)
  }

  // ---- window --------------------------------------------------------------

  const createWindow =
    deps.createWindow ??
    ((bounds: Rect): BuddyWindowLike => {
      const real = createSecureWindow('buddy', {
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height,
        show: false,
        transparent: true,
        frame: false,
        alwaysOnTop: true,
        skipTaskbar: true,
        resizable: false,
        hasShadow: false,
        focusable: true,
        backgroundColor: '#00000000',
        webPreferences: { backgroundThrottling: false }
      })
      real.setAlwaysOnTop(true, 'floating')
      real.setIgnoreMouseEvents(true, { forward: true })
      deps.windows.set('buddy', real)
      loadRenderer(real, 'buddy')
      return real
    })

  const ensureWin = (): BuddyWindowLike => {
    if (win && !win.isDestroyed()) return win
    win = createWindow(fixedLayout(anchor(), workAreaFor(anchor())).bounds)
    ignoreMouse = true
    win.on('focus', () => {
      focused = true
      scheduleCollapse()
    })
    win.on('blur', () => {
      focused = false
      scheduleCollapse()
    })
    win.on('closed', () => {
      win = null
      if (pollTimer !== null) {
        t.clearInterval(pollTimer)
        pollTimer = null
      }
      clearCollapse()
      if (animTimer !== null) {
        t.clearInterval(animTimer)
        animTimer = null
        animating = false
      }
      if (transitionTimer !== null) {
        t.clearTimeout(transitionTimer)
        transitionTimer = null
      }
      dragging = false
    })
    return win
  }

  ensureWin()

  const persistAnchor = (p: Point): void => {
    const settings = store.get('settings').settings
    store.update('settings', { settings: { ...settings, pillAnchor: { ...p } } })
  }

  // Settings → "Reset position" writes pillAnchor: null — re-resolve and
  // relayout. chat changes re-evaluate the collapse guard (streaming pause).
  const unwatch = store.onChange((changed) => {
    if (!changed.has('settings') && !changed.has('chat')) return
    scheduleCollapse()
    if (!changed.has('settings')) return
    const wanted = resolvedAnchor()
    if (samePoint(wanted, anchor())) return
    liveAnchor = null
    syncSlice()
  })

  const buddy: BuddyWindow = {
    summon: () => {
      ensureWin()
      dispatch({ type: 'summon' })
    },
    toggle: () => {
      ensureWin()
      dispatch({ type: 'toggle', focused: focused || (win?.isFocused() ?? false) })
    },
    hide: () => dispatch({ type: 'hide' }),
    request: (mode) => {
      ensureWin()
      dispatch({ type: 'request', mode })
    },
    transitionDone: (id) => dispatch({ type: 'transitionDone', id }),
    setIgnoreMouse(ignore) {
      rendererInside = !ignore
      applyIgnore()
      scheduleCollapse()
    },
    setHitRegions(rects) {
      hitRects = rects
      if (win && !win.isDestroyed() && win.isVisible()) {
        const cursor = scr.getCursorScreenPoint()
        regionsInside = cursorInRegions(cursor, win.getBounds(), hitRects)
      }
      applyIgnore()
    },
    dragStart() {
      if (!win || win.isDestroyed() || machine.mode === 'hidden') return
      dragging = true
      clearCollapse()
      const cursor = scr.getCursorScreenPoint()
      const a = anchor()
      dragOffset = { x: cursor.x - a.x, y: cursor.y - a.y }
      liveAnchor = a
      applyIgnore()
    },
    dragMove() {
      if (!dragging || !win || win.isDestroyed() || !lastLayout) return
      const cursor = scr.getCursorScreenPoint()
      liveAnchor = { x: cursor.x - dragOffset.x, y: cursor.y - dragOffset.y }
      win.setPosition(
        Math.round(liveAnchor.x - lastLayout.owl.x),
        Math.round(liveAnchor.y - lastLayout.owl.y)
      )
    },
    dragEnd(v) {
      if (!dragging || !win || win.isDestroyed()) return
      dragging = false
      const from = liveAnchor ?? anchor()
      const wa = workAreaFor(from)
      const target = anchorAfterDrag(from, v, wa)
      const ratio = Math.hypot(v.vx, v.vy) > 300 ? 0.78 : 1.0
      animateAnchorTo(from, target, v, ratio, () => {
        const layout = machine.mode === 'hidden' ? null : fixedLayout(target, wa)
        if (win && !win.isDestroyed() && layout) win.setBounds(layout.bounds)
        lastLayout = layout
        persistAnchor(target)
        if (layout) store.update('buddy', { layout })
        scheduleCollapse()
      })
    },
    setCursorTracking: (on) => {
      cursorTracking = on
    },
    dismissGreeting: () => {
      store.update('buddy', { greeting: null })
    },
    setAnchor(p) {
      const wa = workAreaFor(p)
      const clamped = clampAnchor(p, wa, ANCHOR_INSET)
      liveAnchor = clamped
      persistAnchor(clamped)
      syncSlice()
    },
    anchor,
    mode: () => machine.mode,
    isFocused: () => focused || (win?.isFocused() ?? false),
    onModeChange(cb) {
      modeCbs.add(cb)
      return () => modeCbs.delete(cb)
    },
    dispose() {
      unwatch()
      clearCollapse()
      if (transitionTimer !== null) {
        t.clearTimeout(transitionTimer)
        transitionTimer = null
      }
      if (pollTimer !== null) {
        t.clearInterval(pollTimer)
        pollTimer = null
      }
      if (animTimer !== null) {
        t.clearInterval(animTimer)
        animTimer = null
      }
    }
  }

  log.info('buddy window created')
  return buddy
}
