import { describe, expect, it } from 'vitest'
import {
  centreInWorkArea,
  clampIntoWorkArea,
  intersectsAny,
  rectsIntersect,
  relocateAnchor
} from '../src/main/windows/bounds'

const wa = { x: 0, y: 0, width: 1280, height: 800 }

describe('centreInWorkArea', () => {
  it('centres the default size', () => {
    expect(centreInWorkArea(wa, { width: 1100, height: 720 })).toEqual({
      x: 90,
      y: 40,
      width: 1100,
      height: 720
    })
  })

  it('shrinks to fit a smaller work area', () => {
    const tiny = { x: 100, y: 50, width: 600, height: 400 }
    const r = centreInWorkArea(tiny, { width: 1100, height: 720 })
    expect(r.width).toBe(600)
    expect(r.height).toBe(400)
    expect(r.x).toBe(100)
    expect(r.y).toBe(50)
  })

  it('respects a non-zero work-area origin', () => {
    const off = { x: 2560, y: 40, width: 1280, height: 800 }
    const r = centreInWorkArea(off, { width: 800, height: 600 })
    expect(r.x).toBe(2560 + 240)
    expect(r.y).toBe(40 + 100)
  })
})

describe('clampIntoWorkArea', () => {
  it('keeps a fully-inside rect unchanged', () => {
    const b = { x: 100, y: 100, width: 800, height: 500 }
    expect(clampIntoWorkArea(b, wa)).toEqual(b)
  })

  it('slides an off-screen rect back inside', () => {
    expect(clampIntoWorkArea({ x: 1200, y: 700, width: 400, height: 300 }, wa)).toEqual({
      x: 880,
      y: 500,
      width: 400,
      height: 300
    })
  })

  it('slides negative origins back inside', () => {
    const r = clampIntoWorkArea({ x: -500, y: -50, width: 400, height: 300 }, wa)
    expect(r).toEqual({ x: 0, y: 0, width: 400, height: 300 })
  })

  it('shrinks an oversized rect to the work area', () => {
    const r = clampIntoWorkArea({ x: 0, y: 0, width: 2000, height: 2000 }, wa)
    expect(r.width).toBe(1280)
    expect(r.height).toBe(800)
  })
})

describe('rectsIntersect / intersectsAny', () => {
  it('detects overlap and edge-touching misses', () => {
    const a = { x: 0, y: 0, width: 100, height: 100 }
    expect(rectsIntersect(a, { x: 50, y: 50, width: 100, height: 100 })).toBe(true)
    expect(rectsIntersect(a, { x: 100, y: 0, width: 50, height: 50 })).toBe(false)
    expect(intersectsAny(a, [{ x: 500, y: 500, width: 10, height: 10 }, a])).toBe(true)
    expect(intersectsAny(a, [])).toBe(false)
  })
})

describe('relocateAnchor', () => {
  const second = { x: 1280, y: 0, width: 1920, height: 1080 }

  it('leaves an anchor inside a work area unchanged', () => {
    const a = { x: 1200, y: 700 }
    expect(relocateAnchor(a, [wa, second], wa)).toEqual(a)
  })

  it('clamps an off-screen anchor into the nearest work area', () => {
    expect(relocateAnchor({ x: 2000, y: 900 }, [wa], wa)).toEqual({ x: 1240, y: 760 })
    // Closer to the second display → clamped there, not the primary.
    expect(relocateAnchor({ x: 3500, y: 1100 }, [wa, second], wa)).toEqual({
      x: 1280 + 1920 - 40,
      y: 1080 - 40
    })
  })

  it('falls back to the primary default when nothing matches', () => {
    expect(relocateAnchor({ x: 50, y: 50 }, [], wa)).toEqual({ x: 1240, y: 760 })
  })
})
