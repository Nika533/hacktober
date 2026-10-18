import type { BuddyMode, RequestedMode } from '@hoot/core'

export type BuddyEvent =
  | { type: 'summon' } // hidden → pill (+greeting), else no-op
  | { type: 'toggle'; focused: boolean }
  | { type: 'request'; mode: RequestedMode }
  | { type: 'hide' } // studio opened, capture suspend
  | { type: 'collapse' } // collapse timer fired (pill → dot only)
  | { type: 'transitionDone'; id: number }
  | { type: 'transitionTimeout'; id: number } // 450 ms fallback

export type BuddyEffect =
  | { kind: 'show' }
  | { kind: 'hideWindow' }
  | { kind: 'focus' }
  | { kind: 'transition'; id: number; from: BuddyMode; to: BuddyMode }
  | { kind: 'greet' }
  | { kind: 'clearAnswerReady' }
  | { kind: 'startCollapseTimer' }
  | { kind: 'stopCollapseTimer' }

export interface MachineState {
  /** The mode the renderer is animating towards — updated immediately. */
  mode: BuddyMode
  /** The in-flight transition; a new event supersedes it with a new id. */
  pending: { id: number; to: BuddyMode } | null
  nextId: number
}

export const initialMachine: MachineState = { mode: 'hidden', pending: null, nextId: 1 }

const RANK: Record<BuddyMode, number> = { hidden: 0, dot: 1, pill: 2, card: 3 }

const noop = (s: MachineState): { state: MachineState; effects: BuddyEffect[] } => ({
  state: s,
  effects: []
})

/**
 * Every mode change emits one `transition` with a fresh id; the renderer
 * animates from its live presentation value and acks with
 * `transitionDone(id)`. Only a `hidden` destination needs a follow-up
 * (`hideWindow`) once the renderer has finished — the window itself is a
 * fixed card-sized canvas, so pill/dot shrinks need no main-side resize.
 */
function transitionTo(
  s: MachineState,
  to: BuddyMode
): { state: MachineState; effects: BuddyEffect[] } {
  if (to === s.mode) return noop(s)
  const from = s.mode
  const grow = RANK[to] > RANK[from]
  const effects: BuddyEffect[] = []
  if (grow && from === 'hidden') effects.push({ kind: 'show' })
  effects.push({ kind: 'transition', id: s.nextId, from, to })
  if (grow) {
    if (to !== 'dot') effects.push({ kind: 'focus' })
    if (to === 'card') effects.push({ kind: 'clearAnswerReady' })
    if (from === 'hidden') effects.push({ kind: 'greet' })
  }
  if (to === 'pill') effects.push({ kind: 'startCollapseTimer' })
  else if (from === 'pill') effects.push({ kind: 'stopCollapseTimer' })
  return {
    state: { mode: to, pending: { id: s.nextId, to }, nextId: s.nextId + 1 },
    effects
  }
}

export function reduce(
  s: MachineState,
  e: BuddyEvent
): { state: MachineState; effects: BuddyEffect[] } {
  switch (e.type) {
    case 'summon':
      return s.mode === 'hidden' ? transitionTo(s, 'pill') : noop(s)

    case 'toggle':
      if (s.mode === 'hidden') return transitionTo(s, 'pill')
      if (e.focused) return transitionTo(s, 'hidden')
      if (s.mode === 'dot') return transitionTo(s, 'pill')
      return { state: s, effects: [{ kind: 'focus' }] }

    case 'request':
      return transitionTo(s, e.mode)

    case 'hide':
      return transitionTo(s, 'hidden')

    case 'collapse':
      return s.mode === 'pill' ? transitionTo(s, 'dot') : noop(s)

    case 'transitionDone':
    case 'transitionTimeout': {
      if (s.pending === null || s.pending.id !== e.id) return noop(s)
      const effects: BuddyEffect[] = s.pending.to === 'hidden' ? [{ kind: 'hideWindow' }] : []
      return { state: { ...s, pending: null }, effects }
    }
  }
}
