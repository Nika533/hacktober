import { createBridgeConnection, type BridgeConnection } from '@hoot/bridge'
import { createFakeBridgeApp } from '@hoot/bridge/testing'
import { DEFAULT_LENS_SETTINGS, LensBackendError, type ExtToApp, type LensEvent } from '@hoot/core'
import { createFakeLensBackend, type FakeLensBackend } from '@hoot/core/testing'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  TransportError,
  createBridgeClient,
  type BridgeClient,
  type BridgeEvent,
  type Connect,
  type TransportHandlers
} from '../src/sw/bridge'
import { CTX } from './context'

const ENABLED = { ...DEFAULT_LENS_SETTINGS, enabled: true, consentedAt: 1 }
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T
const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

let backend: FakeLensBackend
let server: BridgeConnection | null
let handlers: TransportHandlers | null
let connects: number
let client: BridgeClient

/** The client against C's real protocol logic, over an in-memory transport. */
const linked: Connect = (next) => {
  connects += 1
  handlers = next
  const peer = createBridgeConnection({
    app: createFakeBridgeApp(backend, '1.2.3'),
    send: (message) => queueMicrotask(() => next.message(copy(message)))
  })
  server = peer
  return {
    send: (message) => queueMicrotask(() => peer.handle(copy(message))),
    close: () => peer.close()
  }
}

function start(connect: Connect = linked, helloTimeoutMs?: number): BridgeEvent[] {
  client = createBridgeClient({ connect, extVersion: '0.1.0', browser: 'chrome', helloTimeoutMs })
  const events: BridgeEvent[] = []
  client.subscribe((event) => events.push(event))
  return events
}

beforeEach(() => {
  backend = createFakeLensBackend({ settings: ENABLED })
  server = null
  handlers = null
  connects = 0
})

afterEach(() => {
  client.close()
  vi.useRealTimers()
})

describe('bridge client', () => {
  it('says hello and adopts the app’s settings and profile', async () => {
    const events = start()
    await client.connect()
    expect(client.status()).toEqual({ state: 'connected', appVersion: '1.2.3' })
    expect(events.map((event) => event.type)).toEqual(['status', 'status', 'settings', 'profile'])
    expect(await client.getSettings()).toEqual(ENABLED)
  })

  it('routes requests and their replies through the protocol', async () => {
    start()
    const outcome = await client.rewrite({
      ctx: CTX,
      allowedTransforms: ['define'],
      risk: 'normal'
    })
    expect(outcome).toMatchObject({ kind: 'rewritten', result: { transform: 'define' } })
    expect(await client.assess(CTX)).toMatchObject({ reason: 'jargon' })
    const event = { id: 'e1', ts: 1, site: 'example.com', urlHash: 'h', kind: 'shown' }
    await client.feedback({
      ...event,
      transform: 'define',
      mode: 'ask',
      term: null,
      topic: null,
      lang: 'en',
      spanWords: 1,
      p: 0.5,
      difficulty: null,
      latencyMs: 1
    } as LensEvent)
    await client.explainMore(CTX)
    expect(backend.events.map((e) => e.id)).toEqual(['e1'])
    expect(backend.explained).toHaveLength(1)
    expect(connects).toBe(1)
  })

  it('cancels a request by reqId', async () => {
    backend = createFakeLensBackend({ settings: ENABLED, delayMs: 1000 })
    start()
    await client.connect()
    const controller = new AbortController()
    const pending = client.rewrite(
      { ctx: CTX, allowedTransforms: ['define'], risk: 'normal' },
      { signal: controller.signal }
    )
    await tick()
    controller.abort()
    expect(await pending).toEqual({ kind: 'skipped', reason: 'cancelled' })
  })

  it('fails in-flight requests when the transport closes, then reconnects on demand', async () => {
    backend = createFakeLensBackend({ settings: ENABLED, delayMs: 1000 })
    start()
    await client.connect()
    const pending = client.assess(CTX)
    await tick()
    handlers?.closed('not_running')
    await expect(pending).rejects.toMatchObject({ code: 'app_unavailable' })
    expect(client.status().state).toBe('not_running')
    backend = createFakeLensBackend({ settings: ENABLED })
    await client.assess(CTX)
    expect(connects).toBe(2)
  })

  it('reports a missing host as not installed', async () => {
    start(() => {
      throw new TransportError('not_installed')
    })
    await expect(client.connect()).rejects.toBeInstanceOf(LensBackendError)
    expect(client.status().state).toBe('not_installed')
  })

  it('tries again after a failed connect', async () => {
    let failNext = true
    start((next) => {
      if (!failNext) return linked(next)
      failNext = false
      throw new TransportError('not_running')
    })
    await expect(client.connect()).rejects.toBeInstanceOf(LensBackendError)
    await client.connect()
    expect(client.status().state).toBe('connected')
  })

  it('treats a connection-level error from hoot-bridge as the app being away', async () => {
    start((next) => ({
      send: (message: ExtToApp) => {
        if (message.type === 'hello') {
          queueMicrotask(() =>
            next.message({ type: 'error', reqId: null, code: 'app_unavailable', message: 'x' })
          )
        }
      },
      close: () => undefined
    }))
    await expect(client.connect()).rejects.toMatchObject({ code: 'app_unavailable' })
    expect(client.status().state).toBe('not_running')
  })

  it('reports a protocol version mismatch', async () => {
    start((next) => ({
      send: (message: ExtToApp) =>
        queueMicrotask(() =>
          next.message({
            type: 'error',
            reqId: message.reqId,
            code: 'version_mismatch',
            message: 'old app'
          })
        ),
      close: () => undefined
    }))
    await expect(client.connect()).rejects.toMatchObject({ code: 'version_mismatch' })
    expect(client.status().state).toBe('version_mismatch')
  })

  it('gives up on an app that never says welcome', async () => {
    vi.useFakeTimers()
    start(() => ({ send: () => undefined, close: () => undefined }), 1000)
    const connecting = client.connect()
    const settled = expect(connecting).rejects.toMatchObject({ code: 'app_unavailable' })
    await vi.advanceTimersByTimeAsync(1000)
    await settled
    expect(client.status().state).toBe('not_running')
  })

  it('passes settings and profile pushes on, and ignores junk', async () => {
    const events = start()
    await client.connect()
    events.length = 0
    handlers?.message({ type: 'nonsense' })
    server?.pushSettings({ ...ENABLED, mode: 'gloss' })
    server?.pushProfile({ ...(await backend.getProfile()), threshold: 0.9 })
    await tick()
    expect(events).toMatchObject([
      { type: 'settings', lens: { mode: 'gloss' } },
      { type: 'profile', profile: { threshold: 0.9 } }
    ])
    expect((await client.getSettings()).mode).toBe('gloss')
  })
})
