import { BrowserWindow, screen } from 'electron'
import type { WebContents } from 'electron'
import path from 'path'
import { cascadeNotePosition } from '../../shared/geometry'
import type { Pin, Point, Rect } from '../../shared/types'

export const NOTE_WIDTH = 300
const NOTE_MIN_H = 120
const NOTE_MAX_H = 420
const INITIAL_H = 200

export interface NoteDeps {
  isDev(): boolean
  /** App is quitting — let 'close' proceed so quit isn't vetoed. */
  isQuitting(): boolean
  rendererUrl(page: string): string
  /** Current buddy anchor (screen DIP) — fresh pins cascade near it. */
  anchor(): Point
  /** Debounced-persist the window's new bounds onto the pin. */
  onPinBounds(id: string, b: Rect): void
  /** A note asked to close (button, Esc, OS close) → delete the pin. */
  onCloseRequest(id: string): void
}

/** One floating sticky-note window per pin. */
export class NoteManager {
  private wins = new Map<string, BrowserWindow>()
  /** Pin ids whose close was initiated by us (skip the 'close' veto). */
  private closing = new Set<string>()
  private boundsTimers = new Map<string, NodeJS.Timeout>()

  constructor(private deps: NoteDeps) {}

  /** Cascade origin near the buddy anchor, nudged toward the screen centre. */
  placement(index: number): Rect {
    const anchor = this.deps.anchor()
    const wa = screen.getDisplayNearestPoint(anchor).workArea
    const cx = wa.x + wa.width / 2
    const cy = wa.y + wa.height / 2
    const origin: Point = {
      x: anchor.x < cx ? anchor.x + 96 : anchor.x - 96 - NOTE_WIDTH,
      y: anchor.y < cy ? anchor.y + 96 : anchor.y - 96 - INITIAL_H
    }
    const size = { width: NOTE_WIDTH, height: INITIAL_H }
    const pos = cascadeNotePosition(index, origin, wa, size)
    return { x: pos.x, y: pos.y, ...size }
  }

  show(pin: Pin): void {
    if (this.wins.has(pin.id)) {
      this.wins.get(pin.id)!.show()
      return
    }
    const win = new BrowserWindow({
      x: pin.bounds.x,
      y: pin.bounds.y,
      width: NOTE_WIDTH,
      height: Math.min(Math.max(pin.bounds.height, NOTE_MIN_H), NOTE_MAX_H),
      show: false,
      transparent: true,
      frame: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      resizable: false,
      hasShadow: false,
      focusable: true,
      backgroundColor: '#00000000',
      webPreferences: {
        preload: path.join(__dirname, '../preload/index.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false
      }
    })
    win.setAlwaysOnTop(true, 'floating')
    this.wins.set(pin.id, win)

    win.on('close', (e) => {
      // A close we didn't initiate still means "delete the pin" — unless the
      // app is quitting, where a veto would abort the quit.
      if (this.closing.has(pin.id) || this.deps.isQuitting()) return
      e.preventDefault()
      this.deps.onCloseRequest(pin.id)
    })
    win.on('closed', () => {
      this.wins.delete(pin.id)
      this.closing.delete(pin.id)
    })
    win.on('moved', () => {
      const t = this.boundsTimers.get(pin.id)
      if (t) clearTimeout(t)
      this.boundsTimers.set(
        pin.id,
        setTimeout(() => {
          this.boundsTimers.delete(pin.id)
          if (!win.isDestroyed()) this.deps.onPinBounds(pin.id, win.getBounds())
        }, 400)
      )
    })

    const url = this.deps.rendererUrl('note.html')
    if (this.deps.isDev()) void win.loadURL(`${url}#${pin.id}`)
    else void win.loadFile(url, { hash: pin.id })
    win.once('ready-to-show', () => win.show())
  }

  /** Renderer-reported content height, clamped 120–420. */
  resizeFor(sender: WebContents, height: number): void {
    const id = this.pinIdFor(sender)
    if (!id) return
    const win = this.wins.get(id)
    if (!win || win.isDestroyed()) return
    const h = Math.min(Math.max(Math.round(height), NOTE_MIN_H), NOTE_MAX_H)
    const b = win.getBounds()
    if (b.height !== h) win.setBounds({ ...b, height: h })
  }

  pinIdFor(sender: WebContents): string | null {
    for (const [id, w] of this.wins) {
      if (w.webContents.id === sender.id) return id
    }
    return null
  }

  /** Close + remove a note window (the pin itself is deleted by the caller). */
  destroy(id: string): void {
    const win = this.wins.get(id)
    if (!win) return
    this.closing.add(id)
    win.close()
  }

  hideAll(): void {
    for (const w of this.wins.values()) w.hide()
  }

  showAll(pins: Pin[]): void {
    for (const p of pins) this.show(p)
  }

  visibleCount(): number {
    let n = 0
    for (const w of this.wins.values()) if (w.isVisible()) n++
    return n
  }

  destroyAll(): void {
    for (const [id, w] of this.wins) {
      this.closing.add(id)
      w.destroy()
    }
    this.wins.clear()
  }
}
