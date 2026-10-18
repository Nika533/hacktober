import type { DomainRisk, LensContext, RewriteOutcome, Transform } from '@hoot/core'
import type { LensService } from '../src/main/lens'
import { pickRewriteModel } from '../src/main/lens/engine'

/**
 * Lens latency (F-C4, spec §7.2): first visible change p50 under 700 ms and
 * p95 under 1.5 s for spans of 40 words or fewer. This measures the app's
 * part: `LensService.rewrite` from request to validated result. The
 * extension adds the bridge hop and the render on top.
 */
export const LATENCY_TARGETS = { p50: 700, p95: 1500 } as const

export interface LatencyCase {
  id: string
  span: string
  paragraph: string
  transforms: Transform[]
  risk: DomainRisk
  lang?: string
}

/** The spans from the demo script (README), all 40 words or fewer. */
export const DEMO_CASES: LatencyCase[] = [
  {
    id: 'term-jargon',
    span: 'heteroscedasticity',
    paragraph:
      'The residual plot shows heteroscedasticity, so the standard errors of the estimates are unreliable.',
    transforms: ['define', 'expand', 'simplify'],
    risk: 'normal'
  },
  {
    id: 'term-acronym',
    span: 'OLS',
    paragraph: 'We fit the model with OLS and then checked the residuals for patterns.',
    transforms: ['define', 'expand'],
    risk: 'normal'
  },
  {
    id: 'sentence-legal',
    span: 'The licensee shall indemnify and hold harmless the licensor from any and all claims arising out of the use of the software, notwithstanding any provision herein to the contrary.',
    paragraph:
      'The licensee shall indemnify and hold harmless the licensor from any and all claims arising out of the use of the software, notwithstanding any provision herein to the contrary.',
    transforms: ['simplify', 'unpack'],
    risk: 'high'
  },
  {
    id: 'sentence-dense',
    span: 'Because the variance of the residuals grows with the fitted values, the usual standard errors understate the uncertainty of every coefficient in the model.',
    paragraph:
      'Because the variance of the residuals grows with the fitted values, the usual standard errors understate the uncertainty of every coefficient in the model. Robust errors fix this.',
    transforms: ['simplify', 'unpack'],
    risk: 'normal'
  },
  {
    id: 'sentence-foreign',
    span: 'La varianza de los residuos no es constante en todo el rango de valores ajustados.',
    paragraph:
      'La varianza de los residuos no es constante en todo el rango de valores ajustados. Esto afecta a los errores estándar.',
    transforms: ['translate'],
    risk: 'normal',
    lang: 'es'
  }
]

export interface LatencySample {
  id: string
  model: string
  ms: number
  cached: boolean
  /** `error:<code>` when the request failed (e.g. `error:busy` for a timeout). */
  outcome: RewriteOutcome['kind'] | `error:${string}`
}

export function contextFor(c: LatencyCase): LensContext {
  const words = c.span.trim().split(/\s+/).length
  return {
    span: c.span,
    paragraph: c.paragraph,
    headingPath: ['Checking the model'],
    title: 'A gentle guide to linear regression',
    lang: c.lang ?? 'en',
    site: 'example.com',
    siteCategory: c.risk === 'high' ? 'legal' : 'general',
    surface: 'html',
    signals: {
      sizeClass: words === 1 ? 'term' : 'sentence',
      copiedWithinMs: null,
      dwellMs: 1800,
      reselectCount: 0,
      reread: 0,
      rarity: 0.9,
      knownTerm: false,
      topicFamiliarity: null,
      foreignLanguage: c.lang !== undefined && c.lang !== 'en',
      blocked: null
    },
    p: 0.85
  }
}

/**
 * Each run uses a fresh service (an empty cache), sends every case once
 * (cold), then once more (cached).
 */
