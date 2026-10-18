import { BrowserWindow } from 'electron'
import type { BrowserWindowConstructorOptions } from 'electron'
import { join } from 'node:path'
import type { WindowKind } from '@hoot/core'
import { readerPathFromNavigation } from './drop'
import { HOOT_ORIGIN } from './protocol'

/** Origins a window may navigate to: hoot://app, or the dev server in dev. */
export function isAllowedNavigation(url: string): boolean {
  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (url.startsWith(HOOT_ORIGIN)) return true
  return devUrl !== undefined && url.startsWith(devUrl)
}

/**
 * Navigation guards applied to every webContents Hoot creates (also applied
 * by hardening.ts to contents created outside this factory).
 */
const guarded = new WeakSet<Electron.WebContents>()

export interface GuardOptions {
  /** A file dropped on the page (a file: navigation to a Reader document). */
  onFileDrop?(path: string): void
}

// Registered separately from `guarded` so the callback still lands when the
// web-contents-created hook guarded the contents before the factory did.
const dropHandlers = new WeakMap<Electron.WebContents, (path: string) => void>()

export function guardContents(wc: Electron.WebContents, opts?: GuardOptions): void {
  if (opts?.onFileDrop !== undefined) dropHandlers.set(wc, opts.onFileDrop)
  if (guarded.has(wc)) return
  guarded.add(wc)
  wc.on('will-navigate', (e) => {
    const onDrop = dropHandlers.get(wc)
    const path = onDrop !== undefined ? readerPathFromNavigation(e.url) : null
    if (path !== null && onDrop !== undefined) {
      e.preventDefault()
      onDrop(path)
      return
    }
    if (!isAllowedNavigation(e.url)) e.preventDefault()
  })
  wc.on('will-redirect', (e) => e.preventDefault())
  wc.on('will-attach-webview', (e) => e.preventDefault())
  wc.setWindowOpenHandler(() => ({ action: 'deny' }))
}

/**
 * The one window factory: every window gets the same hardened webPreferences.
 * CSP headers are installed globally (protocol.ts / csp.ts).
 */
export function createSecureWindow(
  kind: WindowKind,
  opts: BrowserWindowConstructorOptions,
  guard?: GuardOptions
): BrowserWindow {
  const win = new BrowserWindow({
    ...opts,
    webPreferences: {
      ...opts.webPreferences,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      preload: join(__dirname, '../preload/index.js')
    }
  })
  guardContents(win.webContents, guard)
  return win
}

/** Renderer URL for a page file — dev server in dev, `hoot://` otherwise. */
export function rendererUrlFor(page: string): string {
  const devUrl = process.env['ELECTRON_RENDERER_URL']
  return devUrl ? `${devUrl}/${page}` : `${HOOT_ORIGIN}/${page}`
}

export function loadRenderer(win: BrowserWindow, kind: WindowKind): void {
  void win.loadURL(rendererUrlFor(`${kind}.html`))
}

export interface WindowRegistry {
  get(kind: WindowKind): BrowserWindow | undefined
  set(kind: WindowKind, win: BrowserWindow): void
  all(): BrowserWindow[]
}

export function createWindowRegistry(): WindowRegistry {
  const wins = new Map<WindowKind, BrowserWindow>()
  return {
    get: (kind) => wins.get(kind),
    set(kind, win) {
      wins.set(kind, win)
      win.once('closed', () => {
        if (wins.get(kind) === win) wins.delete(kind)
      })
    },
    all: () => [...wins.values()]
  }
}
