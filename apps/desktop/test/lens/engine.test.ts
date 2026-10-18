import {
  DEFAULT_LENS_SETTINGS,
  LENS_MODELS,
  type LensContext,
  type LensSettings,
  type RewriteRequest
} from '@hoot/core'
import { describe, expect, it } from 'vitest'
import {
  AiError,
  AiOutputError,
  createFakeProvider,
  type AiProvider,
  type JsonRequest
} from '../../src/main/ai'
import { LensCache } from '../../src/main/lens/cache'
import { LensEngine, effectiveTransforms, pickRewriteModel } from '../../src/main/lens/engine'
import { ProfileStore } from '../../src/main/lens/profileStore'
import { createMemoryLensStorage } from '../../src/main/lens/storage'

const ctx = (overrides: Partial<LensContext> = {}): LensContext => ({
  span: 'heteroscedasticity',
  paragraph: 'The residuals show heteroscedasticity, so the errors are unreliable.',
  headingPath: ['Diagnostics'],
  title: 'Regression',
  lang: 'en',
  site: 'example.com',
  siteCategory: 'general',
  surface: 'html',
  signals: {
    sizeClass: 'term',
    copiedWithinMs: null,
    dwellMs: 1500,
    reselectCount: 0,
    reread: 0,
    rarity: 0.9,
    knownTerm: false,
    topicFamiliarity: null,
    foreignLanguage: false,
    blocked: null
  },
  p: 0.8,
  ...overrides
})

const request = (overrides: Partial<RewriteRequest> = {}): RewriteRequest => ({
  ctx: ctx(),
  allowedTransforms: ['define', 'simplify'],
  risk: 'normal',
  ...overrides
})

const goodDefine = {
  action: 'replace',
  transform: 'define',
  text: 'heteroscedasticity (when the spread of errors changes)',
  term: 'heteroscedasticity',
  meaning_preserved: true,
  confidence: 0.9
}

interface Setup {
  engine: LensEngine
  calls: JsonRequest<unknown>[]
  lens: LensSettings
  profile: ProfileStore
}

async function setup(
  opts: {
    json?: (req: JsonRequest<unknown>) => unknown | Promise<unknown>
    provider?: AiProvider | null
    fake?: boolean
    lens?: Partial<LensSettings>
  } = {}
): Promise<Setup> {
  const storage = createMemoryLensStorage()
  const calls: JsonRequest<unknown>[] = []
  const lens: LensSettings = { ...DEFAULT_LENS_SETTINGS, enabled: true, ...opts.lens }
  const base = createFakeProvider({ json: () => goodDefine })
  const provider: AiProvider | null =
    opts.provider === undefined
      ? {
          ...base,
          async generateJson<T>(req: JsonRequest<T>): Promise<T> {
            calls.push(req as JsonRequest<unknown>)
            const raw = await (opts.json ?? (() => goodDefine))(req as JsonRequest<unknown>)
            req.signal?.throwIfAborted()
            const parsed = req.schema.safeParse(raw)
            if (!parsed.success) throw new AiOutputError('schema mismatch')
            return parsed.data
          }
        }
      : opts.provider
  const profile = await ProfileStore.load(storage, { coldStart: false })
  const engine = new LensEngine({
    getProvider: async () => provider,
    getLensSettings: () => lens,
    profile,
    cache: await LensCache.load(storage, Date.now, (e) => {
      throw e
    }),
    fake: opts.fake ?? false,
    now: Date.now
  })
  return { engine, calls, lens, profile }
}

