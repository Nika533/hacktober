import { DEFAULT_LENS_SETTINGS, LensBackendError } from '@hoot/core'
import { describe, expect, it, vi } from 'vitest'
import { ExtensionBackend, type RuntimeLike } from '../src/content/backend'
import { fnv1a64, pageOrigin, pageSite, urlHash } from '../src/content/page'
import { CTX } from './context'

function runtime(
  reply: (message: unknown) => unknown,
  id: string | null = 'ext'
): RuntimeLike & { push(message: unknown): void; sent: unknown[] } {
  const listeners = new Set<(message: unknown) => void>()
  const sent: unknown[] = []
  return {
    get id() {
      return id ?? undefined
    },
    sent,
    sendMessage: async (message) => {
      sent.push(message)
      return reply(message)
    },
    onMessage: {
      addListener: (listener) => listeners.add(listener),
      removeListener: (listener) => listeners.delete(listener)
    },
    push: (message) => listeners.forEach((listener) => listener(message))
  }
}

describe('ExtensionBackend', () => {
  it('unwraps replies', async () => {
    const backend = new ExtensionBackend(
      runtime(() => ({ ok: true, value: DEFAULT_LENS_SETTINGS }))
    )
    expect(await backend.getSettings()).toEqual(DEFAULT_LENS_SETTINGS)
  })

  it('turns error replies into LensBackendError codes', async () => {
    const backend = new ExtensionBackend(
      runtime(() => ({
        ok: false,
        error: { code: 'app_unavailable', message: 'Hoot isn’t running' }
      }))
    )
    const error = await backend.getProfile().catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(LensBackendError)
    expect(error).toMatchObject({ code: 'app_unavailable' })
  })

  it('detects an invalidated extension context', async () => {
    const backend = new ExtensionBackend(runtime(() => undefined, null))
    expect(backend.connected).toBe(false)
    await expect(backend.getSettings()).rejects.toMatchObject({ code: 'app_unavailable' })
  })

  it('sends a cancel for the request when the signal aborts', async () => {
    let release: (value: unknown) => void = () => undefined
    const rt = runtime((message) => {
      const { type } = message as { type: string }
      if (type === 'lens.rewrite') return new Promise((resolve) => (release = resolve))
      return { ok: true, value: null }
    })
    const backend = new ExtensionBackend(rt)
    const controller = new AbortController()
    const pending = backend.rewrite(
      { ctx: CTX, allowedTransforms: ['define'], risk: 'normal' },
      { signal: controller.signal }
    )
    controller.abort()
    release({ ok: true, value: { kind: 'skipped', reason: 'cancelled' } })
    expect(await pending).toEqual({ kind: 'skipped', reason: 'cancelled' })
    const [rewrite, cancel] = rt.sent as Array<{ type: string; reqId: string }>
    expect(cancel).toEqual({ type: 'lens.cancel', reqId: rewrite?.reqId })
    expect(rewrite?.reqId).toMatch(/^[A-Za-z0-9_-]{1,64}$/)
  })

  it('delivers pushes to settings and profile listeners', () => {
    const rt = runtime(() => undefined)
    const backend = new ExtensionBackend(rt)
    const onSettings = vi.fn()
    const onProfile = vi.fn()
    backend.onSettings(onSettings)
    backend.onProfile(onProfile)
    rt.push({ type: 'lens.settings.changed', lens: DEFAULT_LENS_SETTINGS })
    rt.push({ type: 'lens.profile.changed', profile: { knownTerms: [] } })
    rt.push({ type: 'other' })
    expect(onSettings).toHaveBeenCalledWith(DEFAULT_LENS_SETTINGS)
    expect(onProfile).toHaveBeenCalledTimes(1)
  })
})

describe('page identity', () => {
  it('uses the hostname as the site and nothing for local files', () => {
    expect(pageSite({ protocol: 'https:', hostname: 'www.Example.com' })).toBe('example.com')
    expect(pageSite({ protocol: 'http:', hostname: '127.0.0.1' })).toBe('127.0.0.1')
    expect(pageSite({ protocol: 'file:', hostname: '' })).toBe('')
    expect(pageSite({ protocol: 'http:', hostname: '[::1]' })).toBe('')
  })

  it('gives srcdoc and about:blank frames the site of the origin they inherit', () => {
    const srcdoc = { protocol: 'about:', hostname: '', origin: 'null' }
    const origin = pageOrigin(srcdoc, 'https://www.example.com')
    expect(origin).toBe('https://www.example.com')
    expect(pageSite(srcdoc, origin)).toBe('example.com')
    expect(pageSite(srcdoc, pageOrigin(srcdoc, 'null'))).toBe('')
    expect(pageOrigin({ protocol: 'https:', origin: 'https://a.test' }, 'x')).toBe('https://a.test')
  })

  it('hashes origin and path with a salt, never the query', () => {
    const a = urlHash({ origin: 'https://example.com', pathname: '/a' }, 's1')
    expect(a).toMatch(/^[0-9a-f]{16}$/)
    expect(urlHash({ origin: 'https://example.com', pathname: '/a' }, 's2')).not.toBe(a)
    expect(fnv1a64('')).toBe('cbf29ce484222325')
  })
})
