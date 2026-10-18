import type { OverlayCommit, Point, Rect } from '@hoot/core'

/** What the user is drawing, in window DIP (the overlay covers the display 1:1). */
export type Shape = { kind: 'lasso'; points: Point[] } | { kind: 'rect'; rect: Rect }

/** Smaller than this on either side is a stray click, not a capture (matches main). */
export const MIN_SHAPE = 8

export function rectBetween(a: Point, b: Point): Rect {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(b.x - a.x),
    height: Math.abs(b.y - a.y)
  }
}

export function bounds(shape: Shape): Rect {
  if (shape.kind === 'rect') return shape.rect
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const p of shape.points) {
    minX = Math.min(minX, p.x)
    minY = Math.min(minY, p.y)
    maxX = Math.max(maxX, p.x)
    maxY = Math.max(maxY, p.y)
  }
  return shape.points.length
    ? { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
    : { x: 0, y: 0, width: 0, height: 0 }
}

/** The commit for a finished shape, or null when it's too small to mean anything. */
export function commitFor(shape: Shape): OverlayCommit | null {
  if (shape.kind === 'lasso' && shape.points.length < 3) return null
  const box = bounds(shape)
  if (box.width < MIN_SHAPE || box.height < MIN_SHAPE) return null
  return shape.kind === 'rect'
    ? { kind: 'rect', rect: shape.rect }
    : { kind: 'lasso', points: shape.points }
}
