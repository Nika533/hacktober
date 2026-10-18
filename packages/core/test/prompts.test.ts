import { describe, expect, it } from 'vitest'
import {
  stripAnnotationTags,
  QUICK_ACTIONS,
  clipboardTextBlock,
  greetingFor
} from '../src/chat/prompts'

const at = (h: number): Date => new Date(2026, 9, 17, h, 0, 0)

describe('greetingFor', () => {
  it('picks titles by hour boundaries', () => {
    expect(greetingFor(at(5)).title).toBe('Good morning!')
    expect(greetingFor(at(11)).title).toBe('Good morning!')
    expect(greetingFor(at(12)).title).toBe('Good afternoon!')
    expect(greetingFor(at(17)).title).toBe('Good afternoon!')
    expect(greetingFor(at(18)).title).toBe('Good evening!')
    expect(greetingFor(at(22)).title).toBe('Good evening!')
    expect(greetingFor(at(23)).title).toBe('Hi, night owl!')
    expect(greetingFor(at(3)).title).toBe('Hi, night owl!')
    expect(greetingFor(at(4)).title).toBe('Hi, night owl!')
  })

  it('prioritises the clipboard hint', () => {
    const g = greetingFor(at(10), { title: 'x', updatedAt: Date.now() }, true)
    expect(g.action).toBe('clipboard')
    expect(g.subtitle).toContain('copied')
  })

  it('offers to continue a session updated < 2h ago', () => {
    const now = at(12)
    const g = greetingFor(now, {
      title: 'Excel formulas',
      updatedAt: now.getTime() - 60 * 60 * 1000
    })
    expect(g.action).toBe('continue')
    expect(g.subtitle).toBe('Continue “Excel formulas”?')
  })

  it('falls back to the generic subtitle for stale sessions', () => {
    const now = at(12)
    const g = greetingFor(now, { title: 'old', updatedAt: now.getTime() - 3 * 60 * 60 * 1000 })
    expect(g.subtitle).toBe('How can I help you?')
    expect(g.action).toBeUndefined()
  })
})

describe('QUICK_ACTIONS', () => {
  it('interpolates the target language for translate', () => {
    const p = QUICK_ACTIONS.translate.prompt({ translateTo: 'German' })
    expect(p).toContain('into German')
    expect(p).toContain('already in German')
  })
  it('has labels for every action', () => {
    expect(QUICK_ACTIONS.explain.label).toBe('Explain')
    expect(QUICK_ACTIONS.extract.label).toBe('Extract text')
    expect(QUICK_ACTIONS.summarize.label).toBe('Summarize')
    expect(QUICK_ACTIONS.fix.label).toBe('Fix this')
  })
})

describe('clipboardTextBlock', () => {
  it('wraps text in a quoted block, capped at 8000 chars', () => {
    const t = clipboardTextBlock('hello')
    expect(t).toContain('"""')
    expect(t).toContain('hello')
    expect(clipboardTextBlock('x'.repeat(9000)).length).toBeLessThan(9000)
  })
})

describe('stripAnnotationTags', () => {
  it('takes the live overlay tags out of an answer shown elsewhere', () => {
    expect(
      stripAnnotationTags(
        'Click **Save**.\n[[point: 120, 40, "Save"]]\nThen `[[box: 1, 2, 3, 4, "Chart"]]` check it. [[action: 5, 6, "Go"]]'
      )
    ).toBe('Click **Save**.\nThen  check it.')
  })

  it('leaves answers without tags alone', () => {
    expect(stripAnnotationTags('Arrays look like [[1, 2], [3]].')).toBe(
      'Arrays look like [[1, 2], [3]].'
    )
  })
})
