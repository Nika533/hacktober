import { screen, type BrowserWindow } from 'electron'
import { cascadeNotePosition, type Point, type Rect } from '@hoot/core'
import { createSecureWindow } from '../windows/base'
import type { NoteWindows } from './service'

export const NOTE_WIDTH = 300
const NOTE_MIN_HEIGHT = 120
const NOTE_MAX_HEIGHT = 420
const NOTE_INITIAL_HEIGHT = 200
const BOUNDS_SAVE_MS = 400

export interface NoteWindowsDeps {
  /** URL of a renderer page; d1 knows the dev server and the hoot:// origin. */
  rendererUrl(page: string): string
  /** The owl's position (screen DIP); new notes cascade near it. */
  anchor(): Point
  /** The app is quitting: let windows close without deleting their pins. */
  isQuitting(): boolean
  /** The OS (or Alt+F4) closed a note: delete its pin. */
  onCloseRequest(pinId: string): void
  onBounds(pinId: string, bounds: Rect): void
}

const clampHeight = (h: number): number =>
  Math.min(Math.max(Math.round(h), NOTE_MIN_HEIGHT), NOTE_MAX_HEIGHT)

/** One transparent, always-on-top note window per pin. */
export function createNoteWindows(deps: NoteWindowsDeps): NoteWindows {
  const wins = new Map<string, BrowserWindow>()
  /** Closes we started ourselves, which must not delete the pin again. */
  const closing = new Set<string>()
  const saveTimers = new Map<string, ReturnType<typeof setTimeout>>()

  return {
    open(pin) {
      const existing = wins.get(pin.id)
      if (existing && !existing.isDestroyed()) {
        existing.showInactive()
        return
      }
      const win = createSecureWindow('note', {
        x: Math.round(pin.bounds.x),
        y: Math.round(pin.bounds.y),
        width: NOTE_WIDTH,
        height: clampHeight(pin.bounds.height || NOTE_INITIAL_HEIGHT),
        show: false,
        transparent: true,
        frame: false,
        resizable: false,
        skipTaskbar: true,
        hasShadow: false,
        alwaysOnTop: true,
        backgroundColor: '#00000000'
      })
      win.setAlwaysOnTop(true, 'floating')
      wins.set(pin.id, win)
      win.on('close', (e) => {
        if (closing.has(pin.id) || deps.isQuitting()) return
        e.preventDefault()
        deps.onCloseRequest(pin.id)
      })
      win.on('closed', () => {
        wins.delete(pin.id)
        closing.delete(pin.id)
        clearTimeout(saveTimers.get(pin.id))
      })
      win.on('moved', () => {
        clearTimeout(saveTimers.get(pin.id))
        saveTimers.set(
          pin.id,
          setTimeout(() => {
            if (!win.isDestroyed()) deps.onBounds(pin.id, win.getBounds())
          }, BOUNDS_SAVE_MS)
        )
      })
      win.once('ready-to-show', () => win.showInactive())
      void win.loadURL(`${deps.rendererUrl('note.html')}#${encodeURIComponent(pin.id)}`)
    },

    close(pinId) {
      const win = wins.get(pinId)
      if (!win || win.isDestroyed()) return
      closing.add(pinId)
      win.close()
    },

    hideAll() {
      for (const win of wins.values()) if (!win.isDestroyed()) win.hide()
    },

    pinIdFor(senderId) {
      for (const [id, win] of wins) {
        if (!win.isDestroyed() && win.webContents.id === senderId) return id
      }
      return null
    },

    resize(pinId, height) {
      const win = wins.get(pinId)
      if (!win || win.isDestroyed()) return
      const b = win.getBounds()
      const h = clampHeight(height)
      if (b.height !== h) win.setBounds({ ...b, height: h })
    },

    placement(index) {
      const anchor = deps.anchor()
      const area = screen.getDisplayNearestPoint(anchor).workArea
      const cx = area.x + area.width / 2
      const cy = area.y + area.height / 2
      const origin: Point = {
        x: anchor.x < cx ? anchor.x + 96 : anchor.x - 96 - NOTE_WIDTH,
        y: anchor.y < cy ? anchor.y + 96 : anchor.y - 96 - NOTE_INITIAL_HEIGHT
      }
      const size = { width: NOTE_WIDTH, height: NOTE_INITIAL_HEIGHT }
      return { ...cascadeNotePosition(index, origin, area, size), ...size }
    }
  }
}
