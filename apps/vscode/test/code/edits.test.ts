import { describe, expect, it } from 'vitest'
import { locateEdit, shiftRange, withEol } from '../../src/code/edits'
import {
  buildCodeFile,
  chooseWindow,
  pickDiagnostics,
  LINE_MAX,
  type DiagnosticInput,
  type DocText
} from '../../src/code/snapshot'

const doc = ['function f(a) {', '  if (a = 1) {', '    return 1', '  }', '  return 0', '}']

describe('locateEdit', () => {
  const edit = {
    range: { start: 2, end: 2 },
    expected: '  if (a = 1) {',
    replacement: '  if (a === 1) {'
  }

  it('finds the lines where Hoot read them, ignoring trailing whitespace', () => {
    expect(locateEdit(doc, edit)).toEqual({ ok: true, range: { start: 2, end: 2 }, already: false })
    expect(
      locateEdit(
        doc.map((l) => `${l}  `),
        edit
      )
    ).toMatchObject({ ok: true, already: false })
  })

  it('follows the lines when the file moved on, once', () => {
    const moved = ['// header', '', ...doc]
    expect(locateEdit(moved, edit)).toEqual({
      ok: true,
      range: { start: 4, end: 4 },
      already: false
    })
    expect(locateEdit([...doc, ...doc], { ...edit, range: { start: 9, end: 9 } })).toMatchObject({
      ok: false
    })
  })

  it('says done when the new text is already there', () => {
    const fixed = doc.map((l, i) => (i === 1 ? '  if (a === 1) {' : l))
    expect(locateEdit(fixed, edit)).toMatchObject({ ok: true, already: true })
  })

  it('refuses when the lines changed', () => {
    const changed = doc.map((l, i) => (i === 1 ? '  if (b) {' : l))
    const result = locateEdit(changed, edit)
    expect(result.ok).toBe(false)
    expect(!result.ok && result.message).toContain('changed since Hoot read them')
  })

  it('never searches for blank lines', () => {
    expect(
      locateEdit(['a', '', 'b', ''], { range: { start: 1, end: 1 }, expected: '', replacement: '' })
    ).toMatchObject({ ok: false })
  })

  it('handles multi-line ranges and removals', () => {
    expect(
      locateEdit(doc, {
        range: { start: 3, end: 4 },
        expected: '    return 1\n  }',
        replacement: ''
      })
    ).toEqual({ ok: true, range: { start: 3, end: 4 }, already: false })
  })
})

describe('shiftRange', () => {
  const r = { start: 10, end: 12 }

  it('moves with changes above, ignores changes below, drops on overlap', () => {
    expect(shiftRange(r, [{ start: 3, end: 3, breaks: 2 }])).toEqual({ start: 12, end: 14 })
    expect(shiftRange(r, [{ start: 2, end: 5, breaks: 0 }])).toEqual({ start: 7, end: 9 })
    expect(shiftRange(r, [{ start: 20, end: 20, breaks: 5 }])).toBe(r)
    expect(shiftRange(r, [{ start: 11, end: 11, breaks: 0 }])).toBeNull()
    expect(shiftRange(r, [{ start: 8, end: 10, breaks: 0 }])).toBeNull()
    expect(
      shiftRange(r, [
        { start: 1, end: 1, breaks: 1 },
        { start: 30, end: 30, breaks: 1 }
      ])
    ).toEqual({
      start: 11,
      end: 13
    })
  })

  it('converts line endings', () => {
    expect(withEol('a\nb\r\nc', '\r\n')).toBe('a\r\nb\r\nc')
  })
})

const text = (lines: string[]): DocText => ({
  lineCount: lines.length,
  line: (i: number) => lines[i] ?? ''
})

describe('chooseWindow / buildCodeFile', () => {
  const many = Array.from({ length: 1000 }, (_, i) => `line ${i + 1}`)

  it('takes the whole file when it fits', () => {
    expect(chooseWindow(text(doc), { start: 3, end: 3 }, { chars: 1000, lines: 100 })).toEqual({
      start: 1,
      end: 6
    })
  })

  it('grows around the focus within the caps', () => {
    const w = chooseWindow(text(many), { start: 500, end: 510 }, { chars: 100_000, lines: 41 })
    expect(w.end - w.start + 1).toBe(41)
    expect(w.start).toBeLessThanOrEqual(500)
    expect(w.end).toBeGreaterThanOrEqual(510)
    expect(chooseWindow(text(many), { start: 1, end: 1 }, { chars: 100_000, lines: 10 })).toEqual({
      start: 1,
      end: 10
    })
    expect(
      chooseWindow(text(many), { start: 1000, end: 1000 }, { chars: 100_000, lines: 10 })
    ).toEqual({
      start: 991,
      end: 1000
    })
    const byChars = chooseWindow(text(many), { start: 500, end: 500 }, { chars: 100, lines: 1000 })
    expect(byChars.end - byChars.start + 1).toBeLessThan(15)
  })

  it('focuses on what the user sees and selected, cuts very long lines', () => {
    const lines = [...many]
    lines[699] = 'x'.repeat(LINE_MAX * 3)
    const file = buildCodeFile(
      {
        path: 'a.txt',
        uri: 'file:///a.txt',
        languageId: 'plaintext',
        version: 1,
        dirty: false,
        doc: text(lines),
        visible: [{ start: 690, end: 720 }],
        selection: { start: 700, end: 700, text: 'x'.repeat(5000) }
      },
      { chars: 20_000, lines: 100 }
    )
    expect(file.window.start).toBeLessThanOrEqual(690)
    expect(file.window.end).toBeGreaterThanOrEqual(720)
    expect(file.text.split('\n')).toHaveLength(file.window.end - file.window.start + 1)
    expect(file.text).toContain(`${'x'.repeat(LINE_MAX)}…`)
    expect(file.selection?.text.length).toBe(2000)
    expect(file.lineCount).toBe(1000)
  })
})

describe('pickDiagnostics', () => {
  it('keeps the shown files’ problems and other files’ errors, errors first', () => {
    const d = (
      path: string,
      severity: 'error' | 'warning' | 'hint',
      shown: boolean,
      start = 1
    ): DiagnosticInput => ({
      path,
      start,
      end: start,
      severity,
      message: `  ${severity}\n in ${path} `,
      source: null,
      shown
    })
    expect(
      pickDiagnostics([
        d('b.ts', 'warning', false),
        d('a.ts', 'warning', true, 5),
        d('a.ts', 'hint', true),
        d('c.ts', 'error', false),
        d('a.ts', 'error', true, 9)
      ]).map((x) => `${x.path}:${x.start} ${x.message}`)
    ).toEqual(['a.ts:9 error in a.ts', 'a.ts:5 warning in a.ts', 'c.ts:1 error in c.ts'])
  })
})
