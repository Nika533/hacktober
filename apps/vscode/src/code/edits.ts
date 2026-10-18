import { formatLines, type CodeEdit, type LineRange } from '@hoot/core/code'

export type Located =
  { ok: true; range: LineRange; already: boolean } | { ok: false; message: string }

const trimEnd = (s: string): string => s.replace(/\s+$/, '')

/** Where `block` sits in `lines` (1-based start), comparing without trailing whitespace. */
function matchesAt(lines: readonly string[], block: readonly string[], start: number): boolean {
  if (start < 1 || start + block.length - 1 > lines.length) return false
  return block.every((b, i) => trimEnd(lines[start - 1 + i] ?? '') === trimEnd(b))
}

function findAll(lines: readonly string[], block: readonly string[]): number[] {
  const out: number[] = []
  for (let s = 1; s + block.length - 1 <= lines.length; s++) {
    if (matchesAt(lines, block, s)) out.push(s)
  }
  return out
}

/**
 * Where an edit goes in the document as it is now. The lines Hoot read must
 * still be at `range`, or somewhere else exactly once (the file moved on).
 * When the new text is already there, it's done. Anything else is refused:
 * an edit is never applied to code Hoot didn't see.
 */
export function locateEdit(
  lines: readonly string[],
  edit: Pick<CodeEdit, 'range' | 'expected' | 'replacement'>
): Located {
  const expected = edit.expected.split('\n')
  const replacement = edit.replacement === '' ? null : edit.replacement.split('\n')
  const at = (start: number): LineRange => ({ start, end: start + expected.length - 1 })
  if (matchesAt(lines, expected, edit.range.start)) {
    return { ok: true, range: at(edit.range.start), already: false }
  }
  if (replacement && matchesAt(lines, replacement, edit.range.start)) {
    return { ok: true, range: edit.range, already: true }
  }
  // Blank lines are everywhere: only their exact spot counts.
  if (expected.some((l) => l.trim())) {
    const found = findAll(lines, expected)
    if (found.length === 1) return { ok: true, range: at(found[0]!), already: false }
    if (found.length > 1) {
      return {
        ok: false,
        message: `Those lines now appear ${found.length} times in the file, so Hoot won’t guess. Ask again.`
      }
    }
  }
  if (
    replacement &&
    replacement.some((l) => l.trim()) &&
    findAll(lines, replacement).length === 1
  ) {
    return { ok: true, range: edit.range, already: true }
  }
  return {
    ok: false,
    message: `Lines ${formatLines(edit.range)} changed since Hoot read them. Ask again to get a fresh fix.`
  }
}

/** A change to a document: lines `start`..`end` (1-based) replaced by text with `breaks` line breaks. */
export interface LineChange {
  start: number
  end: number
  breaks: number
}

/**
 * Follow edits: a change that ends above the range moves it; one below leaves
 * it; one touching it drops it (the user is working on that code). `changes`
 * are relative to the document before any of them, as VS Code reports them.
 */
export function shiftRange(range: LineRange, changes: readonly LineChange[]): LineRange | null {
  let shift = 0
  for (const c of changes) {
    if (c.end < range.start) shift += c.breaks - (c.end - c.start)
    else if (c.start <= range.end) return null
  }
  return shift ? { start: range.start + shift, end: range.end + shift } : range
}

/** The replacement with the document's line endings. */
export const withEol = (text: string, eol: '\n' | '\r\n'): string => text.replace(/\r?\n/g, eol)
