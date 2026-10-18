import { DEFAULT_CHAT_MODEL, LEGACY_CHAT_MODELS } from '@hoot/core'
import type { z } from 'zod'
import { AiBlockedError, AiError, AiOutputError, isAbortError, mapAiError } from './errors'
import { toResponseSchema } from './schema'
import type { AiProvider, JsonRequest } from './types'

const API = 'https://api.anthropic.com/v1'
const VERSION = '2023-06-01'
const JSON_DEFAULTS = { maxTokens: 1024, timeoutMs: 8000, retries: 1 } as const

/** Anthropic keys (`sk-ant-…`): the rest of Hoot picks Claude for these. */
export const isClaudeKey = (key: string): boolean => key.trim().startsWith('sk-ant-')

/**
 * The Claude model to call. Settings and Lens name Claude models; a Gemini id
 * left from before the move maps to the model with the same role.
 */
export const claudeModel = (model: string): string =>
  model.startsWith('claude-') ? model : (LEGACY_CHAT_MODELS[model] ?? DEFAULT_CHAT_MODEL)

/** Claude refuses or cuts an answer for these. */
const BLOCKED_STOP_REASONS = new Set(['refusal'])

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message)
    this.name = 'HttpError'
  }
}

/** The tool Claude is made to call: its input is the structured answer. */
const JSON_TOOL = 'answer'
const FORCED_TOOL_REJECTED = /tool_choice.*not supported/i
const AUTO_TOOL_RULE = `Answer only by calling the \`${JSON_TOOL}\` tool, with no other text.`

/** A JSON object in a text answer (a model that answered without the tool). */
function jsonFromText(content: { type: string; text?: string }[] | undefined): unknown {
  const text = content?.find((b) => b.type === 'text')?.text?.trim()
  if (!text) return undefined
  const body = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  try {
    return JSON.parse(body)
  } catch {
    return undefined
  }
}

/** Claude via the Messages API, with plain fetch (no SDK dependency). */
export function createClaudeProvider(apiKey: string): AiProvider {
  /** Models that reject a forced tool call (Sonnet 5.5): asked with tool_choice auto instead. */
  const autoTool = new Set<string>()
  const headers = {
    'x-api-key': apiKey.trim(),
    'anthropic-version': VERSION,
    'content-type': 'application/json'
  }

  const post = async (body: object, signal: AbortSignal): Promise<Response> => {
    const res = await fetch(`${API}/messages`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      let message = text
      try {
        message = (JSON.parse(text) as { error?: { message?: string } }).error?.message ?? text
      } catch {
        // not JSON: keep the text
      }
      throw new HttpError(res.status, message.slice(0, 500) || `HTTP ${res.status}`)
    }
    return res
  }

  async function jsonAttempt<T>(req: JsonRequest<T>, signal: AbortSignal): Promise<T> {
    const model = claudeModel(req.model)
    const auto = autoTool.has(model)
    const res = await post(
      {
        model,
        max_tokens: req.maxTokens ?? JSON_DEFAULTS.maxTokens,
        system: auto ? `${req.system}\n\n${AUTO_TOOL_RULE}` : req.system,
        messages: [{ role: 'user', content: req.prompt }],
        tools: [
          {
            name: JSON_TOOL,
            description: 'Give your answer as this structured object.',
            input_schema: toResponseSchema(req.schema as z.ZodType)
          }
        ],
        tool_choice: auto ? { type: 'auto' } : { type: 'tool', name: JSON_TOOL }
      },
      signal
    )
    const data = (await res.json()) as {
      stop_reason?: string
      content?: { type: string; name?: string; input?: unknown; text?: string }[]
    }
    if (data.stop_reason && BLOCKED_STOP_REASONS.has(data.stop_reason)) {
      throw new AiBlockedError(data.stop_reason)
    }
    if (data.stop_reason === 'max_tokens') throw new AiOutputError('reply truncated at maxTokens')
    const call = data.content?.find((b) => b.type === 'tool_use' && b.name === JSON_TOOL)
    const input = call ? call.input : jsonFromText(data.content)
    if (input === undefined) throw new AiOutputError('reply has no structured answer')
    const parsed = req.schema.safeParse(input)
    if (!parsed.success) {
      throw new AiOutputError(`reply does not match schema: ${parsed.error.message}`)
    }
    return parsed.data
  }

  return {
    async stream(req, onText) {
      let res: Response
      try {
        res = await post(
          {
            model: claudeModel(req.model),
            max_tokens: req.maxTokens,
            system: req.system,
            // ConversationMessage is already Messages API shaped (text and base64 image blocks).
            messages: req.messages,
            stream: true
          },
          req.signal
        )
      } catch (e) {
        if (isAbortError(e)) throw e
        throw new AiError(mapAiError(e), e instanceof Error ? e.message : String(e))
      }
      const reader = res.body?.getReader()
      if (!reader) throw new AiError('network', 'no response body')
      const decoder = new TextDecoder()
      let buffer = ''
      let stopReason: string | null = null
      let emitted = false
      for (;;) {
        const { value, done } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        // Server-sent events: blank-line separated, `data: {json}` lines.
        let cut: number
        while ((cut = buffer.indexOf('\n\n')) >= 0) {
          const event = buffer.slice(0, cut)
          buffer = buffer.slice(cut + 2)
          for (const line of event.split('\n')) {
            if (!line.startsWith('data:')) continue
            let msg: {
              type?: string
              delta?: { type?: string; text?: string; stop_reason?: string }
              error?: { type?: string; message?: string }
            }
            try {
              msg = JSON.parse(line.slice(5).trim()) as typeof msg
            } catch {
              continue
            }
            if (msg.type === 'content_block_delta' && msg.delta?.type === 'text_delta') {
              const text = msg.delta.text ?? ''
              if (text) {
                emitted = true
                onText(text)
              }
            } else if (msg.type === 'message_delta' && msg.delta?.stop_reason) {
              stopReason = msg.delta.stop_reason
            } else if (msg.type === 'error') {
              const overloaded = msg.error?.type === 'overloaded_error'
              throw new AiError(
                overloaded ? 'busy' : 'unknown',
                msg.error?.message ?? 'stream error'
              )
            }
          }
        }
      }
      if (!emitted && stopReason && BLOCKED_STOP_REASONS.has(stopReason)) {
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
          const model = claudeModel(req.model)
          if (
            e instanceof HttpError &&
            FORCED_TOOL_REJECTED.test(e.message) &&
            !autoTool.has(model)
          ) {
            autoTool.add(model)
            attempt-- // a refused tool_choice isn't a failed attempt
            continue
          }
          if (e instanceof AiOutputError || e instanceof AiError) throw e
          const code = timeout.aborted ? 'busy' : isAbortError(e) ? 'network' : mapAiError(e)
          // A timed-out request already waited its budget; overload
          // (529/503) and network errors fail fast and get one more try.
          const retryable = !timeout.aborted && (code === 'busy' || code === 'network')
          if (!retryable || attempt >= retries) {
            throw new AiError(code, e instanceof Error ? e.message : String(e))
          }
          await new Promise((r) => setTimeout(r, 250 + Math.random() * 500))
        }
      }
    },

    async validateKey(key) {
      const res = await fetch(`${API}/models?limit=1`, {
        headers: { 'x-api-key': key.trim(), 'anthropic-version': VERSION }
      })
      if (res.status === 401 || res.status === 403) return false
      if (!res.ok) throw new HttpError(res.status, `key check failed: HTTP ${res.status}`)
      return true
    }
  }
}
