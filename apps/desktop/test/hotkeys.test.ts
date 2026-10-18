import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, type StateSlices } from '@hoot/core'
import { createHotkeys, type HotkeyTimers, type ShortcutApi } from '../src/main/hotkeys'
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

const log = { info: () => {}, warn: () => {}, error: () => {} }

const fakeShortcuts = (
  fail: string[] = []
): ShortcutApi & {
  registered: Map<string, () => void>
} => {
  const registered = new Map<string, () => void>()
  return {
    registered,
    register: (acc, cb) => {
      if (fail.includes(acc) || registered.has(acc)) return false
      registered.set(acc, cb)
      return true
    },
    unregister: (acc) => {
      registered.delete(acc)
    }
  }
}

const fakeTimers = (): HotkeyTimers & { fire(): void; pending(): number } => {
  const queue: { fn: () => void }[] = []
  return {
    setTimeout: (fn) => {
      const h = { fn }
      queue.push(h)
      return h
    },
    clearTimeout: (h) => {
      const i = queue.indexOf(h as { fn: () => void })
      if (i >= 0) queue.splice(i, 1)
    },
    pending: () => queue.length,
    fire: () => {
      for (const h of queue.splice(0)) h.fn()
    }
  }
}

const flush = async (): Promise<void> => {
  await new Promise((r) => setTimeout(r, 0))
}

const SUMMON = DEFAULT_SETTINGS.summonHotkey
const CAPTURE = DEFAULT_SETTINGS.captureHotkey

describe('createHotkeys', () => {
  it('registers both accelerators and reports no errors', () => {
    const store = makeStore()
    const shortcuts = fakeShortcuts()
    const hk = createHotkeys({
      store,
      log,
      enabled: true,
      onSummon: () => {},
      onCapture: () => {},
      shortcuts
    })
    hk.apply()
    expect([...shortcuts.registered.keys()].sort()).toEqual([CAPTURE, SUMMON].sort())
    expect(store.get('settings').hotkeyErrors).toEqual([])
  })

  it('reports a structured HotkeyError when a registration fails', () => {
    const store = makeStore()
    const shortcuts = fakeShortcuts([SUMMON])
    createHotkeys({
      store,
      log,
      enabled: true,
      onSummon: () => {},
      onCapture: () => {},
      shortcuts
    }).apply()
    expect(store.get('settings').hotkeyErrors).toEqual([
      {
        which: 'summonHotkey',
        accelerator: SUMMON,
        message: `"${SUMMON}" is already taken by another app`
      }
    ])
    expect(shortcuts.registered.has(CAPTURE)).toBe(true)
  })

  it('re-applies when the accelerators change in settings', async () => {
    const store = makeStore()
    const shortcuts = fakeShortcuts()
    const hk = createHotkeys({
      store,
      log,
      enabled: true,
      onSummon: () => {},
      onCapture: () => {},
      shortcuts
    })
    hk.apply()
    const settings = store.get('settings').settings
    store.update('settings', { settings: { ...settings, summonHotkey: 'Ctrl+Shift+H' } })
    await flush()
    expect(shortcuts.registered.has(SUMMON)).toBe(false)
    expect(shortcuts.registered.has('Ctrl+Shift+H')).toBe(true)
  })

  it('suspend(true) unregisters, the 60 s timer resumes', () => {
    const store = makeStore()
    const shortcuts = fakeShortcuts()
    const timers = fakeTimers()
    const hk = createHotkeys({
      store,
      log,
      enabled: true,
      onSummon: () => {},
      onCapture: () => {},
      shortcuts,
      timers
    })
    hk.apply()
    hk.suspend(true, 7)
    expect(shortcuts.registered.size).toBe(0)
    expect(timers.pending()).toBe(1)
    timers.fire() // 60 s elapsed
    expect(shortcuts.registered.size).toBe(2)
  })

  it('suspend(false) resumes immediately', () => {
    const store = makeStore()
    const shortcuts = fakeShortcuts()
    const hk = createHotkeys({
      store,
      log,
      enabled: true,
      onSummon: () => {},
      onCapture: () => {},
      shortcuts
    })
    hk.apply()
    hk.suspend(true, 7)
    expect(shortcuts.registered.size).toBe(0)
    hk.suspend(false)
    expect(shortcuts.registered.size).toBe(2)
  })

  it('settings changes during suspend apply on resume', () => {
    const store = makeStore()
    const shortcuts = fakeShortcuts()
    const timers = fakeTimers()
    const hk = createHotkeys({
      store,
      log,
      enabled: true,
      onSummon: () => {},
      onCapture: () => {},
      shortcuts,
      timers
    })
    hk.apply()
    hk.suspend(true, 7)
    const settings = store.get('settings').settings
    store.update('settings', { settings: { ...settings, summonHotkey: 'Ctrl+Shift+J' } })
    expect(shortcuts.registered.size).toBe(0)
    timers.fire()
    expect([...shortcuts.registered.keys()].sort()).toEqual(['Ctrl+Shift+J', CAPTURE].sort())
  })

  it('enabled:false registers nothing and reports no errors', () => {
    const store = makeStore()
    const shortcuts = fakeShortcuts()
    createHotkeys({
      store,
      log,
      enabled: false,
      onSummon: () => {},
      onCapture: () => {},
      shortcuts
    }).apply()
    expect(shortcuts.registered.size).toBe(0)
    expect(store.get('settings').hotkeyErrors).toEqual([])
  })

  it('dispose unregisters everything and stops watching', async () => {
    const store = makeStore()
    const shortcuts = fakeShortcuts()
    const hk = createHotkeys({
      store,
      log,
      enabled: true,
      onSummon: () => {},
      onCapture: () => {},
      shortcuts
    })
    hk.apply()
    hk.dispose()
    expect(shortcuts.registered.size).toBe(0)
    const settings = store.get('settings').settings
    store.update('settings', { settings: { ...settings, summonHotkey: 'Ctrl+Shift+K' } })
    await flush()
    expect(shortcuts.registered.size).toBe(0)
  })
})
