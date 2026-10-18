import { describe, expect, it } from 'vitest'
import { compare, loadCases, runEval, summarize, type CaseResult } from '../../evals/harness'

describe('eval harness', () => {
  it('loads every case and covers each category', () => {
    const cases = loadCases()
    expect(cases.length).toBeGreaterThanOrEqual(40)
    expect(new Set(cases.map((c) => c.id)).size).toBe(cases.length)
    const categories = new Set(cases.map((c) => c.category))
    for (const c of [
      'jargon',
      'acronym',
      'dense_sentence',
      'invariants',
      'high_stakes',
      'foreign_language',
      'notation'
    ]) {
      expect(categories.has(c)).toBe(true)
    }
  })

  it('runs end to end on the fakes and passes the gates', async () => {
    const run = await runEval({ cases: loadCases(), provider: null, fake: true })
    expect(run.results).toHaveLength(loadCases().length)
    expect(run.metrics.highStakesGlossRate).toBe(1)
    expect(compare(run.metrics, null)).toEqual([])
  })

  it('flags gate failures and regressions', () => {
    const r = (over: Partial<CaseResult>): CaseResult => ({
      id: 'x',
      category: 'c',
      expect: 'gloss',
      outcome: {
        kind: 'rewritten',
        result: {
          action: 'replace',
          transform: 'simplify',
          text: 't',
          term: null,
          confidence: 0.9,
          cacheKey: 'k',
          latencyMs: 1,
          cached: false
        }
      },
      latencyMs: 1,
      checks: { invariants: true, mustKeep: true, expectation: false, lengthRatio: 1 },
      grade: { meaning_preserved: true, adds_facts: false, easier: 4, fluent: true },
      ...over
    })
    const metrics = summarize([r({})])
    expect(compare(metrics, null)).toContain('highStakesGlossRate 0.000 < 1')
    const good = summarize([
      r({ checks: { invariants: true, mustKeep: true, expectation: true, lengthRatio: 1 } })
    ])
    const worse = { ...good, meanEasier: good.meanEasier - 1 }
    expect(compare(worse, good).some((f) => f.startsWith('meanEasier regressed'))).toBe(true)
  })
})
