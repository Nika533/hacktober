import { describe, expect, it } from 'vitest'
import {
  GRAY_ZONE,
  PageRateLimiter,
  adaptThreshold,
  confusionScore,
  decide,
  effectiveThreshold,
  type DecisionInput
} from '../src/lens/score'
import type { LensSignals } from '../src/types/lens'
import { DEFAULT_LENS_SETTINGS } from '../src/types/settings'
import { sampleSignals } from './fixtures'

const p = (overrides: Partial<LensSignals>): number =>
  confusionScore(sampleSignals({ rarity: 0.8, dwellMs: 2000, ...overrides }))

describe('confusionScore: calibrated against the §6.1 table', () => {
  it.each<[string, Partial<LensSignals>, number, number]>([
    ['rare term, 2 s dwell → act', {}, 0.75, 1],
    ['rare term, 1.3 s dwell → gray zone', { dwellMs: 1300 }, 0.6, 0.75],
    ['common word, 2 s dwell → nothing', { rarity: 0.2 }, 0, 0.6],
    ['known term → nothing', { knownTerm: true }, 0, 0.3],
    ['copied within 2.5 s → nothing', { copiedWithinMs: 900 }, 0, 0.1],
    ['reselected rare term, 1.3 s → act', { dwellMs: 1300, reselectCount: 1 }, 0.75, 1],
    [
      'foreign sentence, 1.5 s → act',
      { sizeClass: 'sentence', rarity: 0.3, dwellMs: 1500, foreignLanguage: true },
      0.75,
      1
    ],
    ['multi-paragraph drag → nothing', { sizeClass: 'multi-paragraph', dwellMs: 4000 }, 0, 0.05],
    [
      'quick sentence, middling words → nothing',
      { sizeClass: 'sentence', rarity: 0.4, dwellMs: 1300 },
      0,
      0.6
    ],
    ['familiar topic lowers the score', { topicFamiliarity: 0.95, dwellMs: 1300 }, 0, 0.6]
  ])('%s', (_label, overrides, lo, hi) => {
    const score = p(overrides)
    expect(score).toBeGreaterThanOrEqual(lo)
    expect(score).toBeLessThan(hi)
  })

  it('ignores a copy made after the 2.5 s window', () => {
    expect(p({ copiedWithinMs: 4000 })).toBeCloseTo(p({}))
  })

  it('scores blocked selections as 0', () => {
    expect(p({ blocked: 'editable' })).toBe(0)
  })

  it('is monotonic in dwell, rarity and rereading', () => {
    expect(p({ dwellMs: 2500 })).toBeGreaterThan(p({ dwellMs: 1500 }))
    expect(p({ rarity: 0.9 })).toBeGreaterThan(p({ rarity: 0.5 }))
    expect(p({ reread: 0.8 })).toBeGreaterThan(p({ reread: 0 }))
  })
})

describe('thresholds', () => {
  const profile = { threshold: 0.75, perSite: { 'law.com': { threshold: 0.9 } } }

  it('prefers a per-site θ and shifts by Sensitivity, within bounds', () => {
    expect(effectiveThreshold(profile, { sensitivity: 0 }, 'x.com')).toBe(0.75)
    expect(effectiveThreshold(profile, { sensitivity: 0 }, 'law.com')).toBe(0.9)
    expect(effectiveThreshold(profile, { sensitivity: 1 }, 'x.com')).toBeCloseTo(0.65)
    expect(effectiveThreshold(profile, { sensitivity: -1 }, 'law.com')).toBe(0.95)
    expect(effectiveThreshold({ ...profile, threshold: 0.55 }, { sensitivity: 1 }, 'x')).toBe(0.55)
  })

  it('adapts θ from feedback (§6.2)', () => {
    expect(adaptThreshold(0.75, { kind: 'reverted', msSinceShown: 3000 })).toBeCloseTo(0.78)
    expect(adaptThreshold(0.75, { kind: 'knew_it', msSinceShown: 1000 })).toBeCloseTo(0.78)
    expect(adaptThreshold(0.75, { kind: 'reverted', msSinceShown: 9000 })).toBe(0.75)
    expect(adaptThreshold(0.75, { kind: 'kept', msSinceShown: null })).toBeCloseTo(0.74)
    expect(adaptThreshold(0.75, { kind: 'knew_it', msSinceShown: 60_000 })).toBeCloseTo(0.78)
    expect(adaptThreshold(0.75, { kind: 'reselected', msSinceShown: null })).toBeCloseTo(0.74)
    expect(adaptThreshold(0.75, { kind: 'explain_more', msSinceShown: 1000 })).toBe(0.75)
    expect(adaptThreshold(0.94, { kind: 'reverted', msSinceShown: 0 })).toBe(0.95)
    expect(adaptThreshold(0.55, { kind: 'kept', msSinceShown: null })).toBe(0.55)
  })
})

