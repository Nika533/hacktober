import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { DEFAULT_LENS_SETTINGS } from '@hoot/core'
import { describe, expect, it } from 'vitest'
import {
  DEMO_CASES,
  LATENCY_TARGETS,
  latencyReportMarkdown,
  measureLatency,
  summarizeLatency
} from '../evals/latency'
import { createAiProvider } from '../src/main/ai'
import { createLensService } from '../src/main/lens/service'
import { createMemoryLensStorage } from '../src/main/lens/storage'

/**
 * F-C4: the demo spans against real Claude, 3 cold + 3 cached runs each.
 * Writes evals/reports/latency-<time>.md (git-ignored) and fails when the
 * spec §7.2 targets are missed, which means fixing the model routing.
 */
const key = process.env['ANTHROPIC_API_KEY'] ?? ''

describe.skipIf(!key)('Lens latency (live Claude)', () => {
  it(`first visible change: p50 < ${LATENCY_TARGETS.p50} ms, p95 < ${LATENCY_TARGETS.p95} ms`, async () => {
    const samples = await measureLatency(
      () =>
        createLensService({
          storage: createMemoryLensStorage(),
          getLensSettings: () => ({ ...DEFAULT_LENS_SETTINGS, enabled: true, coldStartDone: true }),
          getProvider: async () => createAiProvider(key)
        }),
      DEMO_CASES,
      { runs: 3 }
    )
    const summary = summarizeLatency(samples)
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const dir = join(import.meta.dirname, '../evals/reports')
    mkdirSync(dir, { recursive: true })
    const md = latencyReportMarkdown(summary, stamp)
    writeFileSync(join(dir, `latency-${stamp}.md`), md)
    console.log(md)
    expect(summary.meetsTargets).toBe(true)
  }, 180_000)
})
