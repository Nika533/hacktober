import { describe, expect, it } from 'vitest'
import {
  CODE_GUIDE,
  codeLinkPipePath,
  codeLinkTokenPath,
  codeNote,
  findCodeFile,
  numberLines,
  parseCodeAnswer,
  resolveCodeTags,
  stripCodeTags,
  type CodeFile,
  type CodeSnapshot
} from '@hoot/core/code'
import { CodeAppToExtSchema, CodeExtToAppSchema, CodeSnapshotSchema } from '@hoot/core/code/schemas'

const FILE_TEXT = [
  "import { sum } from './math'",
  '',
  'export function total(items: number[]): number {',
  '  let t = 0',
  '  for (let i = 0; i <= items.length; i++) t += items[i]',
  '  return t',
  '}'
].join('\n')

function file(over: Partial<CodeFile> = {}): CodeFile {
  return {
    path: 'src/total.ts',
    uri: 'file:///c%3A/w/src/total.ts',
    languageId: 'typescript',
    version: 3,
    dirty: false,
    lineCount: 7,
    window: { start: 1, end: 7 },
    text: FILE_TEXT,
    visible: [{ start: 1, end: 7 }],
    selection: null,
    ...over
  }
}

function snapshot(over: Partial<CodeSnapshot> = {}): CodeSnapshot {
  return { workspace: 'demo', active: file(), others: [], diagnostics: [], excluded: [], ...over }
}

let n = 0
const newId = (): string => `id${++n}`

describe('parseCodeAnswer', () => {
  it('passes answers without tags through', () => {
    expect(parseCodeAnswer('  Looks fine.  ')).toEqual({ text: 'Looks fine.', tags: [] })
  })

  it('reads line tags in the forms models write them', () => {
    const { text, tags } = parseCodeAnswer(
      [
        'The loop runs one step too far.',
        '[[line: src/total.ts:5, "Off by one: <= should be <"]]',
        '`[[line: src\\total.ts#L3-L4, "Signature"]]`',
        '[[line: ./src/total.ts, line 6]]',
        '[[line: 2, "No path"]]',
        "[[line: total.ts:6-4, 'Reversed, with a comma']]"
      ].join('\n')
    )
    expect(text).toBe('The loop runs one step too far.')
    expect(tags).toEqual([
      {
        kind: 'line',
        path: 'src/total.ts',
        range: { start: 5, end: 5 },
        label: 'Off by one: <= should be <'
      },
      { kind: 'line', path: 'src/total.ts', range: { start: 3, end: 4 }, label: 'Signature' },
      { kind: 'line', path: 'src/total.ts', range: { start: 6, end: 6 }, label: '' },
      { kind: 'line', path: '', range: { start: 2, end: 2 }, label: 'No path' },
      {
        kind: 'line',
        path: 'total.ts',
        range: { start: 4, end: 6 },
        label: 'Reversed, with a comma'
      }
    ])
  })

  it('keeps line references as text with lineRefs (Studio)', () => {
    expect(stripCodeTags('Here.\n[[line: src/total.ts:5, "Off by one"]]')).toBe(
      'Here.\n`src/total.ts:5` — Off by one'
    )
  })

  it('takes the code block after an edit tag as the replacement and keeps it on display', () => {
    const answer = [
      'Stop at the last item:',
      '[[edit: src/total.ts:5, "Use < instead of <="]]',
      '```ts',
      '  for (let i = 0; i < items.length; i++) t += items[i]',
      '```',
      'Done.'
    ].join('\n')
    const { text, tags } = parseCodeAnswer(answer)
    expect(tags).toEqual([
      {
        kind: 'edit',
        path: 'src/total.ts',
        range: { start: 5, end: 5 },
        label: 'Use < instead of <=',
        replacement: '  for (let i = 0; i < items.length; i++) t += items[i]'
      }
    ])
    expect(text).toBe(
      [
        'Stop at the last item:',
        '**Change** `src/total.ts:5` — Use < instead of <=',
        '```ts',
        '  for (let i = 0; i < items.length; i++) t += items[i]',
        '```',
        'Done.'
      ].join('\n')
    )
  })

  it('reads an empty block as a removal and strips copied line numbers', () => {
    const { tags } = parseCodeAnswer(
      [
        '[[edit: src/total.ts:2, "Remove the blank line"]]',
        '',
        '```',
        '```',
        '[[edit: src/total.ts:4-5, "Numbered"]]',
        '~~~ts',
        '4|   let t = 0',
        '5|   for (const x of items) t += x',
        '~~~'
      ].join('\n')
    )
    expect(tags.map((t) => (t.kind === 'edit' ? t.replacement : null))).toEqual([
      '',
      '  let t = 0\n  for (const x of items) t += x'
    ])
  })

  it('treats an edit without a code block as a line mark', () => {
    expect(parseCodeAnswer('[[edit: src/total.ts:5, "Fix"]]\nNo block here.').tags).toEqual([
      { kind: 'line', path: 'src/total.ts', range: { start: 5, end: 5 }, label: 'Fix' }
    ])
  })

  it('while streaming, hides a half-written tag and holds an edit until its block closes', () => {
    expect(parseCodeAnswer('Look here\n[[line: src/tot', { streaming: true })).toEqual({
      text: 'Look here',
      tags: []
    })
    const open = '[[edit: src/total.ts:5, "Fix"]]\n```ts\n  for (;;)'
    expect(parseCodeAnswer(open, { streaming: true }).tags).toEqual([])
    expect(parseCodeAnswer(open).tags).toHaveLength(1)
    expect(parseCodeAnswer(`${open}\n\`\`\``, { streaming: true }).tags).toHaveLength(1)
  })

  it('ignores tags it cannot read but still hides them', () => {
    expect(parseCodeAnswer('A\n[[line: somewhere, "x"]]\nB')).toEqual({ text: 'A\nB', tags: [] })
  })
})

