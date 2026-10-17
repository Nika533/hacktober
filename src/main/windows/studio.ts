import { BrowserWindow, nativeImage, nativeTheme, screen } from 'electron'
import path from 'path'
import type { AppState, Rect, StudioView } from '../../shared/types'
import { resolvedAnchor } from './buddy'
import type { BuddyWindow } from './buddy'

const DEFAULT_W = 1100
const DEFAULT_H = 720
const MIN_W = 720
const MIN_H = 480
const TITLEBAR_H = 44

export interface StudioDeps {
  getState(): AppState
  update(mut: (s: AppState) => void): void
  isDev(): boolean
  rendererUrl(page: string): string
  buddy(): BuddyWindow | null
  onPersistBounds(b: Rect): void
}

function symbolColor(): string {
  return nativeTheme.shouldUseDarkColors ? '#F5F5F7' : '#1D1D1F'
}

/** Centre the default size on the display that contains the buddy anchor. */
function defaultBounds(state: AppState): Rect {
  const anchor = resolvedAnchor(state)
  const wa = screen.getDisplayNearestPoint(anchor).workArea
  const width = Math.min(DEFAULT_W, wa.width)
  const height = Math.min(DEFAULT_H, wa.height)
  return {
    x: Math.round(wa.x + (wa.width - width) / 2),
    y: Math.round(wa.y + (wa.height - height) / 2),
    width,
    height
  }
}

function clampIntoWorkArea(b: Rect): Rect {
  const wa = screen.getDisplayNearestPoint({ x: b.x + b.width / 2, y: b.y + b.height / 2 }).workArea
  const width = Math.min(b.width, wa.width)
  const height = Math.min(b.height, wa.height)
  return {
    x: Math.min(Math.max(b.x, wa.x), wa.x + wa.width - width),
    y: Math.min(Math.max(b.y, wa.y), wa.y + wa.height - height),
    width,
    height
  }
}

export class StudioWindow {
  win: BrowserWindow | null = null
  private quitting = false
  private boundsTimer: NodeJS.Timeout | null = null

  constructor(private deps: StudioDeps) {}

  create(): void {
    const saved = this.deps.getState().settings.studioBounds
    this.win = new BrowserWindow({
      x: saved?.x,
      y: saved?.y,
      width: saved?.width ?? DEFAULT_W,
      height: saved?.height ?? DEFAULT_H,
      minWidth: MIN_W,
      minHeight: MIN_H,
      show: false,
      title: 'Hoot',
      icon: nativeImage.createFromPath(path.join(__dirname, '../../resources/icon.png')),
      titleBarStyle: 'hidden',
      titleBarOverlay: { color: '#00000000', symbolColor: symbolColor(), height: TITLEBAR_H },
      backgroundMaterial: 'mica',
      roundedCorners: true,
      webPreferences: {
        preload: path.join(__dirname, '../preload/index.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false
      }
    })

    nativeTheme.on('updated', () => {
      this.win?.setTitleBarOverlay({
        color: '#00000000',
        symbolColor: symbolColor(),
        height: TITLEBAR_H
      })
    })

    const persistBounds = (): void => {
      if (!this.win || this.win.isDestroyed() || this.win.isMaximized()) return
      if (this.boundsTimer) clearTimeout(this.boundsTimer)
      this.boundsTimer = setTimeout(() => {
        if (!this.win || this.win.isDestroyed() || this.win.isMaximized()) return
        this.deps.onPersistBounds(this.win.getNormalBounds())
      }, 400)
    }
    this.win.on('resized', persistBounds)
    this.win.on('moved', persistBounds)

    // Native close locks back to the buddy instead of destroying the window.
    this.win.on('close', (e) => {
      if (this.quitting) return
      e.preventDefault()
      this.lock()
    })
    this.win.on('closed', () => {
      this.win = null
    })

    const url = this.deps.rendererUrl('studio.html')
    if (this.deps.isDev()) void this.win.loadURL(url)
    else void this.win.loadFile(url)
  }

  /** Unlock: open (or focus) Studio in `view` and suspend the buddy. */
  open(view: StudioView = 'chat'): void {
    if (!this.win) return
    this.deps.update((s) => {
      s.studioView = view
      s.studioOpen = true
    })
    if (!this.win.isVisible()) {
      const b = this.deps.getState().settings.studioBounds
      this.win.setBounds(clampIntoWorkArea(b ?? defaultBounds(this.deps.getState())))
      this.win.show()
    }
    this.win.focus()
    this.deps.buddy()?.suspend()
  }

  /** Lock: show the buddy card first so there is no empty-screen flicker. */
  lock(): void {
    this.deps.buddy()?.resume('card')
    this.win?.hide()
    this.deps.update((s) => {
      s.studioOpen = false
    })
  }

  show(): void {
    if (!this.win) return
    this.win.show()
    this.win.focus()
  }

  hide(): void {
    this.win?.hide()
  }

  focus(): void {
    this.win?.focus()
  }

  isVisible(): boolean {
    return !!this.win && !this.win.isDestroyed() && this.win.isVisible()
  }

  isFocused(): boolean {
    return !!this.win && !this.win.isDestroyed() && this.win.isFocused()
  }

  markQuitting(): void {
    this.quitting = true
  }
}

// ---- module singleton (mirrors how ipc.ts/index.ts already use these) ----

let instance: StudioWindow | null = null

export function createStudio(deps: StudioDeps): StudioWindow {
  instance = new StudioWindow(deps)
  instance.create()
  return instance
}

export function studioWindow(): StudioWindow | null {
  return instance
}

export function openStudio(view: StudioView = 'chat'): void {
  instance?.open(view)
}

export function lockStudio(): void {
  instance?.lock()
}

export function openSettingsWindow(): void {
  instance?.open('settings')
}

export function markQuitting(): void {
  instance?.markQuitting()
}
