import { clipboard } from 'electron'
import type { AppContext } from '../context'
import { handleInvoke } from './handle'

export function registerClipboardIpc(ctx: AppContext): void {
  handleInvoke('clipboard:writeText', (_s, text) => {
    clipboard.writeText(text)
  })

  handleInvoke('clipboard:arm', () => ctx.clipboard.arm())

  handleInvoke('clipboard:dismiss', () => ctx.clipboard.dismiss())
}
