import { describe, expect, it } from 'vitest'
import { CODE_IN_CHAT, nextSpeech, speakableText, voiceNote } from '@hoot/core'

describe('speakableText', () => {
  it('drops markup, links and tags, and ends every line like a sentence', () => {
    const md = [
      '## Two options',
      'Use **Ctrl+C** to copy, see [the docs](https://example.com/docs).',
      '- First item',
      '1. Second `item`',
      '[[point: 10, 20, "Here"]]',
      '[[find: "exact words", "label"]]',
      'Visit https://example.com now'
    ].join('\n')
    expect(speakableText(md)).toBe(
      'Two options. Use Ctrl+C to copy, see the docs. First item. Second item. Visit the link now.'
    )
  })

  it('says once that the code is in the chat, for any number of code blocks', () => {
    const md = 'Here:\n```ts\nconst a = 1\n```\nAnd:\n```\nb\n```\nDone.'
    expect(speakableText(md)).toBe(`Here: ${CODE_IN_CHAT} And: Done.`)
  })

  it('reads table rows as lists and skips the rule', () => {
    expect(speakableText('| Name | Age |\n| --- | --- |\n| Ana | 31 |')).toBe('Name, Age. Ana, 31.')
  })

  it('keeps snake_case words and drops emphasis underscores and emoji', () => {
    expect(speakableText('Set _max_items_ in file_name 🎉')).toBe('Set max_items in file_name.')
  })

  it('while streaming, leaves out a tag, link or inline code still arriving', () => {
    expect(speakableText('Look here [[point: 1, 2', true)).toBe('Look here.')
    expect(speakableText('See [the do', true)).toBe('See.')
    expect(speakableText('Run `npm i', true)).toBe('Run.')
    // A finished inline code span at the end stays.
    expect(speakableText('Run `npm i` now', true)).toBe('Run npm i now.')
  })

  it('keeps the spoken prefix stable as the answer grows', () => {
    const a = speakableText('First sentence. Second', true)
    const b = speakableText('First sentence. Second one is done. Third', true)
    expect(b.startsWith('First sentence. ')).toBe(true)
    expect(a.startsWith('First sentence. ')).toBe(true)
  })
})

describe('nextSpeech', () => {
  it('hands out only finished sentences while streaming', () => {
    const clean = 'Hello there. How are'
    expect(nextSpeech(clean, 0, false)).toEqual({ text: 'Hello there.', end: 13 })
    expect(nextSpeech(clean, 13, false)).toBeNull()
  })

  it('hands out everything left at the end', () => {
    expect(nextSpeech('Hello there. How are you', 13, true)).toEqual({
      text: 'How are you',
      end: 24
    })
    expect(nextSpeech('Done.', 5, true)).toBeNull()
  })

  it('takes every finished sentence at once, and never splits decimals', () => {
    const clean = 'It costs 3.50 dollars. That is cheap! Next'
    expect(nextSpeech(clean, 0, false)?.text).toBe('It costs 3.50 dollars. That is cheap!')
  })
})

describe('voiceNote', () => {
  it('asks for a spoken-style answer only when Hoot reads it aloud', () => {
    expect(voiceNote(true)).toMatch(/reads your answer to me aloud/)
    expect(voiceNote(false)).not.toMatch(/aloud:/)
    expect(voiceNote(false)).toMatch(/speech recognition/)
  })
})
