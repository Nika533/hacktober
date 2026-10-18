import { AGENT_OWL_AT } from '@hoot/core'
import { describe, expect, it } from 'vitest'
import { CARD, OWL, cardAt, owlAt, placeCard } from '../../src/main/agents/geometry'

const AREA = { x: 0, y: 0, width: 1920, height: 1040 }

describe('agent windows: geometry', () => {
  it('shrinking into the owl and growing back keep the owl on the same screen spot', () => {
    const card = { x: 500, y: 300, width: CARD.width, height: CARD.height }
    const owl = { x: card.x + AGENT_OWL_AT.x, y: card.y + AGENT_OWL_AT.y }
    const small = owlAt(owl, AREA)
    expect(small).toEqual({ x: 500, y: 300, width: OWL.size, height: OWL.size })
    expect(cardAt({ x: small.x + OWL.owl.x, y: small.y + OWL.owl.y }, AREA)).toEqual(card)
  })

  it('a card growing out of an owl near an edge stays on screen', () => {
    expect(cardAt({ x: 1900, y: 1030 }, AREA)).toEqual({
      x: 1920 - CARD.width,
      y: 1040 - CARD.height,
      width: CARD.width,
      height: CARD.height
    })
    expect(owlAt({ x: 2, y: 2 }, AREA)).toMatchObject({ x: 0, y: 0 })
  })

  it('opens beside Hoot’s owl, toward the middle of the screen, each one a step on', () => {
    const bottomRight = { x: 1800, y: 950 }
    const first = placeCard(bottomRight, 0, AREA)
    const second = placeCard(bottomRight, 1, AREA)
    expect(first.x + first.width).toBeLessThan(bottomRight.x)
    expect(second.x).toBeLessThan(first.x)
    expect(second.y).toBeLessThan(first.y)

    const topLeft = placeCard({ x: 60, y: 60 }, 0, AREA)
    expect(topLeft.x).toBeGreaterThan(60)
    for (const r of [first, second, topLeft]) {
      expect(r.x).toBeGreaterThanOrEqual(0)
      expect(r.y).toBeGreaterThanOrEqual(0)
      expect(r.x + r.width).toBeLessThanOrEqual(AREA.width)
      expect(r.y + r.height).toBeLessThanOrEqual(AREA.height)
    }
  })
})
