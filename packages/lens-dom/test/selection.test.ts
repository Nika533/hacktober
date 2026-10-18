import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  SelectionWatcher,
  sizeClass,
  type SelectionCandidate,
  type SelectionListener
} from '../src/selection'
import { loadArticle, rangeAcross, rangeForText } from './helpers'

let article: HTMLElement
let now: number
let watcher: SelectionWatcher
let events: Array<{ type: string; candidate?: SelectionCandidate; afterSettle?: boolean }>

const listener: SelectionListener = {
  settled: (candidate) => events.push({ type: 'settled', candidate }),
  dwell: (candidate) => events.push({ type: 'dwell', candidate }),
  cleared: () => events.push({ type: 'cleared' }),
  copied: ({ afterSettle }) => events.push({ type: 'copied', afterSettle })
}

function select(range: Range | null): void {
  const selection = document.getSelection()!
  selection.removeAllRanges()
  if (range) selection.addRange(range)
  document.dispatchEvent(new Event('selectionchange'))
}

function advance(ms: number): void {
  now += ms
  vi.advanceTimersByTime(ms)
}

beforeEach(() => {
  vi.useFakeTimers()
  now = 1000
  article = loadArticle()
  events = []
  watcher = new SelectionWatcher({ document, now: () => now }, listener)
})

afterEach(() => {
  watcher.destroy()
  document.getSelection()?.removeAllRanges()
  vi.useRealTimers()
})

describe('SelectionWatcher', () => {
  it('settles after the selection stops changing, then reports dwell', () => {
    select(rangeForText(article, 'heteroscedasticity'))
    advance(299)
    expect(events).toEqual([])
    advance(1)
    expect(events.map((event) => event.type)).toEqual(['settled'])
    const candidate = events[0]?.candidate
    expect(candidate?.text).toBe('heteroscedasticity')
    expect(candidate?.signals).toMatchObject({
      sizeClass: 'term',
      words: 1,
      reselectCount: 0,
      copiedWithinMs: null
    })
    advance(900)
    expect(events.map((event) => event.type)).toEqual(['settled', 'dwell'])
    expect(events[1]?.candidate?.signals.dwellMs).toBe(1200)
  })

  it('waits for the pointer to come up while dragging', () => {
    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true, composed: true }))
    select(rangeForText(article, 'linear model'))
    advance(1000)
    expect(events).toEqual([])
    document.body.dispatchEvent(new Event('pointerup', { bubbles: true }))
    advance(300)
    expect(events.map((event) => event.type)).toEqual(['settled'])
  })

  it('treats a copy after the selection as a strong negative and cancels dwell', () => {
    select(rangeForText(article, 'residuals'))
    advance(300)
    document.dispatchEvent(new Event('copy'))
    advance(2000)
    expect(events.map((event) => event.type)).toEqual(['settled', 'copied'])
    expect(events[1]?.afterSettle).toBe(true)
    expect(events[0]?.candidate?.signals.copiedWithinMs).toBe(0)
  })

  it('reports clearing and marks a reselected span', () => {
    select(rangeForText(article, 'fitted values'))
    advance(300)
    select(null)
    select(rangeForText(article, 'fitted values'))
    advance(300)
    expect(events.map((event) => event.type)).toEqual(['settled', 'cleared', 'settled'])
    expect(events[2]?.candidate?.signals.reselectCount).toBe(1)
  })

  it('holds off while the user is typing and after a fast scroll', () => {
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }))
    select(rangeForText(article, 'standard errors'))
    advance(300)
    expect(events).toEqual([])
    advance(700)
    expect(events.map((event) => event.type)).toEqual(['settled'])

    events = []
    select(null)
    events = []
    Object.defineProperty(window, 'scrollY', { value: 0, configurable: true })
    document.dispatchEvent(new Event('scroll'))
    advance(10)
    Object.defineProperty(window, 'scrollY', { value: 400, configurable: true })
    document.dispatchEvent(new Event('scroll'))
    select(rangeForText(article, 'trustworthy'))
    advance(300)
    expect(events).toEqual([])
    advance(700)
    expect(events.map((event) => event.type)).toEqual(['settled'])
  })

  it('ignores selections in form fields and in Lens UI', () => {
    const input = document.createElement('input')
    input.value = 'typed words here'
    document.body.append(input)
    input.focus()
    select(rangeForText(article, 'residuals'))
    advance(2000)
    expect(events).toEqual([])
    input.blur()
  })

  it('still sees selections while a checkbox, radio or button has focus', () => {
    for (const type of ['checkbox', 'radio', 'button']) {
      const input = document.createElement('input')
      input.type = type
      document.body.append(input)
      input.focus()
      events = []
      select(rangeForText(article, 'residuals'))
      advance(300)
      expect(
        events.map((event) => event.type),
        type
      ).toEqual(['settled'])
      select(null)
      input.remove()
    }
  })

  it('classifies selections that span blocks as multi-paragraph', () => {
    const items = article.querySelectorAll('#list li')
    select(rangeAcross(items[0]!.firstChild!, 0, items[1]!.lastChild!, 3))
    advance(300)
    expect(events[0]?.candidate?.signals.sizeClass).toBe('multi-paragraph')
  })
})

describe('sizeClass', () => {
  it.each([
    [1, false, 'term'],
    [3, false, 'term'],
    [7, false, 'phrase'],
    [25, false, 'sentence'],
    [40, false, 'sentence'],
    [41, false, 'passage'],
    [120, false, 'passage'],
    [5, true, 'multi-paragraph']
  ] as const)('%i words, multiBlock %s → %s', (words, multiBlock, expected) => {
    expect(sizeClass(words, multiBlock)).toBe(expected)
  })
})
