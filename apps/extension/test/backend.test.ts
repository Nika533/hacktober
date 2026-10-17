import { LensError } from '@hoot/lens-dom'
import { describe, expect, it, vi } from 'vitest'
import { ExtensionBackend, type RuntimeLike } from '../src/content/backend'

function runtime(
  reply: (message: unknown) => unknown,
  id: string | null = 'ext'
): RuntimeLike & {
  push(message: unknown): void
  sent: unknown[]
} {
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

const settings = { enabled: true, mode: 'ask', copy: 'original', highStakes: 'gloss' }

describe('ExtensionBackend', () => {
  it('unwraps replies and validates settings', async () => {
    const backend = new ExtensionBackend(runtime(() => ({ ok: true, value: settings })))
    expect(await backend.getSettings()).toEqual(settings)
    const broken = new ExtensionBackend(runtime(() => ({ ok: true, value: { enabled: 'yes' } })))
    await expect(broken.getSettings()).rejects.toMatchObject({ code: 'invalid-settings' })
  })

  it('turns error replies into LensError codes', async () => {
    const backend = new ExtensionBackend(
      runtime(() => ({
        ok: false,
        error: { code: 'app-unavailable', message: 'Hoot isn’t running' }
      }))
    )
    const error = await backend.getProfile().catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(LensError)
    expect(error).toMatchObject({ code: 'app-unavailable' })
  })

  it('detects an invalidated extension context', async () => {
    const backend = new ExtensionBackend(runtime(() => undefined, null))
    await expect(backend.getSettings()).rejects.toMatchObject({ code: 'extension-reloaded' })
  })

  it('delivers validated settings pushes to listeners', () => {
    const rt = runtime(() => undefined)
    const backend = new ExtensionBackend(rt)
    const listener = vi.fn()
    backend.onSettings(listener)
    rt.push({ type: 'lens.settings.changed', settings })
    rt.push({ type: 'lens.settings.changed', settings: { enabled: 1 } })
    rt.push({ type: 'other' })
    expect(listener).toHaveBeenCalledTimes(1)
    expect(listener).toHaveBeenCalledWith(settings)
  })

  it('sends cancel, feedback and explain without waiting', () => {
    const rt = runtime(() => ({ ok: true, value: null }))
    const backend = new ExtensionBackend(rt)
    backend.cancel('r1')
    backend.explainMore({ span: 'a', paragraph: 'b', title: 'c' })
    expect(rt.sent).toEqual([
      { type: 'lens.cancel', reqId: 'r1' },
      { type: 'lens.explain', request: { span: 'a', paragraph: 'b', title: 'c' } }
    ])
  })
})