describe('resolveCodeTags', () => {
  const other = file({
    path: 'lib/util.ts',
    uri: 'file:///c%3A/w/lib/util.ts',
    lineCount: 3,
    text: 'a\nb\nc',
    window: { start: 1, end: 3 }
  })

  it('finds files by exact path, suffix or name, and the focused file without a path', () => {
    const files = [file(), other]
    expect(findCodeFile(files, 'src/total.ts')?.path).toBe('src/total.ts')
    expect(findCodeFile(files, 'C:\\w\\src\\total.ts')?.path).toBe('src/total.ts')
    expect(findCodeFile(files, 'util.ts')?.path).toBe('lib/util.ts')
    expect(findCodeFile(files, '')?.path).toBe('src/total.ts')
    expect(findCodeFile(files, 'missing.ts')).toBeNull()
  })

  it('fills in uri and the expected lines, clamps to the file, and drops edits it cannot check', () => {
    const { marks, edits } = resolveCodeTags(
      [
        { kind: 'line', path: 'total.ts', range: { start: 5, end: 9 }, label: 'loop' },
        { kind: 'line', path: 'elsewhere.ts', range: { start: 2, end: 2 }, label: 'unread' },
        {
          kind: 'line',
          path: 'src/total.ts',
          range: { start: 40, end: 41 },
          label: 'past the end'
        },
        { kind: 'edit', path: '', range: { start: 5, end: 6 }, label: 'fix', replacement: 'x' },
        {
          kind: 'edit',
          path: 'elsewhere.ts',
          range: { start: 1, end: 1 },
          label: 'no',
          replacement: ''
        }
      ],
      [file(), other],
      newId
    )
    expect(marks).toEqual([
      {
        id: expect.any(String),
        path: 'src/total.ts',
        uri: file().uri,
        range: { start: 5, end: 7 },
        label: 'loop'
      },
      {
        id: expect.any(String),
        path: 'elsewhere.ts',
        uri: null,
        range: { start: 2, end: 2 },
        label: 'unread'
      }
    ])
    expect(edits).toEqual([
      {
        id: expect.any(String),
        path: 'src/total.ts',
        uri: file().uri,
        range: { start: 5, end: 6 },
        label: 'fix',
        replacement: 'x',
        expected: '  for (let i = 0; i <= items.length; i++) t += items[i]\n  return t'
      }
    ])
  })

  it('only edits lines inside the window Hoot read', () => {
    const windowed = file({ lineCount: 500, window: { start: 101, end: 107 } })
    const tag = (start: number) =>
      ({
        kind: 'edit',
        path: '',
        range: { start, end: start },
        label: '',
        replacement: ''
      }) as const
    const { edits } = resolveCodeTags([tag(50), tag(103)], [windowed], newId)
    expect(edits.map((e) => [e.range.start, e.expected])).toEqual([
      [103, 'export function total(items: number[]): number {']
    ])
  })
})

