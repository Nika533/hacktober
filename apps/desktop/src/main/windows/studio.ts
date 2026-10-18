import os from 'node:os'
import { screen } from 'electron'
import type { BrowserWindow } from 'electron'
import type { StudioView, Unsubscribe } from '@hoot/core'
import type { Logger } from '../log'
import type { Store } from '../store/store'
import { centreInWorkArea, clampIntoWorkArea } from './bounds'
import { createSecureWindow, loadRenderer, type WindowRegistry } from './base'

const TITLEBAR_H = 44
const MIN_W = 720
const MIN_H = 480

export interface StudioWindow {
  open(view?: StudioView): void
  lock(): void
  isVisible(): boolean
  isFocused(): boolean
  focus(): void
  markQuitting(): void
  /** The buddy hooks in here (D1-14) to resume when Studio locks. */
  onLock(cb: () => void): Unsubscribe
}

/**
 * Mica needs Windows 11 (build 22000) and doesn't render under high
 * contrast; anything else gets an opaque theme background. `os.release()` on
 * Windows is `10.0.<build>`; 0 on other platforms (where the option is
 * ignored anyway).
 */
export const windowsBuild = (): number =>
  process.platform === 'win32' ? Number(os.release().split('.')[2] ?? 0) : 0

export function studioMaterial(o: {
  windowsBuild: number
  highContrast: boolean
}): 'mica' | 'none' {
  return o.highContrast || o.windowsBuild < 22000 ? 'none' : 'mica'
}

const symbolColor = (dark: boolean, highContrast: boolean): string =>
  highContrast ? (dark ? '#FFFFFF' : '#000000') : dark ? '#F5F5F7' : '#1D1D1F'

const surfaceColor = (dark: boolean): string => (dark ? '#202020' : '#F3F3F3')

/**
 * One Studio window, created lazily on first `open()` and reused — a hidden
 * start (or a session that never opens Studio) doesn't pay for a renderer.
 * Native close locks (hides) instead of destroying, unless we're quitting.
 */
export function createStudioWindow(deps: {
  store: Store
  windows: WindowRegistry
  log: Logger
}): StudioWindow {
  const { store, windows, log } = deps

  let win: BrowserWindow | null = null
  let quitting = false
  const lockListeners = new Set<() => void>()

  const ensureWin = (): BrowserWindow => {
    if (win && !win.isDestroyed()) return win

    const saved = store.get('settings').settings.studioBounds
    const sys = store.get('system')
    const material = studioMaterial({
      windowsBuild: windowsBuild(),
      highContrast: sys.highContrast
    })
    const w = createSecureWindow('studio', {
      x: saved?.x,
      y: saved?.y,
      width: saved?.width ?? undefined,
      height: saved?.height ?? undefined,
      minWidth: MIN_W,
      minHeight: MIN_H,
      show: false,
      title: 'Hoot',
      titleBarStyle: 'hidden',
      titleBarOverlay: {
        color: '#00000000',
        symbolColor: symbolColor(sys.darkMode, sys.highContrast),
        height: TITLEBAR_H
      },
      backgroundMaterial: material,
      backgroundColor: material === 'none' ? surfaceColor(sys.darkMode) : '#00000000',
      roundedCorners: true
    })
    win = w
    windows.set('studio', w)

    // Material, surface and symbol colour follow the system slice.
    let lastDark = sys.darkMode
    let lastHc = sys.highContrast
    const unwatchTheme = store.onChange(() => {
      if (w.isDestroyed()) return
      const s = store.get('system')
      if (s.darkMode === lastDark && s.highContrast === lastHc) return
      lastDark = s.darkMode
      lastHc = s.highContrast
      const m = studioMaterial({ windowsBuild: windowsBuild(), highContrast: s.highContrast })
      w.setBackgroundMaterial(m)
      w.setBackgroundColor(m === 'none' ? surfaceColor(s.darkMode) : '#00000000')
      w.setTitleBarOverlay({
        color: '#00000000',
        symbolColor: symbolColor(s.darkMode, s.highContrast),
        height: TITLEBAR_H
      })
    })
    w.once('closed', () => {
      unwatchTheme()
      if (win === w) win = null
    })

    // Persist bounds (debounced) — studioBounds is main-only, so the write
    // goes straight to the slice, never through settings:update.
    let boundsTimer: ReturnType<typeof setTimeout> | null = null
    const persistBounds = (): void => {
      if (w.isDestroyed() || w.isMaximized()) return
      if (boundsTimer) clearTimeout(boundsTimer)
      boundsTimer = setTimeout(() => {
        if (w.isDestroyed() || w.isMaximized()) return
        const settings = store.get('settings').settings
        store.update('settings', {
          settings: { ...settings, studioBounds: w.getNormalBounds() }
        })
      }, 400)
    }
    w.on('resized', persistBounds)
    w.on('moved', persistBounds)

    w.on('close', (e) => {
      if (quitting) return
      e.preventDefault()
      studio.lock()
    })

    loadRenderer(w, 'studio')
    log.info('studio window created')
    return w
  }

  const restoredBounds = (): Electron.Rectangle => {
    const savedB = store.get('settings').settings.studioBounds
    if (savedB) {
      const wa = screen.getDisplayNearestPoint({
        x: savedB.x + savedB.width / 2,
        y: savedB.y + savedB.height / 2
      }).workArea
      return clampIntoWorkArea(savedB, wa)
    }
    const wa = screen.getPrimaryDisplay().workArea
    return centreInWorkArea(wa)
  }

  const studio: StudioWindow = {
    open(view = 'chat') {
      store.update('studio', { open: true, view })
      const w = ensureWin()
      if (!w.isVisible()) {
        w.setBounds(restoredBounds())
        w.show()
      }
      w.focus()
    },

    lock() {
      if (win !== null && !win.isDestroyed() && win.isVisible()) win.hide()
      store.update('studio', { open: false })
      for (const cb of lockListeners) cb()
    },

    isVisible: () => win !== null && !win.isDestroyed() && win.isVisible(),
    isFocused: () => win !== null && !win.isDestroyed() && win.isFocused(),
    focus: () => {
      if (win !== null && !win.isDestroyed()) win.focus()
    },
    markQuitting: () => {
      quitting = true
    },
    onLock(cb) {
      lockListeners.add(cb)
      return () => lockListeners.delete(cb)
    }
  }

  return studio
}
