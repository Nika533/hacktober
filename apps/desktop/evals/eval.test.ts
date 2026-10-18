import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createGeminiProvider } from '../src/main/ai'
import { compare, loadCases, reportMarkdown, runEval, type EvalMetrics } from './harness'

/**
 * `npm run eval` (repo root): real Gemini with GEMINI_API_KEY, or a dry run of
 * the harness with EVAL_FAKE=1. Writes evals/reports/<time>.{json,md}.
 * `EVAL_UPDATE_BASELINE=1` saves this run's metrics as evals/baseline.json.
 */
const key = process.env['GEMINI_API_KEY'] ?? ''
const fake = process.env['EVAL_FAKE'] === '1'
const dir = import.meta.dirname

describe.skipIf(!key && !fake)('Lens rewrite quality', () => {
  it('meets every gate and does not regress the baseline', async () => {
    const cases = loadCases()
    const run = await runEval({ cases, provider: key ? createGeminiProvider(key) : null, fake })
    const baselineFile = join(dir, fake ? 'baseline.fake.json' : 'baseline.json')
    const baseline = existsSync(baselineFile)
      ? (JSON.parse(readFileSync(baselineFile, 'utf8')) as EvalMetrics)
      : null
    const failures = compare(run.metrics, baseline)

    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    mkdirSync(join(dir, 'reports'), { recursive: true })
    writeFileSync(join(dir, 'reports', `${stamp}.json`), JSON.stringify(run, null, 2))
    writeFileSync(join(dir, 'reports', `${stamp}.md`), reportMarkdown(run, failures))
    if (process.env['EVAL_UPDATE_BASELINE'] === '1') {
      writeFileSync(baselineFile, JSON.stringify(run.metrics, null, 2) + '\n')
    }
    console.log(reportMarkdown(run, failures).split('\n').slice(0, 18).join('\n'))
    expect(failures).toEqual([])
  })
})
