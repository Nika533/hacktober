import { DEFAULT_LENS_SETTINGS, type LensEvent, type LensSettings } from '@hoot/core'
import { createFakeLensBackend } from '@hoot/core/testing'
import { describe, expect, it, vi } from 'vitest'
import { createRouter, type Router } from '../src/sw/router'
import { SETTINGS_KEY, createSettingsStore, type StorageArea } from '../src/sw/settings'
import { unavailableUpstream, type Upstream } from '../src/sw/upstream'
import { CTX } from './context'

const ENABLED: LensSettings = { ...DEFAULT_LENS_SETTINGS, enabled: true, mode: 'ask' }
const sender = { id: 'ext-id', tab: { id: 7 } }
const request = { ctx: CTX, allowedTransforms: ['define'], risk: 'normal' }

function memoryArea(initial: Record<string, unknown> = {}): StorageArea & {
  data: Record<string, unknown>
} {
  const data = { ...initial }
  return {
    data,
    get: async (key) => ({ [key]: data[key] }),
    set: async (items) => void Object.assign(data, items)
  }
}

function setup(
  upstream: Upstream = createFakeLensBackend({ settings: ENABLED }),
  area = memoryArea({ [SETTINGS_KEY]: ENABLED })
): { router: Router; area: ReturnType<typeof memoryArea> } {
  const router = createRouter({
    extensionId: 'ext-id',
    upstream: () => upstream,
    settings: createSettingsStore(area, DEFAULT_LENS_SETTINGS)
  })
  return { router, area }
}

describe('service worker router', () => {
  it('only answers our own content scripts and valid messages', async () => {
    const { router } = setup()
    expect(
      await router.handle({ type: 'lens.settings.get' }, { id: 'other', tab: { id: 1 } })
    ).toEqual({
      ok: false,
      error: { code: 'unauthorized', message: 'unauthorized' }
    })
    expect(await router.handle({ type: 'lens.settings.get' }, { id: 'ext-id' })).toMatchObject({
      ok: false
    })
    expect(await router.handle({ type: 'nope' }, sender)).toMatchObject({
      ok: false,
      error: { code: 'bad_request' }
    })
    expect(
      await router.handle({ type: 'lens.settings.get' }, { id: 'ext-id', url: 'https://x.test/' })
    ).toMatchObject({ ok: false, error: { code: 'unauthorized' } })
  })

  it('answers our own extension pages, such as the options page', async () => {
    const { router } = setup()
    const page = { id: 'ext-id', url: 'chrome-extension://ext-id/options.html' }
    expect(await router.handle({ type: 'lens.settings.get' }, page)).toEqual({
      ok: true,
      value: ENABLED
    })
  })

  it('applies concurrent settings patches one after another', async () => {
    const { router, area } = setup()
    await Promise.all([
      router.handle({ type: 'lens.settings.patch', patch: { mode: 'gloss' } }, sender),
      router.handle(
        { type: 'lens.settings.patch', patch: { sites: { 'a.test': 'never' } } },
        sender
      )
    ])
    expect(area.data[SETTINGS_KEY]).toMatchObject({ mode: 'gloss', sites: { 'a.test': 'never' } })
  })

  it('routes a rewrite through the upstream', async () => {
    const { router } = setup()
    const reply = await router.handle({ type: 'lens.rewrite', reqId: 'r1', request }, sender)
    expect(reply).toMatchObject({
      ok: true,
      value: {
        kind: 'rewritten',
        result: {
          action: 'replace',
          transform: 'define',
          text: 'heteroscedasticity (a fake definition)'
        }
      }
    })
  })

  it('skips rewrites while Lens is off', async () => {
    const { router } = setup(undefined, memoryArea())
    expect(await router.handle({ type: 'lens.rewrite', reqId: 'r3', request }, sender)).toEqual({
      ok: true,
      value: { kind: 'skipped', reason: 'lens_off' }
    })
  })

  it('cancels an in-flight request by reqId and tab', async () => {
    const { router } = setup(createFakeLensBackend({ settings: ENABLED, delayMs: 1000 }))
    const pending = router.handle({ type: 'lens.rewrite', reqId: 'r4', request }, sender)
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(router.inflight()).toBe(1)
    await router.handle({ type: 'lens.cancel', reqId: 'r4' }, sender)
    expect(await pending).toEqual({ ok: true, value: { kind: 'skipped', reason: 'cancelled' } })
    expect(router.inflight()).toBe(0)
  })

  it('applies settings patches, including per-site pause', async () => {
    const { router, area } = setup()
    const reply = await router.handle(
      { type: 'lens.settings.patch', patch: { sites: { 'example.com': 'paused' } } },
      sender
    )
    expect(reply).toMatchObject({ ok: true, value: { sites: { 'example.com': 'paused' } } })
    expect((area.data[SETTINGS_KEY] as LensSettings).sites).toEqual({ 'example.com': 'paused' })
    await router.handle(
      { type: 'lens.settings.patch', patch: { sites: { 'example.com': null } } },
      sender
    )
    expect((area.data[SETTINGS_KEY] as LensSettings).sites).toEqual({})
  })

  it('keeps the valid parts of stored settings from another schema version', async () => {
    const older: Record<string, unknown> = {
      ...ENABLED,
      sites: { 'a.test': 'never' },
      mode: 'sideways'
    }
    delete older.coldStartDone
    const { router } = setup(undefined, memoryArea({ [SETTINGS_KEY]: older }))
    expect(await router.handle({ type: 'lens.settings.get' }, sender)).toEqual({
      ok: true,
      value: { ...ENABLED, mode: DEFAULT_LENS_SETTINGS.mode, sites: { 'a.test': 'never' } }
    })
  })

  it('falls back to the defaults when stored settings are corrupt', async () => {
    const { router } = setup(undefined, memoryArea({ [SETTINGS_KEY]: { enabled: 'yes' } }))
    expect(await router.handle({ type: 'lens.settings.get' }, sender)).toEqual({
      ok: true,
      value: DEFAULT_LENS_SETTINGS
    })
  })

  it('reports that the app is unavailable without the bridge', async () => {
    const { router } = setup(unavailableUpstream)
    expect(await router.handle({ type: 'lens.rewrite', reqId: 'r5', request }, sender)).toEqual({
      ok: false,
      error: { code: 'app_unavailable', message: 'Hoot isn’t running' }
    })
  })

  it('forwards valid feedback and explain requests', async () => {
    const fake = createFakeLensBackend({ settings: ENABLED })
    const explain = vi.spyOn(fake, 'explainMore')
    const { router } = setup(fake)
    const event: LensEvent = {
      id: 'e1',
      ts: 1,
      site: 'example.com',
      urlHash: 'h',
      kind: 'shown',
      transform: 'define',
      mode: 'ask',
      term: null,
      topic: null,
      lang: 'en',
      spanWords: 1,
      p: 0,
      difficulty: null,
      latencyMs: 300
    }
    expect(await router.handle({ type: 'lens.feedback', event }, sender)).toEqual({
      ok: true,
      value: null
    })
    await router.handle({ type: 'lens.explain', ctx: CTX }, sender)
    expect(fake.events).toEqual([event])
    expect(explain).toHaveBeenCalledWith(CTX)
  })
})
