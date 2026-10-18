import {
  CODE_LIMITS,
  type CodeDiagnostic,
  type CodeFile,
  type CodeSelection,
  type CodeSeverity,
  type LineRange
} from '@hoot/core/code'

/** Longer lines (minified code) are cut. An edit on a cut line is then refused, never misapplied. */
export const LINE_MAX = 1000

export interface WindowCaps {
  chars: number
  lines: number
}

export const FOCUSED_CAPS: WindowCaps = {
  chars: CODE_LIMITS.fileChars,
  lines: CODE_LIMITS.fileLines
}
export const OTHER_CAPS: WindowCaps = { chars: CODE_LIMITS.otherChars, lines: 200 }

/** A document's lines (0-based), without VS Code. */
export interface DocText {
  lineCount: number
  line(index: number): string
}

const cut = (line: string): string =>
  line.length <= LINE_MAX ? line : `${line.slice(0, LINE_MAX)}…`
const clamp = (n: number, min: number, max: number): number => Math.min(max, Math.max(min, n))

function union(ranges: readonly LineRange[]): LineRange | null {
  if (ranges.length === 0) return null
  return {
    start: Math.min(...ranges.map((r) => r.start)),
    end: Math.max(...ranges.map((r) => r.end))
  }
}

/**
 * The lines to send: the whole file when it fits, else as much as fits around
 * `focus` (its top part when it alone is too big), growing a line up and a
 * line down in turn.
 */
export function chooseWindow(doc: DocText, focus: LineRange, caps: WindowCaps): LineRange {
  const n = Math.max(1, doc.lineCount)
  const len = (line: number): number => cut(doc.line(line - 1)).length + 1
  let total = 0
  for (let i = 1; i <= n && total <= caps.chars; i++) total += len(i)
  if (n <= caps.lines && total <= caps.chars) return { start: 1, end: n }

  const from = clamp(focus.start, 1, n)
  const to = clamp(focus.end, from, n)
  let start = from
  let end = from
  let used = len(from)
  while (end < to && end - start + 1 < caps.lines && used + len(end + 1) <= caps.chars) {
    end++
    used += len(end)
  }
  let up = true
  while (end - start + 1 < caps.lines) {
    const canUp = start > 1 && used + len(start - 1) <= caps.chars
    const canDown = end < n && used + len(end + 1) <= caps.chars
    if (!canUp && !canDown) break
    if ((up && canUp) || !canDown) {
      start--
      used += len(start)
    } else {
      end++
      used += len(end)
    }
    up = !up
  }
  return { start, end }
}

export interface FileInput {
  path: string
  uri: string
  languageId: string
  version: number
  dirty: boolean
  doc: DocText
  /** 1-based, from the editor's visible ranges. */
  visible: LineRange[]
  selection: CodeSelection | null
}

/** One editor as a CodeFile: what the user sees and selected, plus as much around it as fits. */
export function buildCodeFile(input: FileInput, caps: WindowCaps): CodeFile {
  const view = union(input.visible)
  const both = view && input.selection ? union([view, input.selection]) : (view ?? input.selection)
  const focus = (both && both.end - both.start < caps.lines ? both : (view ?? input.selection)) ?? {
    start: 1,
    end: 1
  }
  const window = chooseWindow(input.doc, focus, caps)
  const lines: string[] = []
  for (let i = window.start; i <= window.end; i++) lines.push(cut(input.doc.line(i - 1)))
  return {
    path: input.path,
    uri: input.uri,
    languageId: input.languageId,
    version: input.version,
    dirty: input.dirty,
    lineCount: Math.max(1, input.doc.lineCount),
    window,
    text: lines.join('\n'),
    visible: input.visible.slice(0, 8),
    selection: input.selection
      ? { ...input.selection, text: input.selection.text.slice(0, CODE_LIMITS.selectionChars) }
      : null
  }
}

export interface DiagnosticInput extends CodeDiagnostic {
  /** In a file Hoot is sending (focused or on screen). */
  shown: boolean
}

const RANK: Record<CodeSeverity, number> = { error: 0, warning: 1, info: 2, hint: 3 }

/**
 * The problems worth sending: everything but hints in the files Hoot sends,
 * and errors elsewhere in the workspace. Errors first, then by file and line.
 */
export function pickDiagnostics(
  all: readonly DiagnosticInput[],
  max: number = CODE_LIMITS.diagnostics
): CodeDiagnostic[] {
  return all
    .filter((d) => (d.shown ? d.severity !== 'hint' : d.severity === 'error'))
    .sort(
      (a, b) =>
        Number(b.shown) - Number(a.shown) ||
        RANK[a.severity] - RANK[b.severity] ||
        a.path.localeCompare(b.path) ||
        a.start - b.start
    )
    .slice(0, max)
    .map((d) => ({
      path: d.path,
      start: d.start,
      end: d.end,
      severity: d.severity,
      message: d.message.replace(/\s+/g, ' ').trim().slice(0, CODE_LIMITS.diagnosticChars),
      source: d.source
    }))
}
