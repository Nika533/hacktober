import { screen } from 'electron'
import type { BrowserWindow } from 'electron'
import type { EventChannel, Point } from '@hoot/core'
import type { Logger } from '../log'
import { centreInWorkArea } from './bounds'
import { createSecureWindow, loadRenderer, type WindowRegistry } from './base'

const SIZE = { width: 1000, height: 760 }
const MIN_W = 640
const MIN_H = 480

export interface ReaderWindow {
  open(): void
  isOpen(): boolean
  /**
   * Deliver an event to the Reader page. Sent at once when the page is
   * loaded; otherwise queued and flushed on the next `did-finish-load`
   * (the window may have been recreated, so this is per-page-load).
   */
  send(channel: EventChannel, payload: unknown): void
  /** cb runs on every `did-finish-load`, and at once when already loaded. */
  onReady(cb: () => void): void
  /** The live BrowserWindow (e.g. as a dialog parent); null when closed. */
  browserWindow(): BrowserWindow | null
}

/**
 * The Reader window: created lazily, recreated when destroyed, centred on
 * the display holding the buddy anchor. Hidden until open() — a document
 * send may create it early, in which case it loads off-screen first.
 */
export function createReaderWindow(deps: {
  windows: WindowRegistry
  log: Logger
  /** Screen DIP point whose display the window centres on (the owl's anchor). */
  anchor?: () => Point
}): ReaderWindow {
  const { windows, log } = deps
  let win: BrowserWindow | null = null
  let loaded = false
  let showWhenReady = false
  const readyCbs = new Set<() => void>()
  const queue: [EventChannel, unknown][] = []

  const ensure = (): BrowserWindow => {
    if (win && !win.isDestroyed()) return win
    const anchor = deps.anchor?.()
    const display = anchor ? screen.getDisplayNearestPoint(anchor) : screen.getPrimaryDisplay()
    loaded = false
    win = createSecureWindow('reader', {
      ...centreInWorkArea(display.workArea, SIZE),
      minWidth: MIN_W,
      minHeight: MIN_H,
      title: 'Hoot Reader',
      show: false
    })
    windows.set('reader', win)
    win.once('ready-to-show', () => {
      if (showWhenReady && win && !win.isDestroyed()) {
        win.show()
        win.focus()
      }
    })
    win.webContents.on('did-finish-load', () => {
      if (!win) return
      loaded = true
      for (const [channel, payload] of queue.splice(0)) {
        win.webContents.send(channel, payload)
      }
      for (const cb of readyCbs) cb()
    })
    win.once('closed', () => {
      win = null
      loaded = false
    })
    loadRenderer(win, 'reader')
    log.info('reader window created')
    return win
  }

  return {
    open() {
      showWhenReady = true
      const w = ensure()
      if (loaded && !w.isDestroyed()) {
        w.show()
        w.focus()
      }
    },
    isOpen: () => win !== null && !win.isDestroyed() && win.isVisible(),
    send(channel, payload) {
      const w = ensure()
      if (loaded && !w.isDestroyed()) w.webContents.send(channel, payload)
      else queue.push([channel, payload])
    },
    onReady(cb) {
      readyCbs.add(cb)
      if (loaded) cb()
    },
    browserWindow: () => (win && !win.isDestroyed() ? win : null)
  }
}
