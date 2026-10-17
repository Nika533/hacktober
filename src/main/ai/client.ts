import Anthropic from '@anthropic-ai/sdk'
import type { ConversationMessage } from './conversation'

export interface StreamRequest {
  model: string
  system: string
  messages: ConversationMessage[]
  maxTokens: number
  signal: AbortSignal
}

export interface AiClient {
  stream(
    req: StreamRequest,
    onText: (delta: string) => void
  ): Promise<{ stopReason: string | null }>
  validateKey(key: string): Promise<boolean>
}

function toAnthropicMessages(messages: ConversationMessage[]): Anthropic.MessageParam[] {
  return messages.map((m) => ({
    role: m.role,
    content:
      typeof m.content === 'string'
        ? m.content
        : m.content.map((b): Anthropic.ContentBlockParam => {
            if (b.type === 'text') return { type: 'text', text: b.text }
            return {
              type: 'image',
              source: {
                type: 'base64',
                media_type: b.source.media_type,
                data: b.source.data
              }
            }
          })
  }))
}

export function createAnthropicClient(apiKey: string): AiClient {
  const client = new Anthropic({ apiKey })
  return {
    async stream(req, onText) {
      const stream = client.messages.stream(
        {
          model: req.model,
          system: req.system,
          messages: toAnthropicMessages(req.messages),
          max_tokens: req.maxTokens
        },
        { signal: req.signal }
      )
      stream.on('text', (delta) => onText(delta))
      const final = await stream.finalMessage()
      return { stopReason: final.stop_reason }
    },
    async validateKey(key) {
      const probe = new Anthropic({ apiKey: key })
      try {
        await probe.models.list({ limit: 1 })
        return true
      } catch {
        return false
      }
    }
  }
}
