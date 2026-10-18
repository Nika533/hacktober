import { CODE_LIMITS } from './link'
import type { LineRange } from './types'

/**
 * What the model asks for in an answer about code (see CODE_GUIDE):
 * - `[[line: path:N, "label"]]` or `path:N-M`: point at a spot (highlighted in VS Code);
 * - `[[edit: path:N-M, "label"]]` followed by a fenced code block: replace
 *   lines N–M with the block (an empty block removes them).
 * `path` is '' when the model left it out (the focused file).
 */
export type CodeTag =
  | { kind: 'line'; path: string; range: LineRange; label: string }
  | { kind: 'edit'; path: string; range: LineRange; label: string; replacement: string }

export interface ParsedCodeAnswer {
  /** The answer for display, tags taken out (see `parseCodeAnswer`). */
  text: string
  tags: CodeTag[]
}

/** A tag, with the backticks the model sometimes wraps it in. */
const TAG = /`?\[\[\s*(line|edit)\s*:\s*([^\]]*?)\s*\]\]`?/gi
const ANY_TAG = /\[\[\s*(?:line|edit)\s*:/i
/** A tag still arriving at the end of a streaming answer (last line only). */
const PARTIAL_TAG = /`?\[\[[^\]\n]*\]?$/
/** `path:N`, `path#L12-20`, `path, line 4`, `path, 4-6`, then an optional `, "label"`. */
const LOCATION =
  /^(.+?)(?:\s*[:#]\s*L?|\s*,?\s+lines?\s+|\s*,\s*)(\d+)(?:\s*[-–—]\s*L?(\d+))?(?:\s*,\s*(.*?))?\s*$/i
/** Just the lines: `42, "label"`. */
const LINES_ONLY = /^(?:lines?\s+)?L?(\d+)(?:\s*[-–—]\s*L?(\d+))?(?:\s*,\s*(.*?))?\s*$/i
const FENCE_OPEN = /^(\s*)(`{3,}|~{3,})/
/** Snapshot line numbers ("  42| ") a model copied into its code. */
const NUMBERED = /^\s*\d+\| ?/

const unquote = (s: string): string =>
  s
    .trim()
    .replace(/^["“”'‘’]/, '')
    .replace(/["“”'‘’]$/, '')
    .trim()

export const formatLines = (r: LineRange): string =>
  r.start === r.end ? `${r.start}` : `${r.start}–${r.end}`

/** `src/app.ts:42–44`, or just the lines when there's no path. */
export const formatLocation = (path: string, r: LineRange): string =>
  path ? `${path}:${formatLines(r)}` : `line${r.start === r.end ? '' : 's'} ${formatLines(r)}`

function parseArgs(raw: string): { path: string; range: LineRange; label: string } | null {
  const at = LOCATION.exec(raw)
  const only = at ? null : LINES_ONLY.exec(raw.trim())
  const m = at ?? only
  if (!m) return null
  const [path, from, to, label] = at
    ? [at[1] ?? '', at[2], at[3], at[4]]
    : ['', only?.[1], only?.[2], only?.[3]]
  const start = Number(from)
  const end = to === undefined ? start : Number(to)
  if (!Number.isInteger(start) || !Number.isInteger(end) || Math.min(start, end) < 1) return null
  return {
    path: unquote(path)
      .replace(/^`+|`+$/g, '')
      .replace(/\\/g, '/')
      .replace(/^\.\//, ''),
    range: { start: Math.min(start, end), end: Math.max(start, end) },
    label: unquote(label ?? '').slice(0, CODE_LIMITS.labelChars)
  }
}

/** The fenced block starting at or after `from` (blank lines skipped), CommonMark style. */
function readFence(
  lines: readonly string[],
  from: number
): { body: string[]; closed: boolean } | null {
  let i = from
  while (i < lines.length && (lines[i] ?? '').trim() === '') i++
  const open = FENCE_OPEN.exec(lines[i] ?? '')
  if (!open) return null
  const indent = open[1]?.length ?? 0
  const marker = open[2] ?? '```'
  const body: string[] = []
  for (let j = i + 1; j < lines.length; j++) {
    const line = lines[j] ?? ''
    const trimmed = line.trim()
    if (trimmed.startsWith(marker[0]!.repeat(marker.length)) && /^(`+|~+)$/.test(trimmed)) {
      return { body, closed: true }
    }
    // Content inside an indented fence (a list item) loses that indent.
    body.push(line.replace(new RegExp(`^ {0,${indent}}`), ''))
  }
  return { body, closed: false }
}

function cleanReplacement(body: readonly string[]): string {
  const numbered = body.some((l) => l.trim()) && body.every((l) => !l.trim() || NUMBERED.test(l))
  return (numbered ? body.map((l) => l.replace(NUMBERED, '')) : body).join('\n')
}

/**
 * The code tags in an answer and the answer to display. Tags are taken out;
 * a line that held only tags goes away. An edit keeps its code block under a
 * `**Change** \`path:N–M\` — label` line. With `lineRefs`, line tags become
 * `` `path:N` — label `` lines (for views without highlight chips). While
 * `streaming`, a tag still arriving is hidden, and an edit whose code block
 * hasn't closed yet isn't returned.
 */
export function parseCodeAnswer(
  text: string,
  opts: { streaming?: boolean; lineRefs?: boolean } = {}
): ParsedCodeAnswer {
  const source = opts.streaming ? text.replace(PARTIAL_TAG, '') : text
  if (!ANY_TAG.test(source)) return { text: source.trim(), tags: [] }
  const lines = source.split('\n')
  const out: string[] = []
  const tags: CodeTag[] = []
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? ''
    const found: Array<NonNullable<ReturnType<typeof parseArgs>> & { kind: string }> = []
    const rest = line.replace(TAG, (_match, kind: string, args: string) => {
      const parsed = parseArgs(args)
      if (parsed) found.push({ kind: kind.toLowerCase(), ...parsed })
      return ''
    })
    if (rest === line) {
      out.push(line)
      continue
    }
    if (rest.trim()) out.push(rest.trimEnd())
    let fenceTaken = false
    for (const f of found) {
      const where = formatLocation(f.path, f.range)
      const label = f.label ? ` — ${f.label}` : ''
      const block = f.kind === 'edit' && !fenceTaken ? readFence(lines, i + 1) : null
      if (block) {
        fenceTaken = true
        out.push(`**Change** \`${where}\`${label}`)
        if ((block.closed || !opts.streaming) && tags.length < CODE_LIMITS.tags) {
          tags.push({
            kind: 'edit',
            path: f.path,
            range: f.range,
            label: f.label,
            replacement: cleanReplacement(block.body)
          })
        }
        continue
      }
      if (opts.lineRefs) out.push(`\`${where}\`${label}`)
      if (tags.length < CODE_LIMITS.tags) {
        tags.push({ kind: 'line', path: f.path, range: f.range, label: f.label })
      }
    }
  }
  return {
    text: out
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim(),
    tags
  }
}

/** For views that show the answer as text (the card, Studio). */
export const stripCodeTags = (text: string): string =>
  parseCodeAnswer(text, { lineRefs: true }).text

export const hasCodeTags = (text: string): boolean => ANY_TAG.test(text)
