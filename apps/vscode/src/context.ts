import {
  LENS_LIMITS,
  MAX_REPLACE_WORDS,
  countWords,
  type LensContext,
  type LensSettings,
  type SelectionSize
} from '@hoot/core'

/** Paragraphs are blank-line delimited in these; anything else is treated as code. */
export const PROSE_LANGUAGES: ReadonlySet<string> = new Set([
  'markdown',
  'plaintext',
  'latex',
  'restructuredtext',
  'asciidoc'
])

/** Lines of context around a code selection. */
const CODE_LINES = 3
const ELLIPSIS = '…'
const TERM_WORDS = 3
const PHRASE_WORDS = 10
export const AUTO_MAX_WORDS = 40

export const normalizeWhitespace = (text: string): string => text.replace(/\s+/g, ' ').trim()

export function clampText(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}${ELLIPSIS}`
}

/** At most `max` characters of `text`, centred on `span` when it has to cut. */
export function windowAround(text: string, span: string, max: number): string {
  if (text.length <= max) return text
  const room = max - 2
  const at = text.indexOf(span)
  const start = Math.min(
    text.length - room,
    at < 0 ? 0 : Math.max(0, at - Math.floor((room - span.length) / 2))
  )
  const end = start + room
  return `${start > 0 ? ELLIPSIS : ''}${text.slice(start, end)}${end < text.length ? ELLIPSIS : ''}`
}

/** s1, with lens-dom's thresholds. */
export function sizeClass(words: number, multiBlock: boolean): SelectionSize {
  if (multiBlock) return 'multi-paragraph'
  if (words <= TERM_WORDS) return 'term'
  if (words <= PHRASE_WORDS) return 'phrase'
  return words <= MAX_REPLACE_WORDS ? 'sentence' : 'passage'
}

const NOTATION = /[\u00b1\u00b2\u00b3\u00b9\u00d7\u00f7\u2070-\u209f\u2200-\u22ff\u0391-\u03c9]/u
const ACRONYM = /^(?=(?:.*\p{Lu}){2})[\p{Lu}\p{N}]{2,6}s?$/u

/** s6 like lens-dom until there are word lists: notation and acronyms count as jargon. */
export function rarityOf(span: string): number {
  if (NOTATION.test(span)) return 1
  const words = span.match(/[\p{L}\p{N}]+/gu) ?? []
  const acronyms = words.filter((word) => ACRONYM.test(word)).length
  return 0.8 * Math.min(1, (3 * acronyms) / Math.max(words.length, 3))
}

/** Scripts that belong to one language (Greek is left out: in an editor it's notation). */
const SCRIPTS: ReadonlyArray<readonly [RegExp, string]> = [
  [/\p{Script=Hebrew}/u, 'he'],
  [/\p{Script=Georgian}/u, 'ka'],
  [/\p{Script=Armenian}/u, 'hy'],
  [/\p{Script=Thai}/u, 'th'],
  [/\p{Script=Hangul}/u, 'ko'],
  [/[\p{Script=Hiragana}\p{Script=Katakana}]/u, 'ja']
]

/** The span's language when its script makes it obvious, else `fallback`. */
export function languageOf(span: string, fallback = 'en'): string {
  const letters = span.match(/\p{L}/gu) ?? []
  for (const [pattern, lang] of SCRIPTS) {
    if (letters.filter((ch) => pattern.test(ch)).length * 2 >= letters.length && letters.length) {
      return lang
    }
  }
  return fallback
}

const baseLang = (tag: string): string => tag.toLowerCase().split('-')[0] ?? tag

function isForeign(lang: string, lens: LensSettings | null): boolean {
  if (!lens) return false
  const reads = [lens.languages.primary, ...lens.languages.comfortable].map(baseLang)
  return !reads.includes(baseLang(lang))
}

const FENCE = /^\s{0,3}(```|~~~)/
const ATX = /^\s{0,3}(#{1,6})\s+(.*?)(?:\s+#+)?\s*$/

/** The enclosing ATX headings above `line`, outermost first (at most three). */
export function markdownHeadings(lines: readonly string[], line: number): string[] {
  const stack: Array<{ level: number; text: string }> = []
  let fenced = false
  for (let i = 0; i < Math.min(line, lines.length); i++) {
    const text = lines[i] ?? ''
    if (FENCE.test(text)) fenced = !fenced
    const heading = fenced ? null : ATX.exec(text)
    if (!heading?.[2]) continue
    const level = heading[1]?.length ?? 1
    while ((stack[stack.length - 1]?.level ?? 0) >= level) stack.pop()
    stack.push({ level, text: clampText(normalizeWhitespace(heading[2]), LENS_LIMITS.heading) })
  }
  return stack.map((h) => h.text).slice(-LENS_LIMITS.headings)
}

const isBreak = (line: string): boolean => !line.trim() || /^\s*(#{1,6}\s|```|~~~)/.test(line)

/**
 * Prose: the blank-line-delimited paragraph holding the selection. Code: the
 * selected lines with a few lines either side.
 */
export function paragraphAround(
  lines: readonly string[],
  startLine: number,
  endLine: number,
  prose: boolean
): string {
  if (!prose) {
    const from = Math.max(0, startLine - CODE_LINES)
    return lines
      .slice(from, endLine + CODE_LINES + 1)
      .join('\n')
      .trim()
  }
  let start = startLine
  let end = endLine
  while (start > 0 && !isBreak(lines[start - 1] ?? '')) start--
  while (end < lines.length - 1 && !isBreak(lines[end + 1] ?? '')) end++
  return normalizeWhitespace(lines.slice(start, end + 1).join(' '))
}

export interface ContextInput {
  /** The whole document, one entry per line. */
  lines: readonly string[]
  startLine: number
  endLine: number
  /** The selected text. */
  text: string
  languageId: string
  /** Base name of the file. */
  fileName: string
  /** 1 for explicit requests, lower for automatic ones. */
  p: number
  dwellMs: number
  lens: LensSettings | null
  /** Lower-cased `ProfileSnapshot.knownTerms`. */
  knownTerms: ReadonlySet<string>
}

/** The span before clamping: whitespace collapsed in prose, line structure kept in code. */
export const spanOf = (text: string, languageId: string): string =>
  PROSE_LANGUAGES.has(languageId) ? normalizeWhitespace(text) : text.replace(/\r\n?/g, '\n').trim()

/** Everything that leaves VS Code for one selection (hoot-lens.md §6.3). */
export function buildContext(input: ContextInput): LensContext {
  const prose = PROSE_LANGUAGES.has(input.languageId)
  const span = clampText(spanOf(input.text, input.languageId), LENS_LIMITS.span)
  const paragraph = windowAround(
    paragraphAround(input.lines, input.startLine, input.endLine, prose) || span,
    span.endsWith(ELLIPSIS) ? span.slice(0, -1) : span,
    LENS_LIMITS.paragraph
  )
  const headings =
    input.languageId === 'markdown' ? markdownHeadings(input.lines, input.startLine) : []
  const fileName = clampText(input.fileName, LENS_LIMITS.heading)
  const lang = languageOf(span)
  const words = countWords(span)
  return {
    span,
    paragraph,
    headingPath: headings.length ? headings : fileName ? [fileName] : [],
    title: clampText(input.fileName, LENS_LIMITS.title),
    lang,
    site: '',
    siteCategory: 'general',
    surface: 'editor',
    signals: {
      sizeClass: sizeClass(words, /\n\s*\n/.test(input.text)),
      copiedWithinMs: null,
      dwellMs: input.dwellMs,
      reselectCount: 0,
      reread: 0,
      rarity: rarityOf(span),
      knownTerm: input.knownTerms.has(span.toLowerCase()),
      topicFamiliarity: null,
      foreignLanguage: isForeign(lang, input.lens),
      blocked: null
    },
    p: input.p
  }
}

export interface AutoInput {
  /** The selected text. */
  text: string
  languageId: string
  autoLanguages: readonly string[]
  lens: LensSettings | null
  knownTerms: ReadonlySet<string>
}

/** Whether a selection that stayed still may get an automatic rewrite. */
export function autoEligible(input: AutoInput): boolean {
  const { lens } = input
  if (!lens?.enabled || lens.mode === 'ask') return false
  if (!input.autoLanguages.includes(input.languageId)) return false
  const span = normalizeWhitespace(input.text)
  const words = countWords(span)
  if (words < 1 || words > AUTO_MAX_WORDS || span.length > LENS_LIMITS.span) return false
  return !input.knownTerms.has(span.toLowerCase())
}
