import { describe, expect, it } from 'vitest'
import {
  PAGE_GUIDE,
  pageNote,
  parsePageAnswer,
  stripAnnotationTags,
  stripPageTags,
  type PageSnapshot
} from '@hoot/core'
import { AppToExtSchema, ExtToAppSchema, PageSnapshotSchema } from '@hoot/core/schemas'

function snap(over: Partial<PageSnapshot> = {}): PageSnapshot {
  return {
    tab: 7,
    url: 'https://example.com/article',
    title: 'How tides work',
    site: 'example.com',
    lang: 'en',
    selection: '',
    visible: 'The moon pulls the oceans.',
    text: 'The moon pulls the oceans. Twice a day the water rises.',
    headings: ['Tides', 'Why twice a day'],
    blocked: null,
    ...over
  }
}

describe('parsePageAnswer', () => {
  it('takes [[find]] tags out and returns their quotes and labels', () => {
    const parsed = parsePageAnswer(
      'The moon does it.\n[[find: "The moon pulls the oceans", "the cause"]]\nThat is all.'
    )
    expect(parsed.text).toBe('The moon does it.\nThat is all.')
    expect(parsed.marks).toEqual([{ quote: 'The moon pulls the oceans', label: 'the cause' }])
  })

  it('reads curly quotes, missing labels and backticks', () => {
    const parsed = parsePageAnswer('See `[[find: “Twice a day”]]` here')
    expect(parsed.marks).toEqual([{ quote: 'Twice a day', label: '' }])
    expect(parsed.text).toBe('See  here')
  })

  it('hides a tag still arriving while streaming', () => {
    expect(parsePageAnswer('Look\n[[find: "The mo', { streaming: true }).text).toBe('Look')
  })

  it('turns tags into quoted lines for views that show text', () => {
    expect(stripPageTags('Here.\n[[find: "Twice a day", "when"]]')).toBe(
      'Here.\n> “Twice a day” — when'
    )
    expect(stripAnnotationTags('A\n[[find: "B"]]')).toBe('A\n> “B”')
  })
})

describe('pageNote', () => {
  it('sends the whole page the first time, with the guide', () => {
    const { note, memory } = pageNote(snap({ selection: 'pulls' }), null, 'chrome')
    expect(note).toContain('read from Chrome (not a screenshot)')
    expect(note).toContain('Page: “How tides work” — https://example.com/article')
    expect(note).toContain('Selected on the page: “pulls”')
    expect(note).toContain('More of the page:')
    expect(note).toContain('Headings: Tides · Why twice a day')
    expect(note).toContain(PAGE_GUIDE)
    expect(memory?.url).toBe('https://example.com/article')
  })

  it('says only what is on screen for the same, unchanged page', () => {
    const first = pageNote(snap(), null, 'edge')
    const again = pageNote(snap(), first.memory, 'edge')
    expect(again.note).toContain('unchanged since the page I sent earlier')
    expect(again.note).toContain('The same part of it is on screen.')
    expect(again.note).not.toContain(PAGE_GUIDE)
    const scrolled = pageNote(snap({ visible: 'Twice a day the water rises.' }), first.memory)
    expect(scrolled.note).toContain('On screen now:')
    expect(scrolled.note).toContain('Twice a day the water rises.')
  })

  it('never describes a private page', () => {
    const { note, memory } = pageNote(
      snap({ blocked: 'private', url: '', title: '', site: '', visible: '', text: '' }),
      null
    )
    expect(note).toContain('Hoot keeps private')
    expect(note).not.toContain('example.com')
    expect(memory).toBeNull()
  })

  it('says when a page could not be read', () => {
    expect(pageNote(snap({ blocked: 'unreadable', visible: '', text: '' }), null).note).toContain(
      "a page Hoot can't read"
    )
  })
})

describe('page link messages', () => {
  it('accepts the page messages both ways', () => {
    const page = { tab: 1, url: 'https://a.com/', title: 'A' }
    for (const m of [
      { type: 'page.focus', reqId: 'b1', focused: true, page },
      { type: 'page.focus', reqId: 'b2', focused: false, page: null },
      { type: 'page.snapshot', reqId: 'page-1', snapshot: snap() },
      { type: 'page.snapshot', reqId: 'page-2', snapshot: null },
      { type: 'page.ask', reqId: 'b3', text: 'What is this?', voice: true, snapshot: snap() }
    ]) {
      expect(ExtToAppSchema.safeParse(m).success, m.type).toBe(true)
    }
    for (const m of [
      { type: 'page.read', reqId: 'page-1' },
      { type: 'page.marks', tab: 1, marks: [{ quote: 'x y', label: '' }] },
      { type: 'page.marks', tab: 1, marks: [] }
    ]) {
      expect(AppToExtSchema.safeParse(m).success, m.type).toBe(true)
    }
  })

  it('refuses oversized pages and empty questions', () => {
    expect(PageSnapshotSchema.safeParse(snap({ visible: 'x'.repeat(6001) })).success).toBe(false)
    expect(
      ExtToAppSchema.safeParse({
        type: 'page.ask',
        reqId: 'b',
        text: '  ',
        voice: false,
        snapshot: null
      }).success
    ).toBe(false)
  })
})
