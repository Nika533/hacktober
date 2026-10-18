import * as vscode from 'vscode'
import {
  CODE_LIMITS,
  formatLines,
  type CodeActionResult,
  type CodeEdit,
  type CodeFile,
  type CodeFocusFile,
  type CodeMark,
  type CodeSeverity,
  type CodeSnapshot,
  type LineRange
} from '@hoot/core/code'
import { locateEdit, shiftRange, withEol, type LineChange } from './edits'
import type { CodeLinkHandlers } from './link'
import {
  FOCUSED_CAPS,
  OTHER_CAPS,
  buildCodeFile,
  pickDiagnostics,
  type DiagnosticInput,
  type WindowCaps
} from './snapshot'

/** Commands behind the CodeLens and hover links; apply and dismiss take an id. */
export const CODE_COMMANDS = {
  apply: 'hoot.code.apply',
  dismiss: 'hoot.code.dismiss',
  clear: 'hoot.code.clear'
} as const

/** Never read by Hoot (`hoot.code.exclude`). */
export const DEFAULT_EXCLUDE = [
  '**/.env',
  '**/.env.*',
  '**/*.pem',
  '**/*.key',
  '**/*.pfx',
  '**/*.p12',
  '**/*.keystore',
  '**/id_rsa*',
  '**/secrets.*'
]

/** Diagnostics in files without an open document are matched by name only. */
const SECRET_NAME =
  /(^|\/)(\.env[^/]*|id_rsa[^/]*|secrets\.[^/]*|[^/]*\.(pem|key|pfx|p12|keystore))$/i
const SCHEMES = new Set(['file', 'untitled', 'vscode-remote', 'vscode-vfs', 'vscode-notebook-cell'])
const ACCENT = '#38bdf8'
const ISSUE = '#f5a524'
const FLASH_MS = 1400
/** Errors from files Hoot isn't sending, before ranking. */
const OTHER_ERRORS = 200

interface Shown {
  id: string
  kind: 'mark' | 'edit'
  uri: string
  path: string
  range: LineRange
  label: string
  edit: CodeEdit | null
}

export interface CodeEditor extends CodeLinkHandlers, vscode.Disposable {
  /** The focused editor's file, for the app's focus tracking. */
  focusFile(): CodeFocusFile | null
  /** The CodeLens / hover Apply. */
  applyById(id: unknown): Promise<void>
  dismiss(id: unknown): void
  clearAll(): void
  /** An edit was applied from VS Code (not at the app's request). */
  onApplied(listener: (editId: string) => void): vscode.Disposable
}

export interface CodeEditorDeps {
  log: vscode.LogOutputChannel
  /** Glob patterns of files Hoot never reads. */
  exclude(): readonly string[]
}

const SEVERITY: Record<vscode.DiagnosticSeverity, CodeSeverity> = {
  [vscode.DiagnosticSeverity.Error]: 'error',
  [vscode.DiagnosticSeverity.Warning]: 'warning',
  [vscode.DiagnosticSeverity.Information]: 'info',
  [vscode.DiagnosticSeverity.Hint]: 'hint'
}

const truncate = (s: string, max: number): string => {
  const line = s.replace(/\s+/g, ' ').trim()
  return line.length <= max ? line : `${line.slice(0, max - 1).trimEnd()}…`
}

function commandLink(label: string, command: string, id: string): string {
  return `[${label}](command:${command}?${encodeURIComponent(JSON.stringify([id]))})`
}

function lineRange(doc: vscode.TextDocument, r: LineRange): vscode.Range {
  const start = Math.min(r.start, doc.lineCount) - 1
  const end = Math.min(r.end, doc.lineCount) - 1
  return new vscode.Range(start, 0, end, doc.lineAt(end).text.length)
}

/** Removing whole lines takes a line break with them. */
function removalRange(doc: vscode.TextDocument, r: LineRange): vscode.Range {
  if (r.end < doc.lineCount) return new vscode.Range(r.start - 1, 0, r.end, 0)
  if (r.start > 1) {
    return new vscode.Range(
      r.start - 2,
      doc.lineAt(r.start - 2).text.length,
      r.end - 1,
      doc.lineAt(r.end - 1).text.length
    )
  }
  return lineRange(doc, r)
}

