import { describe, expect, it } from 'vitest'
import { placeNear } from '../src/ui/position'

const viewport = { width: 800, height: 600, scrollX: 0, scrollY: 1000 }
const size = { width: 200, height: 100 }

describe('placeNear', () => {
  it('places below the anchor in document coordinates', () => {
    const place = placeNear({ left: 100, top: 100, width: 80, height: 20 }, size, viewport)
    expect(place).toMatchObject({ side: 'below', left: 100, top: 1126, originY: 0 })
    expect(place.originX).toBe(40)
  })

  it('flips above when there is no room below', () => {
    const place = placeNear({ left: 100, top: 540, width: 80, height: 20 }, size, viewport)
    expect(place.side).toBe('above')
    expect(place.top).toBe(1000 + 540 - 6 - 100)
    expect(place.originY).toBe(100)
  })

  it('clamps inside the viewport horizontally', () => {
    const place = placeNear({ left: 760, top: 100, width: 30, height: 20 }, size, viewport)
    expect(place.left).toBe(800 - 8 - 200)
    expect(place.originX).toBe(775 - 592)
  })
})
