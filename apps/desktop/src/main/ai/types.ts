import type { ConversationMessage } from '@hoot/core'
import type { z } from 'zod'

export interface ChatStreamRequest {
  model: string
  system: string
  messages: ConversationMessage[]
  /** Output token cap for the answer. */
  maxTokens: number
  signal: AbortSignal
}

export type ThinkingLevel = 'minimal' | 'low' | 'medium' | 'high'

export interface JsonRequest<T> {
  model: string
  system: string
  prompt: string
  /** The reply must match this schema (sent to Claude as the forced tool's input schema). */
  schema: z.ZodType<T>
  /** Default 1024; thinking counts against it. */
  maxTokens?: number
  /** Reasoning effort hint; Claude answers without extended thinking. */
  thinking?: ThinkingLevel
  /** Caller cancellation; rejects with an AbortError. */
  signal?: AbortSignal
  /** Per-attempt timeout; default 8000 ms. A timeout counts as `busy`. */
  timeoutMs?: number
  /** Extra attempts on `busy` / `network` failures; default 1. */
  retries?: number
}

/**
 * The one seam between Hoot and a model provider. All calls happen in the
 * main process; renderers and the extension never see the key.
 */
export interface AiProvider {
  stream(
    req: ChatStreamRequest,
    onText: (delta: string) => void
  ): Promise<{ stopReason: string | null }>
  generateJson<T>(req: JsonRequest<T>): Promise<T>
  validateKey(key: string): Promise<boolean>
}
