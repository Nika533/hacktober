import { randomUUID } from 'node:crypto'
import {
  AGENT_COLOR_NAMES,
  AGENT_COLORS,
  MAX_AGENTS,
  type AgentState,
  type Rect,
  type SendPayload,
  type StateSlices
} from '@hoot/core'
import type { AiProvider } from '../ai'
import { createChatService, type ChatService } from '../chat'
import type { CodeChatLink, CodeChatSource } from '../code'
import type { Logger } from '../log'
import type { Broadcaster } from '../store/broadcast'
import type { Persistence } from '../store/persistence'
import type { Store } from '../store/store'
import type { DebouncedWriter } from '../store/writer'
import { createAgentStore } from './scope'
import type { AgentWindows } from './windows'

export interface AgentsDeps {
  store: Store
  persistence: Persistence
  writer: DebouncedWriter
  log: Logger
  getProvider(): Promise<AiProvider | null>
  windows: AgentWindows
  /** Where the `index`th agent's card opens (screen DIP). */
  placement(index: number): Rect
  /** The code link for an agent's chat: VS Code's code with its messages, edits back. */
  codeLink?(source: CodeChatSource): CodeChatLink
  /** Tell the user something (a system notification in the app). */
  notify?(message: string): void
  newId?(): string
  /** How often a streaming answer's new words reach the agent's window. */
  frameMs?: number
}

export interface AgentsService {
  /** Call a new agent; false when every colour is already out (MAX_AGENTS). */
  create(): Promise<boolean>
  send(senderId: number, payload: SendPayload): Promise<void>
  stop(senderId: number): Promise<void>
  regenerate(senderId: number): Promise<void>
  minimize(senderId: number): Promise<void>
  restore(senderId: number): Promise<void>
  close(senderId: number): Promise<void>
  /** An agent's window closed without Hoot asking (Alt+F4): the agent goes too. */
  closed(agentId: string): void
  dragStart(senderId: number): void
  dragMove(senderId: number): void
  dragEnd(senderId: number): void
  /** Save every agent's chat (before quit). */
  flush(): Promise<void>
}

interface Agent {
  state: AgentState
  chat: ChatService
  link: CodeChatLink | null
}

/** Agent windows render from the `agents` slice, so their chats broadcast no deltas. */
const SILENT: Broadcaster = {
  subscribe: () => ({}),
  unsubscribe: () => undefined,
  delta: () => undefined,
  emit: () => undefined
}

const FRAME_MS = 50

export const ALL_OUT = `All ${MAX_AGENTS} agents are already working. Close one to call another.`

/**
 * Agents: extra Hoot chats answering at the same time as the owl's, each a
 * full chat service of its own (streaming, Stop, Regenerate, saved like any
 * chat, so it shows in Studio) on a store whose `chat` slice is the agent's.
 * Each agent has a colour, and its window shrinks into an owl of that colour.
 */
export function createAgentsService(deps: AgentsDeps): AgentsService {
  const { store, windows, log } = deps
  const newId = deps.newId ?? randomUUID
  const frameMs = deps.frameMs ?? FRAME_MS
  const agents = new Map<string, Agent>()
  let frame: ReturnType<typeof setTimeout> | null = null

  const publish = (): void => {
    if (frame) clearTimeout(frame)
    frame = null
    store.set('agents', { list: [...agents.values()].map((a) => a.state) })
  }
  /** Streamed words go out at most once a frame; everything else right away. */
  const publishSoon = (): void => {
    frame ??= setTimeout(publish, frameMs)
  }

  const onChat = (agent: Agent, chat: StateSlices['chat']): void => {
    const prev = agent.state
    const ended = prev.stream !== null && chat.stream === null
    agent.state = {
      ...prev,
      session: chat.session,
      stream: chat.stream,
      answerReady: prev.answerReady || (ended && prev.minimized)
    }
    const structural =
      prev.stream?.messageId !== chat.stream?.messageId ||
      prev.session?.id !== chat.session?.id ||
      prev.session?.messages.length !== chat.session?.messages.length
    if (structural) publish()
    else publishSoon()
  }

  const bySender = (senderId: number): Agent | null => {
    const id = windows.agentFor(senderId)
    return (id && agents.get(id)) || null
  }

  const update = (agent: Agent, patch: Partial<AgentState>): void => {
    agent.state = { ...agent.state, ...patch }
    publish()
  }

  /** The agent leaves: its answer stops, its chat is saved, its window goes. */
  const remove = async (agent: Agent): Promise<void> => {
    if (!agents.delete(agent.state.id)) return
    agent.link?.dispose()
    publish()
    await agent.chat.stop()
    await agent.chat.flush()
  }

  return {
    async create() {
      const used = new Set([...agents.values()].map((a) => a.state.color))
      const color = AGENT_COLORS.find((c) => !used.has(c))
      if (!color) {
        deps.notify?.(ALL_OUT)
        return false
      }
      const id = newId()
      // Its chat only changes once it's asked something, so after `agent` is set.
      let agent: Agent | null = null
      const scoped = createAgentStore(store, (chat) => {
        if (agent) onChat(agent, chat)
      })
      const link = deps.codeLink?.(scoped) ?? null
      const chat = createChatService({
        store: scoped,
        broadcaster: SILENT,
        persistence: deps.persistence,
        writer: deps.writer,
        log,
        getProvider: deps.getProvider,
        // Like the owl's chat: VS Code's code goes along when the user was just in it.
        beforeSend: async () => {
          const window = link?.chatWindow() ?? null
          return link && window ? link.note(window) : null
        }
      })
      agent = {
        state: {
          id,
          name: `${AGENT_COLOR_NAMES[color]} agent`,
          color,
          minimized: false,
          answerReady: false,
          session: null,
          stream: null
        },
        chat,
        link
      }
      agents.set(id, agent)
      publish()
      windows.open(id, deps.placement(agents.size - 1))
      log.info(`agents: ${agent.state.name} called`)
      return true
    },

    async send(senderId, payload) {
      await bySender(senderId)?.chat.send(payload)
    },

    async stop(senderId) {
      await bySender(senderId)?.chat.stop()
    },

    async regenerate(senderId) {
      await bySender(senderId)?.chat.regenerate()
    },

    async minimize(senderId) {
      const agent = bySender(senderId)
      if (!agent || agent.state.minimized) return
      update(agent, { minimized: true })
      windows.setMinimized(agent.state.id, true)
    },

    async restore(senderId) {
      const agent = bySender(senderId)
      if (!agent) return
      update(agent, { minimized: false, answerReady: false })
      windows.setMinimized(agent.state.id, false)
    },

    async close(senderId) {
      const agent = bySender(senderId)
      if (!agent) return
      windows.close(agent.state.id)
      await remove(agent)
    },

    closed(agentId) {
      const agent = agents.get(agentId)
      if (agent) void remove(agent).catch((e: unknown) => log.warn(`agents: ${String(e)}`))
    },

    dragStart(senderId) {
      const id = windows.agentFor(senderId)
      if (id) windows.dragStart(id)
    },

    dragMove(senderId) {
      const id = windows.agentFor(senderId)
      if (id) windows.dragMove(id)
    },

    dragEnd(senderId) {
      const id = windows.agentFor(senderId)
      if (id) windows.dragEnd(id)
    },

    async flush() {
      for (const agent of agents.values()) await agent.chat.flush()
    }
  }
}
