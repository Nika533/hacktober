import { describe, expect, it } from 'vitest'
import { CARD_WINDOW, type Rect } from '@hoot/core'
import { anchorAfterDrag, cursorInRegions, fixedLayout } from '../src/main/buddy/hitTest'

const WA: Rect = { x: 0, y: 0, width: 1920, height: 1040 }

describe('cursorInRegions', () => {
  const win: Rect = { x: 100, y: 100, width: 420, height: 620 }
  const rects: Rect[] = [
    { x: 10, y: 10, width: 56, height: 56 },
    { x: 300, y: 500, width: 100, height: 40 }
  ]

  it('is true inside a window-local region and false outside', () => {
    expect(cursorInRegions({ x: 120, y: 120 }, win, rects)).toBe(true)
    expect(cursorInRegions({ x: 410, y: 610 }, win, rects)).toBe(true)
    expect(cursorInRegions({ x: 200, y: 200 }, win, rects)).toBe(false)
    expect(cursorInRegions({ x: 100, y: 100 }, win, rects)).toBe(false)
    // right/bottom edges are exclusive
    expect(cursorInRegions({ x: 166, y: 120 }, win, rects)).toBe(false)
    expect(cursorInRegions({ x: 165, y: 120 }, win, rects)).toBe(true)
  })

  it('is false for any rect when empty', () => {
    expect(cursorInRegions({ x: 110, y: 110 }, win, [])).toBe(false)
  })

  it('respects non-zero window offsets', () => {
    const moved: Rect = { x: 900, y: 400, width: 420, height: 620 }
    expect(cursorInRegions({ x: 120, y: 120 }, moved, rects)).toBe(false)
    expect(cursorInRegions({ x: 920, y: 420 }, moved, rects)).toBe(true)
  })
})

describe('fixedLayout', () => {
  const corners = [
    { anchor: { x: 40, y: 40 }, openX: 'right', openY: 'down' },
    { anchor: { x: 1880, y: 40 }, openX: 'left', openY: 'down' },
    { anchor: { x: 40, y: 1000 }, openX: 'right', openY: 'up' },
    { anchor: { x: 1880, y: 1000 }, openX: 'left', openY: 'up' }
  ] as const

  it.each(corners)('$openX/$openY keeps the owl on the anchor and stays inside', (c) => {
    const l = fixedLayout({ x: c.anchor.x, y: c.anchor.y }, WA)
    expect(l.bounds.width).toBe(CARD_WINDOW.width)
    expect(l.bounds.height).toBe(CARD_WINDOW.height)
    expect(l.openX).toBe(c.openX)
    expect(l.openY).toBe(c.openY)
    // bounds inside the work area
    expect(l.bounds.x).toBeGreaterThanOrEqual(WA.x)
    expect(l.bounds.y).toBeGreaterThanOrEqual(WA.y)
    expect(l.bounds.x + l.bounds.width).toBeLessThanOrEqual(WA.x + WA.width)
    expect(l.bounds.y + l.bounds.height).toBeLessThanOrEqual(WA.y + WA.height)
    // owl (window-local) lands back on the anchor in screen coordinates
    expect(l.bounds.x + l.owl.x).toBeCloseTo(c.anchor.x, 0)
    expect(l.bounds.y + l.owl.y).toBeCloseTo(c.anchor.y, 0)
  })

  it('shifts the window (not the anchor) when the anchor is near an edge', () => {
    const l = fixedLayout({ x: 0, y: 0 }, WA)
    // clamped into the work area; the owl offset grows to keep screen position
    expect(l.bounds.x).toBe(WA.x)
    expect(l.bounds.y).toBe(WA.y)
    expect(l.bounds.x + l.owl.x).toBe(0)
    expect(l.bounds.y + l.owl.y).toBe(0)
  })
})

describe('anchorAfterDrag', () => {
  it('without velocity keeps the anchor (no snap, inside)', () => {
    const target = anchorAfterDrag({ x: 500, y: 500 }, { vx: 0, vy: 0 }, WA)
    expect(target).toEqual({ x: 500, y: 500 })
  })

  it('snaps to a near edge', () => {
    const target = anchorAfterDrag({ x: 30, y: 500 }, { vx: 0, vy: 0 }, WA)
    expect(target.x).toBe(WA.x + 40) // snapped to inset
    expect(target.y).toBe(500)
  })

  it('clamps a fling back inside the work area', () => {
    // project(3000) ≈ 1497 → x ≈ 500+1497=1997 > right edge → clamp + snap
    const target = anchorAfterDrag({ x: 500, y: 500 }, { vx: 3000, vy: 0 }, WA)
    expect(target.x).toBe(WA.x + WA.width - 40)
    expect(target.y).toBe(500)
  })

  it('clamps a fling through the left edge to the inset', () => {
    const target = anchorAfterDrag({ x: 500, y: 500 }, { vx: -3000, vy: 0 }, WA)
    expect(target.x).toBe(WA.x + 40)
  })
})
