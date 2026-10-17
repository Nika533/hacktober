export interface Box {
  left: number
  top: number
  width: number
  height: number
}

export interface Viewport {
  width: number
  height: number
  scrollX: number
  scrollY: number
}

export interface Placement {
  left: number
  top: number
  side: 'below' | 'above'
  originX: number
  originY: number
}

const clamp = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), Math.max(min, max))

export function placeNear(
  anchor: Box,
  size: { width: number; height: number },
  viewport: Viewport,
  gap = 6,
  margin = 8
): Placement {
  const spaceBelow = viewport.height - (anchor.top + anchor.height) - gap - margin
  const spaceAbove = anchor.top - gap - margin
  const side =
    spaceBelow >= size.height || spaceBelow >= spaceAbove ? ('below' as const) : ('above' as const)
  const top = side === 'below' ? anchor.top + anchor.height + gap : anchor.top - gap - size.height
  const left = clamp(anchor.left, margin, viewport.width - margin - size.width)
  const anchorCenter = anchor.left + anchor.width / 2
  return {
    left: left + viewport.scrollX,
    top: top + viewport.scrollY,
    side,
    originX: clamp(anchorCenter - left, 0, size.width),
    originY: side === 'below' ? 0 : size.height
  }
}

export function viewportOf(doc: Document): Viewport {
  const win = doc.defaultView
  return {
    width: doc.documentElement.clientWidth || win?.innerWidth || 0,
    height: doc.documentElement.clientHeight || win?.innerHeight || 0,
    scrollX: win?.scrollX ?? 0,
    scrollY: win?.scrollY ?? 0
  }
}
