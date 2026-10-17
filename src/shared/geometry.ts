import type { BuddyMode, ModeLayout, Point, Rect } from './types'

/** Owl disc diameter, DIP. */
export const OWL_SIZE = 56

export const DOT_WINDOW = { width: 88, height: 88 } as const
export const PILL_WINDOW = { width: 248, height: 160 } as const
export const PILL_CAPSULE = { width: 164, height: 64 } as const
export const CARD_WINDOW = { width: 420, height: 620 } as const

/** Padding between window edge and visible surface. */
const PAD = 16
/** How far the owl centre sits inside the card's anchor-side corner. */
const CARD_OWL_INSET = 32

function windowSize(mode: BuddyMode): { width: number; height: number } {
  switch (mode) {
    case 'dot':
      return DOT_WINDOW
    case 'pill':
      return PILL_WINDOW
    case 'card':
      return CARD_WINDOW
    case 'hidden':
      return DOT_WINDOW
  }
}

function clampRectInside(bounds: Rect, within: Rect): Rect {
  const x = Math.min(Math.max(bounds.x, within.x), within.x + within.width - bounds.width)
  const y = Math.min(Math.max(bounds.y, within.y), within.y + within.height - bounds.height)
  return { x: Math.round(x), y: Math.round(y), width: bounds.width, height: bounds.height }
}

/**
 * Compute the window layout for a buddy mode so the owl centre lands exactly on
 * `anchor` (screen DIP). Content opens toward the work-area centre; bounds are
 * clamped inside `workArea` (which shifts `owl` if the window moves).
 */
export function layoutForMode(mode: BuddyMode, anchor: Point, workArea: Rect): ModeLayout {
  const cx = workArea.x + workArea.width / 2
  const cy = workArea.y + workArea.height / 2
  const openX: ModeLayout['openX'] = anchor.x < cx ? 'right' : 'left'
  const openY: ModeLayout['openY'] = anchor.y < cy ? 'down' : 'up'
  const size = windowSize(mode)

  let bounds: Rect
  if (mode === 'pill') {
    // Owl sits at the anchor-side end of the capsule, centred vertically on it,
    // inset 4 DIP on its three outer sides (top/bottom/end).
    const capsuleX =
      openX === 'left'
        ? anchor.x + OWL_SIZE / 2 + 4 - PILL_CAPSULE.width
        : anchor.x - OWL_SIZE / 2 - 4
    // The capsule hugs the window side opposite the greeting bubble.
    const relCapsuleTop = openY === 'up' ? size.height - PAD - PILL_CAPSULE.height : PAD
    const capsuleCentreY = relCapsuleTop + PILL_CAPSULE.height / 2
    bounds = {
      x: capsuleX - PAD,
      y: anchor.y - capsuleCentreY,
      width: size.width,
      height: size.height
    }
  } else if (mode === 'card') {
    bounds = {
      x: openX === 'left' ? anchor.x + CARD_OWL_INSET - size.width : anchor.x - CARD_OWL_INSET,
      y: openY === 'up' ? anchor.y + CARD_OWL_INSET - size.height : anchor.y - CARD_OWL_INSET,
      width: size.width,
      height: size.height
    }
  } else {
    // dot / hidden: owl centred in the window.
    bounds = {
      x: anchor.x - size.width / 2,
      y: anchor.y - size.height / 2,
      width: size.width,
      height: size.height
    }
  }

  bounds = clampRectInside(bounds, workArea)
  const owl: Point = {
    x: Math.round(anchor.x - bounds.x),
    y: Math.round(anchor.y - bounds.y)
  }
  return { bounds, owl, openX, openY }
}

/** Clamp the anchor point inside the work area, `inset` DIP from the edges. */
export function clampAnchor(anchor: Point, workArea: Rect, inset = 40): Point {
  return {
    x: Math.min(Math.max(anchor.x, workArea.x + inset), workArea.x + workArea.width - inset),
    y: Math.min(Math.max(anchor.y, workArea.y + inset), workArea.y + workArea.height - inset)
  }
}

