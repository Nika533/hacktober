import {
  classifySite,
  countWords,
  LENS_LIMITS,
  MAX_REPLACE_WORDS,
  type DomainRisk,
  type LensContext,
  type SelectionSize
} from '@hoot/core'
import { LensContextSchema } from '@hoot/core/schemas'
import type { SelectionInfo } from '../textAccess'

/** s1 from the word count, with lens-dom's thresholds; a blank line makes it multi-paragraph. */
export function sizeClass(text: string): SelectionSize {
  if (/\n\s*\n/.test(text)) return 'multi-paragraph'
  const words = countWords(text)
  if (words <= 3) return 'term'
  if (words <= 10) return 'phrase'
  return words <= MAX_REPLACE_WORDS ? 'sentence' : 'passage'
}

const clip = (s: string, max: number): string => (s.length > max ? s.slice(0, max) : s)

/** A `max`-character window of `paragraph`, centred on the span when it's inside. */
function around(paragraph: string, span: string, max: number): string {
  if (paragraph.length <= max) return paragraph
  const at = paragraph.indexOf(span)
  if (at < 0) return paragraph.slice(0, max)
  const start = Math.min(
    Math.max(0, at - Math.floor((max - span.length) / 2)),
    paragraph.length - max
  )
  return paragraph.slice(start, start + max)
}

export interface AnywhereRequest {
  ctx: LensContext
  risk: DomainRisk
  /** The selection is longer than a span may be (`ctx.span` is clipped). */
  tooLong: boolean
}

/**
 * The LensContext for text selected in another app. The window title stands
 * in for the page title (it usually names the document), the process for the
 * heading; the language is undetermined, so the model may still translate.
 * The user asked explicitly, hence p = 1. Null if it fails the schema.
 */
export function buildAnywhereRequest(sel: SelectionInfo): AnywhereRequest | null {
  const text = sel.text.trim()
  const span = clip(text, LENS_LIMITS.span)
  const title = clip(sel.app.title.trim(), LENS_LIMITS.title)
  const app = clip(sel.app.process.trim(), LENS_LIMITS.heading)
  const site = classifySite({ hostname: '', title, headings: [] })
  const parsed = LensContextSchema.safeParse({
    span,
    paragraph: around(sel.paragraph.trim() || text, span, LENS_LIMITS.paragraph),
    headingPath: app ? [app] : [],
    title,
    lang: 'und',
    site: '',
    siteCategory: site.category,
    surface: 'app',
    signals: {
      sizeClass: sizeClass(text),
      copiedWithinMs: null,
      dwellMs: 0,
      reselectCount: 0,
      reread: 0,
      rarity: 0.5,
      knownTerm: false,
      topicFamiliarity: null,
      foreignLanguage: false,
      blocked: null
    },
    p: 1
  } satisfies LensContext)
  if (!parsed.success) return null
  return { ctx: parsed.data, risk: site.risk, tooLong: text.length > LENS_LIMITS.span }
}
