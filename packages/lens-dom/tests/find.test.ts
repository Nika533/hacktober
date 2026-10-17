import { expect, it } from 'vitest'
import { findTextRange, trimRange } from '../src/find'

it('trims the trailing space Windows adds on double-click, across elements', () => {
  document.body.innerHTML = '<p id="p">The   <b>OLS</b>  estimator&nbsp;is</p>'
  const p = document.getElementById('p')!
  const range = document.createRange()
  range.setStart(p.querySelector('b')!.firstChild!, 0)
  range.setEnd(p.lastChild!, 1)
  expect(range.toString()).toBe('OLS ')
  const trimmed = trimRange(range)
  expect(trimmed.toString()).toBe('OLS')
  expect(trimmed.endContainer).toBe(p.querySelector('b')!.firstChild)

  const padded = document.createRange()
  padded.setStart(p.firstChild!, 3)
  padded.setEnd(p.lastChild!, 11)
  expect(trimRange(padded).toString()).toBe('OLS  estimator')
  const blank = document.createRange()
  blank.setStart(p.firstChild!, 3)
  blank.setEnd(p.firstChild!, 6)
  expect(trimRange(blank).collapsed).toBe(true)
})

it('finds text across inline elements and skips Lens marks', () => {
  document.body.innerHTML =
    '<p id="p">fit <b>the</b> model <hoot-lens-mark>model</hoot-lens-mark> twice: model</p>'
  const p = document.getElementById('p')!
  expect(findTextRange(p, 'fit the mo')?.toString()).toBe('fit the mo')
  const range = findTextRange(p, 'model twice')
  expect(range).toBeNull()
  const last = findTextRange(p, ': model')
  expect(last?.startContainer).toBe(p.lastChild)
  expect(findTextRange(p, '')).toBeNull()
})
