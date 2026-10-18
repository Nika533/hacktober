import { describe, expect, it } from 'vitest'
import {
  BUBBLE_GAP,
  BUBBLE_MARGIN,
  BUBBLE_MAX_HEIGHT,
  BUBBLE_MIN_HEIGHT,
  BUBBLE_WIDTH,
  bubbleBounds,
  bubbleSide,
  cursorAnchor,
  unionRect
} from '../../src/main/anywhere/placement'

const AREA = { x: 0, y: 0, width: 1920, height: 1040 }

describe('unionRect', () => {
  it('bounds every rect of a multi-line selection', () => {
    expect(
      unionRect([
        { x: 300, y: 100, width: 400, height: 20 },
        { x: 120, y: 120, width: 500, height: 20 },
        { x: 120, y: 140, width: 80, height: 20 }
      ])
    ).toEqual({ x: 120, y: 100, width: 580, height: 60 })
  })

  it('is null without rects (or with only empty ones)', () => {
    expect(unionRect([])).toBeNull()
    expect(unionRect([{ x: 5, y: 5, width: 0, height: 0 }])).toBeNull()
  })
})

describe('bubble placement', () => {
  const sel = { x: 400, y: 200, width: 300, height: 40 }

  it('sits below the selection with the gap between it and the card', () => {
    expect(bubbleSide(sel, AREA)).toBe('below')
    const b = bubbleBounds(sel, 200, 'below', AREA)
    expect(b).toEqual({
      x: 400 - BUBBLE_MARGIN,
      y: 240 + BUBBLE_GAP - BUBBLE_MARGIN,
      width: BUBBLE_WIDTH,
      height: 200
    })
    // The visible card starts exactly BUBBLE_GAP under the selection.
    expect(b.y + BUBBLE_MARGIN - (sel.y + sel.height)).toBe(BUBBLE_GAP)
  })

  it('flips above when the tallest bubble wouldn’t fit below', () => {
    const low = { x: 400, y: 900, width: 300, height: 40 }
    expect(bubbleSide(low, AREA)).toBe('above')
    const b = bubbleBounds(low, 200, 'above', AREA)
    expect(b.y + b.height - BUBBLE_MARGIN).toBe(low.y - BUBBLE_GAP)
  })

  it('stays below when neither side fits but below has more room', () => {
    const short = { x: 0, y: 0, width: 800, height: 300 }
    expect(bubbleSide({ x: 10, y: 100, width: 50, height: 20 }, short)).toBe('below')
    expect(bubbleSide({ x: 10, y: 200, width: 50, height: 20 }, short)).toBe('above')
  })

  it('clamps into the work area of the display, including multi-monitor offsets', () => {
    const right = { x: 1920, y: 0, width: 1280, height: 984 }
    const edge = { x: 3150, y: 960, width: 40, height: 18 }
    const side = bubbleSide(edge, right)
    expect(side).toBe('above')
    const b = bubbleBounds(edge, BUBBLE_MAX_HEIGHT, side, right)
    expect(b.x).toBe(right.x + right.width - BUBBLE_WIDTH)
    expect(b.y).toBeGreaterThanOrEqual(right.y)
    expect(b.y + b.height).toBeLessThanOrEqual(right.y + right.height)

    const topLeft = bubbleBounds({ x: -500, y: -40, width: 10, height: 10 }, 120, 'above', AREA)
    expect(topLeft).toMatchObject({ x: 0, y: 0 })
  })

  it('caps the height between the minimum and the maximum', () => {
    expect(bubbleBounds(sel, 5000, 'below', AREA).height).toBe(BUBBLE_MAX_HEIGHT)
    expect(bubbleBounds(sel, 3, 'below', AREA).height).toBe(BUBBLE_MIN_HEIGHT)
  })

  it('anchors just under the pointer when there are no rects', () => {
    const at = cursorAnchor({ x: 640, y: 300 })
    const b = bubbleBounds(at, 120, bubbleSide(at, AREA), AREA)
    expect(b.y + BUBBLE_MARGIN).toBeGreaterThan(300)
    expect(b.x).toBe(640 - BUBBLE_MARGIN)
  })
})
