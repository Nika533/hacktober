import { randomUUID } from 'node:crypto'
import { posix } from 'node:path'
import * as vscode from 'vscode'
import {
  LENS_LIMITS,
  LensBackendError,
  PageRateLimiter,
  TRANSFORMS,
  TRANSFORM_RULES,
  type LensContext,
  type LensEventKind,
  type ProfileSnapshot,
  type RewriteResult
} from '@hoot/core'
import type { HootClient } from './client'
import { autoEligible, buildContext, spanOf } from './context'
import {
  applyChanges,
  lensEvent,
  overlaps,
  truncate,
  urlHash,
  type Mark,
  type OffsetRange
} from './marks'
import { errorMessage, isConnectionError, skipMessage } from './messages'

const ACCENT = '#38bdf8'
const AUTO_DWELL_MS = 1200
const AUTO_P = 0.8
/** A change still showing after this long counts as kept (hoot-lens.md §8.1). */
const KEPT_MS = 30_000
const INLINE_MAX = 80
const DEFAULT_AUTO_LANGUAGES = ['markdown', 'plaintext', 'latex', 'restructuredtext', 'asciidoc']

/** Commands behind the links in a mark's hover; each takes the mark id. */
export const MARK_COMMANDS = {
  restore: 'hoot.lens.restore',
  knewIt: 'hoot.lens.knewIt',
  explainMore: 'hoot.lens.explainMore',
  copyRewrite: 'hoot.lens.copyRewrite'
} as const

interface Target extends OffsetRange {
  text: string
  startLine: number
  endLine: number
}

interface Inflight extends OffsetRange {
  uri: string
  controller: AbortController
  auto: boolean
}

export interface Lens extends vscode.Disposable {
  /** Make this clearer: the selection, or the word under the cursor. */
  rewrite(): Promise<void>
  /** Explain the selection in the Hoot chat. */
  explain(): Promise<void>
  /** Restore every mark in the active editor. */
  restoreAll(): void
  restore(id: unknown): void
  knewIt(id: unknown): void
  explainMore(id: unknown): Promise<void>
  copyRewrite(id: unknown): Promise<void>
}

export interface LensDeps {
  client: HootClient
  /** Per-install salt for `urlHash`. */
  salt: string
  log: vscode.LogOutputChannel
}

const info = (message: string): void => void vscode.window.showInformationMessage(message)
const flash = (message: string): void => void vscode.window.setStatusBarMessage(message, 4000)

function commandLink(label: string, command: string, id: string, title: string): string {
  return `[${label}](command:${command}?${encodeURIComponent(JSON.stringify([id]))} "${title}")`
}

function hover(mark: Mark): vscode.MarkdownString {
  const md = new vscode.MarkdownString('', true)
  md.isTrusted = { enabledCommands: Object.values(MARK_COMMANDS) }
  md.appendMarkdown(`$(eye) **Hoot Lens** · ${TRANSFORM_RULES[mark.result.transform].label}\n\n`)
  md.appendText(mark.result.text)
  md.appendMarkdown('\n\n---\n\n*Original:* ')
  md.appendText(mark.original)
  md.appendMarkdown(
    `\n\n${[
      commandLink('Restore', MARK_COMMANDS.restore, mark.id, 'Put the original back'),
      commandLink('I knew this', MARK_COMMANDS.knewIt, mark.id, 'Hoot skips this next time'),
      commandLink('Explain more in Hoot', MARK_COMMANDS.explainMore, mark.id, 'Open the Hoot chat'),
      commandLink('Copy rewrite', MARK_COMMANDS.copyRewrite, mark.id, 'Copy the clearer version')
    ].join(' · ')}`
  )
  return md
}

/**
 * Hoot Lens in the editor: marks (tint, dotted underline, the rewrite inline
 * and in a hover) over the original text, which is never modified. Marks follow
 * edits and drop when their text changes; feedback goes to the app.
 */
