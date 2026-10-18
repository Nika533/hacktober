import { describe, expect, it } from 'vitest'
import { buildMessages, titleFrom } from '../src/chat/conversation'
import type { Attachment, Message, Session } from '../src/types/chat'

const resolver = (id: string): { base64: string; mediaType: 'image/png' } => ({
  base64: `PNG:${id}`,
  mediaType: 'image/png'
})

const msg = (partial: Partial<Message> & Pick<Message, 'role' | 'text'>): Message => ({
  id: crypto.randomUUID(),
  attachmentIds: [],
  createdAt: Date.now(),
  status: 'done',
  ...partial
})

const att = (id: string): Attachment => ({
  id,
  kind: 'capture',
  thumbDataUrl: '',
  width: 10,
  height: 10,
  createdAt: 0
})

const session = (messages: Message[], attachments: Record<string, Attachment> = {}): Session => ({
  id: 's',
  title: 't',
  createdAt: 0,
  updatedAt: 0,
  messages,
  attachments
})

describe('buildMessages', () => {
  it('puts image blocks before the text block, in attachment order', () => {
    const s = session([msg({ role: 'user', text: 'look', attachmentIds: ['a1', 'a2'] })], {
      a1: att('a1'),
      a2: att('a2')
    })
    const out = buildMessages(s, resolver)
    expect(out).toHaveLength(1)
    const blocks = out[0].content as { type: string; source?: { data: string }; text?: string }[]
    expect(blocks.map((b) => b.type)).toEqual(['image', 'image', 'text'])
    expect(blocks[0].source?.data).toBe('PNG:a1')
    expect(blocks[1].source?.data).toBe('PNG:a2')
    expect(blocks[2].text).toBe('look')
  })

  it('caps images at 8 and replaces older ones with a placeholder', () => {
    const attachments: Record<string, Attachment> = {}
    const messages: Message[] = []
    for (let i = 0; i < 10; i++) {
      attachments[`c${i}`] = att(`c${i}`)
      messages.push(msg({ role: 'user', text: `q${i}`, attachmentIds: [`c${i}`] }))
      messages.push(msg({ role: 'assistant', text: `a${i}` }))
    }
    const out = buildMessages(session(messages, attachments), resolver)
    const images = out.flatMap((m) =>
      typeof m.content === 'string' ? [] : m.content.filter((b) => b.type === 'image')
    )
    expect(images).toHaveLength(8)
    // the two oldest captures are placeholders
    const first = out[0].content as { type: string; text?: string }[]
    expect(first[0]).toEqual({ type: 'text', text: '[Earlier capture omitted to save space]' })
    const third = out[2].content as { type: string; text?: string }[]
    expect(third[0]).toEqual({ type: 'text', text: '[Earlier capture omitted to save space]' })
    const last = out[out.length - 2].content as { type: string; source?: { data: string } }[]
    expect(last[0].type).toBe('image')
  })

  it('keeps only the last 24 messages', () => {
    const messages: Message[] = []
    for (let i = 0; i < 30; i++)
      messages.push(msg({ role: i % 2 ? 'assistant' : 'user', text: `m${i}` }))
    const out = buildMessages(session(messages), resolver)
    expect(out.length).toBeLessThanOrEqual(24)
    const lastText = out[out.length - 1].content
    expect(typeof lastText === 'string' ? lastText : '').toBe('m29')
  })

  it('drops leading assistant messages so the list starts with a user', () => {
    const s = session([
      msg({ role: 'assistant', text: 'hi there' }),
      msg({ role: 'user', text: 'question' })
    ])
    const out = buildMessages(s, resolver)
    expect(out).toHaveLength(1)
    expect(out[0].role).toBe('user')
  })

  it('skips empty/errored assistant turns, keeps stopped partial text', () => {
    const s = session([
      msg({ role: 'user', text: 'q1' }),
      msg({ role: 'assistant', text: '', status: 'error', error: 'network' }),
      msg({ role: 'user', text: 'q2' }),
      msg({ role: 'assistant', text: 'partial answer', status: 'stopped' })
    ])
    const out = buildMessages(s, resolver)
    expect(out).toHaveLength(3)
    expect(out[2].content).toBe('partial answer')
  })

  it('prefers sentText over text', () => {
    const s = session([msg({ role: 'user', text: 'Explain', sentText: 'Explain this capture.' })])
    const out = buildMessages(s, resolver)
    const blocks = out[0].content as { type: string; text?: string }[]
    expect(blocks[blocks.length - 1].text).toBe('Explain this capture.')
  })
})

describe('titleFrom', () => {
  it('strips markdown, takes first 6 words', () => {
    expect(titleFrom('**How** do I `host` a Zoom meeting today please')).toBe(
      'How do I host a Zoom…'
    )
  })
  it('collapses newlines and caps at 48 chars', () => {
    expect(titleFrom('one\ntwo\nthree\nfour\nfive\nsix\nseven')).toBe(
      'one two three four five six…'
    )
    const long = titleFrom('supercalifragilisticexpialidocious-antidisestablishmentarianism')
    expect(long.length).toBeLessThanOrEqual(49)
    expect(long.endsWith('…')).toBe(true)
  })
  it('returns New chat for empty', () => {
    expect(titleFrom('')).toBe('New chat')
    expect(titleFrom('   ```code``` ')).toBe('New chat')
  })
  it('does not truncate short titles', () => {
    expect(titleFrom('hello there')).toBe('hello there')
  })
})