export async function measureLatency(
  makeService: () => Promise<LensService>,
  cases: readonly LatencyCase[] = DEMO_CASES,
  opts: { runs?: number; now?: () => number } = {}
): Promise<LatencySample[]> {
  const now = opts.now ?? (() => performance.now())
  const samples: LatencySample[] = []
  for (let run = 0; run < (opts.runs ?? 3); run++) {
    const service = await makeService()
    for (const c of cases) {
      const request = { ctx: contextFor(c), allowedTransforms: c.transforms, risk: c.risk }
      for (const cached of [false, true]) {
        const started = now()
        let outcome: LatencySample['outcome']
        try {
          const reqId = `latency-${run}-${c.id}-${cached ? 'warm' : 'cold'}`
          outcome = (await service.rewrite(reqId, request)).kind
        } catch (e) {
          // A failed request still counts: it's what the reader waited for.
          outcome = `error:${(e as { code?: string }).code ?? 'unknown'}`
        }
        samples.push({
          id: c.id,
          model: pickRewriteModel(c.transforms, c.span),
          ms: now() - started,
          cached,
          outcome
        })
      }
    }
  }
  return samples
}

/** Nearest-rank percentile; 0 for no samples. */
export function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  return (
    sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))] ?? 0
  )
}

export interface LatencyStats {
  n: number
  p50: number
  p95: number
}

const stats = (xs: readonly number[]): LatencyStats => ({
  n: xs.length,
  p50: percentile(xs, 50),
  p95: percentile(xs, 95)
})

export interface LatencySummary {
  cold: LatencyStats
  cached: LatencyStats
  byModel: Record<string, LatencyStats>
  byCase: Record<string, LatencyStats>
  /** Cold requests that didn't produce a rewrite (skips or errors), by outcome. */
  notRewritten: Record<string, number>
  meetsTargets: boolean
}

export function summarizeLatency(samples: readonly LatencySample[]): LatencySummary {
  const cold = samples.filter((s) => !s.cached)
  const group = (key: (s: LatencySample) => string): Record<string, LatencyStats> => {
    const out: Record<string, number[]> = {}
    for (const s of cold) (out[key(s)] ??= []).push(s.ms)
    return Object.fromEntries(Object.entries(out).map(([k, xs]) => [k, stats(xs)]))
  }
  const notRewritten: Record<string, number> = {}
  for (const s of cold)
    if (s.outcome !== 'rewritten') notRewritten[s.outcome] = (notRewritten[s.outcome] ?? 0) + 1
  const coldStats = stats(cold.map((s) => s.ms))
  return {
    cold: coldStats,
    cached: stats(samples.filter((s) => s.cached).map((s) => s.ms)),
    byModel: group((s) => s.model),
    byCase: group((s) => s.id),
    notRewritten,
    meetsTargets: coldStats.p50 < LATENCY_TARGETS.p50 && coldStats.p95 < LATENCY_TARGETS.p95
  }
}

const ms = (x: number): string => `${Math.round(x)} ms`
const row = (name: string, s: LatencyStats): string =>
  `| ${name} | ${s.n} | ${ms(s.p50)} | ${ms(s.p95)} |`

export function latencyReportMarkdown(summary: LatencySummary, label: string): string {
  const lines = [
    `# Lens latency: ${label}`,
    '',
    `Target (spec §7.2): p50 < ${LATENCY_TARGETS.p50} ms, p95 < ${LATENCY_TARGETS.p95} ms, cold.`,
    `**${summary.meetsTargets ? 'Meets' : 'Misses'} the targets.** App side only: the bridge hop and the render come on top.`,
    '',
    '| | n | p50 | p95 |',
    '|---|---|---|---|',
    row('cold', summary.cold),
    row('cached', summary.cached),
    '',
    '| model (cold) | n | p50 | p95 |',
    '|---|---|---|---|',
    ...Object.entries(summary.byModel).map(([k, s]) => row(`\`${k}\``, s)),
    '',
    '| case (cold) | n | p50 | p95 |',
    '|---|---|---|---|',
    ...Object.entries(summary.byCase).map(([k, s]) => row(k, s))
  ]
  const skipped = Object.entries(summary.notRewritten)
  if (skipped.length > 0) {
    lines.push('', `Not rewritten (cold): ${skipped.map(([k, n]) => `${k} ×${n}`).join(', ')}`)
  }
  return lines.join('\n') + '\n'
}
