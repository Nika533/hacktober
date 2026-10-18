import type { BrowserWindow } from 'electron'
import { HOOT_API_ROUTES, type Rect } from '@hoot/core'
import { createSecureWindow, loadRenderer, type WindowRegistry } from '../windows/base'
import { BUBBLE_MIN_HEIGHT, BUBBLE_WIDTH } from './placement'
import type { BubbleHost } from './service'

const { onUpdate } = HOOT_API_ROUTES.anywhere

/**
 * The Lens anywhere bubble: one transparent, frameless, topmost window,
 * created on first use and reused. It's shown inactive, so the app the user
 * is reading keeps focus. `onDismiss` runs when it goes away while showing.
 */
export function createBubbleWindow(deps: {
  windows: WindowRegistry
  onDismiss(): void
}): BubbleHost {
  let win: BrowserWindow | null = null
  let ready = false
  let showing = false
  let bounds: Rect | null = null

  const live = (): BrowserWindow | null => (win && !win.isDestroyed() ? win : null)

  const reveal = (w: BrowserWindow): void => {
    w.showInactive()
    // Windows per-monitor DPI: the first setBounds on a newly shown window can settle wrong.
    if (bounds) w.setBounds(bounds)
  }

  const ensure = (): BrowserWindow => {
    const existing = live()
    if (existing) return existing
    const w = createSecureWindow('anywhere', {
      width: BUBBLE_WIDTH,
      height: BUBBLE_MIN_HEIGHT,
      show: false,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      hasShadow: false,
      roundedCorners: false,
      resizable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      focusable: true,
      alwaysOnTop: true,
      title: 'Hoot Lens',
      // A tool window stays out of Alt+Tab (Windows).
      ...(process.platform === 'win32' ? { type: 'toolbar' } : {})
    })
    w.setAlwaysOnTop(true, 'pop-up-menu')
    ready = false
    w.once('ready-to-show', () => {
      ready = true
      if (showing && !w.isDestroyed()) reveal(w)
    })
    w.on('closed', () => {
      if (win !== w) return
      win = null
      if (showing) {
        showing = false
        deps.onDismiss()
      }
    })
    deps.windows.set('anywhere', w)
    loadRenderer(w, 'anywhere')
    win = w
    return w
  }

  return {
    show(next) {
      const w = ensure()
      showing = true
      bounds = next
      w.setBounds(next)
      if (ready) reveal(w)
    },
    setBounds(next) {
      bounds = next
      live()?.setBounds(next)
    },
    hide() {
      showing = false
      const w = live()
      if (w?.isVisible()) w.hide()
    },
    update(state) {
      live()?.webContents.send(onUpdate.channel, state)
    },
    isFocused: () => live()?.isFocused() ?? false,
    owns: (senderId) => live()?.webContents.id === senderId
  }
}
