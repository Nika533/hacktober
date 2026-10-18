import { describe, expect, it } from 'vitest'
import { commitFor, rectBetween } from '../../src/renderer/capture/shape'

describe('overlay shapes', () => {
  it('normalises a rectangle dragged in any direction', () => {
    expect(rectBetween({ x: 300, y: 200 }, { x: 100, y: 250 })).toEqual({
      x: 100,
      y: 200,
      width: 200,
      height: 50
    })
  })

  it('commits a rectangle or lasso that is big enough', () => {
    const rect = { x: 10, y: 10, width: 40, height: 30 }
    expect(commitFor({ kind: 'rect', rect })).toEqual({ kind: 'rect', rect })
    const points = [
      { x: 0, y: 0 },
      { x: 40, y: 0 },
      { x: 20, y: 30 }
    ]
    expect(commitFor({ kind: 'lasso', points })).toEqual({ kind: 'lasso', points })
  })

  it('treats a click, a thin line or a two-point lasso as nothing', () => {
    expect(commitFor({ kind: 'rect', rect: { x: 5, y: 5, width: 0, height: 0 } })).toBeNull()
    expect(commitFor({ kind: 'rect', rect: { x: 5, y: 5, width: 200, height: 4 } })).toBeNull()
    expect(
      commitFor({
        kind: 'lasso',
        points: [
          { x: 0, y: 0 },
          { x: 100, y: 100 }
        ]
      })
    ).toBeNull()
    expect(
      commitFor({
        kind: 'lasso',
        points: [
          { x: 0, y: 0 },
          { x: 100, y: 2 },
          { x: 50, y: 4 }
        ]
      })
    ).toBeNull()
  })
})
