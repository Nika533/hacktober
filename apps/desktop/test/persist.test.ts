import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, type Session, type StateSlices } from '@hoot/core'
import { watchPersistence } from '../src/main/store/persist'
import type { Persistence } from '../src/main/store/persistence'
import { createStore, initialSlices } from '../src/main/store/store'
import { createDebouncedWriter } from '../src/main/store/writer'

const system: StateSlices['system'] = {
  platform: 'win32',
  version: '1.0.0',
  packaged: false,
  accentColor: '#CA5010',
  darkMode: false,
  highContrast: false
}

const setup = (): {
  store: ReturnType<typeof createStore>
  persistence: Persistence
  writer: ReturnType<typeof createDebouncedWriter>
  calls: string[]
} => {
  const store = createStore(
    initialSlices({
      settings: DEFAULT_SETTINGS,
      hasApiKey: false,
      keyStorage: 'os-encrypted',
      system
    })
  )
  const calls: string[] = []
  // Fake persistence: records which method ran.
  const persistence = {
    saveSettings: async () => {
      calls.push('settings')
    },
    savePins: async () => {
      calls.push('pins')
    },
    saveSessionIndex: async (i: { activeId: string | null }) => {
      calls.push(`index:${i.activeId ?? 'null'}`)
    }
  } as unknown as Persistence
  const writer = createDebouncedWriter({ delayMs: 300, onError: () => {} })
  return { store, persistence, writer, calls }
}

const flushMicrotask = async (): Promise<void> => {
  await new Promise((r) => setTimeout(r, 0))
}

describe('watchPersistence', () => {
  it('settings change schedules the settings write with current state', async () => {
    const s = setup()
    watchPersistence(s.store, s.persistence, s.writer)
    s.store.update('settings', { hasApiKey: true })
    await flushMicrotask()
    expect(s.writer.pending()).toBe(1)
    await s.writer.flush()
    expect(s.calls).toEqual(['settings'])
  })

  it('pins change schedules the pins write', async () => {
    const s = setup()
    watchPersistence(s.store, s.persistence, s.writer)
    s.store.set('pins', { pins: [] })
    await flushMicrotask()
    await s.writer.flush()
    expect(s.calls).toEqual(['pins'])
  })

  it('sessions change schedules the index write with the active session id', async () => {
    const s = setup()
    watchPersistence(s.store, s.persistence, s.writer)
    s.store.set('sessions', {
      list: [{ id: 'sess1', title: 'T', createdAt: 1, updatedAt: 2, messageCount: 0 }],
      pendingDelete: null
    })
    s.store.update('chat', {
      session: {
        id: 'sess1',
        title: 'T',
        createdAt: 1,
        updatedAt: 2,
        messages: [],
        attachments: {}
      }
    })
    await flushMicrotask()
    await s.writer.flush()
    expect(s.calls).toEqual(['index:sess1'])
  })

  it('switching the active session alone re-writes the index', async () => {
    const s = setup()
    watchPersistence(s.store, s.persistence, s.writer)
    const session = (id: string): Session => ({
      id,
      title: 'T',
      createdAt: 1,
      updatedAt: 2,
      messages: [],
      attachments: {}
    })
    s.store.update('chat', { session: session('a') })
    await flushMicrotask()
    // Same session, other chat fields: no index write.
    s.store.update('chat', { pendingAttachments: [] })
    await flushMicrotask()
    s.store.update('chat', { session: session('b') })
    await flushMicrotask()
    await s.writer.flush()
    expect(s.calls).toEqual(['index:b'])
  })

  it('unrelated slices schedule nothing', async () => {
    const s = setup()
    watchPersistence(s.store, s.persistence, s.writer)
    s.store.update('buddy', { mood: 'thinking' })
    s.store.update('system', { darkMode: true })
    await flushMicrotask()
    expect(s.writer.pending()).toBe(0)
  })
})
