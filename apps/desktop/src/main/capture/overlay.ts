import { screen, type BrowserWindow } from 'electron'
import { HOOT_API_ROUTES, type Rect } from '@hoot/core'
import { createSecureWindow, loadRenderer, type WindowRegistry } from '../windows/base'

/** The full-screen overlay the user circles on. */
export interface OverlayHost {
  /** Create the hidden window ahead of time, so the first capture opens at once. */
  prepare(): void
  show(bounds: Rect): void
  hide(): void
  /**
   * Live mode only: keep the overlay out of screen captures while a frame is
   * grabbed, so the model sees the screen, not Hoot's glow and chat.
   */
  setCaptureExcluded?(excluded: boolean): void
}

const { onOpen, onClosed } = HOOT_API_ROUTES.capture

/** How often live mode checks whether the cursor is over the chat or toolbar. */
export const HIT_POLL_MS = 50

/**
 * Asks the overlay page whether a window-local point is on something it
 * handles (`[data-hit]`: the chat, the toolbar, or the whole page while the
 * user draws). Main reads the DOM directly so click-through needs no IPC.
 */
const hitScript = (x: number, y: number): string =>
  `!!document.elementFromPoint(${Math.round(x)}, ${Math.round(y)})?.closest('[data-hit]')`

/**
 * One hidden window, reused and moved over the target display for each
 * capture. `onDismiss` runs when the window goes away while it's showing
 * (Alt+F4), so the capture ends as a cancel.
 *
 * `live`: the window is transparent over the real, moving screen, and clicks
 * pass through to the desktop everywhere except what the page marks
 * `[data-hit]` (main polls the cursor and toggles `setIgnoreMouseEvents`).
 */
export function createOverlayWindow(deps: {
  windows: WindowRegistry
  onDismiss(): void
  live?: boolean
  log?: { warn(message: string): void }
}): OverlayHost {
  const live = deps.live ?? false
  let win: BrowserWindow | null = null
  let showing = false
  let poll: ReturnType<typeof setInterval> | null = null
  let ignoring = false
  let probing = false
  let warned = false

  const setIgnore = (w: BrowserWindow, ignore: boolean): void => {
    if (ignore === ignoring || w.isDestroyed()) return
    ignoring = ignore
    w.setIgnoreMouseEvents(ignore, { forward: true })
  }

  const stopPoll = (): void => {
    if (poll !== null) clearInterval(poll)
    poll = null
    probing = false
  }

  const startPoll = (w: BrowserWindow): void => {
    stopPoll()
    poll = setInterval(() => {
      if (probing || w.isDestroyed() || !showing) return
      const cursor = screen.getCursorScreenPoint()
      const b = w.getBounds()
      const x = cursor.x - b.x
      const y = cursor.y - b.y
      if (x < 0 || y < 0 || x >= b.width || y >= b.height) return
      probing = true
      w.webContents
        .executeJavaScript(hitScript(x, y))
        .then((hit: unknown) => setIgnore(w, hit !== true))
        .catch((e: unknown) => {
          // Never strand the user: without the probe, the overlay takes clicks.
          setIgnore(w, false)
          if (!warned) {
            warned = true
            deps.log?.warn(`capture: click-through probe failed: ${String(e)}`)
          }
        })
        .finally(() => {
          probing = false
        })
    }, HIT_POLL_MS)
  }

  const ensure = (): BrowserWindow => {
    if (win && !win.isDestroyed()) return win
    const created = createSecureWindow('capture', {
      show: false,
      frame: false,
      // Live: the real screen stays visible (and moving) under the overlay.
      transparent: live,
      // A tool window: Chromium's occlusion tracking skips it, so a browser or
      // editor under the full-screen overlay keeps painting (Windows).
      ...(live && process.platform === 'win32' ? { type: 'toolbar' } : {}),
      backgroundColor: live ? '#00000000' : '#000000',
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
      stopPoll()
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
      ignoring = false
      w.setIgnoreMouseEvents(false)
      w.setBounds(bounds)
      // Above the taskbar and every other topmost window.
      w.setAlwaysOnTop(true, 'screen-saver')
      w.show()
      w.moveTop()
      w.focus()
      // Windows per-monitor DPI: the first setBounds on a newly shown window can settle wrong.
      w.setBounds(bounds)
      w.webContents.send(onOpen.channel)
      if (live) startPoll(w)
    },
    hide() {
      showing = false
      stopPoll()
      if (!win || win.isDestroyed()) return
      win.setContentProtection(false)
      if (ignoring) {
        ignoring = false
        win.setIgnoreMouseEvents(false)
      }
      win.webContents.send(onClosed.channel)
      win.hide()
    },
    setCaptureExcluded(excluded) {
      if (!win || win.isDestroyed()) return
      win.setContentProtection(excluded)
    }
  }
}
