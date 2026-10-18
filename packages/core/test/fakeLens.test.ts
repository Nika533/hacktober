import { describe, expect, it } from 'vitest'
import { LensBackendError } from '../src/protocol/backend'
import { RewriteOutcomeSchema } from '../src/schemas/lens'
import { createFakeLensBackend, fakeAssess, fakeRewrite } from '../src/testing/fakeLens'
import type { RewriteRequest, Transform } from '../src/types/lens'
import { sampleContext, sampleSignals } from './fixtures'

const req = (span: string, extra: Partial<RewriteRequest> = {}): RewriteRequest => ({
  ctx: sampleContext({ span }),
  allowedTransforms: ['define', 'expand', 'simplify', 'translate'] as Transform[],
  risk: 'normal' as const,
  ...extra
})

describe('fakeRewrite', () => {
  it('picks a transform from the span shape', () => {
    const pick = (span: string, foreign = false): string => {
      const o = fakeRewrite({
        ...req(span),
        allowedTransforms: ['define', 'expand', 'simplify', 'translate'],
        ctx: sampleContext({ span, signals: sampleSignals({ foreignLanguage: foreign }) })
      })
      return o.kind === 'rewritten' ? o.result.transform : o.kind
    }
    expect(pick('heteroscedasticity')).toBe('define')
    expect(pick('HTTP')).toBe('expand')
    expect(pick('the residuals are not homoscedastic here')).toBe('simplify')
    expect(pick('la casa es grande', true)).toBe('translate')
  })

  it('glosses high-risk spans and honours allowed transforms', () => {
    const o = fakeRewrite({ ...req('indemnify'), allowedTransforms: ['simplify'], risk: 'high' })
    expect(o.kind === 'rewritten' && o.result.action).toBe('gloss')
    expect(o.kind === 'rewritten' && o.result.transform).toBe('simplify')
  })

  it('has hooks for the skip and error paths', () => {
    expect(fakeRewrite({ ...req('SKIP me'), allowedTransforms: ['define'] })).toEqual({
      kind: 'skipped',
      reason: 'model_skip'
    })
    expect(() => fakeRewrite({ ...req('ERROR'), allowedTransforms: ['define'] })).toThrow(
      LensBackendError
    )
    expect(() => fakeAssess(sampleContext({ span: 'ERROR' }))).toThrow(LensBackendError)
  })

  it('produces outcomes that satisfy the wire schema', () => {
    for (const span of ['word', 'NASA', 'a much longer sentence that needs simplifying']) {
      const o = fakeRewrite({ ...req(span), allowedTransforms: ['define', 'expand', 'simplify'] })
      expect(RewriteOutcomeSchema.safeParse(o).success).toBe(true)
    }
  })
})

describe('createFakeLensBackend', () => {
  it('skips when Lens is off and records feedback', async () => {
    const backend = createFakeLensBackend()
    await backend.patchSettings({ enabled: false })
    const off = await backend.rewrite({ ...req('word'), allowedTransforms: ['define'] })
    expect(off).toEqual({ kind: 'skipped', reason: 'lens_off' })

    await backend.feedback({
      id: 'e1',
      ts: 1,
      site: 'example.com',
      urlHash: 'h',
      kind: 'kept',
      transform: 'define',
      mode: 'replace',
      term: 'word',
      topic: null,
      lang: 'en',
      spanWords: 1,
      p: 0.8,
      difficulty: null,
      latencyMs: 10
    })
    expect(backend.events.map((e) => e.kind)).toEqual(['kept'])
  })

  it('resolves cancelled when aborted mid-call', async () => {
    const backend = createFakeLensBackend({ delayMs: 50 })
    const ac = new AbortController()
    const pending = backend.rewrite(
      { ...req('word'), allowedTransforms: ['define'] },
      {
        signal: ac.signal
      }
    )
    ac.abort()
    await expect(pending).resolves.toEqual({ kind: 'skipped', reason: 'cancelled' })
  })

  it('notifies settings listeners and stops after unsubscribe', async () => {
    const backend = createFakeLensBackend()
    const seen: string[] = []
    const off = backend.onSettings((s) => seen.push(s.mode))
    await backend.patchSettings({ mode: 'ask' })
    off()
    await backend.patchSettings({ mode: 'gloss' })
    expect(seen).toEqual(['ask'])
  })
})
