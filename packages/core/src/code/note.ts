import { formatLines } from './tags'
import type { CodeDiagnostic, CodeFile, CodeSelection, CodeSnapshot, LineRange } from './types'

/** How Hoot asks the model to point at code and propose edits (parsed by `parseCodeAnswer`). */
export const CODE_GUIDE = `How to answer about this code:
- To point at a mistake or a spot, put [[line: path:N, "short label"]] (or path:N-M for several lines) on its own line after the sentence it belongs to. Hoot highlights it in the user's VS Code.
- Only when the user asks you to change, fix, add or remove code, propose each change as [[edit: path:N-M, "what it does"]] on its own line, immediately followed by a fenced code block with the complete new text of lines N–M exactly as they should read: real indentation, no line numbers. An empty code block removes those lines. To add lines, replace the line before them with that same line plus the new ones. Hoot shows the user an Apply button, so never say you changed the file.
- Use the line numbers shown, keep each edit to the lines that change, use at most 5 tags per reply, and never put tags in backticks or inside code blocks.`

/** A changed stretch at most this long is sent on its own instead of the whole window. */
export const HUNK_MAX_LINES = 40

/** What the model was last shown of the focused file in this chat. */
export interface CodeNoteMemory {
  uri: string
  version: number
  lineCount: number
  window: LineRange
  text: string
  problems: string
}

export interface CodeNote {
  /** Appended to what's sent (never shown). */
  note: string
  /** Pass back as `previous` for the next message in the same chat. */
  memory: CodeNoteMemory | null
}

/** `text` with each line prefixed by its number, starting at `first`: ` 9| a`, `10| b`. */
export function numberLines(text: string, first: number): string {
  const lines = text.split('\n')
  const width = String(first + lines.length - 1).length
  return lines.map((l, i) => `${String(first + i).padStart(width)}| ${l}`).join('\n')
}

/** A fenced block that can't be closed early by backticks in the code. */
function fenced(code: string, lang: string): string {
  const longest = Math.max(0, ...(code.match(/`+/g) ?? []).map((run) => run.length))
  const fence = '`'.repeat(Math.max(3, longest + 1))
  return `${fence}${lang.replace(/[^\w+-]/g, '')}\n${code}\n${fence}`
}

const oneLine = (s: string): string => s.replace(/\s+/g, ' ').trim()

function describe(f: CodeFile): string {
  const whole = f.window.start === 1 && f.window.end >= f.lineCount
  const facts = [f.languageId, `${f.lineCount} line${f.lineCount === 1 ? '' : 's'}`]
  if (f.dirty) facts.push('unsaved changes')
  const shown = whole ? '' : `; showing lines ${formatLines(f.window)}`
  return `${f.path} (${facts.join(', ')}${shown})`
}

function selected(s: CodeSelection | null): string {
  if (!s) return 'nothing'
  const where = `line${s.start === s.end ? '' : 's'} ${formatLines(s)}`
  const text = s.text.trim()
  return text && text.length <= 120 && !text.includes('\n') ? `"${text}" on ${where}` : where
}

function view(f: CodeFile): string {
  const lines = f.visible.map(formatLines).join(', ')
  return `${lines ? `The user is looking at lines ${lines}. ` : ''}Selected: ${selected(f.selection)}.`
}

function problems(list: readonly CodeDiagnostic[]): string {
  return list
    .map(
      (d) =>
        `- ${d.path}:${d.start} ${d.severity}: ${oneLine(d.message)}${d.source ? ` (${d.source})` : ''}`
    )
    .join('\n')
}

const problemsBlock = (text: string): string =>
  text ? `Problems VS Code reports:\n${text}` : 'VS Code reports no problems in these files.'

/** The one changed stretch when the line count and window stayed the same. */
function hunk(prev: CodeNoteMemory, f: CodeFile): LineRange | null {
  if (prev.lineCount !== f.lineCount) return null
  if (prev.window.start !== f.window.start || prev.window.end !== f.window.end) return null
  const a = prev.text.split('\n')
  const b = f.text.split('\n')
  if (a.length !== b.length) return null
  let s = 0
  while (s < a.length && a[s] === b[s]) s++
  let e = a.length - 1
  while (e >= s && a[e] === b[e]) e--
  if (e < s || e - s + 1 > HUNK_MAX_LINES) return null
  return { start: f.window.start + s, end: f.window.start + e }
}

/**
 * What goes with a message about the user's code, instead of a screenshot.
 * The first message in a chat gets the whole picture (focused file with line
 * numbers, other visible editors, problems, CODE_GUIDE). Later ones say only
 * what changed, as long as it's the same file: nothing, one changed stretch
 * (same line count), or everything again.
 */
export function codeNote(snapshot: CodeSnapshot, previous: CodeNoteMemory | null): CodeNote {
  const f = snapshot.active
  const found = problems(snapshot.diagnostics)
  const privateLine = snapshot.excluded.length
    ? `The user keeps these private, so Hoot can't read them: ${snapshot.excluded.join(', ')}.`
    : ''

  if (f && previous && previous.uri === f.uri) {
    const changedProblems = found !== previous.problems
    const tail = [view(f), changedProblems ? problemsBlock(found) : 'Problems: unchanged.']
    const memory: CodeNoteMemory = { ...previous, problems: found }
    // The text decides, not the version: VS Code starts versions over when a file reopens.
    if (previous.text === f.text) {
      if (previous.window.start === f.window.start && previous.window.end === f.window.end) {
        return {
          note: [
            `[VS Code: ${f.path} is unchanged since the code I sent earlier in this chat.]`,
            ...tail
          ].join('\n'),
          memory: { ...memory, version: f.version }
        }
      }
    } else {
      const changed = hunk(previous, f)
      if (changed) {
        const lines = f.text
          .split('\n')
          .slice(changed.start - f.window.start, changed.end - f.window.start + 1)
        const one = changed.start === changed.end
        return {
          note: [
            `[VS Code: ${f.path} changed since the code I sent earlier in this chat (still ${f.lineCount} lines; every other line is the same). Line${one ? '' : 's'} ${formatLines(changed)} now read${one ? 's' : ''}:]`,
            fenced(numberLines(lines.join('\n'), changed.start), f.languageId),
            ...tail
          ].join('\n'),
          memory: { ...memory, version: f.version, text: f.text }
        }
      }
    }
  }

  const parts = [
    `[VS Code: the user's code, read straight from the editor (not a screenshot), as of this message.]`,
    `Workspace: ${snapshot.workspace || '(no folder open)'}`
  ]
  if (f) {
    parts.push(
      `Focused file: ${describe(f)}`,
      view(f),
      fenced(numberLines(f.text, f.window.start), f.languageId)
    )
  } else {
    parts.push('No file is focused in the editor.')
  }
  for (const o of snapshot.others) {
    parts.push(
      `Also on screen: ${describe(o)}`,
      fenced(numberLines(o.text, o.window.start), o.languageId)
    )
  }
  parts.push(problemsBlock(found))
  if (privateLine) parts.push(privateLine)
  parts.push(CODE_GUIDE)
  return {
    note: parts.join('\n'),
    memory: f
      ? {
          uri: f.uri,
          version: f.version,
          lineCount: f.lineCount,
          window: f.window,
          text: f.text,
          problems: found
        }
      : null
  }
}
