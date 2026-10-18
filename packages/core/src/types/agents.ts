import type { OwlMood } from './app'
import type { Session } from './chat'

/**
 * Agents: extra Hoot chats that run next to the owl's own chat, each in its
 * own floating window, all answering at the same time. Minimized, an agent is
 * just its owl, and every agent's owl has its own colour.
 */
export const AGENT_COLORS = ['blue', 'green', 'purple', 'pink', 'teal', 'slate'] as const

export type AgentColor = (typeof AGENT_COLORS)[number]

/** At most this many agents at once. */
export const MAX_AGENTS = AGENT_COLORS.length

/**
 * Where an agent's owl sits in its window (window-local DIP), card or
 * minimized: main keeps that spot still on screen when the window shrinks
 * into the owl or grows back into the card.
 */
export const AGENT_OWL_AT = { x: 32, y: 32 } as const

export const AGENT_COLOR_NAMES: Record<AgentColor, string> = {
  blue: 'Blue',
  green: 'Green',
  purple: 'Purple',
  pink: 'Pink',
  teal: 'Teal',
  slate: 'Slate'
}

export interface AgentState {
  id: string
  /** "Agent 1", "Agent 2", … in the order they were called. */
  name: string
  color: AgentColor
  /** Shrunk into its owl. */
  minimized: boolean
  /** An answer finished while the agent was minimized; cleared when it opens. */
  answerReady: boolean
  /** Its chat, like the `chat` slice's; null until the first message. */
  session: Session | null
  /** The assistant message streaming in this agent's chat, if any. */
  stream: { sessionId: string; messageId: string } | null
}

/** The owl's mood for an agent: thinking until the first words, talking while they stream. */
export function agentMood(agent: Pick<AgentState, 'session' | 'stream'>): OwlMood {
  const last = agent.session?.messages.at(-1)
  if (agent.stream) return last?.role === 'assistant' && last.text ? 'talking' : 'thinking'
  return last?.role === 'assistant' && last.status === 'error' ? 'error' : 'idle'
}
