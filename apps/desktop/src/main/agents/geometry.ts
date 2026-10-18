import { AGENT_OWL_AT, type Point, type Rect } from '@hoot/core'

/** The agent's chat card, and where its owl sits in it (window-local DIP, the header). */
export const CARD = { width: 380, height: 540, owl: AGENT_OWL_AT } as const
/**
 * Minimized: just the owl, at the same spot as in the card's header (so
 * shrinking and growing never move it), with room for the badge.
 */
export const OWL = { size: 72, owl: CARD.owl } as const
/** Each new agent's card steps this far from the last one's. */
const CASCADE = 34
/** Cards open this far from Hoot's owl. */
const GAP = 64

/** `r` moved (not resized) to fit inside `area`. */
export function fitInto(r: Rect, area: Rect): Rect {
  return {
    ...r,
    x: Math.round(Math.min(Math.max(r.x, area.x), area.x + area.width - r.width)),
    y: Math.round(Math.min(Math.max(r.y, area.y), area.y + area.height - r.height))
  }
}

/** The card whose header owl is at `owl` (screen DIP), kept on screen. */
export const cardAt = (owl: Point, area: Rect): Rect =>
  fitInto(
    { x: owl.x - CARD.owl.x, y: owl.y - CARD.owl.y, width: CARD.width, height: CARD.height },
    area
  )

/** The minimized owl's window for an owl at `owl` (screen DIP), kept on screen. */
export const owlAt = (owl: Point, area: Rect): Rect =>
  fitInto({ x: owl.x - OWL.owl.x, y: owl.y - OWL.owl.y, width: OWL.size, height: OWL.size }, area)

/**
 * Where the `index`th agent's card opens: beside Hoot's owl, on the side
 * facing the middle of the screen, each one a step further along.
 */
export function placeCard(anchor: Point, index: number, area: Rect): Rect {
  const right = anchor.x < area.x + area.width / 2
  const down = anchor.y < area.y + area.height / 2
  const step = CASCADE * index
  const x = right ? anchor.x + GAP + step : anchor.x - GAP - CARD.width - step
  const y = down ? anchor.y - CARD.owl.y + step : anchor.y - CARD.height + CARD.owl.y - step
  return fitInto({ x, y, width: CARD.width, height: CARD.height }, area)
}
