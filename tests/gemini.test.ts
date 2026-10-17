import type { GenerateContentResponse } from '@google/genai'
import { describe, expect, it } from 'vitest'
import { chunkText, toGeminiContents } from '../src/main/ai/client'
import { AiBlockedError, mapAiError } from '../src/main/ai/errors'

describe('toGeminiContents', () => {
  it('maps assistant to model and keeps string content as one text part', () => {
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
    expect(msg.parts).toEqual([
      { inlineData: { mimeType: 'image/png', data: 'AAAA' } },
      { text: 'what is this?' }
    ])
  })
})

describe('chunkText', () => {
  const chunk = (parts: object[]): GenerateContentResponse =>
    ({ candidates: [{ content: { role: 'model', parts } }] }) as GenerateContentResponse

  it('concatenates text parts and skips thoughts', () => {
    expect(
      chunkText(chunk([{ text: 'secret', thought: true }, { text: 'A' }, { text: 'B' }]))
    ).toBe('AB')
  })

  it('returns empty text for a chunk without candidates', () => {
    expect(chunkText({} as GenerateContentResponse)).toBe('')
  })
})

describe('mapAiError', () => {
  it('treats an invalid Gemini key (400 API_KEY_INVALID) as a rejected key', () => {
    expect(mapAiError({ status: 400, message: 'API key not valid. API_KEY_INVALID' })).toBe('401')
    expect(mapAiError({ status: 403, message: 'PERMISSION_DENIED' })).toBe('401')
  })

  it('keeps other 400s generic', () => {
    expect(mapAiError({ status: 400, message: 'Invalid argument' })).toBe('unknown')
  })

  it('maps quota, overload, block, and network failures', () => {
    expect(mapAiError({ status: 429, message: 'RESOURCE_EXHAUSTED' })).toBe('429')
    expect(mapAiError({ status: 503, message: 'The model is overloaded.' })).toBe('529')
    expect(mapAiError(new AiBlockedError('SAFETY'))).toBe('blocked')
    expect(mapAiError(new TypeError('fetch failed'))).toBe('network')
  })
})
