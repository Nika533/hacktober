import { describe, expect, it } from 'vitest'
import { placeTooltip } from '../src/components/placeTooltip'

const viewport = { width: 800, height: 600 }
const tip = { width: 100, height: 24 }

describe('placeTooltip', () => {
  it('centres above the trigger when there is room', () => {
    const p = placeTooltip({ top: 100, left: 300, width: 32, height: 32 }, tip, viewport)
    expect(p).toEqual({ side: 'top', top: 100 - 6 - 24, left: 300 + 16 - 50 })
  })

  it('flips below when the top edge would clip', () => {
    const p = placeTooltip({ top: 10, left: 300, width: 32, height: 32 }, tip, viewport)
    expect(p.side).toBe('bottom')
    expect(p.top).toBe(10 + 32 + 6)
  })

  it('honours a bottom preference and flips up near the bottom edge', () => {
    const t = { top: 580, left: 300, width: 32, height: 16 }
    expect(placeTooltip({ ...t, top: 100 }, tip, viewport, 'bottom').side).toBe('bottom')
    expect(placeTooltip(t, tip, viewport, 'bottom').side).toBe('top')
  })

  it('clamps inside the viewport horizontally', () => {
    expect(placeTooltip({ top: 100, left: 0, width: 20, height: 20 }, tip, viewport).left).toBe(4)
    expect(placeTooltip({ top: 100, left: 790, width: 10, height: 20 }, tip, viewport).left).toBe(
      800 - 4 - 100
    )
  })
})
