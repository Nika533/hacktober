import type { AppContext } from '../context'
import { handleInvoke } from './handle'

export function registerWindowsIpc(ctx: AppContext): void {
  handleInvoke('windows:openStudio', (_s, view) => {
    ctx.studio.open(view ?? 'chat')
    ctx.buddy.hide()
  })

  handleInvoke('windows:lockStudio', () => {
    ctx.studio.lock()
  })

  handleInvoke('windows:openReader', () => {
    ctx.reader.open()
  })
}
