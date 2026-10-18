import {
  DEFAULT_SETTINGS,
  type ChatDelta,
  type Pin,
  type Session,
  type StatePatch
} from '@hoot/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  AiError,
  createFakeProvider,
  type AiProvider,
  type ChatStreamRequest
} from '../../src/main/ai'
import { createChatHandlers, createChatService, type ChatActivity } from '../../src/main/chat'
import type { Logger } from '../../src/main/log'
import { createBroadcaster } from '../../src/main/store/broadcast'
import type { Persistence } from '../../src/main/store/persistence'
import { createStore, initialSlices } from '../../src/main/store/store'
import { createDebouncedWriter } from '../../src/main/store/writer'
import { HOOT_API_ROUTES } from '@hoot/core'

const noop = (): void => undefined
const silent: Logger = { info: noop, warn: noop, error: noop }

function memoryPersistence(): Persistence & {
  sessions: Map<string, Session>
  attachments: Map<string, Uint8Array>
  deleted: string[]
} {
  const sessions = new Map<string, Session>()
  const attachments = new Map<string, Uint8Array>()
  const deleted: string[] = []
  return {
    sessions,
    attachments,
    deleted,
    async ensureDirs() {
      return undefined
    },
    async loadSettings() {
      return DEFAULT_SETTINGS
    },
    async saveSettings() {
      return undefined
    },
    async loadSessionIndex() {
      return { activeId: null, sessions: [] }
    },
    async saveSessionIndex() {
      return undefined
    },
    async loadSession(id) {
      return sessions.get(id) ?? null
    },
    async saveSession(s) {
      sessions.set(s.id, structuredClone(s))
    },
    async deleteSession(id) {
      sessions.delete(id)
      deleted.push(id)
    },
    async clearSessions() {
      sessions.clear()
      attachments.clear()
    },
    async loadPins(): Promise<Pin[]> {
      return []
    },
    async savePins() {
      return undefined
    },
    attachmentPath: (id) => `/attachments/${id}.png`,
    async saveAttachment(id, png) {
      attachments.set(id, png)
    },
    async readAttachment(id) {
      return attachments.get(id) ?? null
    },
    async deleteAttachment(id) {
      attachments.delete(id)
    }
  }
}

/** A provider whose stream waits for `release()` between chunks. */
function gatedProvider(
  chunks: string[]
): AiProvider & { release(): void; requests: ChatStreamRequest[] } {
  const waiters: (() => void)[] = []
  const requests: ChatStreamRequest[] = []
  const base = createFakeProvider()
  return {
    ...base,
    requests,
    release: () => waiters.splice(0).forEach((w) => w()),
    async stream(req, onText) {
      requests.push(req)
      for (const chunk of chunks) {
        await new Promise<void>((resolve) => {
          waiters.push(resolve)
          req.signal.addEventListener('abort', () => resolve(), { once: true })
        })
        if (req.signal.aborted) return { stopReason: 'aborted' }
        onText(chunk)
      }
      return { stopReason: 'STOP' }
    }
  }
}

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0))

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type -- test fixture bag
function setup(opts: { provider?: AiProvider | null; clipboard?: string | null } = {}) {
  const store = createStore(
    initialSlices({
      settings: DEFAULT_SETTINGS,
      hasApiKey: true,
      keyStorage: 'os-encrypted',
      system: {
        platform: 'win32',
        version: '1.0.0',
        packaged: false,
        accentColor: '#0078D4',
        darkMode: false,
        highContrast: false
      }
    })
  )
  const broadcaster = createBroadcaster(store)
  const sent: { channel: string; payload: unknown }[] = []
  broadcaster.subscribe(
    { id: 1, send: (channel, payload) => sent.push({ channel, payload }), onDestroyed: () => {} },
    ['chat', 'sessions']
  )
  const persistence = memoryPersistence()
  const writer = createDebouncedWriter({
    onError: (e) => {
      throw e
    }
  })
  const activity: ChatActivity[] = []
  let clipboard = opts.clipboard ?? null
  let n = 0
  const chat = createChatService({
    store,
    broadcaster,
    persistence,
    writer,
    getProvider: async () =>
      opts.provider === undefined ? createFakeProvider({ chunkMs: 0 }) : opts.provider,
    log: silent,
    takeClipboardSelection: () => {
      const c = clipboard
      clipboard = null
      return c
    },
    onActivity: (a) => activity.push(a),
    newId: () => `id-${++n}`,
    deleteUndoMs: 50,
    checkpointMs: 0
  })
  const setClipboard = (text: string | null): void => {
    clipboard = text
  }
  return { store, chat, persistence, writer, sent, activity, setClipboard }
}

