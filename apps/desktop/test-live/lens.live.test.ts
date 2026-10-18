import { DEFAULT_LENS_SETTINGS, type LensContext } from '@hoot/core'
import { describe, expect, it } from 'vitest'
import { createAiProvider } from '../src/main/ai'
import { createLensService } from '../src/main/lens/service'
import { createMemoryLensStorage } from '../src/main/lens/storage'

/**
 * The whole Lens pipeline against real Claude: prompt → structured output →
 * guardrails. `ANTHROPIC_API_KEY=... npm run test:live` from the repo root.
 */
const key = process.env['ANTHROPIC_API_KEY'] ?? ''

const ctx = (span: string, paragraph: string): LensContext => ({
  span,
  paragraph,
  headingPath: ['Checking the model'],
  title: 'A gentle guide to linear regression',
  lang: 'en',
  site: 'example.com',
  siteCategory: 'general',
  surface: 'html',
  signals: {
    sizeClass: span.includes(' ') ? 'sentence' : 'term',
    copiedWithinMs: null,
    dwellMs: 1800,
    reselectCount: 0,
    reread: 0,
    rarity: 0.9,
    knownTerm: false,
    topicFamiliarity: null,
    foreignLanguage: false,
    blocked: null
  },
  p: 0.85
})

describe.skipIf(!key)('Lens engine (live Claude)', () => {
  const service = createLensService({
    storage: createMemoryLensStorage(),
    getLensSettings: () => ({ ...DEFAULT_LENS_SETTINGS, enabled: true, coldStartDone: true }),
    getProvider: async () => createAiProvider(key)
  })

  it('defines a jargon term in place', async () => {
    const out = await (
      await service
    ).rewrite('live-1', {
      ctx: ctx(
        'heteroscedasticity',
        'The residual plot shows heteroscedasticity, so the standard errors are unreliable.'
      ),
      allowedTransforms: ['define', 'expand', 'simplify'],
      risk: 'normal'
    })
    expect(out.kind).toBe('rewritten')
    if (out.kind === 'rewritten') {
      expect(out.result.text.toLowerCase()).toContain('heteroscedasticity')
      // The §7.2 target is latency.live.test.ts's job; this only bounds the engine timeout.
      expect(out.result.latencyMs).toBeLessThan(15_000)
    }
  })

  it('keeps numbers and negations when simplifying, or falls back to a gloss', async () => {
    const span =
      'Patients should not exceed 4 g of acetaminophen per 24-hour period, irrespective of formulation.'
    const out = await (
      await service
    ).rewrite('live-2', {
      ctx: ctx(span, span),
      allowedTransforms: ['simplify'],
      risk: 'high'
    })
    if (out.kind === 'rewritten') {
      expect(out.result.action).toBe('gloss')
    } else {
      expect(['model_skip', 'meaning_not_preserved', 'low_confidence']).toContain(out.reason)
    }
  })

  it('assesses difficulty', async () => {
    const result = await (
      await service
    ).assess('live-3', ctx('heteroscedasticity', 'The plot shows heteroscedasticity.'))
    expect(result.difficulty).toBeGreaterThan(0.3)
  })
})
