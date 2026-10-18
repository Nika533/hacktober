import type { Rect } from '@hoot/core'

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
