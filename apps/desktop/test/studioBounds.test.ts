import { describe, expect, it } from 'vitest'
import { centreInWorkArea, clampIntoWorkArea } from '../src/main/windows/bounds'

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