describe('codeNote', () => {
  it('sends the whole picture first: numbered code, view, problems, guide', () => {
    const { note, memory } = codeNote(
      snapshot({
        active: file({ dirty: true, selection: { start: 5, end: 5, text: 'items.length' } }),
        diagnostics: [
          {
            path: 'src/total.ts',
            start: 5,
            end: 5,
            severity: 'error',
            message: "Object is\n possibly 'undefined'.",
            source: 'ts 2532'
          }
        ],
        excluded: ['.env']
      }),
      null
    )
    expect(note).toContain('not a screenshot')
    expect(note).toContain('Focused file: src/total.ts (typescript, 7 lines, unsaved changes)')
    expect(note).toContain('The user is looking at lines 1–7. Selected: "items.length" on line 5.')
    expect(note).toContain('```typescript\n1| import')
    expect(note).toContain("- src/total.ts:5 error: Object is possibly 'undefined'. (ts 2532)")
    expect(note).toContain('.env')
    expect(note).toContain(CODE_GUIDE)
    expect(memory).toMatchObject({ uri: file().uri, version: 3, lineCount: 7 })
  })

  it('says only that nothing changed for the same file and version', () => {
    const first = codeNote(snapshot(), null)
    const again = codeNote(
      snapshot({ active: file({ visible: [{ start: 3, end: 6 }] }) }),
      first.memory
    )
    expect(again.note).toBe(
      [
        '[VS Code: src/total.ts is unchanged since the code I sent earlier in this chat.]',
        'The user is looking at lines 3–6. Selected: nothing.',
        'Problems: unchanged.'
      ].join('\n')
    )
  })

  it('sends one changed stretch when the line count stayed the same', () => {
    const first = codeNote(snapshot(), null)
    const fixed = FILE_TEXT.replace('i <= items', 'i < items')
    const next = codeNote(snapshot({ active: file({ version: 4, text: fixed }) }), first.memory)
    expect(next.note).toContain('Line 5 now reads:')
    expect(next.note).toContain('5|   for (let i = 0; i < items.length; i++)')
    expect(next.note).not.toContain('import { sum }')
    expect(next.note).toContain('Problems: unchanged.')
    expect(next.memory?.text).toBe(fixed)
    // and the memory moves on: the same text again is "unchanged"
    expect(
      codeNote(snapshot({ active: file({ version: 4, text: fixed }) }), next.memory).note
    ).toContain('is unchanged')
  })

  it('sends everything again for another file, another window or new lines', () => {
    const first = codeNote(snapshot(), null)
    const added = codeNote(
      snapshot({
        active: file({
          version: 4,
          lineCount: 8,
          text: `${FILE_TEXT}\n`,
          window: { start: 1, end: 8 }
        })
      }),
      first.memory
    )
    expect(added.note).toContain('Focused file:')
    const otherFile = codeNote(
      snapshot({ active: file({ uri: 'file:///other.ts', path: 'other.ts' }) }),
      first.memory
    )
    expect(otherFile.note).toContain('Focused file: other.ts')
  })

  it('handles no focused file and backticks in the code', () => {
    expect(codeNote(snapshot({ active: null }), null)).toMatchObject({ memory: null })
    const ticks = codeNote(
      snapshot({
        active: file({ text: 'const s = ```x```', lineCount: 1, window: { start: 1, end: 1 } })
      }),
      null
    )
    expect(ticks.note).toContain('````typescript\n1| const s = ```x```\n````')
  })

  it('numbers lines with a fixed width', () => {
    expect(numberLines('a\nb\nc', 9)).toBe(' 9| a\n10| b\n11| c')
  })
})

describe('code link contracts', () => {
  it('validates snapshots and messages', () => {
    expect(CodeSnapshotSchema.safeParse(snapshot()).success).toBe(true)
    expect(
      CodeSnapshotSchema.safeParse(snapshot({ active: file({ window: { start: 5, end: 2 } }) }))
        .success
    ).toBe(false)
    expect(
      CodeExtToAppSchema.safeParse({
        type: 'code.hello',
        protocol: 1,
        token: 'a'.repeat(64),
        extVersion: '0.1.0',
        window: { id: 'w1', name: 'demo' },
        focused: true,
        file: { path: 'src/total.ts', languageId: 'typescript' }
      }).success
    ).toBe(true)
    expect(CodeAppToExtSchema.safeParse({ type: 'code.snapshot.get', reqId: 'r1' }).success).toBe(
      true
    )
    expect(CodeAppToExtSchema.safeParse({ type: 'code.snapshot.get', reqId: '../x' }).success).toBe(
      false
    )
  })

  it('has its own pipe and token per user', () => {
    expect(codeLinkPipePath('win32', 'Ann Lee', 'C:\\Temp')).toBe('\\\\.\\pipe\\hoot-code-Ann_Lee')
    expect(codeLinkPipePath('linux', 'ann', '/tmp/')).toBe('/tmp/hoot-code-ann.sock')
    expect(codeLinkTokenPath('win32', { LOCALAPPDATA: 'C:\\L' })).toBe(
      'C:\\L\\Hoot\\bridge\\code-token'
    )
  })
})
