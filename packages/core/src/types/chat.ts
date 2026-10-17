import type { QuickActionId } from './app'

/**
 * Why a model call failed. Shared by chat messages, the Lens engine and the
 * bridge so every surface shows the same message for the same failure.
 */
export const AI_ERROR_CODES = [
  'no_key',
  'auth',
  'rate_limited',
  'busy',
  'blocked',
  'network',
  'unknown'
] as const

export type AiErrorCode = (typeof AI_ERROR_CODES)[number]

export interface Attachment {
  id: string
  kind: 'capture' | 'clipboard-image'
  /** Small preview; the full PNG lives at `attachments/<id>.png` in main. */
  thumbDataUrl: string
  width: number
  height: number
  createdAt: number
}

export type MessageStatus = 'streaming' | 'done' | 'stopped' | 'error'

export interface Message {
  id: string
  role: 'user' | 'assistant'
  /** Displayed text */
  text: string
  /** Text sent to the model, if different from `text` */
  sentText?: string
  attachmentIds: string[]
  createdAt: number
  status: MessageStatus
  error?: AiErrorCode
}

export interface Session {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  messages: Message[]
  attachments: Record<string, Attachment>
}

export interface SessionMeta {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  messageCount: number
}

export interface SendPayload {
  text?: string
  quickAction?: QuickActionId
}

/** One streamed piece of an assistant answer (`chat:delta`). */
export interface ChatDelta {
  sessionId: string
  messageId: string
  delta: string
}
