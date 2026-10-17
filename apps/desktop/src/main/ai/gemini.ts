import {
  GoogleGenAI,
  ThinkingLevel as GeminiThinkingLevel,
  type Content,
  type GenerateContentResponse,
  type Part
} from '@google/genai'
import type { ConversationMessage } from '@hoot/core'
import { z } from 'zod'
import {
  AiBlockedError,
  AiError,
  AiOutputError,
  BLOCKED_FINISH_REASONS,
  isAbortError,
  mapAiError
} from './errors'
import type { AiProvider, JsonRequest, ThinkingLevel } from './types'

const THINKING: Record<ThinkingLevel, GeminiThinkingLevel> = {
  minimal: GeminiThinkingLevel.MINIMAL,
  low: GeminiThinkingLevel.LOW,
  medium: GeminiThinkingLevel.MEDIUM,
  high: GeminiThinkingLevel.HIGH
}

const CHAT_THINKING: ThinkingLevel = 'low'
const JSON_DEFAULTS = { maxTokens: 1024, thinking: 'minimal', timeoutMs: 8000, retries: 1 } as const

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

/** Visible answer text of a response or stream chunk; thought parts are never shown. */
export function chunkText(chunk: GenerateContentResponse): string {
  let text = ''
  for (const part of chunk.candidates?.[0]?.content?.parts ?? []) {
    if (typeof part.text === 'string' && !part.thought) text += part.text
  }
  return text
}

/** JSON Schema for `responseJsonSchema`, without the `$schema` marker. */
export function toResponseSchema(schema: z.ZodType): Record<string, unknown> {
  const json = z.toJSONSchema(schema, { target: 'draft-2020-12' }) as Record<string, unknown>
  delete json['$schema']
  return json
}

function throwIfBlocked(chunk: GenerateContentResponse): void {
  const blocked = chunk.promptFeedback?.blockReason
  if (blocked) throw new AiBlockedError(String(blocked))
}

const sleep = (ms: number, signal?: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms)
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer)
        reject(signal.reason)
      },
      { once: true }
    )
  })

export function createGeminiProvider(apiKey: string): AiProvider {
  const ai = new GoogleGenAI({ apiKey })

  async function jsonAttempt<T>(req: JsonRequest<T>, signal: AbortSignal): Promise<T> {
    const response = await ai.models.generateContent({
      model: req.model,
      contents: [{ role: 'user', parts: [{ text: req.prompt }] }],
      config: {
        systemInstruction: req.system,
        maxOutputTokens: req.maxTokens ?? JSON_DEFAULTS.maxTokens,
        thinkingConfig: { thinkingLevel: THINKING[req.thinking ?? JSON_DEFAULTS.thinking] },
        responseMimeType: 'application/json',
        responseJsonSchema: toResponseSchema(req.schema),
        abortSignal: signal
      }
    })
    throwIfBlocked(response)
    const finish = response.candidates?.[0]?.finishReason
    if (finish && BLOCKED_FINISH_REASONS.has(finish)) throw new AiBlockedError(finish)
    if (finish === 'MAX_TOKENS') throw new AiOutputError('reply truncated at maxTokens')

    let raw: unknown
    try {
      raw = JSON.parse(chunkText(response))
    } catch {
      throw new AiOutputError('reply is not JSON')
    }
    const parsed = req.schema.safeParse(raw)
    if (!parsed.success)
      throw new AiOutputError(`reply does not match schema: ${parsed.error.message}`)
    return parsed.data
  }

  return {
    async stream(req, onText) {
      const stream = await ai.models.generateContentStream({
        model: req.model,
        contents: toGeminiContents(req.messages),
        config: {
          systemInstruction: req.system,
          maxOutputTokens: req.maxTokens,
          thinkingConfig: { thinkingLevel: THINKING[CHAT_THINKING] },
          abortSignal: req.signal
        }
      })
      let stopReason: string | null = null
      let emitted = false
      for await (const chunk of stream) {
        throwIfBlocked(chunk)
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

    async generateJson(req) {
      const retries = req.retries ?? JSON_DEFAULTS.retries
      const timeoutMs = req.timeoutMs ?? JSON_DEFAULTS.timeoutMs
      for (let attempt = 0; ; attempt++) {
        const timeout = AbortSignal.timeout(timeoutMs)
        const signal = req.signal ? AbortSignal.any([req.signal, timeout]) : timeout
        try {
          return await jsonAttempt(req, signal)
        } catch (e) {
          if (req.signal?.aborted) throw req.signal.reason
          if (e instanceof AiOutputError || e instanceof AiError) throw e
          const code = timeout.aborted ? 'busy' : isAbortError(e) ? 'network' : mapAiError(e)
          const retryable = code === 'busy' || code === 'network'
          if (!retryable || attempt >= retries) {
            throw new AiError(code, e instanceof Error ? e.message : String(e))
          }
          await sleep(250 + Math.random() * 500, req.signal)
        }
      }
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
