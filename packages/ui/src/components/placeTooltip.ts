export interface Box {
  top: number
  left: number
  width: number
  height: number
}

export type Side = 'top' | 'bottom'

export interface Placement {
  top: number
  left: number
  side: Side
}

const GAP = 6
const MARGIN = 4

/**
 * Centres the tip on the trigger on the preferred side, flips when it would
 * leave the viewport, and clamps it horizontally inside the viewport.
 */
export function placeTooltip(
  trigger: Box,
  tip: { width: number; height: number },
  viewport: { width: number; height: number },
  preferred: Side = 'top'
): Placement {
  const above = trigger.top - GAP - tip.height
  const below = trigger.top + trigger.height + GAP
  const fitsAbove = above >= MARGIN
  const fitsBelow = below + tip.height <= viewport.height - MARGIN
  const side: Side =
    preferred === 'top'
      ? fitsAbove || !fitsBelow
        ? 'top'
        : 'bottom'
      : fitsBelow || !fitsAbove
        ? 'bottom'
        : 'top'
  const centred = trigger.left + trigger.width / 2 - tip.width / 2
  const maxLeft = Math.max(MARGIN, viewport.width - MARGIN - tip.width)
  return {
    top: Math.round(side === 'top' ? above : below),
    left: Math.round(Math.min(Math.max(centred, MARGIN), maxLeft)),
    side
  }
}