async function settled(store: ReturnType<typeof setup>['store']): Promise<void> {
  for (let i = 0; i < 200 && store.get('chat').stream; i++)
    await new Promise((r) => setTimeout(r, 5))
  await tick()
}

afterEach(() => vi.useRealTimers())

describe('chat service: sending', () => {
  it('streams an answer into a new session, deltas before the patches that contain them', async () => {
    const { store, chat, sent, activity, writer, persistence } = setup()
    await chat.send({ text: 'hello there' })
    await settled(store)

    const session = store.get('chat').session
    expect(session?.title).toBe('hello there')
    expect(session?.messages.map((m) => [m.role, m.status])).toEqual([
      ['user', 'done'],
      ['assistant', 'done']
    ])
    expect(session?.messages[1]?.text).toContain('your message: "hello there"')
    expect(store.get('sessions').list.map((m) => m.id)).toEqual([session?.id])
    expect(activity).toEqual(['thinking', 'talking', 'done'])

    // The invariant: every patch's assistant text is the sum of deltas sent before it.
    let deltas = ''
    for (const { channel, payload } of sent) {
      if (channel === 'chat:delta') deltas += (payload as ChatDelta).delta
      if (channel === 'state:patch') {
        const text = (payload as StatePatch).chat?.session?.messages[1]?.text
        if (text !== undefined) expect(deltas.startsWith(text)).toBe(true)
      }
    }
    await writer.flush()
    expect(persistence.sessions.get(session?.id ?? '')?.messages[1]?.status).toBe('done')
  })

  it('stops immediately, even before the provider has answered', async () => {
    const provider = gatedProvider(['a', 'b'])
    const { store, chat, activity } = setup({ provider })
    await chat.send({ text: 'q' })
    await chat.stop()
    provider.release()
    await settled(store)
    expect(store.get('chat').session?.messages[1]?.status).toBe('stopped')
    expect(activity.at(-1)).toBe('stopped')
  })

  it('keeps the partial answer when stopped mid-stream', async () => {
    const provider = gatedProvider(['Hel', 'lo', ' world'])
    const { store, chat } = setup({ provider })
    await chat.send({ text: 'q' })
    await tick()
    provider.release()
    await tick()
    provider.release()
    await tick()
    await chat.stop()
    await settled(store)
    const answer = store.get('chat').session?.messages[1]
    expect(answer?.status).toBe('stopped')
    expect(answer?.text).toBe('Hello')
  })

  it('checkpoints partial text so a crash keeps it', async () => {
    const provider = gatedProvider(['part one', ' and two'])
    const { store, chat, writer, persistence } = setup({ provider })
    await chat.send({ text: 'q' })
    await tick()
    provider.release()
    await tick()
    await writer.flush()
    const saved = persistence.sessions.get(store.get('chat').session?.id ?? '')
    expect(saved?.messages[1]).toMatchObject({ status: 'streaming', text: 'part one' })
    provider.release()
    await settled(store)
  })

  it('answers "no key" without a provider, and maps provider errors', async () => {
    const keyless = setup({ provider: null })
    await keyless.chat.send({ text: 'q' })
    await settled(keyless.store)
    expect(keyless.store.get('chat').session?.messages[1]).toMatchObject({
      status: 'error',
      error: 'no_key'
    })

    const failing = createFakeProvider()
    failing.stream = async () => {
      throw new AiError('rate_limited', '429')
    }
    const limited = setup({ provider: failing })
    await limited.chat.send({ text: 'q' })
    await settled(limited.store)
    expect(limited.store.get('chat').session?.messages[1]?.error).toBe('rate_limited')
  })

  it('shows the quick action label and sends its prompt, plus armed clipboard text', async () => {
    const provider = gatedProvider(['ok'])
    const { store, chat } = setup({ provider, clipboard: 'copied words' })
    await chat.send({ quickAction: 'summarize' })
    const user = store.get('chat').session?.messages[0]
    expect(user?.text).toBe('Summarize')
    expect(user?.sentText).toContain('copied words')
    expect(user?.sentText).toContain('3 bullet points')
    provider.release()
    await settled(store)
  })

  it('ignores a second send while streaming', async () => {
    const provider = gatedProvider(['x'])
    const { store, chat } = setup({ provider })
    await chat.send({ text: 'one' })
    await chat.send({ text: 'two' })
    expect(store.get('chat').session?.messages).toHaveLength(2)
    provider.release()
    await settled(store)
  })

  it('a send ignored while streaming leaves the armed clipboard for the next one', async () => {
    const provider = gatedProvider(['x'])
    const { store, chat, setClipboard } = setup({ provider })
    await chat.send({ text: 'one' })
    setClipboard('armed words')
    await chat.send({ text: 'two' })
    expect(store.get('chat').session?.messages).toHaveLength(2)
    await tick()
    provider.release()
    await settled(store)

    await chat.send({ text: 'three' })
    expect(store.get('chat').session?.messages[2]?.sentText).toContain('armed words')
    await chat.stop()
    await settled(store)
  })

  it('regenerates the last answer from the last user turn', async () => {
    const { store, chat } = setup()
    await chat.send({ text: 'first' })
    await settled(store)
    const firstAnswer = store.get('chat').session?.messages[1]?.id
    await chat.regenerate()
    await settled(store)
    const messages = store.get('chat').session?.messages ?? []
    expect(messages).toHaveLength(2)
    expect(messages[1]?.id).not.toBe(firstAnswer)
    expect(messages[1]?.status).toBe('done')
  })

  it('"Explain more" stops a running answer and starts the explanation right away', async () => {
    const provider = gatedProvider(['a', 'b', 'c'])
    const { store, chat } = setup({ provider })
    await chat.send({ text: 'q' })
    await tick()
    await chat.startExplain({ text: 'Explain “API”', sentText: 'full context' })
    const messages = store.get('chat').session?.messages ?? []
    expect(messages.map((m) => [m.role, m.status])).toEqual([
      ['user', 'done'],
      ['assistant', 'stopped'],
      ['user', 'done'],
      ['assistant', 'streaming']
    ])
    expect(messages[2]).toMatchObject({ text: 'Explain “API”', sentText: 'full context' })
    for (let i = 0; i < 4; i++) {
      provider.release()
      await tick()
    }
    await settled(store)
    expect(store.get('chat').session?.messages).toHaveLength(4)
  })
})

