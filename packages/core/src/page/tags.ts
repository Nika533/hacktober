import { PAGE_LIMITS, type PageMark } from './types'

/** `[[find: "exact words", "label"]]`, with the backticks the model sometimes adds. */
const TAG = /`?\[\[\s*find\s*:\s*([^\]]*?)\s*\]\]`?/gi
const ANY_TAG = /\[\[\s*find\s*:/i
/** A tag still arriving at the end of a streaming answer (last line only). */
const PARTIAL_TAG = /`?\[\[[^\]\n]*\]?$/
const CLOSE: Record<string, string> = { '"': '"', '“': '”', '”': '”', "'": "'", '‘': '’' }

const unquote = (s: string): string =>
  s
    .trim()
    .replace(/^["“”'‘’]/, '')
    .replace(/["“”'‘’]$/, '')
    .trim()

function parseArgs(raw: string): PageMark | null {
  const text = raw.trim()
  const close = CLOSE[text[0] ?? '']
  let quote: string
  let rest: string
  if (close) {
    const end = text.indexOf(close, 1)
    quote = text.slice(1, end < 0 ? undefined : end)
    rest = end < 0 ? '' : text.slice(end + 1)
  } else {
    const comma = text.lastIndexOf(',')
    quote = comma < 0 ? text : text.slice(0, comma)
    rest = comma < 0 ? '' : text.slice(comma)
  }
  quote = quote.replace(/\s+/g, ' ').trim().slice(0, PAGE_LIMITS.quoteChars)
  if (!quote) return null
  const label = unquote(rest.replace(/^\s*,/, '')).slice(0, PAGE_LIMITS.labelChars)
  return { quote, label }
}

export interface ParsedPageAnswer {
  /** The answer for display, tags taken out. */
  text: string
  marks: PageMark[]
}

/**
 * The page tags in an answer and the answer to display. A line that held only
 * tags goes away; with `refs`, each tag becomes a `> “quote” — label` line
 * (for views that can't highlight the page). While `streaming`, a tag still
 * arriving is hidden.
 */
export function parsePageAnswer(
  text: string,
  opts: { streaming?: boolean; refs?: boolean } = {}
): ParsedPageAnswer {
  const source = opts.streaming ? text.replace(PARTIAL_TAG, '') : text
  if (!ANY_TAG.test(source)) return { text: source.trim(), marks: [] }
  const out: string[] = []
  const marks: PageMark[] = []
  for (const line of source.split('\n')) {
    const found: PageMark[] = []
    const rest = line.replace(TAG, (_m, args: string) => {
      const mark = parseArgs(args)
      if (mark) found.push(mark)
      return ''
    })
    if (rest === line) {
      out.push(line)
      continue
    }
    if (rest.trim()) out.push(rest.trimEnd())
    for (const mark of found) {
      if (opts.refs) out.push(`> “${mark.quote}”${mark.label ? ` — ${mark.label}` : ''}`)
      if (marks.length < PAGE_LIMITS.marks) marks.push(mark)
    }
  }
  return {
    text: out
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim(),
    marks
  }
}

/** For views that show the answer as text (the card, Studio, notes). */
export const stripPageTags = (text: string): string => parsePageAnswer(text, { refs: true }).text

export const hasPageTags = (text: string): boolean => ANY_TAG.test(text)
