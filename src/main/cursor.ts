import { screen } from 'electron'
import type { Point } from '../shared/types'

const POLL_MS = 50 // ~20 Hz

/** Polls the OS cursor while active and reports cursor − anchor. */
export class CursorTracker {
  private timer: NodeJS.Timeout | null = null

  constructor(private onMove: (offset: Point) => void) {}

  start(getAnchor: () => Point): void {
    if (this.timer) return
    this.timer = setInterval(() => {
      const cursor = screen.getCursorScreenPoint()
      const anchor = getAnchor()
      this.onMove({ x: cursor.x - anchor.x, y: cursor.y - anchor.y })
    }, POLL_MS)
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  get active(): boolean {
    return this.timer !== null
  }
}
