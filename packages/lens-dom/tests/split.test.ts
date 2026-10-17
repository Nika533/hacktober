import { beforeEach, describe, expect, it } from 'vitest'
import { containedRoots, mergeSplits, normalizeRange, siblingRuns } from '../src/render/split'
import { rangeAcross, rangeOf } from './helpers'

let p: HTMLElement

beforeEach(() => {
  document.body.innerHTML = '<p id="p">hello world foo <b>bar</b> baz</p>'
  p = document.getElementById('p') as HTMLElement
})

describe('normalizeRange', () => {
  it('splits a single text node at both boundaries', () => {
    const text = p.firstChild as Text
    const { range, splits } = normalizeRange(rangeOf(text, 6, 11))
    expect(range.toString()).toBe('world')
    expect(splits).toHaveLength(2)
    expect(text.data).toBe('hello ')
    expect(p.childNodes[1]?.textContent).toBe('world')
    expect(range.startContainer).toBe(p)
    expect(range.endContainer).toBe(p)
  })

  it('does not split when boundaries are already at node edges', () => {
    const text = p.firstChild as Text
    const { range, splits } = normalizeRange(rangeOf(text, 0, text.length))
    expect(splits).toHaveLength(0)
    expect(range.toString()).toBe('hello world foo ')
  })

  it('handles a boundary at the very end of a text node', () => {
    const text = p.firstChild as Text
    const bold = p.querySelector('b') as HTMLElement
    const { range, splits } = normalizeRange(rangeAcross(text, text.length, bold.firstChild!, 3))
    expect(splits).toHaveLength(0)
    expect(range.toString()).toBe('bar')
  })

  it('keeps element-container boundaries stable across splits', () => {
    const text = p.firstChild as Text
    const range = document.createRange()
    range.setStart(text, 6)
    range.setEnd(p, 2)
    const normalized = normalizeRange(range)
    expect(normalized.range.toString()).toBe('world foo bar')
  })

  it('round-trips through mergeSplits with the original node object', () => {
    const text = p.firstChild as Text
    const before = p.innerHTML
    const { splits } = normalizeRange(rangeOf(text, 3, 9))
    mergeSplits(splits)
    expect(p.innerHTML).toBe(before)
    expect(p.firstChild).toBe(text)
    expect(text.data).toBe('hello world foo ')
  })
})

describe('containedRoots and siblingRuns', () => {
  it('returns whole elements that are fully selected', () => {
    const text = p.firstChild as Text
    const tail = p.lastChild as Text
    const { range } = normalizeRange(rangeAcross(text, 12, tail, 2))
    const roots = containedRoots(range)
    expect(roots.map((node) => node.textContent)).toEqual(['foo ', 'bar', ' b'])
    expect(siblingRuns(roots)).toHaveLength(1)
  })

  it('descends into partially selected elements and groups by parent', () => {
    const text = p.firstChild as Text
    const boldText = p.querySelector('b')!.firstChild as Text
    const { range } = normalizeRange(rangeAcross(text, 12, boldText, 2))
    const runs = siblingRuns(containedRoots(range))
    expect(runs.map((run) => run.map((node) => node.textContent).join(''))).toEqual(['foo ', 'ba'])
  })
})
