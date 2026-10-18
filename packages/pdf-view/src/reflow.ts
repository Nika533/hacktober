/**
 * Reflow: turn a PDF page's positioned text runs into readable blocks
 * (headings and paragraphs) that wrap to any width. Pure, so it is tested
 * without PDF.js; `runsFromTextContent` adapts PDF.js output.
 *
 * Heuristics, in reading order as the content stream gives it (which keeps
 * columns apart better than sorting by position):
 * - a new line starts when the baseline moves by more than half a font size;
 * - a new block starts on a larger vertical gap or a font-size change;
 * - blocks set noticeably larger than the body size become headings;
 * - a word split by a line-end hyphen ("confi-" / "dence") is rejoined.
 */

export interface TextRun {
  str: string
  /** Left edge, PDF points. */
  x: number
  /** Baseline, PDF points from the page bottom (grows upward). */
  y: number
  width: number
  fontSize: number
}

export type ReflowBlock =
  | { kind: 'heading'; level: 2 | 3; text: string; page: number }
  | { kind: 'paragraph'; text: string; page: number }

interface Line {
  text: string
  x: number
  y: number
  fontSize: number
}

const SPACE = /\s$/
const LEADING_SPACE = /^\s/

/** Groups runs into lines, inserting spaces where the runs leave a gap. */
export function linesFromRuns(runs: readonly TextRun[]): Line[] {
  const lines: Line[] = []
  let cur: (Line & { end: number }) | null = null
  for (const r of runs) {
    if (!r.str) continue
    const size = r.fontSize || 1
    if (cur && Math.abs(r.y - cur.y) <= Math.max(size, cur.fontSize) * 0.5) {
      const gap = r.x - cur.end
      const needsSpace = gap > size * 0.15 && !SPACE.test(cur.text) && !LEADING_SPACE.test(r.str)
      cur.text += (needsSpace ? ' ' : '') + r.str
      cur.end = Math.max(cur.end, r.x + r.width)
      cur.fontSize = Math.max(cur.fontSize, size)
      continue
    }
    if (cur) lines.push(cur)
    cur = { text: r.str, x: r.x, y: r.y, fontSize: size, end: r.x + r.width }
  }
  if (cur) lines.push(cur)
  return lines
    .map(({ text, x, y, fontSize }) => ({ text: text.replace(/\s+/g, ' ').trim(), x, y, fontSize }))
    .filter((l) => l.text.length > 0)
}

/** The font size carrying the most characters: the body text size. */
export function bodyFontSize(lines: readonly Line[]): number {
  const weight = new Map<number, number>()
  for (const l of lines) {
    const k = Math.round(l.fontSize * 2) / 2
    weight.set(k, (weight.get(k) ?? 0) + l.text.length)
  }
  let best = 0
  let size = 0
  for (const [k, w] of weight) {
    if (w > best) {
      best = w
      size = k
    }
  }
  return size
}

/** Joins two wrapped lines, undoing a line-end hyphen inside a word. */
export function joinLines(a: string, b: string): string {
  if (/[\p{L}]-$/u.test(a) && /^\p{Ll}/u.test(b)) return a.slice(0, -1) + b
  return `${a} ${b}`
}

const sameSize = (a: number, b: number): boolean => Math.abs(a - b) <= Math.max(a, b) * 0.12

/**
 * Builds blocks for one page. `body` is the document's body font size
 * (pass bodyFontSize over all pages so headings are judged consistently).
 */
export function reflowPage(
  runs: readonly TextRun[],
  page: number,
  body = bodyFontSize(linesFromRuns(runs))
): ReflowBlock[] {
  const lines = linesFromRuns(runs)
  const blocks: ReflowBlock[] = []
  let text = ''
  let size = 0
  let lastY = 0

  const flush = (): void => {
    if (!text) return
    const ratio = body > 0 ? size / body : 1
    if (ratio >= 1.25 && text.length <= 200) {
      blocks.push({ kind: 'heading', level: ratio >= 1.75 ? 2 : 3, text, page })
    } else {
      blocks.push({ kind: 'paragraph', text, page })
    }
    text = ''
  }

  for (const l of lines) {
    const gap = lastY - l.y
    const continues =
      text !== '' &&
      sameSize(l.fontSize, size) &&
      gap > 0 &&
      gap <= Math.max(l.fontSize, size) * 1.6
    if (continues) {
      text = joinLines(text, l.text)
    } else {
      flush()
      text = l.text
      size = l.fontSize
    }
    lastY = l.y
  }
  flush()
  return blocks
}

/** Minimal shape of a PDF.js TextItem. */
export interface PdfTextItemLike {
  str: string
  transform: readonly number[]
  width?: number
  height?: number
}

const isTextItem = (it: object): it is PdfTextItemLike =>
  'str' in it && typeof it.str === 'string' && 'transform' in it && Array.isArray(it.transform)

/** Adapts PDF.js getTextContent() items (text items and marked-content markers) into runs. */
export function runsFromTextContent(items: readonly object[]): TextRun[] {
  const runs: TextRun[] = []
  for (const it of items) {
    if (!isTextItem(it)) continue
    const [a = 0, b = 0, c = 0, d = 0, e = 0, f = 0] = it.transform
    const fontSize = Math.hypot(c, d) || Math.hypot(a, b) || it.height || 0
    runs.push({ str: it.str, x: e, y: f, width: it.width ?? 0, fontSize })
  }
  return runs
}
