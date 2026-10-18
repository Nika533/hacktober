import { DEFAULT_LENS_SETTINGS } from '@hoot/core'
import { LensContextSchema } from '@hoot/core/schemas'
import { describe, expect, it } from 'vitest'
import {
  autoEligible,
  buildContext,
  languageOf,
  markdownHeadings,
  paragraphAround,
  sizeClass,
  windowAround,
  type ContextInput
} from '../src/context'

const lens = { ...DEFAULT_LENS_SETTINGS, enabled: true }

const README = [
  '# Hoot',
  '',
  'Intro text.',
  '',
  '## Install',
  '',
  '```sh',
  '# not a heading',
  '```',
  '',
  '### On Windows',
  '',
  'Hoot registers a native messaging host',
  'for Chrome and Edge when it starts.',
  '',
  'Next paragraph.'
]

const input = (over: Partial<ContextInput> = {}): ContextInput => ({
  lines: README,
  startLine: 12,
  endLine: 12,
  text: 'native messaging host',
  languageId: 'markdown',
  fileName: 'README.md',
  p: 1,
  dwellMs: 0,
  lens,
  knownTerms: new Set(),
  ...over
})

describe('markdown headings', () => {
  it('returns the enclosing headings outermost first and skips fenced code', () => {
    expect(markdownHeadings(README, 12)).toEqual(['Hoot', 'Install', 'On Windows'])
    expect(markdownHeadings(README, 8)).toEqual(['Hoot', 'Install'])
    expect(markdownHeadings(README, 0)).toEqual([])
  })

  it('pops siblings and keeps the last three levels', () => {
    const lines = ['# A', '## B', '### C', '#### D', '## E ##', 'text']
    expect(markdownHeadings(lines, 4)).toEqual(['B', 'C', 'D'])
    expect(markdownHeadings(lines, 5)).toEqual(['A', 'E'])
  })
})

describe('paragraphs', () => {
  it('takes the blank-line-delimited paragraph in prose', () => {
    expect(paragraphAround(README, 13, 13, true)).toBe(
      'Hoot registers a native messaging host for Chrome and Edge when it starts.'
    )
    expect(paragraphAround(['# Title', 'Body line'], 1, 1, true)).toBe('Body line')
  })

  it('takes a few lines around a code selection', () => {
    const code = Array.from({ length: 20 }, (_, i) => `line ${i}`)
    expect(paragraphAround(code, 10, 10, false)).toBe(code.slice(7, 14).join('\n'))
    expect(paragraphAround(code, 0, 1, false)).toBe(code.slice(0, 5).join('\n'))
  })

  it('windows long text around the span', () => {
    const text = `${'a '.repeat(1000)}TARGET${' b'.repeat(1000)}`
    const out = windowAround(text, 'TARGET', 1500)
    expect(out.length).toBeLessThanOrEqual(1500)
    expect(out).toContain('TARGET')
    expect(out.startsWith('…') && out.endsWith('…')).toBe(true)
  })
})

describe('buildContext', () => {
  it('builds a valid editor context for prose', () => {
    const ctx = buildContext(input({ text: '  native\n messaging host ' }))
    expect(LensContextSchema.parse(ctx)).toEqual(ctx)
    expect(ctx).toMatchObject({
      span: 'native messaging host',
      paragraph: 'Hoot registers a native messaging host for Chrome and Edge when it starts.',
      headingPath: ['Hoot', 'Install', 'On Windows'],
      title: 'README.md',
      lang: 'en',
      site: '',
      siteCategory: 'general',
      surface: 'editor',
      p: 1,
      signals: { sizeClass: 'term', knownTerm: false, foreignLanguage: false, blocked: null }
    })
  })

  it('uses the file name as the heading path outside markdown and keeps code lines', () => {
    const lines = ['function f() {', '  return a ?? b', '}']
    const ctx = buildContext(
      input({
        lines,
        startLine: 1,
        endLine: 1,
        text: 'a ?? b',
        languageId: 'typescript',
        fileName: 'x.ts'
      })
    )
    expect(ctx.headingPath).toEqual(['x.ts'])
    expect(ctx.paragraph).toBe(lines.join('\n'))
    expect(LensContextSchema.safeParse(ctx).success).toBe(true)
  })

  it('clamps everything to the schema limits', () => {
    const long = 'word '.repeat(400)
    const ctx = buildContext(
      input({ lines: [long], startLine: 0, endLine: 0, text: long, fileName: 'f'.repeat(400) })
    )
    expect(LensContextSchema.safeParse(ctx).success).toBe(true)
    expect(ctx.span).toHaveLength(600)
    expect(ctx.signals.sizeClass).toBe('passage')
  })

  it('marks known terms and foreign scripts', () => {
    expect(
      buildContext(input({ text: 'API', knownTerms: new Set(['api']) })).signals.knownTerm
    ).toBe(true)
    const ko = buildContext(input({ text: '안녕하세요' }))
    expect(ko.lang).toBe('ko')
    expect(ko.signals.foreignLanguage).toBe(true)
  })
})

describe('signals', () => {
  it('classifies sizes like lens-dom', () => {
    expect(sizeClass(1, false)).toBe('term')
    expect(sizeClass(8, false)).toBe('phrase')
    expect(sizeClass(30, false)).toBe('sentence')
    expect(sizeClass(41, false)).toBe('passage')
    expect(sizeClass(2, true)).toBe('multi-paragraph')
  })

  it('guesses only obvious languages', () => {
    expect(languageOf('ありがとう')).toBe('ja')
    expect(languageOf('Schadenfreude')).toBe('en')
    expect(languageOf('σ² = Σ(x − μ)²')).toBe('en')
    expect(languageOf('42')).toBe('en')
  })
})

describe('autoEligible', () => {
  const base = {
    text: 'heteroscedasticity',
    languageId: 'markdown',
    autoLanguages: ['markdown', 'plaintext'],
    lens,
    knownTerms: new Set<string>()
  }

  it('accepts a short selection in a prose language while Lens is on', () => {
    expect(autoEligible(base)).toBe(true)
  })

  it.each([
    ['another language', { languageId: 'typescript' }],
    ['Lens off', { lens: { ...lens, enabled: false } }],
    ['no settings yet', { lens: null }],
    ['Ask first', { lens: { ...lens, mode: 'ask' as const } }],
    ['more than 40 words', { text: 'word '.repeat(41) }],
    ['a blank selection', { text: '   ' }],
    ['a known term', { text: 'API', knownTerms: new Set(['api']) }]
  ])('rejects %s', (_label, over) => {
    expect(autoEligible({ ...base, ...over })).toBe(false)
  })
})
