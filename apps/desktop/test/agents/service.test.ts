import {
  AGENT_COLORS,
  DEFAULT_SETTINGS,
  MAX_AGENTS,
  agentMood,
  type AgentState,
  type Rect,
  type Session
} from '@hoot/core'
import { describe, expect, it, vi } from 'vitest'
import { ALL_OUT, createAgentsService } from '../../src/main/agents/service'
import type { AgentWindows } from '../../src/main/agents/windows'
import { createFakeProvider, type AiProvider, type ChatStreamRequest } from '../../src/main/ai'
import type { CodeChatLink, CodeChatSource } from '../../src/main/code'
import type { Persistence } from '../../src/main/store/persistence'
import { createStore, initialSlices } from '../../src/main/store/store'
import { createDebouncedWriter } from '../../src/main/store/writer'

const noop = (): void => undefined
const silent = { info: noop, warn: noop, error: noop }
const wait = (ms = 5): Promise<void> => new Promise((r) => setTimeout(r, ms))

/** A provider whose streams wait for `release()` between chunks, so answers overlap. */
function gatedProvider(chunks: string[]): AiProvider & {
  release(): void
  requests: ChatStreamRequest[]
} {
  const waiters: (() => void)[] = []
  const requests: ChatStreamRequest[] = []
  return {
    ...createFakeProvider(),
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

function fakeWindows(): {
  windows: AgentWindows
  opened: Map<string, { bounds: Rect; sender: number }>
  calls: string[]
  sender(agentId: string): number
} {
  const opened = new Map<string, { bounds: Rect; sender: number }>()
  const calls: string[] = []
  let next = 100
  const windows: AgentWindows = {
    open: (id, bounds) => void opened.set(id, { bounds, sender: ++next }),
    setMinimized: (id, minimized) => void calls.push(`${minimized ? 'shrink' : 'grow'} ${id}`),
    close: (id) => {
      calls.push(`close ${id}`)
      opened.delete(id)
    },
    closeAll: noop,
    agentFor: (senderId) => [...opened].find(([, w]) => w.sender === senderId)?.[0] ?? null,
    dragStart: (id) => void calls.push(`dragStart ${id}`),
    dragMove: (id) => void calls.push(`dragMove ${id}`),
    dragEnd: (id) => void calls.push(`dragEnd ${id}`)
  }
  return { windows, opened, calls, sender: (id) => opened.get(id)?.sender ?? -1 }
}

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type -- test fixture bag
function setup(
  opts: {
    provider?: AiProvider
    codeLink?: (source: CodeChatSource) => CodeChatLink
  } = {}
) {
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
  const saved = new Map<string, Session>()
  const persistence = {
    saveSession: async (s: Session) => void saved.set(s.id, structuredClone(s)),
    loadSession: async (id: string) => saved.get(id) ?? null,
    readAttachment: async () => null,
    deleteAttachment: async () => undefined
  } as unknown as Persistence
  const writer = createDebouncedWriter({ onError: noop })
  const w = fakeWindows()
  const notify = vi.fn<(message: string) => void>()
  let n = 0
  const agents = createAgentsService({
    store,
    persistence,
    writer,
    log: silent,
    getProvider: async () => opts.provider ?? createFakeProvider({ chunkMs: 0 }),
    windows: w.windows,
    placement: (index) => ({ x: index * 10, y: 0, width: 380, height: 540 }),
    ...(opts.codeLink ? { codeLink: opts.codeLink } : {}),
    notify,
    newId: () => `id-${++n}`,
    frameMs: 0
  })
  const list = (): AgentState[] => store.get('agents').list
  return { store, agents, saved, writer, notify, list, ...w }
}

describe('agents', () => {
  it('each new agent gets the next colour and its own window by the owl; six at most', async () => {
    const t = setup()
    expect(await t.agents.create()).toBe(true)
    expect(await t.agents.create()).toBe(true)
    expect(t.list().map((a) => [a.name, a.color, a.minimized])).toEqual([
      ['Blue agent', 'blue', false],
      ['Green agent', 'green', false]
    ])
    const [blue, green] = t.list()
    expect(t.opened.get(blue!.id)?.bounds.x).toBe(0)
    expect(t.opened.get(green!.id)?.bounds.x).toBe(10)

    for (let i = 2; i < MAX_AGENTS; i++) await t.agents.create()
    expect(t.list().map((a) => a.color)).toEqual([...AGENT_COLORS])
    expect(await t.agents.create()).toBe(false)
    expect(t.notify).toHaveBeenCalledWith(ALL_OUT)

    // A colour comes free when its agent leaves.
    await t.agents.close(t.sender(green!.id))
    expect(t.list().map((a) => a.color)).not.toContain('green')
    expect(await t.agents.create()).toBe(true)
    expect(t.list().at(-1)?.color).toBe('green')
  })

  it('agents answer at the same time, each in its own chat, beside the owl’s', async () => {
    const provider = gatedProvider(['Hel', 'lo'])
    const t = setup({ provider })
    await t.agents.create()
    await t.agents.create()
    const [a, b] = t.list()
    await t.agents.send(t.sender(a!.id), { text: 'Plan the trip' })
    await t.agents.send(t.sender(b!.id), { text: 'Fix the bug' })
    await wait()

    // Both are streaming at once.
    expect(t.list().every((x) => x.stream !== null)).toBe(true)
    expect(t.list().map((x) => agentMood(x))).toEqual(['thinking', 'thinking'])
    provider.release()
    await wait()
    expect(t.list().map((x) => agentMood(x))).toEqual(['talking', 'talking'])
    provider.release()
    await wait()

    const [doneA, doneB] = t.list()
    expect(doneA?.stream).toBeNull()
    expect(doneA?.session?.messages.map((m) => [m.role, m.text])).toEqual([
      ['user', 'Plan the trip'],
      ['assistant', 'Hello']
    ])
    expect(doneB?.session?.messages[0]?.text).toBe('Fix the bug')
    expect(doneA?.session?.id).not.toBe(doneB?.session?.id)
    // The owl's own chat is untouched; both chats are in Studio's list and saved.
    expect(t.store.get('chat').session).toBeNull()
    expect(
      t.store
        .get('sessions')
        .list.map((s) => s.title)
        .sort()
    ).toEqual(['Fix the bug', 'Plan the trip'])
    await t.agents.flush()
    expect(t.saved.size).toBe(2)
  })

  it('minimizes into its owl, says an answer is ready while there, and opens again', async () => {
    const provider = gatedProvider(['Done'])
    const t = setup({ provider })
    await t.agents.create()
    const id = t.list()[0]!.id
    const from = t.sender(id)
    await t.agents.send(from, { text: 'Summarize' })
    await t.agents.minimize(from)
    expect(t.list()[0]?.minimized).toBe(true)
    expect(t.calls).toEqual([`shrink ${id}`])

    provider.release()
    await wait()
    expect(t.list()[0]?.answerReady).toBe(true)

    await t.agents.restore(from)
    expect(t.list()[0]).toMatchObject({ minimized: false, answerReady: false })
    expect(t.calls).toEqual([`shrink ${id}`, `grow ${id}`])

    t.agents.dragStart(from)
    t.agents.dragMove(from)
    t.agents.dragEnd(from)
    expect(t.calls.slice(2)).toEqual([`dragStart ${id}`, `dragMove ${id}`, `dragEnd ${id}`])
  })

  it('closing stops its answer and keeps its chat; a window closed by Windows does the same', async () => {
    const provider = gatedProvider(['never'])
    const t = setup({ provider })
    await t.agents.create()
    await t.agents.create()
    const [a, b] = t.list()
    await t.agents.send(t.sender(a!.id), { text: 'Long task' })
    await wait()
    await t.agents.close(t.sender(a!.id))
    expect(t.calls).toContain(`close ${a!.id}`)
    expect(t.list().map((x) => x.id)).toEqual([b!.id])
    expect([...t.saved.values()][0]?.messages.at(-1)?.status).toBe('stopped')

    t.agents.closed(b!.id)
    await wait()
    expect(t.list()).toEqual([])
    // Messages from a window that isn't an agent's do nothing.
    await t.agents.send(999, { text: 'nobody' })
    await t.agents.minimize(999)
  })

  it('reads VS Code for an agent the way the owl’s chat does', async () => {
    const provider = gatedProvider([])
    const sources: CodeChatSource[] = []
    const disposed = vi.fn()
    const t = setup({
      provider,
      codeLink: (source) => {
        sources.push(source)
        return {
          chatWindow: () => 'win-1',
          note: async (id) => `[VS Code: ${id}]`,
          dispose: disposed
        }
      }
    })
    await t.agents.create()
    const id = t.list()[0]!.id
    await t.agents.send(t.sender(id), { text: 'Fix this' })
    await wait()
    expect(sources).toHaveLength(1)
    // The agent's chat (not the owl's) is what the code link follows.
    expect(sources[0]?.get('chat').session?.id).toBe(t.list()[0]?.session?.id)
    const sent = provider.requests[0]?.messages.at(-1)?.content
    expect(JSON.stringify(sent)).toContain('[VS Code: win-1]')
    await t.agents.close(t.sender(id))
    expect(disposed).toHaveBeenCalledTimes(1)
  })
})
