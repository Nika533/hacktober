import { BrowserWindow } from 'electron'
import type { BrowserWindowConstructorOptions } from 'electron'
import { join } from 'node:path'
import type { WindowKind } from '@hoot/core'
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

export function guardContents(wc: Electron.WebContents): void {
  // Both the factory and the global web-contents-created hook call this.
  if (guarded.has(wc)) return
  guarded.add(wc)
  wc.on('will-navigate', (e) => {
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
  opts: BrowserWindowConstructorOptions
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
  guardContents(win.webContents)
  return win
}

export function loadRenderer(win: BrowserWindow, kind: WindowKind): void {
  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (devUrl) void win.loadURL(`${devUrl}/${kind}.html`)
  else void win.loadURL(`${HOOT_ORIGIN}/${kind}.html`)
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