describe('LensEngine.rewrite', () => {
  it('asks Gemini with the rewrite prompt and returns a guarded result', async () => {
    const { engine, calls } = await setup()
    const out = await engine.rewrite('r1', request())
    expect(out).toMatchObject({
      kind: 'rewritten',
      result: { action: 'replace', transform: 'define', cached: false }
    })
    expect(calls).toHaveLength(1)
    expect(calls[0]?.model).toBe(LENS_MODELS.rewriteFast)
    expect(calls[0]?.thinking).toBe('minimal')
    expect(calls[0]?.prompt).toContain('<selection>heteroscedasticity</selection>')
    expect(calls[0]?.prompt).toContain('Reader profile:')
  })

  it('serves a repeat from the cache, and a profile edit retires it', async () => {
    const { engine, calls, profile } = await setup()
    await engine.rewrite('r1', request())
    const again = await engine.rewrite('r2', request())
    expect(again.kind === 'rewritten' && again.result.cached).toBe(true)
    expect(calls).toHaveLength(1)

    await profile.patch({ terms: { foo: 'known' } }, 1)
    await engine.rewrite('r3', request())
    expect(calls).toHaveLength(2)
  })

  it('falls back to the fast model when the strong one is rate-limited', async () => {
    const long = `${'The variance of the residuals grows with the fitted values '.repeat(3)}.`
    const simplify = {
      ...goodDefine,
      action: 'replace',
      transform: 'simplify',
      text: long,
      term: null
    }
    const { engine, calls } = await setup({
      json: (req) => {
        if (req.model === LENS_MODELS.rewriteStrong) throw new AiError('rate_limited', '429')
        return simplify
      }
    })
    const out = await engine.rewrite(
      'r1',
      request({ ctx: ctx({ span: long, paragraph: long }), allowedTransforms: ['simplify'] })
    )
    expect(out.kind).toBe('rewritten')
    expect(calls.map((c) => c.model)).toEqual([LENS_MODELS.rewriteStrong, LENS_MODELS.rewriteFast])

    const fastLimited = await setup({
      json: () => {
        throw new AiError('rate_limited', '429')
      }
    })
    await expect(fastLimited.engine.rewrite('r2', request())).rejects.toMatchObject({
      code: 'rate_limited'
    })
    expect(fastLimited.calls).toHaveLength(1)
  })

  it('applies guardrails: high-stakes becomes a gloss, low confidence is skipped', async () => {
    const { engine } = await setup()
    const high = await engine.rewrite('r1', request({ risk: 'high' }))
    expect(high.kind === 'rewritten' && high.result.action).toBe('gloss')

    const low = await setup({ json: () => ({ ...goodDefine, confidence: 0.3 }) })
    expect(await low.engine.rewrite('r2', request())).toEqual({
      kind: 'skipped',
      reason: 'low_confidence'
    })
  })

  it('skips without calling Gemini when Lens is off or the site is paused', async () => {
    const off = await setup({ lens: { enabled: false } })
    expect(await off.engine.rewrite('r1', request())).toEqual({
      kind: 'skipped',
      reason: 'lens_off'
    })
    const paused = await setup({ lens: { sites: { 'example.com': 'paused' } } })
    expect(await paused.engine.rewrite('r1', request())).toEqual({
      kind: 'skipped',
      reason: 'lens_off'
    })
    expect(off.calls.length + paused.calls.length).toBe(0)
  })

  it('reports invalid model output as a skip and provider failures as errors', async () => {
    const bad = await setup({ json: () => ({ nonsense: true }) })
    expect(await bad.engine.rewrite('r1', request())).toEqual({
      kind: 'skipped',
      reason: 'invalid_output'
    })

    const busy = await setup({
      json: () => {
        throw new AiError('busy', 'overloaded')
      }
    })
    await expect(busy.engine.rewrite('r1', request())).rejects.toMatchObject({ code: 'busy' })

    const keyless = await setup({ provider: null })
    await expect(keyless.engine.rewrite('r1', request())).rejects.toMatchObject({ code: 'no_key' })
  })

  it('cancels by reqId and aborts the model call', async () => {
    let seen: AbortSignal | undefined
    const { engine } = await setup({
      json: (req) =>
        new Promise((resolve) => {
          seen = req.signal
          setTimeout(() => resolve(goodDefine), 50)
        })
    })
    const pending = engine.rewrite('r1', request())
    await new Promise((r) => setTimeout(r, 5))
    engine.cancel('r1')
    expect(await pending).toEqual({ kind: 'skipped', reason: 'cancelled' })
    expect(seen?.aborted).toBe(true)
  })

  it('shares one model call between identical requests in flight', async () => {
    let seen: AbortSignal | undefined
    const { engine, calls } = await setup({
      json: (req) =>
        new Promise((resolve) => {
          seen = req.signal
          setTimeout(() => resolve(goodDefine), 30)
        })
    })
    const a = engine.rewrite('a', request())
    const b = engine.rewrite('b', request())
    await new Promise((r) => setTimeout(r, 5))
    engine.cancel('a')
    expect(await a).toEqual({ kind: 'skipped', reason: 'cancelled' })
    expect(seen?.aborted).toBe(false)
    expect((await b).kind).toBe('rewritten')
    expect(calls).toHaveLength(1)
  })

  it('uses the deterministic fakes under HOOT_FAKE_LENS and keys them like real results', async () => {
    const { engine, calls } = await setup({ fake: true })
    const out = await engine.rewrite('r1', request())
    expect(out.kind === 'rewritten' && out.result.text).toBe(
      'heteroscedasticity (a fake definition)'
    )
    const again = await engine.rewrite('r2', request())
    expect(again.kind === 'rewritten' && again.result.cached).toBe(true)
    expect(calls).toHaveLength(0)
  })
})

describe('LensEngine.assess', () => {
  it('uses the assess model and caches per profile version', async () => {
    const { engine, calls } = await setup({
      json: () => ({ difficulty: 0.7, reason: 'jargon', term: 'heteroscedasticity' })
    })
    await expect(engine.assess('a1', ctx())).resolves.toEqual({
      difficulty: 0.7,
      reason: 'jargon',
      term: 'heteroscedasticity'
    })
    await engine.assess('a2', ctx())
    expect(calls).toHaveLength(1)
    expect(calls[0]?.model).toBe(LENS_MODELS.assess)
    expect(calls[0]?.retries).toBe(0)
  })

  it('refuses when Lens is off', async () => {
    const { engine } = await setup({ lens: { enabled: false } })
    await expect(engine.assess('a1', ctx())).rejects.toMatchObject({ code: 'lens_off' })
  })
})

describe('routing helpers', () => {
  it('drops translate for languages the reader reads', () => {
    const lens = { ...DEFAULT_LENS_SETTINGS, languages: { primary: 'en', comfortable: ['de'] } }
    const req = (lang: string): RewriteRequest =>
      request({ ctx: ctx({ lang }), allowedTransforms: ['translate', 'simplify', 'simplify'] })
    expect(effectiveTransforms(req('en-GB'), lens)).toEqual(['simplify'])
    expect(effectiveTransforms(req('de'), lens)).toEqual(['simplify'])
    expect(effectiveTransforms(req('fr'), lens)).toEqual(['translate', 'simplify'])
  })

  it('sends long simplify/unpack to the stronger model', () => {
    const long = 'word '.repeat(30)
    expect(pickRewriteModel(['simplify'], long)).toBe(LENS_MODELS.rewriteStrong)
    expect(pickRewriteModel(['simplify'], 'short span')).toBe(LENS_MODELS.rewriteFast)
    expect(pickRewriteModel(['define'], long)).toBe(LENS_MODELS.rewriteFast)
  })
})
