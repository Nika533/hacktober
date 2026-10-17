import { expect, it } from 'vitest'
import { findTextRange } from '../src/find'

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
