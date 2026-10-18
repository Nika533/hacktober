import {
  CARD_WINDOW,
  DOT_WINDOW,
  OWL_SIZE,
  PILL_CAPSULE,
  PILL_WINDOW,
  type BuddyMode,
  type ModeLayout,
  type Rect
} from '@hoot/core'

const RANK: Record<BuddyMode, number> = { hidden: 0, dot: 1, pill: 2, card: 3 }

/** Growing transitions animate in after main resizes; shrinking ones animate out first. */
export const isGrow = (from: BuddyMode, to: BuddyMode): boolean => RANK[to] > RANK[from]

const WINDOW: Record<BuddyMode, { width: number; height: number }> = {
  hidden: DOT_WINDOW,
  dot: DOT_WINDOW,
  pill: PILL_WINDOW,
  card: CARD_WINDOW
}

/**
 * True when `layout` is main's layout for `mode`. Clamping to the work area
 * moves a window but never resizes it, so the size identifies the mode.
 */
export function layoutFits(mode: BuddyMode, layout: ModeLayout | null): layout is ModeLayout {
  if (!layout) return false
  const size = WINDOW[mode]
  return layout.bounds.width === size.width && layout.bounds.height === size.height
}

/** The owl's square, window-local. */
export function owlRect(layout: ModeLayout): Rect {
  return {
    x: layout.owl.x - OWL_SIZE / 2,
    y: layout.owl.y - OWL_SIZE / 2,
    width: OWL_SIZE,
    height: OWL_SIZE
  }
}

/** The pill capsule hugs the owl: 4 DIP around it on the anchor-side end. */
export function capsuleRect(layout: ModeLayout): Rect {
  const owl = owlRect(layout)
  const x = layout.openX === 'left' ? owl.x + OWL_SIZE + 4 - PILL_CAPSULE.width : owl.x - 4
  return { x, y: owl.y - 4, width: PILL_CAPSULE.width, height: PILL_CAPSULE.height }
}

/** Rects of every `[data-hit]` element relative to `root` (the window), rounded outward. */
export function measureHitRegions(root: Element): Rect[] {
  const o = root.getBoundingClientRect()
  const rects: Rect[] = []
  for (const el of root.querySelectorAll('[data-hit]')) {
    const r = el.getBoundingClientRect()
    if (r.width <= 0 || r.height <= 0) continue
    const x = Math.floor(r.left - o.left)
    const y = Math.floor(r.top - o.top)
    rects.push({
      x,
      y,
      width: Math.ceil(r.right - o.left) - x,
      height: Math.ceil(r.bottom - o.top) - y
    })
    if (rects.length === 64) break
  }
  return rects
}

export const sameRects = (a: readonly Rect[], b: readonly Rect[]): boolean =>
  a.length === b.length &&
  a.every(
    (r, i) =>
      r.x === b[i]?.x && r.y === b[i]?.y && r.width === b[i]?.width && r.height === b[i]?.height
  )
