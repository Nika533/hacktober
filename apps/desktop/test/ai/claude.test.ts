import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import {
  AiBlockedError,
  AiError,
  AiOutputError,
  claudeModel,
  createAiProvider,
  createClaudeProvider,
  mapAiError,
  type ChatStreamRequest
} from '../../src/main/ai'

afterEach(() => vi.unstubAllGlobals())

interface Call {
  url: string
  headers: Record<string, string>
  body: Record<string, unknown>
}

function stubFetch(...responses: (() => Response)[]): Call[] {
  const calls: Call[] = []
  vi.stubGlobal('fetch', async (url: string | URL, init?: RequestInit) => {
    calls.push({
      url: String(url),
      headers: { ...((init?.headers ?? {}) as Record<string, string>) },
      body: init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {}
    })
    init?.signal?.throwIfAborted()
    const next = responses.shift()
    if (!next) throw new Error('unexpected fetch')
    return next()
  })
  return calls
}

const json =
  (body: object, status = 200) =>
  (): Response =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

const sse =
  (...events: object[]) =>
  (): Response =>
    new Response(events.map((e) => `event: x\ndata: ${JSON.stringify(e)}\n\n`).join(''), {
      status: 200,
      headers: { 'content-type': 'text/event-stream' }
    })

const apiError = (type: string, message: string): object => ({
  type: 'error',
  error: { type, message }
})

const Assess = z.object({ difficulty: z.number().min(0).max(1), term: z.string().nullable() })
const jsonReq = { model: 'claude-haiku-5-5', system: 'SYS', prompt: 'P', schema: Assess }

const streamReq: ChatStreamRequest = {
  model: 'claude-sonnet-5-5',
  system: 'SYS',
  maxTokens: 64,
  signal: new AbortController().signal,
  messages: [
    {
      role: 'user' as const,
      content: [
        {
          type: 'image' as const,
          source: { type: 'base64' as const, media_type: 'image/png' as const, data: 'AAAA' }
        },
        { type: 'text' as const, text: 'what is this?' }
      ]
    }
  ]
}

const toolAnswer = (input: object, stop = 'tool_use'): (() => Response) =>
  json({ stop_reason: stop, content: [{ type: 'tool_use', name: 'answer', input }] })

describe('createClaudeProvider: stream', () => {
  it('posts to the Messages API with the key, streams text and reports the stop reason', async () => {
    const calls = stubFetch(
      sse(
        { type: 'message_start' },
        { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hel' } },
        { type: 'content_block_delta', delta: { type: 'text_delta', text: 'lo' } },
        { type: 'message_delta', delta: { stop_reason: 'end_turn' } },
        { type: 'message_stop' }
      )
    )
    const out: string[] = []
    const r = await createClaudeProvider(' sk-ant-test ').stream(streamReq, (t) => out.push(t))
    expect(out.join('')).toBe('Hello')
    expect(r.stopReason).toBe('end_turn')
    expect(calls[0]?.url).toBe('https://api.anthropic.com/v1/messages')
    expect(calls[0]?.headers).toMatchObject({
      'x-api-key': 'sk-ant-test',
      'anthropic-version': '2023-06-01'
    })
    // ConversationMessage is already Messages API shaped: images go as base64 blocks.
    expect(calls[0]?.body).toMatchObject({
      model: 'claude-sonnet-5-5',
      system: 'SYS',
      stream: true,
      messages: streamReq.messages
    })
  })

  it('maps HTTP errors and an in-stream overload', async () => {
    const fail = (): Promise<unknown> =>
      createClaudeProvider('k')
        .stream(streamReq, () => undefined)
        .catch((e: unknown) => e)
    stubFetch(json(apiError('authentication_error', 'invalid x-api-key'), 401))
    expect(mapAiError(await fail())).toBe('auth')
    stubFetch(json(apiError('rate_limit_error', 'slow down'), 429))
    expect(mapAiError(await fail())).toBe('rate_limited')
    stubFetch(sse({ type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } }))
    expect(((await fail()) as AiError).code).toBe('busy')
  })

  it('reports a refusal with no text as blocked', async () => {
    stubFetch(sse({ type: 'message_delta', delta: { stop_reason: 'refusal' } }))
    await expect(
      createClaudeProvider('k').stream(streamReq, () => undefined)
    ).rejects.toBeInstanceOf(AiBlockedError)
  })
})

