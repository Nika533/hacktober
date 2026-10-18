import { createBridgeConnection } from '@hoot/bridge'
import { createFakeBridgeApp } from '@hoot/bridge/testing'
import { DEFAULT_LENS_SETTINGS, type LensSettings } from '@hoot/core'
import {
  FAKE_PROFILE_SNAPSHOT,
  createFakeLensBackend,
  type FakeLensBackend
} from '@hoot/core/testing'
import { describe, expect, it } from 'vitest'
import {
  TransportError,
  createBridgeClient,
  type BridgeClient,
  type Connect
} from '../src/sw/bridge'
import { SETTINGS_KEY, createSettingsStore, type StorageArea } from '../src/sw/settings'
import {
  PROFILE_KEY,
  RETRY_KEY,
  RETRY_MS,
  UNSYNCED_KEY,
  createLensSync,
  type LensSync,
  mergePatches
} from '../src/sw/sync'

const APP: LensSettings = { ...DEFAULT_LENS_SETTINGS, enabled: true, consentedAt: 1, mode: 'gloss' }
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

function memoryArea(): StorageArea & { data: Record<string, unknown> } {
  const data: Record<string, unknown> = {}
  return {
    data,
    get: async (key) => ({ [key]: data[key] }),
    set: async (items) => void Object.assign(data, items)
  }
}

interface Setup {
  backend: FakeLensBackend
  bridge: BridgeClient
  local: ReturnType<typeof memoryArea>
  session: ReturnType<typeof memoryArea>
  sync: LensSync
  connects(): number
  advance(ms: number): number
}

function setup(reachable = { value: true }): Setup {
  const backend = createFakeLensBackend({ settings: APP })
  let connects = 0
  const connect: Connect = (handlers) => {
    connects += 1
    if (!reachable.value) throw new TransportError('not_running')
    const peer = createBridgeConnection({
      app: createFakeBridgeApp(backend),
      send: (message) => queueMicrotask(() => handlers.message(copy(message)))
    })
    return {
      send: (message) => queueMicrotask(() => peer.handle(copy(message))),
      close: () => peer.close()
    }
  }
  const bridge = createBridgeClient({ connect, extVersion: '0.1.0', browser: 'chrome' })
  const local = memoryArea()
  const session = memoryArea()
  let clock = 1_000
  const sync = createLensSync({
    bridge,
    store: createSettingsStore(local, DEFAULT_LENS_SETTINGS),
    local,
    session,
    now: () => clock
  })
  return {
    backend,
    bridge,
    local,
    session,
    sync,
    connects: () => connects,
    advance: (ms: number) => (clock += ms)
  }
}

describe('Lens settings and profile sync', () => {
  it('serves the cache and adopts the app’s settings and profile on welcome', async () => {
    const { bridge, sync, local, session } = setup()
    expect(await sync.settings.get()).toEqual(DEFAULT_LENS_SETTINGS)
    await bridge.connect()
    await settle()
    expect(await sync.settings.get()).toEqual(APP)
    expect(local.data[SETTINGS_KEY]).toEqual(APP)
    expect(session.data[PROFILE_KEY]).toEqual(FAKE_PROFILE_SNAPSHOT)
    expect(await sync.profile()).toEqual(FAKE_PROFILE_SNAPSHOT)
  })

  it('has no profile before the app has sent one', async () => {
    const { sync } = setup()
    await expect(sync.profile()).rejects.toMatchObject({ code: 'app_unavailable' })
  })

  it('queues changes made while the app is away and sends them on the next welcome', async () => {
    const reachable = { value: false }
    const { bridge, sync, local, backend } = setup(reachable)
    await sync.settings.patch({ sites: { 'a.test': 'paused' } })
    await sync.settings.patch({ sites: { 'b.test': 'never' } })
    expect(local.data[UNSYNCED_KEY]).toEqual({ sites: { 'a.test': 'paused', 'b.test': 'never' } })

    reachable.value = true
    await bridge.connect()
    await settle()
    await settle()
    expect((await backend.getSettings()).sites).toEqual({ 'a.test': 'paused', 'b.test': 'never' })
    expect(local.data[UNSYNCED_KEY]).toBeNull()
    expect(await sync.settings.get()).toMatchObject({ mode: 'gloss', sites: { 'b.test': 'never' } })
  })

  it('sends changes straight to the app while it’s connected', async () => {
    const { bridge, sync, backend, local } = setup()
    await bridge.connect()
    await settle()
    expect(await sync.settings.patch({ mode: 'ask' })).toMatchObject({ mode: 'ask' })
    expect((await backend.getSettings()).mode).toBe('ask')
    expect(local.data[UNSYNCED_KEY]).toBeUndefined()
  })

  it('connects in the background once and backs off after a failure', async () => {
    const reachable = { value: false }
    const { sync, session, connects, advance, bridge } = setup(reachable)
    sync.warm()
    await settle()
    expect(connects()).toBe(1)
    expect(session.data[RETRY_KEY]).toBe(1_000 + RETRY_MS)
    reachable.value = true
    sync.warm()
    await settle()
    expect(connects()).toBe(1)
    advance(RETRY_MS)
    sync.warm()
    await settle()
    await settle()
    expect(connects()).toBe(2)
    expect(bridge.connected).toBe(true)
  })

  it('tries to connect when the options page asks for the status', async () => {
    const { sync } = setup()
    expect(await sync.status(false)).toEqual({ state: 'idle', appVersion: null })
    expect(await sync.status(true)).toEqual({ state: 'connected', appVersion: '0.0.0-fake' })
  })

  it('merges queued patches field by field', () => {
    expect(
      mergePatches(
        { mode: 'ask', sites: { a: 'paused' }, languages: { primary: 'en' } },
        { sites: { a: null, b: 'never' }, languages: { comfortable: ['fr'] } }
      )
    ).toEqual({
      mode: 'ask',
      sites: { a: null, b: 'never' },
      languages: { primary: 'en', comfortable: ['fr'] }
    })
  })
})
