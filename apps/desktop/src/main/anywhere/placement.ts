import type { Point, Rect } from '@hoot/core'

/** Window width (DIP), including the transparent margin the glow draws into. */
export const BUBBLE_WIDTH = 380
export const BUBBLE_MIN_HEIGHT = 72
export const BUBBLE_MAX_HEIGHT = 360
/** Transparent edge between the window and the glass card. */
export const BUBBLE_MARGIN = 12
/** Space between the selection and the card. */
export const BUBBLE_GAP = 8
/** Height of the anchor used at the cursor, so the bubble clears the pointer. */
const CURSOR_HEIGHT = 20

export type BubbleSide = 'below' | 'above'

const clamp = (v: number, lo: number, hi: number): number =>
  Math.round(Math.min(Math.max(v, lo), Math.max(lo, hi)))

export const clampBubbleHeight = (h: number): number =>
  clamp(h, BUBBLE_MIN_HEIGHT, BUBBLE_MAX_HEIGHT)

/** Bounding box of the selection's rects; null when there are none. */
export function unionRect(rects: readonly Rect[]): Rect | null {
  const real = rects.filter((r) => r.width > 0 || r.height > 0)
  if (real.length === 0) return null
  const x = Math.min(...real.map((r) => r.x))
  const y = Math.min(...real.map((r) => r.y))
  const right = Math.max(...real.map((r) => r.x + r.width))
  const bottom = Math.max(...real.map((r) => r.y + r.height))
  return { x, y, width: right - x, height: bottom - y }
}

/** Where to anchor when the selection has no rects: just under the pointer. */
export const cursorAnchor = (p: Point): Rect => ({
  x: p.x,
  y: p.y,
  width: 0,
  height: CURSOR_HEIGHT
})

/**
 * Below the selection when the tallest bubble fits there, else whichever side
 * has more room. Decided once per bubble, so growing content never flips it.
 */
export function bubbleSide(anchor: Rect, area: Rect): BubbleSide {
  const below = area.y + area.height - (anchor.y + anchor.height)
  const above = anchor.y - area.y
  const needed = BUBBLE_MAX_HEIGHT + BUBBLE_GAP - BUBBLE_MARGIN
  return below >= needed || below >= above ? 'below' : 'above'
}

/** Window bounds: the card `BUBBLE_GAP` from the anchor on `side`, clamped to the work area. */
export function bubbleBounds(anchor: Rect, height: number, side: BubbleSide, area: Rect): Rect {
  const h = clampBubbleHeight(height)
  const y =
    side === 'below'
      ? anchor.y + anchor.height + BUBBLE_GAP - BUBBLE_MARGIN
      : anchor.y - BUBBLE_GAP + BUBBLE_MARGIN - h
  return {
    x: clamp(anchor.x - BUBBLE_MARGIN, area.x, area.x + area.width - BUBBLE_WIDTH),
    y: clamp(y, area.y, area.y + area.height - h),
    width: BUBBLE_WIDTH,
    height: h
  }
}
