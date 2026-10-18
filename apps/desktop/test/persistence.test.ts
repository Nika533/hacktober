import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, type Pin, type Session, type SessionMeta } from '@hoot/core'
import { DEFAULT_CHAT_MODEL } from '@hoot/core'
import type { Logger } from '../src/main/log'
import {
  createPersistence,
  migrateSession,
  PersistenceError,
  type Persistence,
  type UiStateStore
} from '../src/main/store/persistence'

const silent: Logger = { info: () => {}, warn: () => {}, error: () => {} }

let root: string
let history = true
let errors: PersistenceError[]
let p: Persistence & UiStateStore

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'hoot-persist-'))
  history = true
  errors = []
  p = createPersistence({
    root,
    log: silent,
    historyEnabled: () => history,
    onError: (e) => errors.push(e)
  })
  await p.ensureDirs()
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

const sessionMeta = (id: string): SessionMeta => ({
  id,
  title: `Session ${id}`,
  createdAt: 1,
  updatedAt: 2,
  messageCount: 1
})

const session = (id: string): Session => ({
  id,
  title: `Session ${id}`,
  createdAt: 1,
  updatedAt: 2,
  messages: [
    {
      id: 'm1',
      role: 'user',
      text: 'hi',
      attachmentIds: [],
      createdAt: 1,
      status: 'done'
    }
  ],
  attachments: {}
})

const pin = (id: string): Pin => ({
  id,
  text: 'note',
  sessionId: null,
  messageId: null,
  bounds: { x: 1, y: 2, width: 300, height: 200 },
  createdAt: 1
})

describe('settings', () => {
  it('missing file → DEFAULT_SETTINGS', async () => {
    expect(await p.loadSettings()).toEqual(DEFAULT_SETTINGS)
  })

  it('legacy v1: Claude model falls back to default, other fields kept', async () => {
    await writeFile(
      join(root, 'settings.json'),
      JSON.stringify({
        model: 'claude-sonnet-5-5',
        summonHotkey: 'CommandOrControl+Shift+Space',
        onboardingDone: true,
        collapseToDotAfterMs: 10_000
      })
    )
    const s = await p.loadSettings()
    expect(s.model).toBe(DEFAULT_CHAT_MODEL)
    expect(s.summonHotkey).toBe('CommandOrControl+Shift+Space')
    expect(s.onboardingDone).toBe(true)
    expect(s.collapseToDotAfterMs).toBe(10_000)
  })

  it('corrupt JSON → backed up + defaults', async () => {
    await writeFile(join(root, 'settings.json'), '{not json')
    const s = await p.loadSettings()
    expect(s).toEqual(DEFAULT_SETTINGS)
    const backups = (await readdir(root)).filter((f) => f.startsWith('settings.corrupt-'))
    expect(backups.length).toBe(1)
  })

  it('saveSettings writes a round-trippable file', async () => {
    const s = { ...DEFAULT_SETTINGS, translateTo: 'Deutsch' }
    await p.saveSettings(s)
    expect(await p.loadSettings()).toEqual(s)
  })
})

describe('session index', () => {
  it('missing → empty index', async () => {
    expect(await p.loadSessionIndex()).toEqual({ activeId: null, sessions: [] })
  })

  it('drops invalid entries, keeps valid ones', async () => {
    await writeFile(
      join(root, 'sessions/index.json'),
      JSON.stringify({
        activeId: 's1',
        sessions: [sessionMeta('s1'), { bogus: true }, sessionMeta('s2')]
      })
    )
    const idx = await p.loadSessionIndex()
    expect(idx.activeId).toBe('s1')
    expect(idx.sessions.map((s) => s.id)).toEqual(['s1', 's2'])
  })

  it('corrupt index → backup + empty', async () => {
    await writeFile(join(root, 'sessions/index.json'), 'not json')
    expect(await p.loadSessionIndex()).toEqual({ activeId: null, sessions: [] })
    const backups = (await readdir(join(root, 'sessions'))).filter((f) =>
      f.startsWith('index.corrupt-')
    )
    expect(backups.length).toBe(1)
  })

  it('saveHistory=false → saveSessionIndex writes nothing', async () => {
    history = false
    await p.saveSessionIndex({ activeId: 's1', sessions: [sessionMeta('s1')] })
    await expect(readFile(join(root, 'sessions/index.json'), 'utf8')).rejects.toThrow()
  })
})

