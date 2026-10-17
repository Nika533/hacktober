import { BrowserWindow, screen, shell } from 'electron'
import path from 'path'
import type { AppState, BuddyMode, ModeLayout, Point, Rect } from '../../shared/types'
import { clampAnchor, layoutForMode, project, snapToEdges } from '../../shared/geometry'
import { IPC } from '../../shared/ipc'
import { CursorTracker } from '../cursor'

const MODE_RANK: Record<BuddyMode, number> = { hidden: 0, dot: 1, pill: 2, card: 3 }
const EXIT_FALLBACK_MS = 450
const DRAG_THRESHOLD_DIP = 6
const EDGE_SNAP_THRESHOLD = 48
const ANCHOR_INSET = 40

export interface BuddyDeps {
  getState(): AppState
  update(mut: (s: AppState) => void): void
  isDev(): boolean
  rendererUrl(page: string): string
  onDismissGreeting(): void
  onSchedulePersist(): void
}

function workAreaFor(p: Point): Rect {
  return screen.getDisplayNearestPoint(p).workArea
}

export function defaultAnchor(): Point {
  const wa = screen.getPrimaryDisplay().workArea
  return { x: wa.x + wa.width - ANCHOR_INSET, y: wa.y + wa.height - ANCHOR_INSET }
}

export function resolvedAnchor(state: AppState): Point {
  const saved = state.settings.pillAnchor ?? defaultAnchor()
  return clampAnchor(saved, workAreaFor(saved), ANCHOR_INSET)
}

export class BuddyWindow {
  win: BrowserWindow | null = null
  hovered = false
  focused = false
  private ignoreMouse = true
  private dragging = false
  private dragOffset: Point = { x: 0, y: 0 }
  private liveAnchor: Point | null = null
  private cursorTracker = new CursorTracker((offset) => {
    if (this.win && !this.win.isDestroyed()) this.win.webContents.send(IPC.cursor, offset)
  })
  private cursorTracking = true
  private collapseTimer: NodeJS.Timeout | null = null
  private exitTimer: NodeJS.Timeout | null = null
  private pendingExit: { mode: BuddyMode; layout: ModeLayout } | null = null
  private exiting = false
  private animTimer: NodeJS.Timeout | null = null
  private suspended = false

  constructor(private deps: BuddyDeps) {}

  get mode(): BuddyMode {
    return this.deps.getState().buddyMode
  }

  get anchor(): Point {
    if (this.liveAnchor) return this.liveAnchor
    return resolvedAnchor(this.deps.getState())
  }

