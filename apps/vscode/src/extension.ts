import { randomBytes } from 'node:crypto'
import * as vscode from 'vscode'
import { LensBackendError } from '@hoot/core'
import { createHootClient, defaultEndpoint } from './client'
import { activateCodeLink } from './code/activate'
import { CODE_COMMANDS } from './code/editor'
import { MARK_COMMANDS, createLens } from './lens'
import { errorMessage } from './messages'

const SALT_KEY = 'hoot.lens.salt'

/**
 * Hoot Lens for VS Code: the Hoot desktop app is the brain (Claude key, Lens
 * engine, reader profile); this extension talks to it over the bridge pipe,
 * and over the code link it lets Hoot read this window's code (instead of
 * screenshots), highlight it and apply the changes you accept.
 */
export function activate(context: vscode.ExtensionContext): void {
  const log = vscode.window.createOutputChannel('Hoot Lens', { log: true })
  const salt = context.globalState.get<string>(SALT_KEY) ?? randomBytes(16).toString('hex')
  void context.globalState.update(SALT_KEY, salt)

  const client = createHootClient({
    ...defaultEndpoint(),
    extVersion: String((context.extension.packageJSON as { version?: string }).version ?? '0'),
    log: (message) => log.info(message)
  })
  const lens = createLens({ client, salt, log })
  const codeLink = activateCodeLink(context, log)
  const codeLine = (): string =>
    !codeLink
      ? 'Hoot can’t read this window’s code (hoot.code.enabled is off).'
      : codeLink.state === 'online'
        ? 'Hoot reads this window’s code when you ask it about code: no screenshots.'
        : 'Code link: waiting for Hoot.'

  const status = vscode.window.createStatusBarItem('hoot.status', vscode.StatusBarAlignment.Right)
  status.name = 'Hoot Lens'
  status.command = 'hoot.menu'
  const problem = (): string => errorMessage(client.lastError?.code ?? 'app_unavailable')
  const update = (): void => {
    if (client.state === 'online') {
      status.text = '$(eye) Hoot'
      status.tooltip = client.lens?.enabled
        ? 'Hoot Lens: connected to the Hoot app'
        : 'Hoot Lens: connected. Lens is off in Hoot settings, so nothing changes on its own.'
    } else {
      status.text = '$(eye-closed) Hoot: offline'
      status.tooltip = client.state === 'connecting' ? 'Hoot Lens: connecting…' : problem()
    }
    status.tooltip = `${status.tooltip}\n${codeLine()}`
    status.show()
  }

  const reconnect = async (): Promise<void> => {
    codeLink?.connect().catch(() => {})
    try {
      await client.connect()
      vscode.window.setStatusBarMessage('Hoot: connected', 3000)
    } catch (e) {
      const code = e instanceof LensBackendError ? e.code : 'app_unavailable'
      const choice = await vscode.window.showWarningMessage(errorMessage(code), 'Retry')
      if (choice === 'Retry') await reconnect()
    }
  }

  const menu = async (): Promise<void> => {
    const items = [
      { label: '$(sparkle) Make this clearer', command: 'hoot.lens.rewrite' },
      { label: '$(comment-discussion) Explain in Hoot chat', command: 'hoot.explain' },
      { label: '$(discard) Restore all', command: 'hoot.lens.restoreAll' },
      { label: '$(clear-all) Clear Hoot’s highlights in code', command: CODE_COMMANDS.clear },
      { label: '$(refresh) Reconnect', command: 'hoot.reconnect' }
    ]
    const pick = await vscode.window.showQuickPick(items, {
      placeHolder: client.state === 'online' ? 'Hoot Lens: connected' : `Hoot Lens: ${problem()}`
    })
    if (pick) await vscode.commands.executeCommand(pick.command)
  }

  context.subscriptions.push(
    log,
    status,
    lens,
    new vscode.Disposable(client.onChange(update)),
    new vscode.Disposable(codeLink?.onChange(update) ?? (() => {})),
    new vscode.Disposable(() => client.dispose()),
    vscode.commands.registerCommand('hoot.lens.rewrite', () => lens.rewrite()),
    vscode.commands.registerCommand('hoot.explain', () => lens.explain()),
    vscode.commands.registerCommand('hoot.lens.restoreAll', () => lens.restoreAll()),
    vscode.commands.registerCommand('hoot.reconnect', reconnect),
    vscode.commands.registerCommand('hoot.menu', menu),
    vscode.commands.registerCommand(MARK_COMMANDS.restore, (id: unknown) => lens.restore(id)),
    vscode.commands.registerCommand(MARK_COMMANDS.knewIt, (id: unknown) => lens.knewIt(id)),
    vscode.commands.registerCommand(MARK_COMMANDS.explainMore, (id: unknown) =>
      lens.explainMore(id)
    ),
    vscode.commands.registerCommand(MARK_COMMANDS.copyRewrite, (id: unknown) =>
      lens.copyRewrite(id)
    )
  )
  update()
  client.connect().catch(() => {})
}
