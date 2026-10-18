import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, type SliceName, type StateSlices } from '@hoot/core'
import { createStore, initialSlices, type Store } from '../src/main/store/store'

const system: StateSlices['system'] = {
  platform: 'win32',
  version: '1.0.0',
  packaged: false,
  accentColor: '#CA5010',
  darkMode: false,
  highContrast: false
}

const makeStore = (): Store => createStore(initialSlices({ settings: DEFAULT_SETTINGS, system }))

const flush = async (): Promise<void> => {
  await new Promise((r) => setTimeout(r, 0))
}

describe('initialSlices', () => {
  it('defaults every slice', () => {
    const s = initialSlices({ settings: DEFAULT_SETTINGS, system })
    expect(s.settings).toEqual({
      settings: DEFAULT_SETTINGS,
      hasApiKey: false,
      keyStorage: 'os-encrypted',
      hotkeyErrors: []
    })
    expect(s.system).toEqual(system)
    expect(s.buddy).toEqual({
      mode: 'hidden',
      layout: null,
      mood: 'idle',
      greeting: null,
      answerReady: false
    })
    expect(s.studio).toEqual({ open: false, view: 'chat', onboardingStep: 0 })
    expect(s.chat).toEqual({
      session: null,
      stream: null,
      pendingAttachments: [],
      clipboardHint: null
    })
    expect(s.sessions).toEqual({ list: [], pendingDelete: null })
    expect(s.pins).toEqual({ pins: [] })
    expect(s.lens).toEqual({ bridge: 'stopped', clients: 0, lastError: null })
  })
})

describe('store', () => {
  it('set replaces, update merges', () => {
    const store = makeStore()
    store.set('buddy', { ...store.get('buddy'), mode: 'pill' })
    expect(store.get('buddy').mode).toBe('pill')
    store.update('buddy', { mood: 'thinking' })
    expect(store.get('buddy')).toMatchObject({ mode: 'pill', mood: 'thinking' })
  })

  it('set with an identical reference records no change', async () => {
    const store = makeStore()
    const calls: string[][] = []
    store.onChange((changed) => calls.push([...changed]))
    store.set('buddy', store.get('buddy'))
    await flush()
    expect(calls).toEqual([])
  })

  it('coalesces changes in one tick into a single flush', async () => {
    const store = makeStore()
    const calls: string[][] = []
    store.onChange((changed) => calls.push([...changed]))
    store.update('buddy', { mood: 'thinking' })
    store.update('buddy', { greeting: null })
    store.update('pins', { pins: [] })
    await flush()
    expect(calls.length).toBe(1)
    expect(new Set(calls[0])).toEqual(new Set(['buddy', 'pins']))
  })

  it('snapshot returns the requested slices', () => {
    const store = makeStore()
    const patch = store.snapshot(['buddy', 'system'])
    expect(Object.keys(patch).sort()).toEqual(['buddy', 'system'])
    expect(patch.buddy).toBe(store.get('buddy'))
    expect(patch.system).toBe(store.get('system'))
  })

  it('unsubscribed listeners stop receiving flushes', async () => {
    const store = makeStore()
    const calls: ReadonlySet<SliceName>[] = []
    const off = store.onChange((c) => calls.push(c))
    off()
    store.update('buddy', { mood: 'error' })
    await flush()
    expect(calls).toEqual([])
  })
})
