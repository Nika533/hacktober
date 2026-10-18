import type { Mark } from './render/types'
import { viewportOf } from './ui/position'

export const KEPT_AFTER_MS = 30_000
export const KEPT_TICK_MS = 1_000

export interface KeptTrackerOptions {
  document: Document
  onKept: (id: string) => void
  afterMs?: number
}

interface Tracked {
  mark: Mark
  ageMs: number
  seenMs: number
  goneMs: number
  scrolledPast: boolean
}

/**
 * Infers `kept` (hoot-lens.md §8.1): a change stayed for 30 s without a revert, and the
 * reader scrolled past it or had it on screen for 30 s while the page was visible.
 */
export class KeptTracker {
  readonly #doc: Document
  readonly #onKept: (id: string) => void
  readonly #afterMs: number
  readonly #tracked = new Map<string, Tracked>()
  #timer: ReturnType<typeof setInterval> | null = null

  constructor(options: KeptTrackerOptions) {
    this.#doc = options.document
    this.#onKept = options.onKept
    this.#afterMs = options.afterMs ?? KEPT_AFTER_MS
  }

  get size(): number {
    return this.#tracked.size
  }

  track(mark: Mark): void {
    this.#tracked.set(mark.id, { mark, ageMs: 0, seenMs: 0, goneMs: 0, scrolledPast: false })
    this.#timer ??= setInterval(this.#tick, KEPT_TICK_MS)
  }

  /** The page re-rendered and the renderer re-applied `previousId` as `mark`. */
  replace(previousId: string, mark: Mark): void {
    const entry = this.#tracked.get(previousId)
    if (!entry) return
    this.#tracked.delete(previousId)
    this.#tracked.set(mark.id, { ...entry, mark, goneMs: 0 })
  }

  forget(id: string): void {
    this.#tracked.delete(id)
    if (this.#tracked.size === 0) this.#stop()
  }

  destroy(): void {
    this.#tracked.clear()
    this.#stop()
  }

  #stop(): void {
    if (this.#timer !== null) clearInterval(this.#timer)
    this.#timer = null
  }

  #tick = (): void => {
    const visible = this.#doc.visibilityState !== 'hidden'
    const height = viewportOf(this.#doc).height
    for (const [id, entry] of this.#tracked) {
      entry.ageMs += KEPT_TICK_MS
      if (!entry.mark.anchor.isConnected) {
        entry.goneMs += KEPT_TICK_MS
        if (entry.goneMs >= this.#afterMs) this.#tracked.delete(id)
        continue
      }
      entry.goneMs = 0
      if (visible) this.#look(entry, height)
      if (entry.ageMs >= this.#afterMs && (entry.scrolledPast || entry.seenMs >= this.#afterMs)) {
        this.#tracked.delete(id)
        this.#onKept(id)
      }
    }
    if (this.#tracked.size === 0) this.#stop()
  }

  #look(entry: Tracked, height: number): void {
    const rects = entry.mark.rects().filter((rect) => rect.width > 0 && rect.height > 0)
    if (rects.length === 0) return
    const top = Math.min(...rects.map((rect) => rect.top))
    const bottom = Math.max(...rects.map((rect) => rect.bottom))
    if (bottom <= 0) entry.scrolledPast = true
    else if (top < height) entry.seenMs += KEPT_TICK_MS
  }
}
