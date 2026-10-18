import type { Message, Session, SliceName, StateSlices } from '@hoot/core'
import type { CodeActionResult, CodeFile, CodeSnapshot } from '@hoot/core/code'
import { describe, expect, it, vi, type Mock } from 'vitest'
import {
  createCodeService,
  type CodePeer,
  type CodeService,
  type CodeServiceDeps
} from '../../src/main/code'
import type { Store } from '../../src/main/store/store'

const TEXT = ['function f(a) {', '  return a +', '}'].join('\n')

function file(over: Partial<CodeFile> = {}): CodeFile {
  return {
    path: 'src/f.js',
    uri: 'file:///w/src/f.js',
    languageId: 'javascript',
    version: 1,
    dirty: false,
    lineCount: 3,
    window: { start: 1, end: 3 },
    text: TEXT,
    visible: [{ start: 1, end: 3 }],
    selection: null,
    ...over
  }
}

const snap = (active: CodeFile | null = file()): CodeSnapshot => ({
  workspace: 'w',
  active,
  others: [],
  diagnostics: [],
  excluded: []
})

type Chat = StateSlices['chat']

interface FakeStore extends Pick<Store, 'get' | 'onChange'> {
  set(patch: Partial<Chat>): void
  chat(): Chat
}

function fakeStore(): FakeStore {
  let chat: Chat = { session: null, stream: null, pendingAttachments: [], clipboardHint: null }
  const listeners = new Set<(changed: ReadonlySet<SliceName>) => void>()
  return {
    get: ((name: SliceName) =>
      name === 'chat' ? chat : undefined) as CodeServiceDeps['store']['get'],
    onChange(cb: (changed: ReadonlySet<SliceName>) => void) {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    set(patch: Partial<Chat>) {
      chat = { ...chat, ...patch }
      for (const l of listeners) l(new Set(['chat']))
    },
    chat: () => chat
  }
}

interface FakePeer extends CodePeer {
  focused: boolean
  focusAt: number
  snapshot: Mock<CodePeer['snapshot']>
  show: Mock<CodePeer['show']>
  apply: Mock<CodePeer['apply']>
  reveal: Mock<CodePeer['reveal']>
  clear: Mock<CodePeer['clear']>
}

const ok: CodeActionResult = { ok: true, message: null }

function peer(id: string, over: Partial<FakePeer> = {}): FakePeer {
  return {
    window: { id, name: id },
    focused: false,
    focusAt: 0,
    file: null,
    snapshot: vi.fn<CodePeer['snapshot']>(async () => snap()),
    show: vi.fn<CodePeer['show']>(async () => ok),
    apply: vi.fn<CodePeer['apply']>(async () => ok),
    reveal: vi.fn<CodePeer['reveal']>(async () => ok),
    clear: vi.fn<CodePeer['clear']>(async () => ok),
    ...over
  }
}

type Hooks = Parameters<CodeServiceDeps['createServer']>[0]

function setup(
  peers: FakePeer[],
  t = { now: 1_000_000 }
): { store: FakeStore; service: CodeService; hooks: Hooks[]; t: { now: number } } {
  const store = fakeStore()
  let n = 0
  const hooks: Hooks[] = []
  const service = createCodeService({
    store,
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    now: () => t.now,
    newId: () => `id${++n}`,
    recentMs: 60_000,
    createServer: (h) => {
      hooks.push(h)
      return { start: async () => {}, stop: async () => {}, peers: () => peers }
    }
  })
  return { store, service, hooks, t }
}

const message = (id: string, role: Message['role'], text: string): Message => ({
  id,
  role,
  text,
  attachmentIds: [],
  createdAt: 1,
  status: 'done'
})

const session = (id: string, messages: Message[]): Session => ({
  id,
  title: 't',
  createdAt: 1,
  updatedAt: 1,
  messages,
  attachments: {}
})

/** What the chat service does around a send: stream on, answer text, stream off. */
function answer(store: FakeStore, sid: string, text: string, id = 'a1'): void {
  const before = store.chat().session?.messages ?? []
  const streaming = { ...message(id, 'assistant', ''), status: 'streaming' as const }
  store.set({
    session: session(sid, [...before, streaming]),
    stream: { sessionId: sid, messageId: id }
  })
  store.set({ session: session(sid, [...before, message(id, 'assistant', text)]), stream: null })
}

describe('code service: which window', () => {
  it('pins the focused window, else the one left recently, and keeps a chat on its window', async () => {
    const a = peer('a', { focusAt: 1_000_000 - 30_000 })
    const b = peer('b', { focusAt: 1_000_000 - 90_000 })
    const { service, store, t } = setup([a, b])
    await service.start()
    expect(service.focusedWindow()).toBeNull()
    expect(service.focusedWindow(31_000)).toEqual({ id: 'a', name: 'a' })
    expect(service.focusedWindow(29_000)).toBeNull()
    expect(service.chatWindow()).toBe('a')
    t.now += 40_000
    expect(service.chatWindow()).toBeNull()

    b.focused = true
    expect(service.focusedWindow()).toEqual({ id: 'b', name: 'b' })
    expect(service.status()).toEqual({ windows: 2, focused: { id: 'b', name: 'b' } })

    // a chat that read window a keeps reading it, wherever focus went
    await service.note('a')
    answer(store, 's1', 'ok')
    expect(service.chatWindow()).toBe('a')
  })

  it('finds the window behind an editor window the OS reports, by its folder name', () => {
    const hoot = peer('w1', { window: { id: 'w1', name: 'hoot' }, focusAt: 5 })
    const site = peer('w2', { window: { id: 'w2', name: 'site' }, focusAt: 9 })
    const { service } = setup([hoot, site])
    const title = (t: string): { process: string; title: string } => ({ process: 'Code', title: t })
    expect(service.windowFor(title('● main.cpp - hoot - Visual Studio Code'))?.id).toBe('w1')
    expect(service.windowFor(title('index.html - site - Visual Studio Code'))?.id).toBe('w2')
    // No folder in the title: the window the user was in last.
    expect(service.windowFor(title('Untitled-1 - Visual Studio Code'))?.id).toBe('w2')
    expect(
      service.windowFor({ process: 'chrome', title: 'hoot - GitHub - Google Chrome' })
    ).toBeNull()
    expect(service.windowFor(null)).toBeNull()
    expect(setup([]).service.windowFor(title('a - hoot - Visual Studio Code'))).toBeNull()
  })
})

describe('code service: notes', () => {
  it('sends everything first, then only what changed in the same chat', async () => {
    const a = peer('a')
    const { service, store } = setup([a])
    await service.start()

    const first = await service.note('a')
    expect(first).toContain('Focused file: src/f.js')
    answer(store, 's1', 'Looks like a typo.')

    const second = await service.note('a')
    expect(second).toContain('src/f.js is unchanged')

    a.snapshot.mockResolvedValueOnce(snap(file({ version: 2, text: TEXT.replace('a +', 'a + 1') })))
    expect(await service.note('a')).toContain('Line 2 now reads:')

    // a new chat starts over
    store.set({ session: null })
    expect(await service.note('a')).toContain('Focused file: src/f.js')
  })

  it('returns null when the window is gone or too slow', async () => {
    const a = peer('a', { snapshot: vi.fn(async () => null) })
    const { service } = setup([a])
    expect(await service.note('a')).toBeNull()
    expect(await service.note('missing')).toBeNull()
  })
})

describe('code service: answers', () => {
  const reply = [
    'The expression is unfinished.',
    '[[line: src/f.js:2, "Missing operand"]]',
    '[[edit: src/f.js:2, "Add the operand"]]',
    '```js',
    '  return a + 1',
    '```',
    '[[edit: elsewhere.js:9, "Unread file"]]',
    '```js',
    'x',
    '```'
  ].join('\n')

  it('highlights and proposes in VS Code when the answer ends, and applies on request', async () => {
    const a = peer('a')
    const { service, store } = setup([a])
    await service.start()
    const changes = vi.fn()
    service.onChange(changes)

    await service.note('a')
    answer(store, 's1', reply)

    expect(a.show).toHaveBeenCalledTimes(1)
    const [marks, edits, reveal] = a.show.mock.calls[0]!
    expect(reveal).toBe(true)
    expect(marks).toEqual([
      {
        id: expect.any(String),
        path: 'src/f.js',
        uri: 'file:///w/src/f.js',
        range: { start: 2, end: 2 },
        label: 'Missing operand'
      },
      {
        id: expect.any(String),
        path: 'elsewhere.js',
        uri: null,
        range: { start: 9, end: 9 },
        label: 'Unread file'
      }
    ])
    expect(edits).toEqual([
      {
        id: expect.any(String),
        path: 'src/f.js',
        uri: 'file:///w/src/f.js',
        range: { start: 2, end: 2 },
        label: 'Add the operand',
        replacement: '  return a + 1',
        expected: '  return a +'
      }
    ])
    expect(service.tagStates('a1')).toEqual(['ready', 'ready', 'ready'])

    expect(await service.apply('a1', 1)).toEqual(ok)
    expect(a.apply).toHaveBeenCalledWith(edits[0])
    expect(service.tagStates('a1')).toEqual(['ready', 'applied', 'ready'])
    expect(changes).toHaveBeenCalled()

    expect(await service.apply('a1', 0)).toMatchObject({ ok: false })
    await service.reveal('a1', 0)
    expect(a.reveal).toHaveBeenCalledWith(marks[0])
    expect(await service.apply('nope', 0)).toMatchObject({ ok: false })
  })

  it('marks edits applied from VS Code itself', async () => {
    const a = peer('a')
    const { service, store, hooks } = setup([a])
    await service.start()
    await service.note('a')
    answer(store, 's1', reply)
    const edit = a.show.mock.calls[0]![1][0]!
    hooks[0]!.onApplied(a, edit.id)
    expect(service.tagStates('a1')?.[1]).toBe('applied')
  })

  it('leaves chats that never read code alone', async () => {
    const a = peer('a')
    const { service, store } = setup([a])
    await service.start()
    answer(store, 's1', reply)
    expect(a.show).not.toHaveBeenCalled()
    expect(service.tagStates('a1')).toBeNull()
  })

  it('follows another chat too (an agent): its answers show in VS Code and apply', async () => {
    const a = peer('a')
    const { service, store } = setup([a])
    await service.start()
    const agent = fakeStore()
    const link = service.forChat(agent)
    expect(link.chatWindow()).toBeNull()
    a.focused = true
    expect(link.chatWindow()).toBe('a')

    expect(await link.note('a')).toContain('Focused file: src/f.js')
    answer(agent, 'agent-1', reply, 'x1')
    expect(a.show).toHaveBeenCalledTimes(1)
    expect(service.tagStates('x1')).toEqual(['ready', 'ready', 'ready'])
    expect(await service.apply('x1', 1)).toEqual(ok)
    expect(service.tagStates('x1')?.[1]).toBe('applied')

    // The owl's chat never read code: its answers stay out of VS Code.
    answer(store, 's1', reply)
    expect(a.show).toHaveBeenCalledTimes(1)
    expect(service.tagStates('a1')).toBeNull()

    link.dispose()
    answer(agent, 'agent-1', reply, 'x2')
    expect(a.show).toHaveBeenCalledTimes(1)
  })

  it('clears VS Code when the chat that read code is left', async () => {
    const a = peer('a')
    const { service, store } = setup([a])
    await service.start()
    await service.note('a')
    answer(store, 's1', reply)
    store.set({ session: session('s2', []) })
    expect(a.clear).toHaveBeenCalledTimes(1)
    answer(store, 's2', reply, 'a2')
    expect(a.show).toHaveBeenCalledTimes(1)
  })
})