describe('chat service: live screen (beforeSend)', () => {
  it('attaches what beforeSend adds and sends its note, hidden from the transcript', async () => {
    const t = setup()
    const chat = createChatService({
      store: t.store,
      broadcaster: createBroadcaster(t.store),
      persistence: t.persistence,
      writer: t.writer,
      getProvider: async () => createFakeProvider({ chunkMs: 0 }),
      log: silent,
      newId: (() => {
        let n = 100
        return () => `b-${++n}`
      })(),
      beforeSend: async () => {
        t.store.update('chat', {
          pendingAttachments: [
            {
              id: 'frame',
              kind: 'capture',
              thumbDataUrl: 'data:,',
              width: 1,
              height: 1,
              createdAt: 0
            }
          ]
        })
        return '[Live screen attached]'
      }
    })
    await chat.send({ text: 'where is save?' })
    const user = t.store.get('chat').session?.messages[0]
    expect(user).toMatchObject({ text: 'where is save?', attachmentIds: ['frame'] })
    expect(user?.sentText).toBe('where is save?\n\n[Live screen attached]')
    await settled(t.store)
  })

  it('a double send grabs one frame: the second is refused while the first prepares', async () => {
    const t = setup()
    let calls = 0
    let release = (): void => undefined
    const chat2 = createChatService({
      store: t.store,
      broadcaster: createBroadcaster(t.store),
      persistence: t.persistence,
      writer: t.writer,
      getProvider: async () => createFakeProvider({ chunkMs: 0 }),
      log: silent,
      beforeSend: () => {
        calls++
        return new Promise<null>((r) => {
          release = () => r(null)
        })
      }
    })
    const first = chat2.send({ text: 'explain' })
    await chat2.send({ text: 'explain' })
    release()
    await first
    expect(calls).toBe(1)
    await settled(t.store)
  })

  it('a new chat deletes the files of captures it drops unsent', async () => {
    const t = setup()
    await t.persistence.saveAttachment('drop-me', new Uint8Array([1]))
    t.store.update('chat', {
      pendingAttachments: [
        {
          id: 'drop-me',
          kind: 'capture',
          thumbDataUrl: 'data:,',
          width: 1,
          height: 1,
          createdAt: 0
        }
      ]
    })
    await t.chat.newChat()
    await new Promise((r) => setTimeout(r, 0))
    expect(await t.persistence.readAttachment('drop-me')).toBeNull()
  })

  it('skips beforeSend (no stray frame) while an answer is streaming', async () => {
    const provider = gatedProvider(['a'])
    const t = setup({ provider })
    await t.chat.send({ text: 'one' })
    let calls = 0
    const chat2 = createChatService({
      store: t.store,
      broadcaster: createBroadcaster(t.store),
      persistence: t.persistence,
      writer: t.writer,
      getProvider: async () => provider,
      log: silent,
      beforeSend: async () => {
        calls++
        return null
      }
    })
    await chat2.send({ text: 'first' })
    await chat2.send({ text: 'while streaming' })
    expect(calls).toBe(1)
    provider.release()
    await settled(t.store)
  })
})