export function createLens({ client, salt, log }: LensDeps): Lens {
  const marks = new Map<string, Mark[]>()
  const keptTimers = new Map<string, ReturnType<typeof setTimeout>>()
  const limiters = new Map<string, PageRateLimiter>()
  let inflight: Inflight | null = null
  let autoTimer: ReturnType<typeof setTimeout> | null = null
  let knownFor: ProfileSnapshot | null = null
  let known = new Set<string>()

  const markType = vscode.window.createTextEditorDecorationType({
    backgroundColor: `${ACCENT}1f`,
    textDecoration: `underline dotted ${ACCENT}99`,
    borderRadius: '3px',
    overviewRulerColor: `${ACCENT}99`,
    overviewRulerLane: vscode.OverviewRulerLane.Right,
    rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed
  })
  const thinkingType = vscode.window.createTextEditorDecorationType({
    backgroundColor: `${ACCENT}0f`,
    textDecoration: `underline dotted ${ACCENT}59`,
    borderRadius: '3px',
    rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
    after: {
      contentText: 'Hoot is reading…',
      fontStyle: 'italic',
      color: new vscode.ThemeColor('editorCodeLens.foreground'),
      margin: '0 0 0 0.75em'
    }
  })

  const knownTerms = (): ReadonlySet<string> => {
    if (client.profile !== knownFor) {
      knownFor = client.profile
      known = new Set(knownFor?.knownTerms.map((term) => term.toLowerCase()))
    }
    return known
  }

  const limiter = (uri: string): PageRateLimiter => {
    const existing = limiters.get(uri)
    if (existing) return existing
    const created = new PageRateLimiter()
    limiters.set(uri, created)
    return created
  }

  const render = (uri: string): void => {
    for (const editor of vscode.window.visibleTextEditors) {
      const doc = editor.document
      if (doc.uri.toString() !== uri) continue
      const range = (r: OffsetRange): vscode.Range =>
        new vscode.Range(doc.positionAt(r.start), doc.positionAt(r.end))
      editor.setDecorations(
        markType,
        (marks.get(uri) ?? []).map((mark) => ({
          range: range(mark),
          hoverMessage: hover(mark),
          renderOptions: {
            after: {
              contentText: `→ ${truncate(mark.result.text, INLINE_MAX)}`,
              fontStyle: 'italic',
              color: new vscode.ThemeColor('textLink.foreground'),
              margin: '0 0 0 0.6em'
            }
          }
        }))
      )
      editor.setDecorations(thinkingType, inflight?.uri === uri ? [range(inflight)] : [])
    }
  }

  const renderAll = (): void => {
    for (const uri of new Set([...marks.keys(), ...(inflight ? [inflight.uri] : [])])) render(uri)
  }

  const send = (mark: Mark, kind: LensEventKind, latencyMs = 0): void => {
    client
      .feedback(lensEvent(mark, kind, Date.now(), latencyMs))
      .catch((e: unknown) => log.warn(`feedback ${kind} failed: ${String(e)}`))
  }

  const forgetTimer = (id: string): void => {
    clearTimeout(keptTimers.get(id))
    keptTimers.delete(id)
  }

  const byId = (id: unknown): Mark | undefined => {
    for (const list of marks.values()) {
      const mark = list.find((m) => m.id === id)
      if (mark) return mark
    }
    return undefined
  }

  const remove = (mark: Mark): void => {
    forgetTimer(mark.id)
    const rest = (marks.get(mark.uri) ?? []).filter((m) => m.id !== mark.id)
    if (rest.length) marks.set(mark.uri, rest)
    else marks.delete(mark.uri)
    render(mark.uri)
  }

  const restore = (id: unknown, kind: 'reverted' | 'knew_it'): void => {
    const mark = byId(id)
    if (!mark) return
    remove(mark)
    if (mark.auto) limiter(mark.uri).recordRevert()
    send(mark, kind)
  }

  const show = (
    uri: string,
    range: OffsetRange,
    original: string,
    ctx: LensContext,
    result: RewriteResult,
    auto: boolean,
    latencyMs: number
  ): void => {
    const mark: Mark = {
      id: randomUUID(),
      uri,
      urlHash: urlHash(uri, salt),
      start: range.start,
      end: range.end,
      original,
      result,
      ctx,
      auto
    }
    const rest = (marks.get(uri) ?? []).filter((m) => {
      if (overlaps(m, mark)) forgetTimer(m.id)
      return !overlaps(m, mark)
    })
    marks.set(uri, [...rest, mark])
    keptTimers.set(
      mark.id,
      setTimeout(() => {
        keptTimers.delete(mark.id)
        if (!byId(mark.id)) return
        if (mark.auto) limiter(uri).recordKept()
        send(mark, 'kept')
      }, KEPT_MS)
    )
    if (auto) limiter(uri).recordChange(Date.now())
    render(uri)
    send(mark, 'shown', latencyMs)
  }

  const cancelInflight = (): void => {
    if (!inflight) return
    const { uri, controller } = inflight
    inflight = null
    controller.abort()
    render(uri)
  }

  const report = async (error: unknown, retryCommand?: string): Promise<void> => {
    const code = error instanceof LensBackendError ? error.code : 'internal'
    if (code === 'cancelled') return
    const retry = retryCommand && isConnectionError(code) ? ['Retry'] : []
    const choice = await vscode.window.showWarningMessage(errorMessage(code), ...retry)
    if (choice === 'Retry' && retryCommand) await vscode.commands.executeCommand(retryCommand)
  }

  const targetOf = (editor: vscode.TextEditor, wordFallback: boolean): Target | null => {
    const doc = editor.document
    const selection = editor.selection
    const range = selection.isEmpty
      ? wordFallback
        ? doc.getWordRangeAtPosition(selection.active)
        : undefined
      : selection
    if (!range) return null
    const raw = doc.getText(range)
    const text = raw.trim()
    if (!text) return null
    const start = doc.offsetAt(range.start) + raw.length - raw.trimStart().length
    const end = start + text.length
    return {
      start,
      end,
      text,
      startLine: doc.positionAt(start).line,
      endLine: doc.positionAt(end).line
    }
  }

  const contextFor = (doc: vscode.TextDocument, target: Target, auto: boolean): LensContext =>
    buildContext({
      lines: doc.getText().split(/\r?\n/),
      startLine: target.startLine,
      endLine: target.endLine,
      text: target.text,
      languageId: doc.languageId,
      fileName: posix.basename(doc.uri.path),
      p: auto ? AUTO_P : 1,
      dwellMs: auto ? AUTO_DWELL_MS : 0,
      lens: client.lens,
      knownTerms: knownTerms()
    })

  const run = async (doc: vscode.TextDocument, target: Target, auto: boolean): Promise<void> => {
    cancelInflight()
    const uri = doc.uri.toString()
    const ctx = contextFor(doc, target, auto)
    const mine: Inflight = {
      uri,
      start: target.start,
      end: target.end,
      controller: new AbortController(),
      auto
    }
    inflight = mine
    render(uri)
    const started = Date.now()
    try {
      const outcome = await client.rewrite(
        { ctx, allowedTransforms: [...TRANSFORMS], risk: 'normal' },
        mine.controller.signal
      )
      if (inflight !== mine) return
      inflight = null
      if (outcome.kind === 'rewritten') {
        show(uri, mine, target.text, ctx, outcome.result, auto, Date.now() - started)
      } else if (!auto) {
        const message = skipMessage(outcome.reason)
        if (outcome.reason === 'lens_off' && message) info(message)
        else if (message) flash(message)
      }
    } catch (e) {
      if (inflight !== mine) return
      inflight = null
      log.warn(`rewrite failed: ${e instanceof Error ? e.message : String(e)}`)
      if (!auto) void report(e, 'hoot.lens.rewrite')
    } finally {
      if (inflight === mine) inflight = null
      render(uri)
    }
  }

  const config = (doc: vscode.TextDocument): vscode.WorkspaceConfiguration =>
    vscode.workspace.getConfiguration('hoot.lens', doc)

  const clearAuto = (): void => {
    if (autoTimer) clearTimeout(autoTimer)
    autoTimer = null
    if (inflight?.auto) cancelInflight()
  }

  const onSelection = (e: vscode.TextEditorSelectionChangeEvent): void => {
    clearAuto()
    const { textEditor: editor, selections } = e
    const doc = editor.document
    const byUser =
      e.kind === vscode.TextEditorSelectionChangeKind.Mouse ||
      e.kind === vscode.TextEditorSelectionChangeKind.Keyboard
    if (!byUser || selections.length !== 1 || selections[0]?.isEmpty) return
    if (client.state !== 'online' || !config(doc).get<boolean>('auto', true)) return
    const target = targetOf(editor, false)
    const eligible =
      target &&
      autoEligible({
        text: target.text,
        languageId: doc.languageId,
        autoLanguages: config(doc).get<string[]>('autoLanguages', DEFAULT_AUTO_LANGUAGES),
        lens: client.lens,
        knownTerms: knownTerms()
      })
    if (!target || !eligible) return
    const uri = doc.uri.toString()
    if ((marks.get(uri) ?? []).some((m) => overlaps(m, target))) return
    const page = limiter(uri)
    if (page.askFirst || !page.canChange(Date.now())) return
    const version = doc.version
    const selection = editor.selection
    autoTimer = setTimeout(() => {
      autoTimer = null
      const still =
        vscode.window.activeTextEditor === editor &&
        doc.version === version &&
        editor.selection.isEqual(selection)
      if (still && client.state === 'online' && client.lens?.enabled) void run(doc, target, true)
    }, AUTO_DWELL_MS)
  }

  const onEdit = (e: vscode.TextDocumentChangeEvent): void => {
    if (!e.contentChanges.length) return
    const uri = e.document.uri.toString()
    const list = marks.get(uri)
    if (list) {
      const { kept, dropped } = applyChanges(list, e.contentChanges)
      for (const mark of dropped) forgetTimer(mark.id)
      if (kept.length) marks.set(uri, kept)
      else marks.delete(uri)
    }
    if (inflight?.uri === uri) {
      const [moved] = applyChanges([inflight], e.contentChanges).kept
      if (moved) Object.assign(inflight, { start: moved.start, end: moved.end })
      else cancelInflight()
    }
    if (list?.length) render(uri)
  }

  const onClose = (doc: vscode.TextDocument): void => {
    const uri = doc.uri.toString()
    for (const mark of marks.get(uri) ?? []) forgetTimer(mark.id)
    marks.delete(uri)
    limiters.delete(uri)
    if (inflight?.uri === uri) cancelInflight()
  }

  const subscriptions = [
    markType,
    thinkingType,
    vscode.window.onDidChangeTextEditorSelection(onSelection),
    vscode.window.onDidChangeVisibleTextEditors(renderAll),
    vscode.workspace.onDidChangeTextDocument(onEdit),
    vscode.workspace.onDidCloseTextDocument(onClose),
    new vscode.Disposable(
      client.onChange(() => {
        if (client.state !== 'online' || !client.lens?.enabled) clearAuto()
      })
    )
  ]

  return {
    async rewrite() {
      const editor = vscode.window.activeTextEditor
      const target = editor && targetOf(editor, true)
      if (!editor || !target) return info('Select the text you want made clearer first.')
      if (spanOf(target.text, editor.document.languageId).length > LENS_LIMITS.span) {
        return info(
          `Hoot Lens works on up to ${LENS_LIMITS.span} characters. Select less, or use Hoot: Explain in Hoot chat.`
        )
      }
      clearAuto()
      await run(editor.document, target, false)
    },

    async explain() {
      const editor = vscode.window.activeTextEditor
      const target = editor && targetOf(editor, true)
      if (!editor || !target) return info('Select what you want Hoot to explain first.')
      try {
        await client.explain(contextFor(editor.document, target, false))
        flash('$(comment-discussion) Hoot is explaining it in the Hoot chat')
      } catch (e) {
        await report(e, 'hoot.explain')
      }
    },

    restoreAll() {
      const editor = vscode.window.activeTextEditor
      if (!editor) return
      const uri = editor.document.uri.toString()
      if (inflight?.uri === uri) cancelInflight()
      const list = [...(marks.get(uri) ?? [])].reverse()
      for (const mark of list) restore(mark.id, 'reverted')
      flash(
        list.length
          ? `Hoot: restored ${list.length} change${list.length > 1 ? 's' : ''}`
          : 'Hoot: nothing to restore'
      )
    },

    restore: (id) => restore(id, 'reverted'),
    knewIt: (id) => restore(id, 'knew_it'),

    async explainMore(id) {
      const mark = byId(id)
      if (!mark) return
      send(mark, 'explain_more')
      try {
        await client.explain(mark.ctx)
        flash('$(comment-discussion) Hoot is explaining it in the Hoot chat')
      } catch (e) {
        await report(e)
      }
    },

    async copyRewrite(id) {
      const mark = byId(id)
      if (!mark) return
      await vscode.env.clipboard.writeText(mark.result.text)
      flash('Hoot: copied the clearer version')
    },

    dispose() {
      clearAuto()
      cancelInflight()
      for (const timer of keptTimers.values()) clearTimeout(timer)
      keptTimers.clear()
      marks.clear()
      for (const s of subscriptions) s.dispose()
    }
  }
}
