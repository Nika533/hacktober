import {
  clampAnchor,
  layoutForMode,
  project,
  snapToEdges,
  type DragEnd,
  type ModeLayout,
  type Point,
  type Rect
} from '@hoot/core'

/**
 * The buddy window is one fixed card-sized canvas in every mode; dot and
 * pill are drawn inside it around the owl. `layoutForMode('card', …)` keeps
 * the owl centre on `anchor` and clamps the window inside the work area.
 */
export function fixedLayout(anchor: Point, workArea: Rect): ModeLayout {
  return layoutForMode('card', anchor, workArea)
}

/**
 * `rects` are window-local DIP hit regions reported by the renderer
 * (`buddy.setHitRegions`). `cursor` and `windowBounds` are screen DIP.
 */
export function cursorInRegions(cursor: Point, windowBounds: Rect, rects: Rect[]): boolean {
  const lx = cursor.x - windowBounds.x
  const ly = cursor.y - windowBounds.y
  return rects.some((r) => lx >= r.x && lx < r.x + r.width && ly >= r.y && ly < r.y + r.height)
}

/**
 * Release position plus Apple's momentum projection (WWDC 2018), clamped
 * into the work area and snapped to near edges — the legacy dragEnd rules.
 */
export function anchorAfterDrag(anchor: Point, v: DragEnd, workArea: Rect): Point {
  const projected = { x: anchor.x + project(v.vx), y: anchor.y + project(v.vy) }
  return snapToEdges(clampAnchor(projected, workArea), workArea)
}
