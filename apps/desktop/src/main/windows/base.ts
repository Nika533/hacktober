import { BrowserWindow } from 'electron'
import type { BrowserWindowConstructorOptions } from 'electron'
import { join } from 'node:path'
import type { WindowKind } from '@hoot/core'

/**
 * The one window factory: every window gets the same hardened webPreferences.
 * CSP headers and navigation guards land on top of this in D1-12.
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
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  return win
}

export function loadRenderer(win: BrowserWindow, kind: WindowKind): void {
  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (devUrl) void win.loadURL(`${devUrl}/${kind}.html`)
  else void win.loadFile(join(__dirname, `../renderer/${kind}.html`))
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
