import { clampAnchor, type Point, type Rect } from '@hoot/core'

export const STUDIO_DEFAULT_SIZE = { width: 1100, height: 720 } as const

/** Centre a window of `size` inside `wa`, shrinking to fit. */
export function centreInWorkArea(
  wa: Rect,
  size: { width: number; height: number } = STUDIO_DEFAULT_SIZE
): Rect {
  const width = Math.min(size.width, wa.width)
  const height = Math.min(size.height, wa.height)
  return {
    x: Math.round(wa.x + (wa.width - width) / 2),
    y: Math.round(wa.y + (wa.height - height) / 2),
    width,
    height
  }
}

/** Fit `b` fully inside `wa` (shrinks first, then slides). */
export function clampIntoWorkArea(b: Rect, wa: Rect): Rect {
  const width = Math.min(b.width, wa.width)
  const height = Math.min(b.height, wa.height)
  return {
    x: Math.min(Math.max(b.x, wa.x), wa.x + wa.width - width),
    y: Math.min(Math.max(b.y, wa.y), wa.y + wa.height - height),
    width,
    height
  }
}

/** Any overlap at all (touching edges don't count). */
export function rectsIntersect(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
}

export function intersectsAny(b: Rect, rects: Rect[]): boolean {
  return rects.some((r) => rectsIntersect(b, r))
}

const contains = (r: Rect, p: Point): boolean =>
  p.x >= r.x && p.x < r.x + r.width && p.y >= r.y && p.y < r.y + r.height

const distToRect = (r: Rect, p: Point): number =>
  Math.hypot(
    Math.max(r.x - p.x, p.x - (r.x + r.width), 0),
    Math.max(r.y - p.y, p.y - (r.y + r.height), 0)
  )

/** The buddy's default spot: bottom-right of a work area, inset. */
const defaultAnchorIn = (wa: Rect): Point => ({
  x: wa.x + wa.width - 40,
  y: wa.y + wa.height - 40
})

/**
 * The anchor after the display topology or a work area changed. On-screen
 * stays put; off-screen slides into the nearest display's work area; with no
 * displays at all it falls back to the default spot on the primary.
 */
export function relocateAnchor(anchor: Point, workAreas: Rect[], primary: Rect): Point {
  if (workAreas.some((wa) => contains(wa, anchor))) return anchor
  if (workAreas.length === 0) return defaultAnchorIn(primary)
  const nearest = workAreas.reduce((a, b) =>
    distToRect(b, anchor) < distToRect(a, anchor) ? b : a
  )
  return clampAnchor(anchor, nearest)
}
