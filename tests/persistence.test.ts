import { mkdtempSync, readdirSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DebouncedWriter, Persistence } from '../src/main/store/persistence'
import { DEFAULT_SETTINGS } from '../src/shared/types'

let dir: string
let store: Persistence

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'hoot-test-'))
  store = new Persistence(dir)
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('Persistence', () => {
  it('round-trips settings', async () => {
    const settings = { ...DEFAULT_SETTINGS, translateTo: 'German', collapseToDotAfterMs: 9999 }
    await store.saveSettings(settings)
    expect(await store.loadSettings()).toEqual(settings)
  })

  it('returns defaults when no settings file exists', async () => {
    expect(await store.loadSettings()).toEqual(DEFAULT_SETTINGS)
  })

  it('replaces a pre-Gemini model id with the default model', async () => {
    const legacy = { ...DEFAULT_SETTINGS, model: 'claude-sonnet-5-5', translateTo: 'German' }
    await store.writeJson('settings.json', legacy)
    expect(await store.loadSettings()).toEqual({ ...DEFAULT_SETTINGS, translateTo: 'German' })
  })

  it('round-trips the session index and session files', async () => {
    const session = {
      id: 's1',
      title: 'Test',
      createdAt: 1,
      updatedAt: 2,
      messages: [
        {
          id: 'm1',
          role: 'user' as const,
          text: 'hi',
          attachmentIds: [],
          createdAt: 1,
          status: 'done' as const
        }
      ],
      attachments: {}
    }
    await store.saveSession(session)
    await store.saveSessionIndex({
      activeId: 's1',
      sessions: [{ id: 's1', title: 'Test', createdAt: 1, updatedAt: 2, messageCount: 1 }]
    })
    expect(await store.loadSession('s1')).toEqual(session)
    expect((await store.loadSessionIndex()).activeId).toBe('s1')
  })

  it('writes atomically — no leftover .tmp files', async () => {
    await store.writeJson('settings.json', { a: 1 })
    const files = readdirSync(dir)
    expect(files).toContain('settings.json')
    expect(files.filter((f) => f.includes('.tmp'))).toHaveLength(0)
  })

  it('creates subdirectories as needed', async () => {
    await store.writeJson(path.join('sessions', 'abc.json'), { ok: true })
    expect(await store.readJson(path.join('sessions', 'abc.json'))).toEqual({ ok: true })
  })
})

describe('DebouncedWriter', () => {
  it('coalesces rapid writes and flush forces pending ones', async () => {
    const writer = new DebouncedWriter(50)
    let n = 0
    writer.schedule('k', async () => {
      n++
    })
    writer.schedule('k', async () => {
      n += 10
    })
    await writer.flush()
    expect(n).toBe(10)
  })
})