/** Snap the anchor to any work-area edge it is within `threshold` of. */
export function snapToEdges(anchor: Point, workArea: Rect, threshold = 48, inset = 40): Point {
  const out = { ...anchor }
  if (anchor.x - workArea.x < threshold) out.x = workArea.x + inset
  else if (workArea.x + workArea.width - anchor.x < threshold)
    out.x = workArea.x + workArea.width - inset
  if (anchor.y - workArea.y < threshold) out.y = workArea.y + inset
  else if (workArea.y + workArea.height - anchor.y < threshold)
    out.y = workArea.y + workArea.height - inset
  return out
}

/** Apple's momentum projection from "Designing Fluid Interfaces" (WWDC 2018). */
export function project(initialVelocity: number, decelerationRate = 0.998): number {
  return ((initialVelocity / 1000) * decelerationRate) / (1 - decelerationRate)
}

/** Bounding box of points plus padding, clamped inside `within` if given. */
export function bboxOfPoints(points: Point[], padding = 0, within?: Rect): Rect | null {
  if (points.length === 0) return null
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const p of points) {
    minX = Math.min(minX, p.x)
    minY = Math.min(minY, p.y)
    maxX = Math.max(maxX, p.x)
    maxY = Math.max(maxY, p.y)
  }
  let rect: Rect = {
    x: minX - padding,
    y: minY - padding,
    width: maxX - minX + padding * 2,
    height: maxY - minY + padding * 2
  }
  if (within) {
    const x = Math.max(rect.x, within.x)
    const y = Math.max(rect.y, within.y)
    const right = Math.min(rect.x + rect.width, within.x + within.width)
    const bottom = Math.min(rect.y + rect.height, within.y + within.height)
    rect = { x, y, width: Math.max(0, right - x), height: Math.max(0, bottom - y) }
  }
  return rect
}

/** DIP rect → physical pixels at `scale`, rounding outward so nothing is cut. */
export function toPhysical(rect: Rect, scale: number): Rect {
  const x = Math.floor(rect.x * scale)
  const y = Math.floor(rect.y * scale)
  const right = Math.ceil((rect.x + rect.width) * scale)
  const bottom = Math.ceil((rect.y + rect.height) * scale)
  return { x, y, width: right - x, height: bottom - y }
}

/**
 * DIP rect → physical crop rect inside an image of `imageW`×`imageH` px.
 * `ratio` is image-px per DIP, derived from the actual capture size.
 * Rounds outward, then clamps to the image.
 */
export function physicalCropRect(rect: Rect, ratio: number, imageW: number, imageH: number): Rect {
  const p = toPhysical(rect, ratio)
  const x = Math.min(Math.max(p.x, 0), imageW)
  const y = Math.min(Math.max(p.y, 0), imageH)
  const right = Math.min(Math.max(p.x + p.width, 0), imageW)
  const bottom = Math.min(Math.max(p.y + p.height, 0), imageH)
  return { x, y, width: Math.max(0, right - x), height: Math.max(0, bottom - y) }
}

/** Scale w×h down so the long edge is at most `maxLongEdge`; returns DIP dims. */
export function fitWithin(
  w: number,
  h: number,
  maxLongEdge: number
): { width: number; height: number } {
  if (w <= 0 || h <= 0) return { width: 0, height: 0 }
  const long = Math.max(w, h)
  if (long <= maxLongEdge) return { width: w, height: h }
  const s = maxLongEdge / long
  return { width: Math.round(w * s), height: Math.round(h * s) }
}

/** Cascade position for sticky-note index `i`, anchored at `origin`. */
export function cascadeNotePosition(
  i: number,
  origin: Point,
  workArea: Rect,
  size: { width: number; height: number }
): Point {
  const STEP = 28
  const WRAP = 6
  let x = origin.x + (i % WRAP) * STEP
  let y = origin.y + (i % WRAP) * STEP
  x = Math.min(
    Math.max(x, workArea.x),
    Math.max(workArea.x, workArea.x + workArea.width - size.width)
  )
  y = Math.min(
    Math.max(y, workArea.y),
    Math.max(workArea.y, workArea.y + workArea.height - size.height)
  )
  return { x, y }
}