describe('createClaudeProvider: generateJson', () => {
  it('forces the answer tool with the JSON schema and validates its input', async () => {
    const calls = stubFetch(toolAnswer({ difficulty: 0.7, term: 'API' }))
    await expect(createClaudeProvider('k').generateJson(jsonReq)).resolves.toEqual({
      difficulty: 0.7,
      term: 'API'
    })
    expect(calls[0]?.body).toMatchObject({
      model: 'claude-haiku-5-5',
      tool_choice: { type: 'tool', name: 'answer' },
      tools: [{ name: 'answer', input_schema: { type: 'object' } }]
    })
  })

  it('rejects a missing, off-schema or truncated answer without retrying', async () => {
    const calls = stubFetch(
      json({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'hi' }] })
    )
    await expect(createClaudeProvider('k').generateJson(jsonReq)).rejects.toBeInstanceOf(
      AiOutputError
    )
    expect(calls).toHaveLength(1)
    stubFetch(toolAnswer({ difficulty: 4, term: null }))
    await expect(createClaudeProvider('k').generateJson(jsonReq)).rejects.toBeInstanceOf(
      AiOutputError
    )
    stubFetch(json({ stop_reason: 'max_tokens', content: [] }))
    await expect(createClaudeProvider('k').generateJson(jsonReq)).rejects.toBeInstanceOf(
      AiOutputError
    )
  })

  it('asks a model that refuses a forced tool with tool_choice auto, and remembers it', async () => {
    const calls = stubFetch(
      json(
        apiError(
          'invalid_request_error',
          'tool_choice: type "tool" and "any" are not supported for this model.'
        ),
        400
      ),
      toolAnswer({ difficulty: 0.4, term: null }),
      json({
        stop_reason: 'end_turn',
        content: [{ type: 'text', text: '{"difficulty":0.5,"term":null}' }]
      })
    )
    const claude = createClaudeProvider('k')
    const req = { ...jsonReq, model: 'claude-sonnet-5-5', retries: 0 }
    await expect(claude.generateJson(req)).resolves.toMatchObject({ difficulty: 0.4 })
    // Remembered; a plain JSON text answer is accepted too.
    await expect(claude.generateJson(req)).resolves.toMatchObject({ difficulty: 0.5 })
    expect(calls.map((c) => (c.body['tool_choice'] as { type: string }).type)).toEqual([
      'tool',
      'auto',
      'auto'
    ])
  })

  it('retries once when Claude is overloaded, never after a timeout', async () => {
    const calls = stubFetch(
      json(apiError('overloaded_error', 'Overloaded'), 529),
      toolAnswer({ difficulty: 0.2, term: null })
    )
    await expect(createClaudeProvider('k').generateJson(jsonReq)).resolves.toMatchObject({
      difficulty: 0.2
    })
    expect(calls).toHaveLength(2)

    let fetches = 0
    vi.stubGlobal('fetch', (_url: string, init?: RequestInit) => {
      fetches++
      return new Promise((_resolve, reject) =>
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason))
      )
    })
    const err = await createClaudeProvider('k')
      .generateJson({ ...jsonReq, timeoutMs: 20, retries: 1 })
      .catch((e: unknown) => e)
    expect((err as AiError).code).toBe('busy')
    expect(fetches).toBe(1)
  })
})

describe('Claude keys and models', () => {
  it('validates a key against the models endpoint', async () => {
    stubFetch(json({ data: [] }))
    await expect(createClaudeProvider('k').validateKey('sk-ant-good')).resolves.toBe(true)
    stubFetch(json(apiError('authentication_error', 'bad'), 401))
    await expect(createClaudeProvider('k').validateKey('sk-ant-bad')).resolves.toBe(false)
  })

  it('maps legacy Gemini ids to the Claude model with the same role', () => {
    expect(claudeModel('claude-opus-5-5')).toBe('claude-opus-5-5')
    expect(claudeModel('gemini-3.5-flash-lite')).toBe('claude-haiku-5-5')
    expect(claudeModel('something-else')).toBe('claude-sonnet-5-5')
    expect(createAiProvider('sk-ant-x')).toBeDefined()
  })
})
