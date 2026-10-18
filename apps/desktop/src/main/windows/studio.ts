import { screen } from 'electron'
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

const symbolColor = (dark: boolean): string => (dark ? '#F5F5F7' : '#1D1D1F')

/**
 * One Studio window, created hidden at startup and reused. Native close
 * locks (hides) instead of destroying, unless we're quitting.
 */
export function createStudioWindow(deps: {
  store: Store
  windows: WindowRegistry
  log: Logger
  /** A file dropped on the page → Reader (F-D1-6). */
  onFileDrop?(path: string): void
}): StudioWindow {
  const { store, windows, log } = deps
  const saved = store.get('settings').settings.studioBounds
  const dark = store.get('system').darkMode

  const win = createSecureWindow(
    'studio',
    {
      x: saved?.x,
      y: saved?.y,
      width: saved?.width ?? undefined,
      height: saved?.height ?? undefined,
      minWidth: MIN_W,
      minHeight: MIN_H,
      show: false,
      title: 'Hoot',
      titleBarStyle: 'hidden',
      titleBarOverlay: { color: '#00000000', symbolColor: symbolColor(dark), height: TITLEBAR_H },
      backgroundMaterial: 'mica',
      roundedCorners: true
    },
    { onFileDrop: deps.onFileDrop }
  )
  windows.set('studio', win)

  let quitting = false
  const lockListeners = new Set<() => void>()

  // Symbol colour follows the system slice's darkMode.
  let lastDark = dark
  const unwatchTheme = store.onChange(() => {
    if (win.isDestroyed()) return
    const d = store.get('system').darkMode
    if (d === lastDark) return
    lastDark = d
    win.setTitleBarOverlay({
      color: '#00000000',
      symbolColor: symbolColor(d),
      height: TITLEBAR_H
    })
  })
  win.once('closed', () => unwatchTheme())

  // Persist bounds (debounced) — studioBounds is main-only, so the write
  // goes straight to the slice, never through settings:update.
  let boundsTimer: ReturnType<typeof setTimeout> | null = null
  const persistBounds = (): void => {
    if (win.isDestroyed() || win.isMaximized()) return
    if (boundsTimer) clearTimeout(boundsTimer)
    boundsTimer = setTimeout(() => {
      if (win.isDestroyed() || win.isMaximized()) return
      const settings = store.get('settings').settings
      store.update('settings', {
        settings: { ...settings, studioBounds: win.getNormalBounds() }
      })
    }, 400)
  }
  win.on('resized', persistBounds)
  win.on('moved', persistBounds)

  win.on('close', (e) => {
    if (quitting) return
    e.preventDefault()
    studio.lock()
  })

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
      if (!win.isVisible()) {
        win.setBounds(restoredBounds())
        win.show()
      }
      win.focus()
    },

    lock() {
      if (!win.isDestroyed() && win.isVisible()) win.hide()
      store.update('studio', { open: false })
      for (const cb of lockListeners) cb()
    },

    isVisible: () => !win.isDestroyed() && win.isVisible(),
    isFocused: () => !win.isDestroyed() && win.isFocused(),
    focus: () => {
      if (!win.isDestroyed()) win.focus()
    },
    markQuitting: () => {
      quitting = true
    },
    onLock(cb) {
      lockListeners.add(cb)
      return () => lockListeners.delete(cb)
    }
  }

  loadRenderer(win, 'studio')
  log.info('studio window created')
  return studio
}
