import { describe, expect, it } from 'vitest'
import { TOPIC_DECAY_AFTER_MS, applyLensEvent, decayTopics } from '../src/lens/learning'
import { createDefaultProfile } from '../src/lens/profile'
import type { LensEvent, LensEventKind, ReaderProfile } from '../src/types/lens'

const DAY = 24 * 60 * 60 * 1000

const event = (kind: LensEventKind, overrides: Partial<LensEvent> = {}): LensEvent => ({
  id: `e-${kind}`,
  ts: 1000,
  site: 'example.com',
  urlHash: 'h',
  kind,
  transform: 'define',
  mode: 'replace',
  term: 'Heteroscedasticity',
  topic: 'Statistics',
  lang: 'en',
  spanWords: 1,
  p: 0.8,
  difficulty: null,
  latencyMs: 300,
  ...overrides
})

const base = (overrides: Partial<ReaderProfile> = {}): ReaderProfile => ({
  ...createDefaultProfile({ coldStart: false }),
  ...overrides
})

const apply = (p: ReaderProfile, e: LensEvent, msSinceShown: number | null = 2000): ReaderProfile =>
  applyLensEvent(p, e, { msSinceShown, now: 5000 })

describe('applyLensEvent (§8.3)', () => {
  it('"I knew this": term known, topic +0.05, θ +0.03, version bumped', () => {
    const before = base()
    const after = apply(before, event('knew_it'), 60_000)
    expect(after.terms['heteroscedasticity']).toEqual({ state: 'known', seen: 1, updatedAt: 5000 })
    expect(after.topics['statistics']?.familiarity).toBeCloseTo(0.55)
    expect(after.threshold).toBeCloseTo(0.78)
    expect(after.version).toBe(before.version + 1)
    expect(before.terms).toEqual({})
  })

  it('a fast revert raises θ; the second fast revert of a term marks it known', () => {
    const once = apply(base(), event('reverted'))
    expect(once.threshold).toBeCloseTo(0.78)
    expect(once.terms['heteroscedasticity']).toMatchObject({ state: 'learning', seen: 1 })
    expect(once.version).toBe(1)
    const twice = apply(once, event('reverted'))
    expect(twice.terms['heteroscedasticity']).toMatchObject({ state: 'known', seen: 2 })
    expect(twice.version).toBe(2)
  })

  it('a slow revert changes nothing', () => {
    const p = base()
    const after = apply(p, event('reverted'), 30_000)
    expect(after.threshold).toBe(p.threshold)
    expect(after.terms).toEqual({})
  })

  it('kept: term learning, topic −0.02, θ −0.01, no version bump', () => {
    const after = apply(base(), event('kept'))
    expect(after.terms['heteroscedasticity']?.state).toBe('learning')
    expect(after.topics['statistics']?.familiarity).toBeCloseTo(0.48)
    expect(after.threshold).toBeCloseTo(0.74)
    expect(after.version).toBe(1)
  })

  it('kept never demotes a known term', () => {
    const known = base({ terms: { heteroscedasticity: { state: 'known', seen: 3, updatedAt: 1 } } })
    expect(apply(known, event('kept')).terms['heteroscedasticity']?.state).toBe('known')
  })

  it('"Explain more": term unknown, topic −0.05 and deeper, θ unchanged', () => {
    const known = base({ terms: { heteroscedasticity: { state: 'known', seen: 3, updatedAt: 1 } } })
    const after = apply(known, event('explain_more'))
    expect(after.terms['heteroscedasticity']?.state).toBe('unknown')
    expect(after.topics['statistics']).toMatchObject({ depth: 1 })
    expect(after.topics['statistics']?.familiarity).toBeCloseTo(0.45)
    expect(after.threshold).toBe(known.threshold)
    expect(after.version).toBe(known.version + 1)
  })

  it('reselected returns a term to learning (unknown stays unknown) and lowers θ', () => {
    const known = base({ terms: { heteroscedasticity: { state: 'known', seen: 3, updatedAt: 1 } } })
    expect(apply(known, event('reselected')).terms['heteroscedasticity']?.state).toBe('learning')
    const unknown = base({
      terms: { heteroscedasticity: { state: 'unknown', seen: 1, updatedAt: 1 } }
    })
    expect(apply(unknown, event('reselected')).terms['heteroscedasticity']?.state).toBe('unknown')
    expect(apply(base(), event('reselected')).threshold).toBeCloseTo(0.74)
  })

  it("copying the original nudges that site's θ up", () => {
    const after = apply(base(), event('copied_original'))
    expect(after.perSite['example.com']?.threshold).toBeCloseTo(0.76)
    expect(after.threshold).toBe(0.75)
  })

  it('counts down the cold-start Ask-first triggers on shown', () => {
    const cold = createDefaultProfile({ coldStart: true })
    const after = apply(cold, event('shown'))
    expect(after.askFirstRemaining).toBe(cold.askFirstRemaining - 1)
    expect(apply(base(), event('shown')).askFirstRemaining).toBe(0)
  })

  it('keeps θ inside its bounds', () => {
    let p = base({ threshold: 0.94 })
    for (let i = 0; i < 5; i++) p = apply(p, event('knew_it'))
    expect(p.threshold).toBe(0.95)
    p = base({ threshold: 0.56 })
    for (let i = 0; i < 5; i++) p = apply(p, event('kept', { term: null }))
    expect(p.threshold).toBe(0.55)
  })

  it('ignores events without a term or topic for those parts', () => {
    const after = apply(base(), event('knew_it', { term: null, topic: null }))
    expect(after.terms).toEqual({})
    expect(after.topics).toEqual({})
    expect(after.threshold).toBeCloseTo(0.78)
  })
})

describe('decayTopics', () => {
  const now = 1_800_000_000_000

  it('leaves recently seen topics alone', () => {
    const p = base({ topics: { law: { familiarity: 0.9, depth: 0, updatedAt: now - 10 * DAY } } })
    expect(decayTopics(p, now)).toBe(p)
  })

  it('drifts stale topics toward 0.5 from both sides', () => {
    const stale = now - TOPIC_DECAY_AFTER_MS - 90 * DAY
    const p = base({
      topics: {
        law: { familiarity: 0.9, depth: 0, updatedAt: stale },
        chess: { familiarity: 0.1, depth: 0, updatedAt: stale }
      }
    })
    const after = decayTopics(p, now)
    expect(after.topics['law']?.familiarity).toBeLessThan(0.9)
    expect(after.topics['law']?.familiarity).toBeGreaterThan(0.5)
    expect(after.topics['chess']?.familiarity).toBeGreaterThan(0.1)
    expect(after.topics['chess']?.familiarity).toBeLessThan(0.5)
  })

  it('gives the same result whether run once or every day', () => {
    const start = now - TOPIC_DECAY_AFTER_MS - 120 * DAY
    const p = base({ topics: { law: { familiarity: 0.9, depth: 0, updatedAt: start } } })
    const once = decayTopics(p, now)
    let daily = p
    for (let t = start + TOPIC_DECAY_AFTER_MS; t <= now; t += DAY) daily = decayTopics(daily, t)
    expect(daily.topics['law']?.familiarity).toBeCloseTo(once.topics['law']?.familiarity ?? 0, 2)
  })
})