describe('PageRateLimiter', () => {
  it('allows 3 changes a minute and 12 a page', () => {
    const page = new PageRateLimiter()
    for (let i = 0; i < 3; i++) page.recordChange(i)
    expect(page.canChange(10_000)).toBe(false)
    expect(page.canChange(61_000)).toBe(true)
    for (let t = 61_000; page.total < 12; t += 25_000) page.recordChange(t)
    expect(page.canChange(10_000_000)).toBe(false)
  })

  it('switches to Ask-first after two reverts in a row; keeping resets it', () => {
    const page = new PageRateLimiter()
    page.recordRevert()
    page.recordKept()
    page.recordRevert()
    expect(page.askFirst).toBe(false)
    page.recordRevert()
    expect(page.askFirst).toBe(true)
  })
})

describe('decide', () => {
  const input = (overrides: Partial<DecisionInput> = {}): DecisionInput => ({
    signals: sampleSignals({ rarity: 0.8, dwellMs: 2000 }),
    site: 'example.com',
    lens: { ...DEFAULT_LENS_SETTINGS, enabled: true },
    profile: { threshold: 0.75, perSite: {}, askFirstRemaining: 0 },
    page: new PageRateLimiter(),
    now: 0,
    ...overrides
  })
  const action = (i: DecisionInput): string => {
    const d = decide(i)
    return d.action === 'ask' || d.action === 'none' ? `${d.action}:${d.why}` : d.action
  }

  it('rewrites above θ, assesses in the gray zone, ignores below', () => {
    expect(action(input())).toBe('rewrite')
    expect(action(input({ signals: sampleSignals({ rarity: 0.8, dwellMs: 1300 }) }))).toBe('assess')
    expect(action(input({ signals: sampleSignals({ rarity: 0.2 }) }))).toBe('none:below_threshold')
  })

  it('never sends anything below the gray zone, whatever the mode', () => {
    const low = sampleSignals({ rarity: 0.1, dwellMs: 900 })
    for (const mode of ['auto', 'ask', 'gloss'] as const) {
      const d = decide(
        input({ signals: low, lens: { ...DEFAULT_LENS_SETTINGS, enabled: true, mode } })
      )
      expect(d.action).toBe('none')
      expect(d.p).toBeLessThan(d.threshold - GRAY_ZONE)
    }
  })

  it('asks instead of acting in Ask-first, cold start, per-site ask and after reverts', () => {
    const ask = { ...DEFAULT_LENS_SETTINGS, enabled: true, mode: 'ask' as const }
    expect(action(input({ lens: ask }))).toBe('ask:mode')
    expect(action(input({ profile: { threshold: 0.75, perSite: {}, askFirstRemaining: 4 } }))).toBe(
      'ask:cold_start'
    )
    expect(
      action(
        input({
          profile: {
            threshold: 0.75,
            perSite: { 'example.com': { mode: 'ask' } },
            askFirstRemaining: 0
          }
        })
      )
    ).toBe('ask:site_mode')
    const page = new PageRateLimiter()
    page.recordRevert()
    page.recordRevert()
    expect(action(input({ page }))).toBe('ask:page_reverts')
  })

  it('lets "always on" sites skip the cold-start ask', () => {
    const lens = {
      ...DEFAULT_LENS_SETTINGS,
      enabled: true,
      sites: { 'example.com': 'always' as const }
    }
    expect(
      action(input({ lens, profile: { threshold: 0.75, perSite: {}, askFirstRemaining: 4 } }))
    ).toBe('rewrite')
  })

  it('stays quiet when off, blocked, paused, denied or rate-limited', () => {
    expect(action(input({ lens: DEFAULT_LENS_SETTINGS }))).toBe('none:off')
    expect(action(input({ signals: sampleSignals({ blocked: 'typing' }) }))).toBe('none:blocked')
    const paused = {
      ...DEFAULT_LENS_SETTINGS,
      enabled: true,
      sites: { 'example.com': 'paused' as const }
    }
    expect(action(input({ lens: paused }))).toBe('none:site_off')
    expect(
      action(
        input({
          profile: {
            threshold: 0.75,
            perSite: { 'example.com': { mode: 'off' } },
            askFirstRemaining: 0
          }
        })
      )
    ).toBe('none:site_off')
    const page = new PageRateLimiter()
    for (let i = 0; i < 3; i++) page.recordChange(0)
    expect(action(input({ page }))).toBe('none:rate_limited')
  })
})
