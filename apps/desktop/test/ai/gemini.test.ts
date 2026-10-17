import type { GenerateContentResponse } from '@google/genai'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { AiBlockedError, AiError, AiOutputError, mapAiError } from '../../src/main/ai/errors'
import {
  chunkText,
  createGeminiProvider,
  toGeminiContents,
  toResponseSchema
} from '../../src/main/ai/gemini'
import { createFakeProvider } from '../../src/main/ai/fake'
import type { ChatStreamRequest } from '../../src/main/ai/types'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

interface Call {
  url: string
  body: Record<string, unknown>
}

/** Replace fetch with a queue of canned responses; records every request. */
function stubFetch(...responses: (() => Response)[]): Call[] {
  const calls: Call[] = []
  vi.stubGlobal('fetch', async (url: string | URL, init?: RequestInit) => {
    calls.push({ url: String(url), body: JSON.parse(String(init?.body ?? '{}')) })
    init?.signal?.throwIfAborted()
    const next = responses.shift()
    if (!next) throw new Error('unexpected fetch')
    return next()
  })
  return calls
}

const sse =
  (...chunks: object[]) =>
  (): Response =>
    new Response(chunks.map((c) => `data: ${JSON.stringify(c)}\r\n\r\n`).join(''), {
      status: 200,
      headers: { 'content-type': 'text/event-stream' }
    })

const json =
  (body: object, status = 200) =>
  (): Response =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

const answer = (text: string, finishReason = 'STOP'): object => ({
  candidates: [{ content: { role: 'model', parts: [{ text }] }, finishReason }]
})

const apiError = (code: number, message: string): object => ({
  error: { code, message, status: 'ERR' }
})

const Assess = z.object({ difficulty: z.number().min(0).max(1), term: z.string().nullable() })

const jsonReq = { model: 'gemini-3.5-flash-lite', system: 'SYS', prompt: 'P', schema: Assess }

describe('toGeminiContents', () => {
  it('maps assistant to model and string content to one text part', () => {
    expect(
      toGeminiContents([
        { role: 'user', content: 'hi' },
        { role: 'assistant', content: 'hello' }
      ])
    ).toEqual([
      { role: 'user', parts: [{ text: 'hi' }] },
      { role: 'model', parts: [{ text: 'hello' }] }
    ])
  })

  it('turns image blocks into inline data parts, in order', () => {
    const [msg] = toGeminiContents([
      {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } },
          { type: 'text', text: 'what is this?' }
        ]
      }
    ])
    expect(msg?.parts).toEqual([
      { inlineData: { mimeType: 'image/png', data: 'AAAA' } },
      { text: 'what is this?' }
    ])
  })
})

describe('chunkText', () => {
  it('concatenates text parts and skips thoughts', () => {
    const chunk = {
      candidates: [
        { content: { parts: [{ text: 'secret', thought: true }, { text: 'A' }, { text: 'B' }] } }
      ]
    } as GenerateContentResponse
    expect(chunkText(chunk)).toBe('AB')
    expect(chunkText({} as GenerateContentResponse)).toBe('')
  })
})

describe('toResponseSchema', () => {
  it('emits plain JSON Schema without the $schema marker', () => {
    const schema = toResponseSchema(Assess)
    expect(schema['$schema']).toBeUndefined()
    expect(schema).toMatchObject({ type: 'object', required: ['difficulty', 'term'] })
  })
})

describe('stream', () => {
  const streamReq = (signal = new AbortController().signal): ChatStreamRequest => ({
    model: 'gemini-3.8-flash',
    system: 'SYS',
    maxTokens: 8192,
    signal,
    messages: [{ role: 'user' as const, content: 'q' }]
  })

  it('sends system instruction and thinking level, streams visible text only', async () => {
    const calls = stubFetch(
      sse(
        { candidates: [{ content: { role: 'model', parts: [{ text: 'hmm', thought: true }] } }] },
        { candidates: [{ content: { role: 'model', parts: [{ text: 'Hel' }] } }] },
        answer('lo')
      )
    )
    const deltas: string[] = []
    const res = await createGeminiProvider('AIza-test').stream(streamReq(), (d) => deltas.push(d))
    expect(deltas).toEqual(['Hel', 'lo'])
    expect(res.stopReason).toBe('STOP')
    expect(calls[0]?.url).toContain('/models/gemini-3.8-flash:streamGenerateContent?alt=sse')
    expect(calls[0]?.body).toMatchObject({
      systemInstruction: { parts: [{ text: 'SYS' }] },
      generationConfig: { maxOutputTokens: 8192, thinkingConfig: { thinkingLevel: 'LOW' } }
    })
  })

  it('reports a blocked prompt instead of an empty answer', async () => {
    stubFetch(sse({ promptFeedback: { blockReason: 'SAFETY' } }))
    await expect(createGeminiProvider('k').stream(streamReq(), () => {})).rejects.toBeInstanceOf(
      AiBlockedError
    )
  })

  it('maps a rejected key to auth', async () => {
    stubFetch(json(apiError(400, 'API key not valid. Please pass a valid API key.'), 400))
    const err = await createGeminiProvider('bad')
      .stream(streamReq(), () => {})
      .catch((e: unknown) => e)
    expect(mapAiError(err)).toBe('auth')
  })
})

