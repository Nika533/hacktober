import { LensEventSchema } from '@hoot/core/schemas'
import { describe, expect, it } from 'vitest'
import {
  applyChanges,
  lensEvent,
  truncate,
  urlHash,
  type Mark,
  type OffsetRange,
  type TextChange
} from '../src/marks'

const range = (start: number, end: number): OffsetRange => ({ start, end })
const change = (rangeOffset: number, rangeLength: number, text: string): TextChange => ({
  rangeOffset,
  rangeLength,
  text
})

describe('applyChanges', () => {
  const mark = range(10, 20)

  it('shifts marks after an edit before them', () => {
    expect(applyChanges([mark], [change(0, 2, 'abcd')]).kept).toEqual([range(12, 22)])
    expect(applyChanges([mark], [change(10, 0, 'xy')]).kept).toEqual([range(12, 22)])
  })

  it('leaves marks alone for edits after them or at their end', () => {
    expect(applyChanges([mark], [change(25, 3, '')]).kept).toEqual([mark])
    expect(applyChanges([mark], [change(20, 0, 'z')]).kept).toEqual([mark])
  })

  it('drops marks when an edit lands in or across them', () => {
    for (const c of [
      change(12, 0, 'x'),
      change(15, 2, ''),
      change(5, 10, ''),
      change(18, 5, 'q')
    ]) {
      expect(applyChanges([mark], [c])).toEqual({ kept: [], dropped: [mark] })
    }
  })

  it('handles several changes and marks at once', () => {
    const second = range(40, 45)
    const result = applyChanges([mark, second], [change(30, 0, 'abc'), change(0, 1, '')])
    expect(result.kept).toEqual([range(9, 19), range(42, 47)])
  })
})

describe('truncate', () => {
  it('keeps one line and adds an ellipsis past the limit', () => {
    expect(truncate('a\n b', 80)).toBe('a b')
    const out = truncate('word '.repeat(40), 80)
    expect(out.length).toBeLessThanOrEqual(80)
    expect(out.endsWith('…')).toBe(true)
  })
})

describe('feedback events', () => {
  const mark: Mark = {
    id: 'm1',
    uri: 'file:///c%3A/notes/a.md',
    urlHash: urlHash('file:///c%3A/notes/a.md', 'salt'),
    start: 0,
    end: 3,
    original: 'API',
    result: {
      action: 'replace',
      transform: 'expand',
      text: 'API (application programming interface)',
      term: 'API',
      confidence: 0.9,
      cacheKey: 'k1',
      latencyMs: 120,
      cached: false
    },
    ctx: {
      span: 'API',
      paragraph: 'The API is small.',
      headingPath: ['Guide'],
      title: 'a.md',
      lang: 'en',
      site: '',
      siteCategory: 'general',
      surface: 'editor',
      signals: {
        sizeClass: 'term',
        copiedWithinMs: null,
        dwellMs: 0,
        reselectCount: 0,
        reread: 0,
        rarity: 0.8,
        knownTerm: false,
        topicFamiliarity: null,
        foreignLanguage: false,
        blocked: null
      },
      p: 1
    },
    auto: false
  }

  it('hashes the file with the salt', () => {
    expect(mark.urlHash).toMatch(/^[0-9a-f]{64}$/)
    expect(urlHash(mark.uri, 'other')).not.toBe(mark.urlHash)
    expect(mark.urlHash).not.toContain('notes')
  })

  it('builds valid events linked to the rewrite', () => {
    const event = lensEvent(mark, 'shown', 1_700_000_000_000.5, 340)
    expect(LensEventSchema.parse(event)).toEqual(event)
    expect(event).toMatchObject({
      kind: 'shown',
      site: '',
      transform: 'expand',
      mode: 'replace',
      term: 'API',
      topic: 'Guide',
      spanWords: 1,
      p: 1,
      difficulty: null,
      latencyMs: 340,
      cacheKey: 'k1',
      ts: 1_700_000_000_000
    })
    expect(lensEvent(mark, 'reverted', 1).id).not.toBe(event.id)
  })
})
