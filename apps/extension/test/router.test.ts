import type { LensSettingsView, RewriteRequest } from '@hoot/lens-dom'
import { describe, expect, it, vi } from 'vitest'
import { createDevUpstream } from '../src/sw/dev-upstream'
import { createRouter } from '../src/sw/router'
import { unavailableUpstream, type Upstream } from '../src/sw/upstream'

const SETTINGS: LensSettingsView = {
  enabled: true,
  mode: 'ask',
  copy: 'original',
  highStakes: 'gloss'
}

const request: RewriteRequest = {
  span: 'heteroscedasticity',
  paragraph: 'The model shows heteroscedasticity.',
  headingPath: ['Residuals'],
  title: 'Article',
  lang: 'en',
  risk: 'normal'
}

const sender = { id: 'ext-id', tab: { id: 7 } }

function setup(upstream: Upstream = createDevUpstream({ push: async () => undefined }, 5)): {
  router: ReturnType<typeof createRouter>
  setSettings(next: LensSettingsView): void
  paused: Set<string>
} {
  let settings = { ...SETTINGS }
  const paused = new Set<string>()
  const router = createRouter({
    extensionId: 'ext-id',
    upstream: () => upstream,
    settings: { get: async () => settings },
    sites: {
      isPaused: async (site) => paused.has(site),
      setPaused: async (site, value) => void (value ? paused.add(site) : paused.delete(site))
    }
  })
  return {
    router,
    setSettings: (next) => {
      settings = next
    },
    paused
  }
}

describe('service worker router', () => {
  it('only answers our own content scripts', async () => {
    const { router } = setup()
    expect(
      await router.handle({ type: 'lens.settings.get' }, { id: 'other', tab: { id: 1 } })
    ).toEqual({
      ok: false,
      error: { code: 'forbidden', message: 'forbidden' }
    })
    expect(await router.handle({ type: 'lens.settings.get' }, { id: 'ext-id' })).toMatchObject({
      ok: false
    })
    expect(await router.handle({ type: 'nope' }, sender)).toMatchObject({
      ok: false,
      error: { code: 'invalid-message' }
    })
  })

  it('routes a rewrite through the upstream', async () => {
    const { router } = setup()
    const reply = await router.handle({ type: 'lens.rewrite', reqId: 'r1', request }, sender)
    expect(reply).toEqual({
      ok: true,
      value: {
        kind: 'rewritten',
        action: 'replace',
        transform: 'define',
        text: 'heteroscedasticity (when the spread of errors changes across values)',
        term: 'heteroscedasticity',
        confidence: 0.9,
        cacheKey: 'dev:heteroscedasticity'
      }
    })
  })

  it('returns a gloss for high-stakes requests in the dev stub', async () => {
    const { router } = setup()
    const reply = await router.handle(
      { type: 'lens.rewrite', reqId: 'r2', request: { ...request, risk: 'high' } },
      sender
    )
    expect(reply).toMatchObject({
      ok: true,
      value: { action: 'gloss', text: 'when the spread of errors changes across values' }
    })
  })

  it('refuses rewrites while Lens is off', async () => {
    const { router, setSettings } = setup()
    setSettings({ ...SETTINGS, enabled: false })
    expect(
      await router.handle({ type: 'lens.rewrite', reqId: 'r3', request }, sender)
    ).toMatchObject({
      ok: false,
      error: { code: 'lens-off' }
    })
  })

  it('cancels an in-flight request by reqId and tab', async () => {
    const { router } = setup(createDevUpstream({ push: async () => undefined }, 1000))
    const pending = router.handle({ type: 'lens.rewrite', reqId: 'r4', request }, sender)
    await Promise.resolve()
    expect(router.inflight()).toBe(1)
    await router.handle({ type: 'lens.cancel', reqId: 'r4' }, sender)
    expect(await pending).toMatchObject({ ok: false, error: { code: 'cancelled' } })
    expect(router.inflight()).toBe(0)
  })

  it('stores per-site pause', async () => {
    const { router, paused } = setup()
    await router.handle({ type: 'lens.site.pause', site: 'example.com', paused: true }, sender)
    expect(paused.has('example.com')).toBe(true)
    expect(await router.handle({ type: 'lens.site.get', site: 'example.com' }, sender)).toEqual({
      ok: true,
      value: { paused: true }
    })
  })

  it('reports that the app is unavailable without the bridge', async () => {
    const { router } = setup(unavailableUpstream)
    expect(await router.handle({ type: 'lens.rewrite', reqId: 'r5', request }, sender)).toEqual({
      ok: false,
      error: { code: 'app-unavailable', message: 'Hoot isn’t running' }
    })
  })

  it('forwards feedback and explain requests', async () => {
    const push = vi.fn(async () => undefined)
    const { router } = setup(createDevUpstream({ push }, 1))
    const event = {
      eventId: 'e1',
      kind: 'shown',
      transform: 'define',
      mode: 'ask',
      term: null,
      lang: 'en',
      spanWords: 1,
      latencyMs: 300
    }
    await router.handle({ type: 'lens.feedback', event }, sender)
    await router.handle(
      { type: 'lens.explain', request: { span: 'x', paragraph: 'y', title: 'z' } },
      sender
    )
    expect(push.mock.calls.map((call) => (call as unknown[])[0])).toEqual(['feedback', 'explain'])
  })
})