describe('generateJson', () => {
  it('asks for JSON with the schema and returns the parsed value', async () => {
    const calls = stubFetch(json(answer('{"difficulty":0.7,"term":"API"}')))
    const out = await createGeminiProvider('k').generateJson(jsonReq)
    expect(out).toEqual({ difficulty: 0.7, term: 'API' })
    expect(calls[0]?.url).toContain('/models/gemini-3.5-flash-lite:generateContent')
    expect(calls[0]?.body).toMatchObject({
      generationConfig: {
        responseMimeType: 'application/json',
        responseJsonSchema: { type: 'object' },
        thinkingConfig: { thinkingLevel: 'MINIMAL' },
        maxOutputTokens: 1024
      }
    })
  })

  it('rejects replies that are not JSON or break the schema, without retrying', async () => {
    stubFetch(json(answer('not json')))
    await expect(createGeminiProvider('k').generateJson(jsonReq)).rejects.toBeInstanceOf(
      AiOutputError
    )
    const calls = stubFetch(json(answer('{"difficulty":4,"term":null}')))
    await expect(createGeminiProvider('k').generateJson(jsonReq)).rejects.toBeInstanceOf(
      AiOutputError
    )
    expect(calls).toHaveLength(1)
  })

  it('treats a truncated reply as invalid output', async () => {
    stubFetch(json(answer('{"difficulty":0.7,', 'MAX_TOKENS')))
    await expect(createGeminiProvider('k').generateJson(jsonReq)).rejects.toBeInstanceOf(
      AiOutputError
    )
  })

  it('retries once when Gemini is busy', async () => {
    const calls = stubFetch(
      json(apiError(503, 'The model is overloaded.'), 503),
      json(answer('{"difficulty":0.2,"term":null}'))
    )
    await expect(createGeminiProvider('k').generateJson(jsonReq)).resolves.toEqual({
      difficulty: 0.2,
      term: null
    })
    expect(calls).toHaveLength(2)
  })

  it('gives up after the retry budget with code busy', async () => {
    stubFetch(json(apiError(503, 'overloaded'), 503), json(apiError(503, 'overloaded'), 503))
    const err = await createGeminiProvider('k')
      .generateJson(jsonReq)
      .catch((e: unknown) => e)
    expect(err).toBeInstanceOf(AiError)
    expect((err as AiError).code).toBe('busy')
  })

  it('does not retry a rejected key', async () => {
    const calls = stubFetch(json(apiError(400, 'API_KEY_INVALID'), 400))
    const err = await createGeminiProvider('k')
      .generateJson(jsonReq)
      .catch((e: unknown) => e)
    expect((err as AiError).code).toBe('auth')
    expect(calls).toHaveLength(1)
  })

  it('times out as busy', async () => {
    vi.stubGlobal(
      'fetch',
      (_url: string, init?: RequestInit) =>
        new Promise((_resolve, reject) =>
          init?.signal?.addEventListener('abort', () => reject(init.signal?.reason))
        )
    )
    const err = await createGeminiProvider('k')
      .generateJson({ ...jsonReq, timeoutMs: 20, retries: 0 })
      .catch((e: unknown) => e)
    expect((err as AiError).code).toBe('busy')
  })

  it('surfaces caller cancellation as an AbortError, not a provider failure', async () => {
    const ac = new AbortController()
    vi.stubGlobal('fetch', async (_url: string, init?: RequestInit) => {
      ac.abort()
      init?.signal?.throwIfAborted()
      return new Response('')
    })
    const err = await createGeminiProvider('k')
      .generateJson({ ...jsonReq, signal: ac.signal })
      .catch((e: unknown) => e)
    expect((err as Error).name).toBe('AbortError')
  })
})

describe('mapAiError', () => {
  it('maps HTTP statuses, timeouts and network failures', () => {
    expect(mapAiError({ status: 403, message: 'PERMISSION_DENIED' })).toBe('auth')
    expect(mapAiError({ status: 400, message: 'Invalid argument' })).toBe('unknown')
    expect(mapAiError({ status: 429, message: 'RESOURCE_EXHAUSTED' })).toBe('rate_limited')
    expect(mapAiError({ status: 504, message: 'deadline' })).toBe('busy')
    expect(mapAiError({ name: 'TimeoutError' })).toBe('busy')
    expect(mapAiError(new TypeError('fetch failed'))).toBe('network')
    expect(mapAiError(new AiBlockedError('SAFETY'))).toBe('blocked')
  })
})

describe('fake provider', () => {
  it('streams an echo and validates scripted JSON against the schema', async () => {
    const fake = createFakeProvider({ chunkMs: 0, json: () => ({ difficulty: 0.5, term: 'x' }) })
    let text = ''
    await fake.stream(
      {
        model: 'm',
        system: 's',
        maxTokens: 1,
        signal: new AbortController().signal,
        messages: [{ role: 'user', content: 'hello' }]
      },
      (d) => (text += d)
    )
    expect(text).toContain('your message: "hello"')
    await expect(fake.generateJson(jsonReq)).resolves.toEqual({ difficulty: 0.5, term: 'x' })
    await expect(fake.validateKey('AIza123')).resolves.toBe(true)
    await expect(fake.validateKey('sk-ant-123')).resolves.toBe(false)
  })
})
