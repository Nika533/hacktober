import type { CodeTag } from './tags'
import type { CodeEdit, CodeFile, CodeMark, CodeSnapshot, LineRange } from './types'

const norm = (p: string): string => p.replace(/\\/g, '/').replace(/^\.\//, '').toLowerCase()

const base = (p: string): string => p.slice(p.lastIndexOf('/') + 1)

/** The files a snapshot carries text for, the focused one first. */
export const snapshotFiles = (s: CodeSnapshot): CodeFile[] => [
  ...(s.active ? [s.active] : []),
  ...s.others
]

/**
 * The file a model meant by `path`: exact, then the one path that ends with
 * it (or that it ends with), then the one file with that name. '' means the
 * focused file.
 */
export function findCodeFile(files: readonly CodeFile[], path: string): CodeFile | null {
  if (!path) return files[0] ?? null
  const want = norm(path)
  const exact = files.find((f) => norm(f.path) === want)
  if (exact) return exact
  const tail = files.filter((f) => {
    const have = norm(f.path)
    return have.endsWith(`/${want}`) || want.endsWith(`/${have}`)
  })
  if (tail.length === 1) return tail[0] ?? null
  const named = files.filter((f) => base(norm(f.path)) === base(want))
  return named.length === 1 ? (named[0] ?? null) : null
}

const clamp = (r: LineRange, lineCount: number): LineRange | null =>
  r.start > lineCount ? null : { start: r.start, end: Math.min(r.end, lineCount) }

/**
 * Turn an answer's tags into what VS Code shows, against the snapshot the
 * model answered from. Marks in files Hoot didn't read keep their path for
 * the extension to find. Edits need the lines they replace in the snapshot
 * (`expected`), so an edit outside what Hoot read is dropped.
 */
export function resolveCodeTags(
  tags: readonly CodeTag[],
  files: readonly CodeFile[],
  newId: () => string
): { marks: CodeMark[]; edits: CodeEdit[] } {
  const marks: CodeMark[] = []
  const edits: CodeEdit[] = []
  for (const tag of tags) {
    const file = findCodeFile(files, tag.path)
    if (tag.kind === 'line') {
      if (!file && !tag.path) continue
      const range = file ? clamp(tag.range, file.lineCount) : tag.range
      if (!range) continue
      marks.push({
        id: newId(),
        path: file?.path ?? tag.path,
        uri: file?.uri ?? null,
        range,
        label: tag.label
      })
      continue
    }
    if (!file) continue
    const range = clamp(tag.range, file.lineCount)
    if (!range || range.start < file.window.start || range.end > file.window.end) continue
    const lines = file.text.split('\n')
    edits.push({
      id: newId(),
      path: file.path,
      uri: file.uri,
      range,
      label: tag.label,
      replacement: tag.replacement,
      expected: lines
        .slice(range.start - file.window.start, range.end - file.window.start + 1)
        .join('\n')
    })
  }
  return { marks, edits }
}