  create(): void {
    const wa = screen.getPrimaryDisplay().workArea
    this.win = new BrowserWindow({
      x: wa.x + wa.width - 300,
      y: wa.y + wa.height - 300,
      width: 248,
      height: 160,
      show: false,
      transparent: true,
      frame: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      resizable: false,
      hasShadow: false,
      focusable: true,
      backgroundColor: '#00000000',
      webPreferences: {
        preload: path.join(__dirname, '../preload/index.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
        // keep the compositor producing frames while hidden so a
        // transparent window never re-shows with a stale/blank frame
        backgroundThrottling: false
      }
    })
    this.win.setAlwaysOnTop(true, 'floating')
    this.win.setVisibleOnAllWorkspaces(true)
    this.win.webContents.setWindowOpenHandler(({ url }) => {
      if (url.startsWith('https://') || url.startsWith('http://')) {
        void shell.openExternal(url)
      }
      return { action: 'deny' }
    })

    // Click-through for transparent regions is driven by the renderer's
    // hit-testing; start ignoring so nothing blocks the desktop.
    this.win.setIgnoreMouseEvents(true, { forward: true })

    this.win.on('focus', () => {
      this.focused = true
      this.scheduleCollapse()
    })
    this.win.on('blur', () => {
      this.focused = false
      this.scheduleCollapse()
    })
    this.win.on('closed', () => {
      this.win = null
    })

    const url = this.deps.rendererUrl('buddy.html')
    if (this.deps.isDev()) void this.win.loadURL(url)
    else void this.win.loadFile(url)
  }

  // ---- mode transitions -------------------------------------------------

  summon(): void {
    if (this.mode !== 'hidden') return
    this.requestMode('pill')
  }

  toggleSummon(): void {
    if (this.mode === 'hidden') {
      this.summon()
    } else if (this.focused) {
      this.requestMode('hidden')
    } else {
      if (this.mode === 'dot') this.requestMode('pill')
      else this.win?.focus()
    }
  }

  /**
   * Hide the window instantly without changing buddyMode — used while the
   * capture overlay or Studio is up so `resume` can restore the mode.
   */
  suspend(): void {
    if (this.suspended) return
    this.suspended = true
    this.win?.hide()
  }

  resume(target: BuddyMode): void {
    this.suspended = false
    if (!this.win) return
    const mode = this.deps.getState().buddyMode
    if (target === mode && target !== 'hidden') {
      this.win.show()
      this.win.webContents.invalidate()
    } else {
      this.requestMode(target)
    }
  }

  isSuspended(): boolean {
    return this.suspended
  }

  requestMode(next: BuddyMode): void {
    const state = this.deps.getState()
    const cur = state.buddyMode
    if (next === cur) return
    if (!this.win) return
    this.suspended = false

    // If a shrink is mid-flight, finish it immediately then continue.
    if (this.pendingExit) this.completeExit()

    const anchor = this.anchor
    const layout = layoutForMode(next, anchor, workAreaFor(anchor))

    if (MODE_RANK[next] > MODE_RANK[cur]) {
      // Grow: resize first (anchor fixed), then broadcast.
      this.exiting = false
      this.win.setBounds(layout.bounds)
      this.deps.update((s) => {
        s.buddyMode = next
        s.buddyLayout = layout
        if (next === 'card') s.answerReady = false
      })
      if (cur === 'hidden') {
        this.win.show()
        this.win.webContents.invalidate()
      }
      if (next !== 'dot') this.win.focus()
      this.hovered = false
      this.ignoreMouse = true
      this.win.setIgnoreMouseEvents(true, { forward: true })
    } else {
      // Shrink: broadcast first, renderer exits along the same path,
      // then calls exitDone(). Fallback timer guards a stuck renderer.
      this.pendingExit = { mode: next, layout }
      this.exiting = true
      this.deps.update((s) => {
        s.buddyMode = next
        // Clear the greeting when hide is *requested* — doing it in
        // completeExit would wipe a fresh greeting if a summon lands
        // inside the exit window.
        if (next === 'hidden') s.greeting = null
        if (next === 'card') s.answerReady = false
      })
      if (this.exitTimer) clearTimeout(this.exitTimer)
      this.exitTimer = setTimeout(() => this.completeExit(), EXIT_FALLBACK_MS)
    }
    this.scheduleCollapse()
    this.updateCursorTimer()
  }

  exitDone(): void {
    if (this.pendingExit) this.completeExit()
  }

  private completeExit(): void {
    const pending = this.pendingExit
    if (!pending || !this.win) {
      this.pendingExit = null
      this.exiting = false
      return
    }
    if (this.exitTimer) {
      clearTimeout(this.exitTimer)
      this.exitTimer = null
    }
    this.pendingExit = null
    this.exiting = false
    if (pending.mode === 'hidden') {
      this.win.hide()
      this.deps.update((s) => {
        s.buddyLayout = null
      })
    } else {
      this.win.setBounds(pending.layout.bounds)
      this.deps.update((s) => {
        s.buddyLayout = pending.layout
      })
    }
    this.hovered = false
    this.scheduleCollapse()
    this.updateCursorTimer()
  }

  // ---- collapse to dot ----------------------------------------------------

  scheduleCollapse(): void {
    if (this.collapseTimer) {
      clearTimeout(this.collapseTimer)
      this.collapseTimer = null
    }
    const s = this.deps.getState()
    if (s.buddyMode !== 'pill') return
    if (this.hovered || this.focused || s.streaming || this.dragging || this.exiting) return
    const delay = s.settings.collapseToDotAfterMs
    if (delay <= 0) return // "Never"
    this.collapseTimer = setTimeout(() => {
      const cur = this.deps.getState()
      if (cur.buddyMode === 'pill' && !this.hovered && !this.focused && !cur.streaming) {
        this.requestMode('dot')
      }
    }, delay)
  }

  // ---- click-through ------------------------------------------------------

  setIgnoreMouse(ignore: boolean): void {
    this.hovered = !ignore
    if (this.dragging || !this.win) {
      this.scheduleCollapse()
      return
    }
    if (ignore !== this.ignoreMouse) {
      this.ignoreMouse = ignore
      this.win.setIgnoreMouseEvents(ignore, { forward: true })
    }
    this.scheduleCollapse()
  }

  // ---- drag ----------------------------------------------------------------

  dragStart(): void {
    if (!this.win) return
    this.dragging = true
    if (this.collapseTimer) {
      clearTimeout(this.collapseTimer)
      this.collapseTimer = null
    }
    const cursor = screen.getCursorScreenPoint()
    const anchor = this.anchor
    this.dragOffset = { x: cursor.x - anchor.x, y: cursor.y - anchor.y }
    this.liveAnchor = anchor
    if (this.ignoreMouse) {
      this.ignoreMouse = false
      this.win.setIgnoreMouseEvents(false)
    }
  }

  dragMove(): void {
    if (!this.dragging || !this.win) return
    const layout = this.deps.getState().buddyLayout
    if (!layout) return
    const cursor = screen.getCursorScreenPoint()
    const anchor = { x: cursor.x - this.dragOffset.x, y: cursor.y - this.dragOffset.y }
    this.liveAnchor = anchor
    this.win.setPosition(Math.round(anchor.x - layout.owl.x), Math.round(anchor.y - layout.owl.y))
  }

  dragEnd(v: { vx: number; vy: number }): void {
    if (!this.dragging || !this.win) return
    this.dragging = false
    const anchor = this.liveAnchor ?? this.anchor
    const wa = workAreaFor(anchor)
    const projected = {
      x: anchor.x + project(v.vx),
      y: anchor.y + project(v.vy)
    }
    const target = snapToEdges(
      clampAnchor(projected, wa, ANCHOR_INSET),
      wa,
      EDGE_SNAP_THRESHOLD,
      ANCHOR_INSET
    )
    const speed = Math.hypot(v.vx, v.vy)
    const dampingRatio = speed > 300 ? 0.78 : 1.0
    this.animateAnchorTo(anchor, target, { vx: v.vx, vy: v.vy }, dampingRatio, () => {
      const s = this.deps.getState()
      const layout = s.buddyMode === 'hidden' ? null : layoutForMode(s.buddyMode, target, wa)
      if (this.win && layout) this.win.setBounds(layout.bounds)
      this.deps.update((st) => {
        st.settings.pillAnchor = { ...target }
        if (layout) st.buddyLayout = layout
      })
      this.deps.onSchedulePersist()
      this.scheduleCollapse()
    })
  }

  /** Small critically-damped-ish spring integrator ticking ~16 ms. */
  private animateAnchorTo(
    from: Point,
    to: Point,
    v0: { vx: number; vy: number },
    dampingRatio: number,
    done: () => void
  ): void {
    if (this.animTimer) clearInterval(this.animTimer)
    const layout = this.deps.getState().buddyLayout
    if (!this.win || !layout) {
      done()
      return
    }
    const owl = layout.owl
    const wn = (2 * Math.PI) / 0.45 // natural frequency for ~0.45 s response
    const k = wn * wn
    const c = 2 * dampingRatio * wn
    let x = from.x
    let y = from.y
    let vx = v0.vx
    let vy = v0.vy
    const dt = 0.016
    let elapsed = 0
    this.animTimer = setInterval(() => {
      elapsed += dt
      const ax = -k * (x - to.x) - c * vx
      const ay = -k * (y - to.y) - c * vy
      vx += ax * dt
      vy += ay * dt
      x += vx * dt
      y += vy * dt
      this.liveAnchor = { x, y }
      if (this.win && !this.win.isDestroyed()) {
        this.win.setPosition(Math.round(x - owl.x), Math.round(y - owl.y))
      }
      const settled =
        (Math.abs(x - to.x) < 0.5 && Math.abs(y - to.y) < 0.5 && Math.hypot(vx, vy) < 8) ||
        elapsed > 0.9
      if (settled) {
        if (this.animTimer) clearInterval(this.animTimer)
        this.animTimer = null
        this.liveAnchor = { ...to }
        done()
      }
    }, 16)
  }

  // ---- cursor eye-tracking --------------------------------------------------

  setCursorTracking(on: boolean): void {
    this.cursorTracking = on
    this.updateCursorTimer()
  }

  private updateCursorTimer(): void {
    const s = this.deps.getState()
    const want =
      this.cursorTracking &&
      (s.buddyMode === 'dot' || s.buddyMode === 'pill') &&
      !!this.win &&
      this.win.isVisible()
    if (want) this.cursorTracker.start(() => this.anchor)
    else this.cursorTracker.stop()
  }

  refreshCursorTimer(): void {
    this.updateCursorTimer()
  }

  setAnchor(p: Point): void {
    const wa = workAreaFor(p)
    const clamped = clampAnchor(p, wa, ANCHOR_INSET)
    this.liveAnchor = clamped
    const s = this.deps.getState()
    if (s.buddyMode !== 'hidden' && this.win) {
      const layout = layoutForMode(s.buddyMode, clamped, wa)
      this.win.setBounds(layout.bounds)
      this.deps.update((st) => {
        st.settings.pillAnchor = clamped
        st.buddyLayout = layout
      })
    } else {
      this.deps.update((st) => {
        st.settings.pillAnchor = clamped
      })
    }
    this.deps.onSchedulePersist()
  }

  /** Reset the buddy to the default anchor corner and relayout. */
  resetAnchor(): void {
    const p = defaultAnchor()
    this.liveAnchor = p
    const s = this.deps.getState()
    const layout = s.buddyMode === 'hidden' ? null : layoutForMode(s.buddyMode, p, workAreaFor(p))
    if (this.win && layout) this.win.setBounds(layout.bounds)
    this.deps.update((st) => {
      st.settings.pillAnchor = null
      st.buddyLayout = layout
    })
    this.deps.onSchedulePersist()
  }

  isDragging(): boolean {
    return this.dragging
  }

  isExiting(): boolean {
    return this.exiting
  }
}

export { DRAG_THRESHOLD_DIP }
