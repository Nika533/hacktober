import { describe, expect, it } from 'vitest'
import {
  bboxOfPoints,
  cascadeNotePosition,
  clampAnchor,
  fitWithin,
  layoutForMode,
  physicalCropRect,
  project,
  snapToEdges,
  toPhysical
} from '../src/util/geometry'
import type { Point, Rect } from '../src/types/app'

const wa: Rect = { x: 0, y: 0, width: 1920, height: 1040 }

const inside = (r: Rect, w: Rect): void => {
  expect(r.x).toBeGreaterThanOrEqual(w.x)
  expect(r.y).toBeGreaterThanOrEqual(w.y)
  expect(r.x + r.width).toBeLessThanOrEqual(w.x + w.width)
  expect(r.y + r.height).toBeLessThanOrEqual(w.y + w.height)
}

describe('layoutForMode', () => {
  const anchors: Record<string, Point> = {
    'top-left': { x: 40, y: 40 },
    'top-right': { x: 1880, y: 40 },
    'bottom-left': { x: 40, y: 1000 },
    'bottom-right': { x: 1880, y: 1000 },
    centre: { x: 960, y: 520 }
  }

  for (const [name, anchor] of Object.entries(anchors)) {
    for (const mode of ['dot', 'pill', 'card'] as const) {
      it(`${mode} @ ${name}: owl lands on anchor, bounds inside work area`, () => {
        const l = layoutForMode(mode, anchor, wa)
        inside(l.bounds, wa)
        // owl centre in screen coords = bounds origin + local owl pos
        const screenX = l.bounds.x + l.owl.x
        const screenY = l.bounds.y + l.owl.y
        expect(Math.abs(screenX - anchor.x)).toBeLessThan(40)
        expect(Math.abs(screenY - anchor.y)).toBeLessThan(40)
        expect(l.owl.x).toBeGreaterThanOrEqual(0)
        expect(l.owl.y).toBeGreaterThanOrEqual(0)
      })
    }
  }

  it('opens toward the work-area centre', () => {
    expect(layoutForMode('card', { x: 100, y: 100 }, wa)).toMatchObject({
      openX: 'right',
      openY: 'down'
    })
    expect(layoutForMode('card', { x: 1800, y: 100 }, wa)).toMatchObject({
      openX: 'left',
      openY: 'down'
    })
    expect(layoutForMode('card', { x: 100, y: 900 }, wa)).toMatchObject({
      openX: 'right',
      openY: 'up'
    })
    expect(layoutForMode('card', { x: 1800, y: 900 }, wa)).toMatchObject({
      openX: 'left',
      openY: 'up'
    })
  })

  it('clamps into the work area when the anchor is near the edge', () => {
    const l = layoutForMode('card', { x: 5, y: 5 }, wa)
    inside(l.bounds, wa)
  })
})

describe('clampAnchor', () => {
  it('keeps the anchor inset from work-area edges', () => {
    expect(clampAnchor({ x: -500, y: 5000 }, wa)).toEqual({ x: 40, y: 1000 })
    expect(clampAnchor({ x: 960, y: 520 }, wa)).toEqual({ x: 960, y: 520 })
  })
})

describe('snapToEdges', () => {
  it('snaps within the threshold', () => {
    expect(snapToEdges({ x: 30, y: 500 }, wa)).toEqual({ x: 40, y: 500 })
    expect(snapToEdges({ x: 1900, y: 500 }, wa)).toEqual({ x: 1880, y: 500 })
    expect(snapToEdges({ x: 500, y: 10 }, wa)).toEqual({ x: 500, y: 40 })
    expect(snapToEdges({ x: 500, y: 1030 }, wa)).toEqual({ x: 500, y: 1000 })
  })
  it('leaves mid-screen anchors alone', () => {
    expect(snapToEdges({ x: 960, y: 520 }, wa)).toEqual({ x: 960, y: 520 })
  })
})

describe('project', () => {
  it("matches Apple's formula (v/1000)*d/(1-d)", () => {
    expect(project(1000, 0.998)).toBeCloseTo(499)
    expect(project(0)).toBe(0)
    expect(project(-500, 0.998)).toBeCloseTo(-249.5)
  })
})

