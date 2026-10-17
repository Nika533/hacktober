import { beforeEach, describe, expect, it } from 'vitest'
import { findTextRange } from '../src/find'
import { checkRange } from '../src/guard'
import { InlineRenderer } from '../src/render/inline'
import type { RangeCheck } from '../src/render/types'
import { rangeAcross, rangeForText } from './helpers'

beforeEach(() => {
  document.body.innerHTML = `
    <article id="root">
      <p id="plain">A plain sentence about variance and bias.</p>
      <p>Edit <input value="input text"> here and <textarea>area text</textarea>.</p>
      <div contenteditable="true"><p>editable paragraph text</p></div>
      <div contenteditable="false"><p>not editable text</p></div>
      <div role="textbox">role textbox text</div>
      <pre>pre formatted code</pre>
      <p>Call <code>fit_model()</code> to start.</p>
      <blockquote>quoted words here</blockquote>
      <p>She said <q>inline quote text</q> twice.</p>
      <p id="links">Read about <a href="/blue">best linear estimators</a> today.</p>
      <p hidden>hidden words</p>
      <p aria-hidden="true">aria hidden words</p>
      <p id="first">First block text.</p>
      <p id="second">Second block text.</p>
      <p>Already <hoot-lens-mark>marked words</hoot-lens-mark> inside.</p>
    </article>`
})

const root = (): HTMLElement => document.getElementById('root') as HTMLElement
const reason = (needle: string, action?: 'replace' | 'gloss'): string | undefined => {
  const result = checkRange(rangeForText(root(), needle), action)
  return result.ok ? undefined : result.reason
}

describe('checkRange', () => {
  it('allows plain paragraph text', () => {
    expect(reason('variance and bias')).toBeUndefined()
  })

  it.each([
    ['area text', 'editable'],
    ['editable paragraph', 'editable'],
    ['role textbox', 'editable'],
    ['pre formatted', 'code'],
    ['fit_model', 'code'],
    ['quoted words', 'quote'],
    ['inline quote', 'quote'],
    ['hidden words', 'hidden'],
    ['aria hidden words', 'hidden'],
    ['marked words', 'marked']
  ])('blocks %s (%s)', (needle, expected) => {
    expect(reason(needle)).toBe(expected)
  })

  it('treats contenteditable="false" as normal text', () => {
    expect(reason('not editable text')).toBeUndefined()
  })

  it('blocks a range that contains code or a quote', () => {
    const across = (needle: string): RangeCheck => checkRange(findTextRange(root(), needle)!)
    expect(across('Call fit_model() to')).toEqual({ ok: false, reason: 'code' })
    expect(across('said inline quote text twice')).toEqual({ ok: false, reason: 'quote' })
  })

  it('never changes link text, but allows a gloss around a whole link', () => {
    expect(reason('linear estimators')).toBe('link')
    expect(reason('linear estimators', 'gloss')).toBe('link')
    const links = document.getElementById('links') as HTMLElement
    const range = rangeAcross(links.firstChild!, 0, links.lastChild!, 6)
    expect(checkRange(range, 'replace')).toEqual({ ok: false, reason: 'link' })
    expect(checkRange(range, 'gloss')).toEqual({ ok: true })
  })

  it('blocks ranges across blocks, empty ranges and over-long spans', () => {
    const first = document.getElementById('first')!.firstChild as Text
    const second = document.getElementById('second')!.firstChild as Text
    expect(checkRange(rangeAcross(first, 6, second, 6))).toEqual({
      ok: false,
      reason: 'multi-block'
    })
    expect(checkRange(rangeAcross(first, 3, first, 3)).ok).toBe(false)
    const plain = document.getElementById('plain')!
    plain.textContent = 'x'.repeat(601)
    expect(checkRange(rangeAcross(plain.firstChild!, 0, plain.firstChild!, 601))).toEqual({
      ok: false,
      reason: 'too-long'
    })
  })

  it('makes the renderer refuse blocked ranges without touching the DOM', () => {
    const renderer = new InlineRenderer({ document })
    const before = document.body.innerHTML
    expect(
      renderer.apply(rangeForText(root(), 'pre formatted'), {
        action: 'replace',
        transform: 'simplify',
        text: 'x'
      })
    ).toBeNull()
    expect(document.body.innerHTML).toBe(before)
  })
})
