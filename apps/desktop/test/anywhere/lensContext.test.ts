import { describe, expect, it } from 'vitest'
import { LENS_LIMITS } from '@hoot/core'
import { LensContextSchema } from '@hoot/core/schemas'
import { buildAnywhereRequest, sizeClass } from '../../src/main/anywhere/lensContext'
import type { SelectionInfo } from '../../src/main/textAccess'

const sel = (over: Partial<SelectionInfo> = {}): SelectionInfo => ({
  text: 'idempotent',
  paragraph: 'Retries are safe because the endpoint is idempotent.',
  rects: [],
  app: { process: 'Code', title: 'api.md - Visual Studio Code' },
  source: 'uia',
  ...over
})

describe('sizeClass', () => {
  it('follows lens-dom’s word thresholds', () => {
    expect(sizeClass('idempotent')).toBe('term')
    expect(sizeClass('the retry budget is per endpoint')).toBe('phrase')
    expect(sizeClass('word '.repeat(25))).toBe('sentence')
    expect(sizeClass('word '.repeat(60))).toBe('passage')
    expect(sizeClass('One paragraph.\n\nAnother one.')).toBe('multi-paragraph')
  })
})

describe('buildAnywhereRequest', () => {
  it('builds a valid app-surface LensContext from the selection', () => {
    const r = buildAnywhereRequest(sel())!
    expect(LensContextSchema.safeParse(r.ctx).success).toBe(true)
    expect(r.ctx).toMatchObject({
      span: 'idempotent',
      paragraph: 'Retries are safe because the endpoint is idempotent.',
      headingPath: ['Code'],
      title: 'api.md - Visual Studio Code',
      site: '',
      siteCategory: 'general',
      surface: 'app',
      p: 1
    })
    expect(r.ctx.signals).toEqual({
      sizeClass: 'term',
      copiedWithinMs: null,
      dwellMs: 0,
      reselectCount: 0,
      reread: 0,
      rarity: 0.5,
      knownTerm: false,
      topicFamiliarity: null,
      foreignLanguage: false,
      blocked: null
    })
    expect(r.risk).toBe('normal')
    expect(r.tooLong).toBe(false)
  })

  it('uses the text itself when the paragraph is unknown', () => {
    expect(buildAnywhereRequest(sel({ paragraph: '' }))!.ctx.paragraph).toBe('idempotent')
  })

  it('respects LENS_LIMITS: clips long titles, apps and paragraphs around the span', () => {
    const span = 'the needle'
    const paragraph = `${'a'.repeat(3000)} ${span} ${'b'.repeat(3000)}`
    const r = buildAnywhereRequest(
      sel({
        text: span,
        paragraph,
        app: { process: 'P'.repeat(400), title: 'T'.repeat(900) }
      })
    )!
    expect(r.ctx.title).toHaveLength(LENS_LIMITS.title)
    expect(r.ctx.headingPath[0]).toHaveLength(LENS_LIMITS.heading)
    expect(r.ctx.paragraph).toHaveLength(LENS_LIMITS.paragraph)
    expect(r.ctx.paragraph).toContain(span)
  })

  it('flags a selection longer than a span and clips it', () => {
    const r = buildAnywhereRequest(sel({ text: 'x '.repeat(500).trim() }))!
    expect(r.tooLong).toBe(true)
    expect(r.ctx.span).toHaveLength(LENS_LIMITS.span)
  })

  it('treats a high-stakes window title as high risk', () => {
    const r = buildAnywhereRequest(
      sel({
        app: { process: 'WINWORD', title: 'Lease agreement - binding contract clause.docx - Word' }
      })
    )!
    expect(r.ctx.siteCategory).toBe('legal')
    expect(r.risk).toBe('high')
  })

  it('is null for whitespace-only text', () => {
    expect(buildAnywhereRequest(sel({ text: '   ' }))).toBeNull()
  })
})
