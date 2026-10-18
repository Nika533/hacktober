import { describe, expect, it } from 'vitest'
import {
  initialMachine,
  reduce,
  type BuddyEffect,
  type BuddyEvent,
  type MachineState
} from '../src/main/buddy/machine'

const kinds = (effects: BuddyEffect[]): string[] => effects.map((e) => e.kind)
const has = (effects: BuddyEffect[], kind: BuddyEffect['kind']): boolean =>
  effects.some((e) => e.kind === kind)

const at = (mode: MachineState['mode'], nextId = 5): MachineState => ({
  mode,
  pending: null,
  nextId
})

describe('buddy machine', () => {
  it('summon: hidden → pill with show/transition/focus/greet/collapse-timer', () => {
    const r = reduce(initialMachine, { type: 'summon' })
    expect(kinds(r.effects)).toEqual(['show', 'transition', 'focus', 'greet', 'startCollapseTimer'])
    expect(r.effects[1]).toEqual({ kind: 'transition', id: 1, from: 'hidden', to: 'pill' })
    expect(r.state).toEqual({ mode: 'pill', pending: { id: 1, to: 'pill' }, nextId: 2 })
  })

  it('summon is a no-op when already visible', () => {
    for (const mode of ['dot', 'pill', 'card'] as const) {
      const r = reduce(at(mode), { type: 'summon' })
      expect(r.state.mode).toBe(mode)
      expect(r.effects).toEqual([])
    }
  })

  it('walks hidden → pill → card → pill → dot → hidden', () => {
    let s = initialMachine
    const go = (e: BuddyEvent): BuddyEffect[] => {
      const r = reduce(s, e)
      s = r.state
      return r.effects
    }
    go({ type: 'summon' })
    expect(s.mode).toBe('pill')

    const cardFx = go({ type: 'request', mode: 'card' })
    expect(s.mode).toBe('card')
    expect(has(cardFx, 'clearAnswerReady')).toBe(true)
    expect(has(cardFx, 'stopCollapseTimer')).toBe(true)
    expect(cardFx[0]).toEqual({ kind: 'transition', id: 2, from: 'pill', to: 'card' })

    // resolve the pending transition, then shrink back to pill
    go({ type: 'transitionDone', id: 2 })
    const pillFx = go({ type: 'request', mode: 'pill' })
    expect(s.mode).toBe('pill')
    expect(kinds(pillFx)).toEqual(['transition', 'startCollapseTimer'])
    expect(has(pillFx, 'focus')).toBe(false) // shrink: no focus steal
    expect(has(pillFx, 'greet')).toBe(false) // greet only from hidden

    go({ type: 'transitionDone', id: 3 })
    const dotFx = go({ type: 'collapse' })
    expect(s.mode).toBe('dot')
    expect(kinds(dotFx)).toEqual(['transition', 'stopCollapseTimer'])

    go({ type: 'transitionDone', id: 4 })
    const hideFx = go({ type: 'request', mode: 'hidden' })
    expect(s.mode).toBe('hidden')
    expect(kinds(hideFx)).toEqual(['transition'])
    const doneFx = go({ type: 'transitionDone', id: 5 })
    expect(kinds(doneFx)).toEqual(['hideWindow'])
    expect(s.pending).toBeNull()
  })

  it('toggle: hidden → pill', () => {
    const r = reduce(initialMachine, { type: 'toggle', focused: false })
    expect(r.state.mode).toBe('pill')
    expect(has(r.effects, 'greet')).toBe(true)
  })

  it('toggle: visible + focused → hidden', () => {
    for (const mode of ['dot', 'pill', 'card'] as const) {
      const r = reduce(at(mode), { type: 'toggle', focused: true })
      expect(r.state.mode).toBe('hidden')
      expect(kinds(r.effects)).toContain('transition')
    }
  })

  it('toggle: visible + unfocused → focus; dot additionally grows to pill', () => {
    const pill = reduce(at('pill'), { type: 'toggle', focused: false })
    expect(pill.state.mode).toBe('pill')
    expect(kinds(pill.effects)).toEqual(['focus'])

    const card = reduce(at('card'), { type: 'toggle', focused: false })
    expect(card.state.mode).toBe('card')
    expect(kinds(card.effects)).toEqual(['focus'])

    const dot = reduce(at('dot'), { type: 'toggle', focused: false })
    expect(dot.state.mode).toBe('pill')
    expect(kinds(dot.effects)).toEqual(['transition', 'focus', 'startCollapseTimer'])
    expect(has(dot.effects, 'greet')).toBe(false)
  })

  it('request of the current mode is a no-op', () => {
    for (const mode of ['hidden', 'dot', 'pill', 'card'] as const) {
      const s = at(mode)
      const r = reduce(s, { type: 'request', mode })
      expect(r.state).toBe(s) // same reference: a true no-op
      expect(r.effects).toEqual([])
    }
  })

  it('a new request supersedes a pending transition with a fresh id', () => {
    let s = reduce(at('pill', 7), { type: 'request', mode: 'card' }).state
    expect(s.pending).toEqual({ id: 7, to: 'card' })
    s = reduce(s, { type: 'request', mode: 'hidden' }).state
    expect(s.pending).toEqual({ id: 8, to: 'hidden' })
    // the stale ack resolves nothing
    const stale = reduce(s, { type: 'transitionDone', id: 7 })
    expect(stale.effects).toEqual([])
    expect(stale.state.pending).toEqual({ id: 8, to: 'hidden' })
    // only the latest id hides the window
    const done = reduce(s, { type: 'transitionDone', id: 8 })
    expect(kinds(done.effects)).toEqual(['hideWindow'])
  })

  it('transitionTimeout resolves only the matching transition and hides on hidden', () => {
    const s = reduce(at('card', 3), { type: 'request', mode: 'hidden' }).state
    const wrong = reduce(s, { type: 'transitionTimeout', id: 99 })
    expect(wrong.effects).toEqual([])
    expect(wrong.state.pending).not.toBeNull()
    const timeout = reduce(s, { type: 'transitionTimeout', id: 3 })
    expect(kinds(timeout.effects)).toEqual(['hideWindow'])
    expect(timeout.state.pending).toBeNull()
  })

  it('transitionDone on a non-hidden target just clears pending', () => {
    const s = reduce(at('pill', 4), { type: 'request', mode: 'card' }).state
    const r = reduce(s, { type: 'transitionDone', id: 4 })
    expect(r.state).toEqual({ mode: 'card', pending: null, nextId: 5 })
    expect(r.effects).toEqual([])
  })

  it('collapse only acts in pill', () => {
    for (const mode of ['hidden', 'dot', 'card'] as const) {
      const r = reduce(at(mode), { type: 'collapse' })
      expect(r.effects).toEqual([])
      expect(r.state.mode).toBe(mode)
    }
    const r = reduce(at('pill', 2), { type: 'collapse' })
    expect(r.state.mode).toBe('dot')
    expect(r.effects[0]).toEqual({ kind: 'transition', id: 2, from: 'pill', to: 'dot' })
  })

  it('greet only on hidden-origin grows', () => {
    const fromDot = reduce(at('dot'), { type: 'request', mode: 'card' })
    expect(has(fromDot.effects, 'greet')).toBe(false)
    const fromHidden = reduce(initialMachine, { type: 'request', mode: 'card' })
    expect(has(fromHidden.effects, 'greet')).toBe(true)
  })

  it('clearAnswerReady only on card arrival', () => {
    const toCard = reduce(at('pill'), { type: 'request', mode: 'card' })
    expect(has(toCard.effects, 'clearAnswerReady')).toBe(true)
    const toPill = reduce(at('card'), { type: 'request', mode: 'pill' })
    expect(has(toPill.effects, 'clearAnswerReady')).toBe(false)
  })

  it('hide behaves like a request to hidden', () => {
    const r = reduce(at('pill'), { type: 'hide' })
    expect(r.state.mode).toBe('hidden')
    expect(kinds(r.effects)).toEqual(['transition', 'stopCollapseTimer'])
  })

  it('grow from hidden shows first, then transitions', () => {
    const r = reduce(initialMachine, { type: 'request', mode: 'card' })
    const order = kinds(r.effects)
    expect(order.indexOf('show')).toBeLessThan(order.indexOf('transition'))
    expect(order.indexOf('greet')).toBeGreaterThan(order.indexOf('transition'))
  })
})