describe('bboxOfPoints', () => {
  it('bounds points plus padding', () => {
    const r = bboxOfPoints(
      [
        { x: 10, y: 10 },
        { x: 50, y: 40 },
        { x: 20, y: 60 }
      ],
      8
    )
    expect(r).toEqual({ x: 2, y: 2, width: 56, height: 66 })
  })
  it('clamps within a rect', () => {
    const r = bboxOfPoints(
      [
        { x: -20, y: -20 },
        { x: 100, y: 100 }
      ],
      8,
      { x: 0, y: 0, width: 80, height: 80 }
    )
    expect(r).toEqual({ x: 0, y: 0, width: 80, height: 80 })
  })
  it('returns null for empty input', () => {
    expect(bboxOfPoints([])).toBeNull()
  })
})

describe('toPhysical', () => {
  it('rounds outward at 1.25×', () => {
    expect(toPhysical({ x: 10.4, y: 10.4, width: 50.4, height: 50.4 }, 1.25)).toEqual({
      x: 13,
      y: 13,
      width: 63, // ceil(60.8*1.25=76) - 13
      height: 63
    })
    expect(toPhysical({ x: 0.5, y: 0.5, width: 1, height: 1 }, 1.25)).toEqual({
      x: 0,
      y: 0,
      width: 2, // floor(0.625)=0, ceil(1.5*1.25=1.875)=2
      height: 2
    })
  })
  it('rounds outward at 1.5×', () => {
    expect(toPhysical({ x: 10.3, y: 10.3, width: 40.7, height: 20.1 }, 1.5)).toEqual({
      x: 15,
      y: 15,
      width: 62, // ceil(51*1.5=76.5)=77 - 15
      height: 31 // ceil(30.4*1.5=45.6)=46 - 15
    })
  })
})

describe('fitWithin', () => {
  it('scales the long edge down', () => {
    expect(fitWithin(4000, 1000, 1568)).toEqual({ width: 1568, height: 392 })
    expect(fitWithin(100, 200, 1568)).toEqual({ width: 100, height: 200 })
  })
})

describe('cascadeNotePosition', () => {
  it('offsets successive notes and clamps inside the work area', () => {
    const size = { width: 200, height: 160 }
    const p0 = cascadeNotePosition(0, { x: 100, y: 100 }, wa, size)
    const p1 = cascadeNotePosition(1, { x: 100, y: 100 }, wa, size)
    expect(p1.x).toBeGreaterThan(p0.x)
    expect(p1.y).toBeGreaterThan(p0.y)
    const far = cascadeNotePosition(0, { x: 99999, y: 99999 }, wa, size)
    expect(far.x + size.width).toBeLessThanOrEqual(wa.x + wa.width)
    expect(far.y + size.height).toBeLessThanOrEqual(wa.y + wa.height)
  })
})

describe('physicalCropRect', () => {
  const dip: Rect = { x: 100, y: 50, width: 300, height: 200 }

  it('ratio 1 � identity crop', () => {
    expect(physicalCropRect(dip, 1, 1920, 1080)).toEqual({ x: 100, y: 50, width: 300, height: 200 })
  })

  it('ratio 1.25 � rounds outward', () => {
    expect(
      physicalCropRect({ x: 100.5, y: 50.5, width: 300, height: 200 }, 1.25, 1920, 1080)
    ).toEqual({
      x: 125, // floor(100.5*1.25=125.625)
      y: 63, // floor(50.5*1.25=63.125)
      width: 376, // ceil(400.5*1.25=500.625)=501 - 125
      height: 251 // ceil(250.5*1.25=313.125)=314 - 63
    })
  })

  it('ratio 1.5 � exact multiples stay exact', () => {
    expect(physicalCropRect(dip, 1.5, 2880, 1620)).toEqual({
      x: 150,
      y: 75,
      width: 450,
      height: 300
    })
  })

  it('non-integer ratio mismatch � uses the image ratio, not scaleFactor', () => {
    // 1920-DIP display whose capture came back 2400px wide ? ratio 1.25
    const r = physicalCropRect({ x: 0, y: 0, width: 1920, height: 1080 }, 1.25, 2400, 1350)
    expect(r).toEqual({ x: 0, y: 0, width: 2400, height: 1350 })
  })

  it('clamps to the image bounds', () => {
    const r = physicalCropRect({ x: -40, y: -20, width: 2000, height: 1200 }, 1, 1920, 1080)
    expect(r).toEqual({ x: 0, y: 0, width: 1920, height: 1080 })
  })

  it('fully off-image selection ? zero-size rect', () => {
    const r = physicalCropRect({ x: 5000, y: 5000, width: 100, height: 100 }, 1, 1920, 1080)
    expect(r.width).toBe(0)
    expect(r.height).toBe(0)
  })
})
