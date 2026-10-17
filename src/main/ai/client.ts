import {
  GoogleGenAI,
  ThinkingLevel,
  type Content,
  type GenerateContentResponse,
  type Part
} from '@google/genai'
import type { ConversationMessage } from './conversation'
import { AiBlockedError, BLOCKED_FINISH_REASONS } from './errors'

export interface StreamRequest {
  model: string
  system: string
  messages: ConversationMessage[]
  /** Gemini counts thinking tokens against this cap too. */
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

/** Gemini calls the assistant role `model`; images travel as inline base64 parts. */
export function toGeminiContents(messages: ConversationMessage[]): Content[] {
  return messages.map((m) => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts:
      typeof m.content === 'string'
        ? [{ text: m.content }]
        : m.content.map((b): Part => {
            if (b.type === 'text') return { text: b.text }
            return { inlineData: { mimeType: b.source.media_type, data: b.source.data } }
          })
  }))
}

/** Visible answer text of a chunk; thought parts are never shown. */
export function chunkText(chunk: GenerateContentResponse): string {
  let text = ''
  for (const part of chunk.candidates?.[0]?.content?.parts ?? []) {
    if (typeof part.text === 'string' && !part.thought) text += part.text
  }
  return text
}

export function createGeminiClient(apiKey: string): AiClient {
  const ai = new GoogleGenAI({ apiKey })
  return {
    async stream(req, onText) {
      const stream = await ai.models.generateContentStream({
        model: req.model,
        contents: toGeminiContents(req.messages),
        config: {
          systemInstruction: req.system,
          maxOutputTokens: req.maxTokens,
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          abortSignal: req.signal
        }
      })
      let stopReason: string | null = null
      let emitted = false
      for await (const chunk of stream) {
        const blocked = chunk.promptFeedback?.blockReason
        if (blocked) throw new AiBlockedError(String(blocked))
        const text = chunkText(chunk)
        if (text) {
          emitted = true
          onText(text)
        }
        const reason = chunk.candidates?.[0]?.finishReason
        if (reason) stopReason = reason
      }
      if (!emitted && stopReason && BLOCKED_FINISH_REASONS.has(stopReason)) {
        throw new AiBlockedError(stopReason)
      }
      return { stopReason }
    },
    async validateKey(key) {
      const probe = new GoogleGenAI({ apiKey: key })
      try {
        await probe.models.list({ config: { pageSize: 1 } })
        return true
      } catch {
        return false
      }
    }
  }
}
