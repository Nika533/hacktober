import { describe, expect, it } from 'vitest'
import {
  DEFAULT_SETTINGS,
  textFingerprint,
  type ClipboardProbe,
  type StateSlices
} from '@hoot/core'
import { createClipboardWatcher, type ClipboardWatcher } from '../src/main/clipboardWatch'
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

const textProbe = (text: string): ClipboardProbe | null => {
  const fp = textFingerprint(text)
  return fp ? { fp, hint: { kind: 'text', chars: text.length } } : null
}

interface FakeClipboard {
  watcher: ClipboardWatcher
  setNext(t: string | null): void
}

const make = (store: Store, probeText: () => string | null, clipboard = ''): FakeClipboard => {
  let next = probeText()
  const probe = async (): Promise<ClipboardProbe | null> => {
    const p = next === null ? null : textProbe(next)
    next = probeText()
    return p
  }
  return {
    watcher: createClipboardWatcher({ store, log, probe, readText: async () => clipboard }),
    setNext: (t: string | null) => {
      next = t
    }
  }
}

const hint = (store: Store): StateSlices['chat']['clipboardHint'] => store.get('chat').clipboardHint

describe('createClipboardWatcher', () => {
  it('init swallows pre-existing clipboard content', async () => {
    const store = makeStore()
    const { watcher, setNext } = make(store, () => 'already there')
    await watcher.init()
    setNext('already there') // same content at summon
    await watcher.onSummon()
    expect(hint(store)).toBeNull()
  })

  it('changed text at summon shows a text hint with chars', async () => {
    const store = makeStore()
    const { watcher, setNext } = make(store, () => 'old')
    await watcher.init()
    setNext('hello 123')
    await watcher.onSummon()
    expect(hint(store)).toEqual({ kind: 'text', chars: 9 })
  })

  it('unchanged content across summons shows no hint', async () => {
    const store = makeStore()
    const { watcher, setNext } = make(store, () => 'same')
    await watcher.init()
    setNext('same')
    await watcher.onSummon()
    expect(hint(store)).toBeNull()
    await watcher.onSummon()
    expect(hint(store)).toBeNull()
  })

  it('settings.clipboardHint off → no hint even for new content', async () => {
    const store = makeStore()
    const settings = store.get('settings').settings
    store.update('settings', { settings: { ...settings, clipboardHint: false } })
    const { watcher, setNext } = make(store, () => 'old')
    await watcher.init()
    setNext('brand new text')
    await watcher.onSummon()
    expect(hint(store)).toBeNull()
  })

  it('arm marks the hint selected and take() returns the snapshot once', async () => {
    const store = makeStore()
    const { watcher, setNext } = make(store, () => 'old', 'the copied text')
    await watcher.init()
    setNext('the copied text')
    await watcher.onSummon()
    await watcher.arm()
    expect(hint(store)).toEqual({ kind: 'text', chars: 15, selected: true })
    expect(watcher.take()).toBe('the copied text')
    expect(hint(store)).toBeNull()
    expect(watcher.take()).toBeNull()
  })

  it('dismiss clears hint and selection', async () => {
    const store = makeStore()
    const { watcher, setNext } = make(store, () => 'old', 'text')
    await watcher.init()
    setNext('text')
    await watcher.onSummon()
    await watcher.arm()
    watcher.dismiss()
    expect(hint(store)).toBeNull()
    expect(watcher.take()).toBeNull()
  })

  it('an emptied clipboard still updates the fingerprint for next time', async () => {
    const store = makeStore()
    const { watcher, setNext } = make(store, () => 'old')
    await watcher.init()
    setNext(null)
    await watcher.onSummon()
    expect(hint(store)).toBeNull()
    setNext('fresh content')
    await watcher.onSummon()
    expect(hint(store)).toEqual({ kind: 'text', chars: 13 })
  })
})
