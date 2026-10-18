import { clipboard } from 'electron'
import type { AppContext } from '../context'
import { handleInvoke } from './handle'

export function registerClipboardIpc(ctx: AppContext): void {
  handleInvoke('clipboard:writeText', (_s, text) => {
    clipboard.writeText(text)
  })

  // The hint itself is produced by the clipboard watcher (D1-21); arming just
  // marks it selected so the next send includes the snapshot.
  handleInvoke('clipboard:arm', () => {
    const hint = ctx.store.get('chat').clipboardHint
    if (hint) ctx.store.update('chat', { clipboardHint: { ...hint, selected: true } })
  })

  handleInvoke('clipboard:dismiss', () => {
    ctx.store.update('chat', { clipboardHint: null })
  })
}
