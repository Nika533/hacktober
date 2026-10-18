import type { AppContext } from '../context'
import { createSecureWindow, loadRenderer } from '../windows/base'
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
    let win = ctx.windows.get('reader')
    if (!win || win.isDestroyed()) {
      win = createSecureWindow('reader', {
        width: 1000,
        height: 760,
        minWidth: 640,
        minHeight: 480,
        title: 'Hoot Reader'
      })
      ctx.windows.set('reader', win)
      loadRenderer(win, 'reader')
    }
    win.show()
    win.focus()
  })
}
