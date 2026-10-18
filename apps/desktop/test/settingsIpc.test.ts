import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, type StateSlices } from '@hoot/core'
import { applySettingsUpdate, makeValidator, setApiKeyFlow } from '../src/main/ipc/settings'
import { createStore, initialSlices } from '../src/main/store/store'
import type { SecretStore } from '../src/main/secrets'

const system: StateSlices['system'] = {
  platform: 'win32',
  version: '1.0.0',
  packaged: false,
  accentColor: '#CA5010',
  darkMode: false,
  highContrast: false
}

const makeStore = (): ReturnType<typeof createStore> =>
  createStore(
    initialSlices({
      settings: DEFAULT_SETTINGS,
      hasApiKey: false,
      keyStorage: 'os-encrypted',
      system
    })
  )

const fakeSecrets = (
  storage: 'os-encrypted' | 'memory' = 'os-encrypted'
): SecretStore & {
  stored: string | null
} => {
  let stored: string | null = null
  return {
    get stored() {
      return stored
    },
    async load(): Promise<void> {
      await Promise.resolve()
    },
    get: () => stored,
    async set(k) {
      stored = k
      return storage
    },
    async clear() {
      stored = null
    },
    storage,
    source: 'none'
  }
}

describe('setApiKeyFlow', () => {
  it('rejected key → { ok:false, rejected }, nothing stored', async () => {
    const store = makeStore()
    const secrets = fakeSecrets()
    const r = await setApiKeyFlow({ store, secrets, validate: async () => false }, 'bad')
    expect(r).toEqual({ ok: false, reason: 'rejected' })
    expect(secrets.stored).toBeNull()
    expect(store.get('settings').hasApiKey).toBe(false)
  })

  it('valid key → stored, slice updated', async () => {
    const store = makeStore()
    const secrets = fakeSecrets('os-encrypted')
    const r = await setApiKeyFlow({ store, secrets, validate: async () => true }, 'sk-good')
    expect(r).toEqual({ ok: true })
    expect(secrets.stored).toBe('sk-good')
    expect(store.get('settings').hasApiKey).toBe(true)
    expect(store.get('settings').keyStorage).toBe('os-encrypted')
  })

  it('memory storage propagates to the slice', async () => {
    const store = makeStore()
    const secrets = fakeSecrets('memory')
    await setApiKeyFlow({ store, secrets, validate: async () => true }, 'sk-good')
    expect(store.get('settings').keyStorage).toBe('memory')
  })

  it('network/busy provider errors → unreachable', async () => {
    const store = makeStore()
    const secrets = fakeSecrets()
    const network = Object.assign(new TypeError('fetch failed'), {})
    const r = await setApiKeyFlow(
      { store, secrets, validate: async () => Promise.reject(network) },
      'k'
    )
    expect(r).toEqual({ ok: false, reason: 'unreachable' })
  })

  it('other provider errors → rejected', async () => {
    const store = makeStore()
    const secrets = fakeSecrets()
    const r = await setApiKeyFlow(
      { store, secrets, validate: async () => Promise.reject(new Error('bogus')) },
      'k'
    )
    expect(r).toEqual({ ok: false, reason: 'rejected' })
  })
})

describe('makeValidator (fakeAi)', () => {
  it('accepts fake-* or long keys, rejects short ones', async () => {
    const v = makeValidator({ fakeAi: true })
    expect(await v('fake-1')).toBe(true)
    expect(await v('12345678')).toBe(true)
    expect(await v('short')).toBe(false)
  })
})

describe('applySettingsUpdate', () => {
  it('applies the patch into the slice', () => {
    const store = makeStore()
    applySettingsUpdate({ store }, { translateTo: 'Deutsch', collapseToDotAfterMs: 10_000 })
    expect(store.get('settings').settings.translateTo).toBe('Deutsch')
    expect(store.get('settings').settings.collapseToDotAfterMs).toBe(10_000)
  })

  it('rejects unknown patch keys at the schema level (no-op here)', () => {
    const store = makeStore()
    applySettingsUpdate({ store }, {})
    expect(store.get('settings').settings).toEqual(DEFAULT_SETTINGS)
  })

  it('launchAtLogin change calls setLoginItem; unchanged does not', () => {
    const store = makeStore()
    const calls: boolean[] = []
    const deps = { store, setLoginItem: (on: boolean) => calls.push(on) }
    applySettingsUpdate(deps, { launchAtLogin: true })
    applySettingsUpdate(deps, { translateTo: 'Deutsch' }) // no launchAtLogin
    applySettingsUpdate(deps, { launchAtLogin: true }) // unchanged
    applySettingsUpdate(deps, { launchAtLogin: false })
    expect(calls).toEqual([true, false])
  })
})
