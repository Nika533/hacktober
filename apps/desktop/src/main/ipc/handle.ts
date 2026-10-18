import { ipcMain } from 'electron'
import type { InvokeChannel, InvokeResult, SendChannel } from '@hoot/core'
import {
  IpcValidationError,
  parseInvokeArgs,
  parseSendArgs,
  type InvokeArgs,
  type SendArgs
} from '@hoot/core/schemas'
import { createLogger } from '../log'

const log = createLogger('ipc')

/**
 * Register an invoke handler with argument validation. `IpcValidationError`
 * propagates, so the renderer's `invoke` rejects with the message preserved.
 */
export function handleInvoke<C extends InvokeChannel>(
  channel: C,
  fn: (
    sender: Electron.WebContents,
    ...args: InvokeArgs<C>
  ) => Promise<InvokeResult<C>> | InvokeResult<C>
): void {
  ipcMain.handle(channel, (event, ...args: unknown[]) => {
    const parsed = parseInvokeArgs(channel, args)
    return fn(event.sender, ...parsed)
  })
}

/**
 * Register a fire-and-forget handler. Invalid arguments are logged and
 * dropped — a send has no one to reject to.
 */
export function onSend<C extends SendChannel>(
  channel: C,
  fn: (sender: Electron.WebContents, ...args: SendArgs<C>) => void
): void {
  ipcMain.on(channel, (event, ...args: unknown[]) => {
    try {
      const parsed = parseSendArgs(channel, args)
      fn(event.sender, ...parsed)
    } catch (err) {
      if (err instanceof IpcValidationError) {
        log.warn(err.message)
        return
      }
      throw err
    }
  })
}