/**
 * Hoot in the editor for the code link: reads what the user sees, shows
 * Hoot's highlights (amber) and proposed edits (blue, with Apply / Dismiss
 * CodeLens and a preview in the hover), and applies an edit only when asked,
 * as one undoable change, after checking the code is still what Hoot read.
 */
export function createCodeEditor(deps: CodeEditorDeps): CodeEditor {
  const { log } = deps
  const shown = new Map<string, Shown>()
  const appliedListeners = new Set<(editId: string) => void>()
  const lensChanged = new vscode.EventEmitter<void>()

  const issueType = vscode.window.createTextEditorDecorationType({
    isWholeLine: true,
    backgroundColor: `${ISSUE}24`,
    overviewRulerColor: `${ISSUE}cc`,
    overviewRulerLane: vscode.OverviewRulerLane.Right,
    rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed
  })
  const editType = vscode.window.createTextEditorDecorationType({
    isWholeLine: true,
    backgroundColor: `${ACCENT}1f`,
    borderWidth: '0 0 0 2px',
    borderStyle: 'solid',
    borderColor: `${ACCENT}cc`,
    overviewRulerColor: `${ACCENT}cc`,
    overviewRulerLane: vscode.OverviewRulerLane.Right,
    rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed
  })
  const flashType = vscode.window.createTextEditorDecorationType({
    isWholeLine: true,
    backgroundColor: new vscode.ThemeColor('diffEditor.insertedLineBackground')
  })

  const usable = (doc: vscode.TextDocument): boolean => SCHEMES.has(doc.uri.scheme)
  const excluded = (doc: vscode.TextDocument): boolean =>
    deps.exclude().some((pattern) => vscode.languages.match({ pattern }, doc) > 0)
  const pathOf = (uri: vscode.Uri): string =>
    uri.scheme === 'untitled'
      ? uri.path
      : vscode.workspace.asRelativePath(uri, (vscode.workspace.workspaceFolders?.length ?? 0) > 1)

  const hover = (s: Shown, languageId: string): vscode.MarkdownString => {
    const md = new vscode.MarkdownString('', true)
    md.isTrusted = { enabledCommands: [CODE_COMMANDS.apply, CODE_COMMANDS.dismiss] }
    if (s.kind === 'mark') {
      md.appendMarkdown(`$(eye) **Hoot** · `)
      md.appendText(s.label || 'look here')
      md.appendMarkdown(`\n\n${commandLink('Dismiss', CODE_COMMANDS.dismiss, s.id)}`)
      return md
    }
    md.appendMarkdown(`$(sparkle) **Hoot proposes** · `)
    md.appendText(s.label || `a change to lines ${formatLines(s.range)}`)
    md.appendMarkdown('\n\n')
    if (s.edit?.replacement) md.appendCodeblock(s.edit.replacement, languageId)
    else md.appendMarkdown('_Removes these lines._')
    md.appendMarkdown(
      `\n\n${commandLink('Apply', CODE_COMMANDS.apply, s.id)} · ${commandLink('Dismiss', CODE_COMMANDS.dismiss, s.id)}`
    )
    return md
  }

  const render = (editor: vscode.TextEditor): void => {
    const doc = editor.document
    const uri = doc.uri.toString()
    const mine = [...shown.values()].filter((s) => s.uri === uri && s.range.start <= doc.lineCount)
    editor.setDecorations(
      issueType,
      mine
        .filter((s) => s.kind === 'mark')
        .map((s) => ({
          range: lineRange(doc, s.range),
          hoverMessage: hover(s, doc.languageId),
          renderOptions: {
            after: {
              contentText: `  ◂ Hoot${s.label ? `: ${truncate(s.label, 80)}` : ''}`,
              fontStyle: 'italic',
              color: new vscode.ThemeColor('editorCodeLens.foreground')
            }
          }
        }))
    )
    editor.setDecorations(
      editType,
      mine
        .filter((s) => s.kind === 'edit')
        .map((s) => ({ range: lineRange(doc, s.range), hoverMessage: hover(s, doc.languageId) }))
    )
  }

  const renderAll = (): void => {
    for (const editor of vscode.window.visibleTextEditors) render(editor)
    lensChanged.fire()
  }

  const flash = (editor: vscode.TextEditor, r: LineRange): void => {
    editor.setDecorations(flashType, [lineRange(editor.document, r)])
    setTimeout(() => editor.setDecorations(flashType, []), FLASH_MS)
  }

  const forget = (id: string): void => {
    if (shown.delete(id)) renderAll()
  }

  /** The URI a mark points at: given, an open document with that path, or that path in a folder. */
  const resolveUri = async (m: Pick<CodeMark, 'uri' | 'path'>): Promise<vscode.Uri | null> => {
    if (m.uri) return vscode.Uri.parse(m.uri)
    const want = m.path.replace(/\\/g, '/').toLowerCase()
    const open = vscode.workspace.textDocuments.find((d) => pathOf(d.uri).toLowerCase() === want)
    if (open) return open.uri
    for (const folder of vscode.workspace.workspaceFolders ?? []) {
      const candidate = vscode.Uri.joinPath(folder.uri, m.path)
      try {
        await vscode.workspace.fs.stat(candidate)
        return candidate
      } catch {
        // not in this folder
      }
    }
    return null
  }

  /** Show `doc` in the editor it's already in, else in the active column. */
  const editorFor = (
    doc: vscode.TextDocument,
    preserveFocus: boolean
  ): Thenable<vscode.TextEditor> => {
    const existing = vscode.window.visibleTextEditors.find((e) => e.document === doc)
    return vscode.window.showTextDocument(doc, {
      preserveFocus,
      preview: !existing && preserveFocus === false,
      viewColumn: existing?.viewColumn
    })
  }

  const fileOf = (editor: vscode.TextEditor, caps: WindowCaps): CodeFile => {
    const doc = editor.document
    const sel = editor.selection
    return buildCodeFile(
      {
        path: pathOf(doc.uri),
        uri: doc.uri.toString(),
        languageId: doc.languageId,
        version: doc.version,
        dirty: doc.isDirty,
        doc: { lineCount: doc.lineCount, line: (i) => doc.lineAt(i).text },
        visible: editor.visibleRanges.map((r) => ({
          start: r.start.line + 1,
          end: r.end.line + 1
        })),
        selection: sel.isEmpty
          ? null
          : {
              start: sel.start.line + 1,
              // A selection ending at the start of a line doesn't include that line.
              end:
                sel.end.line + (sel.end.character === 0 && sel.end.line > sel.start.line ? 0 : 1),
              text: doc.getText(sel).slice(0, CODE_LIMITS.selectionChars)
            }
      },
      caps
    )
  }

  const applyEdit = async (edit: CodeEdit): Promise<CodeActionResult> => {
    let doc: vscode.TextDocument
    try {
      doc = await vscode.workspace.openTextDocument(vscode.Uri.parse(edit.uri))
    } catch {
      return { ok: false, message: `VS Code can’t open ${edit.path}.` }
    }
    const at = locateEdit(doc.getText().split(/\r?\n/), edit)
    if (!at.ok) return { ok: false, message: at.message }
    forget(edit.id)
    const editor = await editorFor(doc, true)
    if (at.already) {
      editor.revealRange(
        lineRange(doc, at.range),
        vscode.TextEditorRevealType.InCenterIfOutsideViewport
      )
      return { ok: true, message: `Already in ${edit.path}.` }
    }
    const remove = edit.replacement === ''
    const eol = doc.eol === vscode.EndOfLine.CRLF ? '\r\n' : '\n'
    const done = await editor.edit((b) =>
      b.replace(
        remove ? removalRange(doc, at.range) : lineRange(doc, at.range),
        remove ? '' : withEol(edit.replacement, eol)
      )
    )
    if (!done) return { ok: false, message: 'VS Code didn’t accept the change.' }
    const changed: LineRange = {
      start: Math.min(at.range.start, doc.lineCount),
      end: Math.min(
        at.range.start + (remove ? 0 : edit.replacement.split('\n').length - 1),
        doc.lineCount
      )
    }
    editor.revealRange(
      lineRange(doc, changed),
      vscode.TextEditorRevealType.InCenterIfOutsideViewport
    )
    if (!remove) flash(editor, changed)
    log.info(`code link: applied "${edit.label}" to ${edit.path}:${formatLines(at.range)}`)
    return {
      ok: true,
      message: `Changed ${edit.path}:${formatLines(at.range)}. Ctrl+Z in VS Code undoes it.`
    }
  }

  const onEdit = (e: vscode.TextDocumentChangeEvent): void => {
    if (e.contentChanges.length === 0) return
    const uri = e.document.uri.toString()
    const changes: LineChange[] = e.contentChanges.map((c) => ({
      start: c.range.start.line + 1,
      end: c.range.end.line + 1,
      breaks: (c.text.match(/\n/g) ?? []).length
    }))
    let touched = false
    for (const s of [...shown.values()]) {
      if (s.uri !== uri) continue
      const next = shiftRange(s.range, changes)
      if (next === s.range) continue
      touched = true
      if (!next) shown.delete(s.id)
      else {
        s.range = next
        if (s.edit) s.edit = { ...s.edit, range: next }
      }
    }
    if (touched) renderAll()
  }

  const lensProvider = vscode.languages.registerCodeLensProvider('*', {
    onDidChangeCodeLenses: lensChanged.event,
    provideCodeLenses(doc) {
      const uri = doc.uri.toString()
      return [...shown.values()]
        .filter((s) => s.uri === uri && s.range.start <= doc.lineCount)
        .flatMap((s) => {
          const at = new vscode.Range(s.range.start - 1, 0, s.range.start - 1, 0)
          const fallback = s.kind === 'edit' ? 'proposed change' : 'look here'
          const lenses = [
            new vscode.CodeLens(at, {
              title: `$(${s.kind === 'edit' ? 'sparkle' : 'eye'}) Hoot: ${truncate(s.label || fallback, 80)}`,
              command: ''
            })
          ]
          if (s.kind === 'edit') {
            lenses.push(
              new vscode.CodeLens(at, {
                title: '$(check) Apply',
                command: CODE_COMMANDS.apply,
                arguments: [s.id]
              })
            )
          }
          lenses.push(
            new vscode.CodeLens(at, {
              title: '$(close) Dismiss',
              command: CODE_COMMANDS.dismiss,
              arguments: [s.id]
            })
          )
          return lenses
        })
    }
  })

  const subscriptions: vscode.Disposable[] = [
    issueType,
    editType,
    flashType,
    lensChanged,
    lensProvider,
    vscode.window.onDidChangeVisibleTextEditors(renderAll),
    vscode.workspace.onDidChangeTextDocument(onEdit),
    vscode.workspace.onDidCloseTextDocument((doc) => {
      const uri = doc.uri.toString()
      for (const s of [...shown.values()]) if (s.uri === uri && !s.edit) shown.delete(s.id)
    })
  ]

  return {
    focusFile() {
      const doc = vscode.window.activeTextEditor?.document
      return doc && usable(doc) ? { path: pathOf(doc.uri), languageId: doc.languageId } : null
    },

    async snapshot(): Promise<CodeSnapshot> {
      const active = vscode.window.activeTextEditor
      const seen = new Set<string>()
      const editors = [active, ...vscode.window.visibleTextEditors].filter(
        (e): e is vscode.TextEditor => {
          if (!e || !usable(e.document) || seen.has(e.document.uri.toString())) return false
          seen.add(e.document.uri.toString())
          return true
        }
      )
      const excludedPaths: string[] = []
      const kept = editors.filter((e) => {
        if (!excluded(e.document)) return true
        excludedPaths.push(pathOf(e.document.uri))
        return false
      })
      const focused = active && kept[0] === active ? fileOf(active, FOCUSED_CAPS) : null
      const others = kept
        .filter((e) => e !== active)
        .slice(0, CODE_LIMITS.others)
        .map((e) => fileOf(e, OTHER_CAPS))
      const sent = new Set([focused, ...others].flatMap((f) => (f ? [f.uri] : [])))
      const found: DiagnosticInput[] = []
      let otherErrors = 0
      for (const [uri, list] of vscode.languages.getDiagnostics()) {
        const isSent = sent.has(uri.toString())
        const path = pathOf(uri)
        if (!isSent && SECRET_NAME.test(path)) continue
        for (const d of list) {
          const severity = SEVERITY[d.severity]
          if (!isSent && (severity !== 'error' || otherErrors++ >= OTHER_ERRORS)) continue
          const code = typeof d.code === 'object' ? d.code.value : d.code
          found.push({
            path,
            start: d.range.start.line + 1,
            end: d.range.end.line + 1,
            severity,
            message: d.message,
            source: [d.source, code].filter((v) => v !== undefined && v !== '').join(' ') || null,
            shown: isSent
          })
        }
      }
      return {
        workspace: vscode.workspace.name ?? '',
        active: focused,
        others,
        diagnostics: pickDiagnostics(found),
        excluded: excludedPaths.slice(0, 8)
      }
    },

    async show(marks, edits, reveal) {
      const items: Shown[] = []
      for (const m of marks) {
        const uri = await resolveUri(m)
        if (!uri) continue
        items.push({ ...m, kind: 'mark', uri: uri.toString(), edit: null })
      }
      for (const e of edits) items.push({ ...e, kind: 'edit', edit: e })
      shown.clear()
      for (const item of items) shown.set(item.id, item)
      renderAll()
      if (reveal) {
        for (const item of items) {
          const editor = vscode.window.visibleTextEditors.find(
            (e) => e.document.uri.toString() === item.uri
          )
          if (!editor) continue
          editor.revealRange(
            lineRange(editor.document, item.range),
            vscode.TextEditorRevealType.InCenterIfOutsideViewport
          )
          break
        }
      }
      return {
        ok: true,
        message: items.length ? null : 'Hoot couldn’t find those files in VS Code.'
      }
    },

    apply: applyEdit,

    async reveal(mark) {
      const uri = await resolveUri(mark)
      if (!uri) return { ok: false, message: `VS Code can’t find ${mark.path}.` }
      const doc = await vscode.workspace.openTextDocument(uri)
      const editor = await editorFor(doc, false)
      const range = lineRange(doc, mark.range)
      editor.revealRange(range, vscode.TextEditorRevealType.InCenter)
      editor.selection = new vscode.Selection(range.start, range.start)
      if (!shown.has(mark.id)) {
        shown.set(mark.id, { ...mark, kind: 'mark', uri: uri.toString(), edit: null })
        renderAll()
      }
      flash(editor, mark.range)
      return { ok: true, message: null }
    },

    async clear() {
      shown.clear()
      renderAll()
      return { ok: true, message: null }
    },

    async applyById(id) {
      const s = typeof id === 'string' ? shown.get(id) : undefined
      if (!s?.edit) return
      const result = await applyEdit(s.edit)
      if (result.ok) {
        for (const listener of appliedListeners) listener(s.id)
        void vscode.window.setStatusBarMessage(
          `$(check) Hoot: ${result.message ?? 'applied'}`,
          4000
        )
      } else {
        void vscode.window.showWarningMessage(result.message ?? 'Hoot couldn’t apply that change.')
      }
    },

    dismiss(id) {
      if (typeof id === 'string') forget(id)
    },

    clearAll() {
      shown.clear()
      renderAll()
    },

    onApplied(listener) {
      appliedListeners.add(listener)
      return new vscode.Disposable(() => appliedListeners.delete(listener))
    },

    dispose() {
      shown.clear()
      appliedListeners.clear()
      for (const s of subscriptions) s.dispose()
    }
  }
}