describe('sessions', () => {
  it('save + load round-trip', async () => {
    const s = session('abc123')
    await p.saveSession(s)
    expect(await p.loadSession('abc123')).toEqual(s)
  })

  it('missing → null', async () => {
    expect(await p.loadSession('zzz')).toBeNull()
  })

  it('rejects path-unsafe ids', async () => {
    await expect(p.loadSession('../evil')).rejects.toThrow(PersistenceError)
    await expect(p.loadSession('../evil')).rejects.toMatchObject({ kind: 'invalid-id' })
  })

  it('corrupt session → backup + null', async () => {
    await writeFile(join(root, 'sessions/bad.json'), '{oops')
    expect(await p.loadSession('bad')).toBeNull()
    const backups = (await readdir(join(root, 'sessions'))).filter((f) =>
      f.startsWith('bad.corrupt-')
    )
    expect(backups.length).toBe(1)
  })

  it('schema-invalid session → backup + null', async () => {
    await writeFile(join(root, 'sessions/bad.json'), JSON.stringify({ id: 'bad' }))
    expect(await p.loadSession('bad')).toBeNull()
  })

  it('legacy session migrates: error "429" → rate_limited, streaming → stopped, path dropped', async () => {
    const legacy = {
      id: 'old1',
      title: 'Legacy',
      createdAt: 1,
      updatedAt: 2,
      messages: [
        {
          id: 'm1',
          role: 'assistant',
          text: 'partial',
          attachmentIds: [],
          createdAt: 1,
          status: 'streaming',
          error: '429'
        }
      ],
      attachments: {
        a1: {
          id: 'a1',
          kind: 'capture',
          thumbDataUrl: 'data:image/png;base64,AAAA',
          width: 10,
          height: 10,
          createdAt: 1,
          path: 'C:\\legacy\\a1.png'
        }
      }
    }
    await writeFile(join(root, 'sessions/old1.json'), JSON.stringify(legacy))
    const s = await p.loadSession('old1')
    expect(s).not.toBeNull()
    expect(s?.messages[0]?.status).toBe('stopped')
    expect(s?.messages[0]?.error).toBe('rate_limited')
    expect(s?.attachments['a1']).not.toHaveProperty('path')
    expect(s?.attachments['a1']?.id).toBe('a1')
  })

  it('saveHistory=false → saveSession writes nothing', async () => {
    history = false
    await p.saveSession(session('nope'))
    await expect(readFile(join(root, 'sessions/nope.json'), 'utf8')).rejects.toThrow()
  })

  it('deleteSession removes the file', async () => {
    await p.saveSession(session('gone'))
    await p.deleteSession('gone')
    expect(await p.loadSession('gone')).toBeNull()
  })

  it('clearSessions removes session files + writes empty index even when history off', async () => {
    await p.saveSession(session('one'))
    await p.saveSessionIndex({ activeId: 'one', sessions: [sessionMeta('one')] })
    history = false
    await p.clearSessions()
    expect(await readdir(join(root, 'sessions'))).toEqual(['index.json'])
    expect(await p.loadSessionIndex()).toEqual({ activeId: null, sessions: [] })
  })
})

describe('migrateSession (pure)', () => {
  it('maps legacy error codes', () => {
    const out = migrateSession({
      messages: [
        { id: 'm', error: '401', status: 'error' },
        { id: 'n', error: '529', status: 'error' },
        { id: 'o', status: 'done' }
      ]
    }) as { messages: Record<string, unknown>[] }
    expect(out.messages[0]?.['error']).toBe('auth')
    expect(out.messages[1]?.['error']).toBe('busy')
    expect(out.messages[2]).not.toHaveProperty('error')
  })

  it('leaves non-objects alone', () => {
    expect(migrateSession(42)).toBe(42)
    expect(migrateSession('x')).toBe('x')
  })
})

describe('pins', () => {
  it('missing → []', async () => {
    expect(await p.loadPins()).toEqual([])
  })

  it('drops invalid entries', async () => {
    await writeFile(join(root, 'pins.json'), JSON.stringify([pin('p1'), { nope: 1 }]))
    expect((await p.loadPins()).map((x) => x.id)).toEqual(['p1'])
  })

  it('save + load round-trip', async () => {
    await p.savePins([pin('p1'), pin('p2')])
    expect((await p.loadPins()).length).toBe(2)
  })
})

describe('attachments', () => {
  it('round-trips png bytes', async () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47])
    await p.saveAttachment('att1', png)
    expect(new Uint8Array((await p.readAttachment('att1')) ?? [])).toEqual(png)
    await p.deleteAttachment('att1')
    expect(await p.readAttachment('att1')).toBeNull()
  })

  it('rejects unsafe ids', () => {
    expect(() => p.attachmentPath('../x')).toThrow(PersistenceError)
    expect(p.attachmentPath('ok_1')).toContain('attachments')
  })
})

describe('ui-state', () => {
  it('missing file -> step 0', async () => {
    expect(await p.loadUiState()).toEqual({ onboardingStep: 0 })
  })

  it('save + load round-trip', async () => {
    await p.saveUiState({ onboardingStep: 2 })
    expect(await p.loadUiState()).toEqual({ onboardingStep: 2 })
  })

  it('corrupt JSON -> backup + 0', async () => {
    await writeFile(join(root, 'ui-state.json'), '{nope')
    expect(await p.loadUiState()).toEqual({ onboardingStep: 0 })
    const backups = (await readdir(root)).filter((f) => f.startsWith('ui-state.corrupt-'))
    expect(backups.length).toBe(1)
  })

  it('out-of-range step -> backup + 0', async () => {
    await writeFile(join(root, 'ui-state.json'), JSON.stringify({ onboardingStep: 99 }))
    expect(await p.loadUiState()).toEqual({ onboardingStep: 0 })
    const backups = (await readdir(root)).filter((f) => f.startsWith('ui-state.corrupt-'))
    expect(backups.length).toBe(1)
  })
})
