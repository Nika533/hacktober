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
 * The canvas extends past the card on every side so the owl and capsule
 * shadows (~18 px --shadow-2) render soft instead of clipping at the window
 * edge (#82). It may extend past the work area — transparent pixels click
 * through natively and the hit-region poller gates the rest.
 */
export const BUDDY_CANVAS_PAD = 16

/**
 * The buddy window is one fixed card-sized canvas in every mode; dot and
 * pill are drawn inside it around the owl. `layoutForMode('card', …)` keeps
 * the owl centre on `anchor` and clamps the window inside the work area;
 * the pad then grows the canvas outward without moving the anchor.
 */
export function fixedLayout(anchor: Point, workArea: Rect): ModeLayout {
  const base = layoutForMode('card', anchor, workArea)
  return {
    ...base,
    bounds: {
      x: base.bounds.x - BUDDY_CANVAS_PAD,
      y: base.bounds.y - BUDDY_CANVAS_PAD,
      width: base.bounds.width + 2 * BUDDY_CANVAS_PAD,
      height: base.bounds.height + 2 * BUDDY_CANVAS_PAD
    },
    owl: { x: base.owl.x + BUDDY_CANVAS_PAD, y: base.owl.y + BUDDY_CANVAS_PAD }
  }
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
