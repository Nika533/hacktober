import { DEFAULT_LENS_SETTINGS } from '@hoot/core'
import { describe, expect, it } from 'vitest'
import {
  DEMO_CASES,
  latencyReportMarkdown,
  measureLatency,
  percentile,
  summarizeLatency,
  type LatencySample
} from '../../evals/latency'
import { createFakeProvider } from '../../src/main/ai'
import { createLensService, type LensService } from '../../src/main/lens/service'
import { createMemoryLensStorage } from '../../src/main/lens/storage'

/** A model that answers instantly with a gloss that keeps every invariant. */
const instantModel = createFakeProvider({
  json: (req) => {
    const prompt = JSON.stringify(req)
    const c = DEMO_CASES.find((x) => prompt.includes(x.span))
    return {
      action: 'gloss',
      transform: c?.transforms[0] ?? 'define',
      text: `In short: ${c?.span ?? ''}`,
      term: null,
      meaning_preserved: true,
      confidence: 0.9
    }
  }
})

const service = (): Promise<LensService> =>
  createLensService({
    storage: createMemoryLensStorage(),
    getLensSettings: () => ({ ...DEFAULT_LENS_SETTINGS, enabled: true, coldStartDone: true }),
    getProvider: async () => instantModel
  })

describe('Lens latency harness', () => {
  it('nearest-rank percentiles', () => {
    expect(percentile([], 50)).toBe(0)
    expect(percentile([5], 95)).toBe(5)
    const xs = Array.from({ length: 20 }, (_, i) => i + 1)
    expect(percentile(xs, 50)).toBe(10)
    expect(percentile(xs, 95)).toBe(19)
  })

  it('the demo spans are 40 words or fewer (the §7.2 target applies to them)', () => {
    for (const c of DEMO_CASES) expect(c.span.split(/\s+/).length).toBeLessThanOrEqual(40)
  })

  it("the app's own overhead is small next to the 700 ms budget", async () => {
    const samples = await measureLatency(service, DEMO_CASES, { runs: 2 })
    const summary = summarizeLatency(samples)
    expect(summary.cold.n).toBe(DEMO_CASES.length * 2)
    expect(summary.notRewritten).toEqual({})
    // Generous bounds for slow CI runners; locally both are a few ms.
    expect(summary.cold.p95).toBeLessThan(250)
    expect(summary.cached.p95).toBeLessThan(50)
  })

  it('reports by model and case, and says whether the targets are met', () => {
    const samples: LatencySample[] = [
      { id: 'a', model: 'fast', ms: 400, cached: false, outcome: 'rewritten' },
      { id: 'b', model: 'strong', ms: 1600, cached: false, outcome: 'rewritten' },
      { id: 'b', model: 'strong', ms: 3, cached: true, outcome: 'rewritten' },
      { id: 'c', model: 'fast', ms: 500, cached: false, outcome: 'skipped' }
    ]
    const summary = summarizeLatency(samples)
    expect(summary.cold).toEqual({ n: 3, p50: 500, p95: 1600 })
    expect(summary.meetsTargets).toBe(false)
    expect(summary.notRewritten).toEqual({ skipped: 1 })
    const md = latencyReportMarkdown(summary, 'test')
    expect(md).toContain('**Misses the targets.**')
    expect(md).toContain('| `strong` | 1 | 1600 ms | 1600 ms |')
    expect(md).toContain('skipped ×1')
  })
})
