import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, type LensSettings, type StateSlices } from '@hoot/core'
import { watchLensSettings } from '../src/main/store/lensWatch'
import { createStore, initialSlices, type Store } from '../src/main/store/store'

const system: StateSlices['system'] = {
  platform: 'win32',
  version: '1.0.0',
  packaged: false,
  accentColor: '#CA5010',
  darkMode: false,
  highContrast: false
}

const makeStore = (): Store =>
  createStore(
    initialSlices({
      settings: DEFAULT_SETTINGS,
      hasApiKey: false,
      keyStorage: 'os-encrypted',
      system
    })
  )

const flush = async (): Promise<void> => {
  await new Promise((r) => setTimeout(r, 0))
}

describe('watchLensSettings', () => {
  it('pushes when the settings.lens object is replaced', async () => {
    const store = makeStore()
    const pushes: LensSettings[] = []
    const unwatch = watchLensSettings(store, { pushSettings: (l) => pushes.push(l) })

    const settings = store.get('settings').settings
    store.update('settings', {
      settings: { ...settings, lens: { ...settings.lens, mode: 'ask' } }
    })
    await flush()
    expect(pushes).toHaveLength(1)
    expect(pushes[0]?.mode).toBe('ask')
    unwatch()
  })

  it('does not push on unrelated settings changes or other slices', async () => {
    const store = makeStore()
    const pushes: LensSettings[] = []
    watchLensSettings(store, { pushSettings: (l) => pushes.push(l) })

    const settings = store.get('settings').settings
    store.update('settings', { settings: { ...settings, translateTo: 'Deutsch' } })
    store.update('buddy', { mood: 'thinking' })
    await flush()
    expect(pushes).toHaveLength(0)
  })

  it('stops after unsubscribe', async () => {
    const store = makeStore()
    const pushes: LensSettings[] = []
    const unwatch = watchLensSettings(store, { pushSettings: (l) => pushes.push(l) })
    unwatch()
    const settings = store.get('settings').settings
    store.update('settings', {
      settings: { ...settings, lens: { ...settings.lens, mode: 'ask' } }
    })
    await flush()
    expect(pushes).toHaveLength(0)
  })
})
