import { readFile } from 'node:fs/promises'
import { tmpdir, userInfo } from 'node:os'
import * as vscode from 'vscode'
import type { Platform } from '@hoot/core'
import { codeLinkPipePath, codeLinkTokenPath } from '@hoot/core/code'
import { CODE_COMMANDS, DEFAULT_EXCLUDE, createCodeEditor } from './editor'
import { createCodeLink, type CodeLink } from './link'

/** Connect now instead of waiting for the next retry. */
export const CODE_RECONNECT = 'hoot.code.reconnect'

/**
 * The code link: Hoot reads the code you're looking at straight from this
 * window (no screenshots), highlights what it points at, and applies the
 * edits you accept. Off with `hoot.code.enabled`; files matching
 * `hoot.code.exclude` are never read. Returns null when it's off.
 */
export function activateCodeLink(
  context: vscode.ExtensionContext,
  log: vscode.LogOutputChannel
): CodeLink | null {
  const config = (): vscode.WorkspaceConfiguration => vscode.workspace.getConfiguration('hoot.code')
  if (!config().get<boolean>('enabled', true)) {
    log.info('code link: off (hoot.code.enabled)')
    return null
  }
  const editor = createCodeEditor({
    log,
    exclude: () => config().get<string[]>('exclude', DEFAULT_EXCLUDE)
  })
  const platform = process.platform as Platform
  const link = createCodeLink({
    pipePath: codeLinkPipePath(platform, userInfo().username, tmpdir()),
    readToken: () =>
      readFile(codeLinkTokenPath(platform, process.env), 'utf8').then(
        (token) => token.trim() || null,
        () => null
      ),
    extVersion: String((context.extension.packageJSON as { version?: string }).version ?? '0'),
    window: { id: vscode.env.sessionId.slice(0, 128), name: vscode.workspace.name ?? 'VS Code' },
    focus: () => ({ focused: vscode.window.state.focused, file: editor.focusFile() }),
    handlers: editor,
    log: (message) => log.info(message)
  })
  context.subscriptions.push(
    editor,
    new vscode.Disposable(() => link.dispose()),
    editor.onApplied((id) => link.applied(id)),
    vscode.window.onDidChangeWindowState(() => link.focusChanged()),
    vscode.window.onDidChangeActiveTextEditor(() => link.focusChanged()),
    vscode.commands.registerCommand(CODE_COMMANDS.apply, (id: unknown) => editor.applyById(id)),
    vscode.commands.registerCommand(CODE_COMMANDS.dismiss, (id: unknown) => editor.dismiss(id)),
    vscode.commands.registerCommand(CODE_COMMANDS.clear, () => editor.clearAll()),
    vscode.commands.registerCommand(CODE_RECONNECT, () =>
      link.connect().then(
        () => vscode.window.setStatusBarMessage('Hoot: VS Code connected', 3000),
        () => vscode.window.showWarningMessage('Hoot isn’t running. Start Hoot, then retry.')
      )
    )
  )
  link.connect().catch(() => {})
  return link
}