describe('chat service: sessions', () => {
  it('deleting a session mid-stream aborts it and never brings it back', async () => {
    const provider = gatedProvider(['a', 'b'])
    const { store, chat, writer, persistence } = setup({ provider })
    await chat.send({ text: 'doomed' })
    const id = store.get('chat').session?.id ?? ''
    await tick()
    await chat.deleteSession(id)
    provider.release()
    await new Promise((r) => setTimeout(r, 80))
    await writer.flush()
    expect(store.get('sessions').list).toEqual([])
    expect(store.get('chat').session).toBeNull()
    expect(persistence.sessions.has(id)).toBe(false)
    expect(persistence.deleted).toContain(id)
  })

  it('deleting or clearing mid-stream settles the owl instead of leaving it thinking', async () => {
    const deleting = setup({ provider: gatedProvider(['a', 'b']) })
    await deleting.chat.send({ text: 'doomed' })
    await tick()
    await deleting.chat.deleteSession(deleting.store.get('chat').session?.id ?? '')
    await settled(deleting.store)
    expect(deleting.activity.at(-1)).toBe('stopped')

    const clearing = setup({ provider: gatedProvider(['a', 'b']) })
    await clearing.chat.send({ text: 'doomed' })
    await tick()
    await clearing.chat.clearAll()
    await settled(clearing.store)
    expect(clearing.activity.at(-1)).toBe('stopped')
  })

  it("deleting a chat that wasn't opened this run still deletes its captures", async () => {
    const { store, chat, persistence } = setup()
    const onDisk: Session = {
      id: 'old',
      title: 'Old chat',
      createdAt: 1,
      updatedAt: 1,
      messages: [
        {
          id: 'm1',
          role: 'user',
          text: 'what is this',
          attachmentIds: ['cap1'],
          createdAt: 1,
          status: 'done'
        }
      ],
      attachments: {
        cap1: {
          id: 'cap1',
          kind: 'capture',
          thumbDataUrl: 'data:image/png;base64,',
          width: 1,
          height: 1,
          createdAt: 1
        }
      }
    }
    persistence.sessions.set('old', onDisk)
    persistence.attachments.set('cap1', new Uint8Array([1]))
    store.update('sessions', {
      list: [{ id: 'old', title: 'Old chat', createdAt: 1, updatedAt: 1, messageCount: 1 }]
    })
    await chat.deleteSession('old')
    await new Promise((r) => setTimeout(r, 80))
    expect(persistence.deleted).toContain('old')
    expect(persistence.attachments.has('cap1')).toBe(false)
  })

  it('undo restores a deleted session within the window', async () => {
    const { store, chat, persistence } = setup()
    await chat.send({ text: 'keep me' })
    await settled(store)
    const id = store.get('chat').session?.id ?? ''
    await chat.deleteSession(id)
    expect(store.get('sessions').pendingDelete).toBe(id)
    await chat.undoDelete(id)
    await new Promise((r) => setTimeout(r, 80))
    expect(store.get('sessions').list.map((m) => m.id)).toEqual([id])
    expect(persistence.deleted).not.toContain(id)
  })

  it('switching away mid-stream lets the answer finish into its own session', async () => {
    const provider = gatedProvider(['answer'])
    const { store, chat, writer, persistence } = setup({ provider })
    await chat.send({ text: 'long question' })
    const id = store.get('chat').session?.id ?? ''
    await chat.newChat()
    await tick()
    provider.release()
    await settled(store)
    await writer.flush()
    expect(store.get('chat').session).toBeNull()
    expect(persistence.sessions.get(id)?.messages[1]).toMatchObject({
      status: 'done',
      text: 'answer'
    })
    await chat.openSession(id)
    expect(store.get('chat').session?.messages[1]?.text).toBe('answer')
  })

  it('renames, searches and clears', async () => {
    const { store, chat } = setup()
    await chat.send({ text: 'alpha' })
    await settled(store)
    const id = store.get('chat').session?.id ?? ''
    await chat.renameSession(id, '  Trip notes ')
    expect(store.get('sessions').list[0]?.title).toBe('Trip notes')
    expect((await chat.search('trip')).map((m) => m.id)).toEqual([id])
    expect(await chat.search('nothing')).toEqual([])
    await chat.clearAll()
    expect(store.get('sessions').list).toEqual([])
    expect(store.get('chat').session).toBeNull()
  })

  it('opens only attachments that belong to the chat', async () => {
    const opened: string[] = []
    const { store, chat } = setup()
    store.update('chat', {
      pendingAttachments: [
        {
          id: 'att1',
          kind: 'capture',
          thumbDataUrl: 'data:image/png;base64,',
          width: 1,
          height: 1,
          createdAt: 0
        }
      ]
    })
    const withOpener = createChatService({
      store,
      broadcaster: createBroadcaster(store),
      persistence: memoryPersistence(),
      writer: createDebouncedWriter({ onError: () => {} }),
      getProvider: async () => null,
      log: silent,
      openPath: async (p) => {
        opened.push(p)
      }
    })
    await withOpener.openAttachment('att1')
    expect(opened).toEqual(['/attachments/att1.png'])
    await expect(withOpener.openAttachment('someone-else')).rejects.toThrow()
    await chat.removeAttachment('att1')
    expect(store.get('chat').pendingAttachments).toEqual([])
  })
})

describe('createChatHandlers', () => {
  it('covers every chat, sessions and attachments channel', () => {
    const { chat } = setup()
    const handlers = createChatHandlers(chat)
    const channels = [
      ...Object.values(HOOT_API_ROUTES.chat),
      ...Object.values(HOOT_API_ROUTES.sessions),
      ...Object.values(HOOT_API_ROUTES.attachments)
    ]
      .filter((r) => r.kind === 'invoke')
      .map((r) => r.channel)
    expect(Object.keys(handlers).sort()).toEqual([...channels].sort())
  })
})
