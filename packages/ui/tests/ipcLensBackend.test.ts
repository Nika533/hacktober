import {
  DEFAULT_SETTINGS,
  type HootApi,
  type LensContext,
  type LensSettings,
  type SettingsPatch
} from '@hoot/core'
import { describe, expect, it, vi } from 'vitest'
import { createIpcLensBackend, createLensSettingsFeed } from '../src/lens/ipcLensBackend'

const CTX = { span: 'amortization' } as unknown as LensContext

function fakeHoot(): {
  hoot: Pick<HootApi, 'lens' | 'settings'>
  assess: ReturnType<typeof vi.fn>
  cancel: ReturnType<typeof vi.fn>
  update: ReturnType<typeof vi.fn>
  resolveAssess: () => void
} {
  let resolveAssess = (): void => undefined
  const assess = vi.fn(
    () =>
      new Promise((r) => {
        resolveAssess = () => r({ difficulty: 0.9, reason: 'term', term: 'amortization' })
      })
  )
  const cancel = vi.fn(() => Promise.resolve())
  const update = vi.fn<(patch: SettingsPatch) => Promise<void>>(() => Promise.resolve())
  const hoot = {
    lens: {
      assess,
      cancel,
      rewrite: vi.fn(() => Promise.resolve({ kind: 'skipped', reason: 'cancelled' })),
      feedback: vi.fn(() => Promise.resolve()),
      explain: vi.fn(() => Promise.resolve()),
      snapshot: vi.fn(() => Promise.resolve({ version: 1 })),
      onProfile: vi.fn(() => () => undefined)
    },
    settings: { update }
  } as unknown as Pick<HootApi, 'lens' | 'settings'>
  return { hoot, assess, cancel, update, resolveAssess: () => resolveAssess() }
}

describe('createIpcLensBackend', () => {
  it('gives every call its own reqId and cancels it when the signal aborts', async () => {
    const f = fakeHoot()
    const backend = createIpcLensBackend(f.hoot, createLensSettingsFeed())
    const ac = new AbortController()
    const pending = backend.assess(CTX, { signal: ac.signal })
    const [reqId, ctx] = f.assess.mock.calls[0] as [string, LensContext]
    expect(reqId).toMatch(/^[A-Za-z0-9_-]{1,64}$/)
    expect(ctx).toBe(CTX)
    ac.abort()
    expect(f.cancel).toHaveBeenCalledWith(reqId)
    f.resolveAssess()
    await expect(pending).resolves.toMatchObject({ term: 'amortization' })

    void backend.assess(CTX)
    expect(f.assess.mock.calls[1]?.[0]).not.toBe(reqId)
  })

  it('reads settings from the window’s mirror and waits for main’s echo after a patch', async () => {
    const f = fakeHoot()
    const feed = createLensSettingsFeed()
    const backend = createIpcLensBackend(f.hoot, feed)
    expect(await backend.getSettings()).toEqual(DEFAULT_SETTINGS.lens)

    const on: LensSettings = { ...DEFAULT_SETTINGS.lens, enabled: true }
    feed.push(on)
    expect(await backend.getSettings()).toBe(on)

    const seen = vi.fn()
    backend.onSettings(seen)
    const patched = backend.patchSettings({ mode: 'ask' })
    await Promise.resolve()
    expect(f.update).toHaveBeenCalledWith({ lens: { mode: 'ask' } })
    const echo = { ...on, mode: 'ask' as const }
    feed.push(echo)
    await expect(patched).resolves.toBe(echo)
    expect(seen).toHaveBeenCalledWith(echo)
  })
})
