import type { BrowserWindow } from 'electron'
import { HOOT_API_ROUTES, type Rect } from '@hoot/core'
import { createSecureWindow, loadRenderer, type WindowRegistry } from '../windows/base'

/** The full-screen overlay the user circles on. */
export interface OverlayHost {
  /** Create the hidden window ahead of time, so the first capture opens at once. */
  prepare(): void
  show(bounds: Rect): void
  hide(): void
}

const { onOpen, onClosed } = HOOT_API_ROUTES.capture

/**
 * One hidden window, reused and moved over the target display for each
 * capture. `onDismiss` runs when the window goes away while it's showing
 * (Alt+F4), so the capture ends as a cancel.
 */
export function createOverlayWindow(deps: {
  windows: WindowRegistry
  onDismiss(): void
}): OverlayHost {
  let win: BrowserWindow | null = null
  let showing = false

  const ensure = (): BrowserWindow => {
    if (win && !win.isDestroyed()) return win
    const created = createSecureWindow('capture', {
      show: false,
      frame: false,
      transparent: false,
      backgroundColor: '#000000',
      hasShadow: false,
      roundedCorners: false,
      skipTaskbar: true,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      focusable: true,
      alwaysOnTop: true,
      title: 'Hoot capture'
    })
    created.on('closed', () => {
      if (win === created) win = null
      if (showing) {
        showing = false
        deps.onDismiss()
      }
    })
    deps.windows.set('capture', created)
    loadRenderer(created, 'capture')
    win = created
    return created
  }

  return {
    prepare: () => void ensure(),
    show(bounds) {
      const w = ensure()
      showing = true
      w.setBounds(bounds)
      // Above the taskbar and every other topmost window.
      w.setAlwaysOnTop(true, 'screen-saver')
      w.show()
      w.moveTop()
      w.focus()
      // Windows per-monitor DPI: the first setBounds on a newly shown window can settle wrong.
      w.setBounds(bounds)
      w.webContents.send(onOpen.channel)
    },
    hide() {
      showing = false
      if (!win || win.isDestroyed()) return
      win.webContents.send(onClosed.channel)
      win.hide()
    }
  }
}
