import type { AppContext } from '../context'
import { handleInvoke, onSend } from './handle'

/**
 * buddy:* — renderer → main. All sends are fire-and-forget; the arguments
 * are validated against SEND_ARGS before the handler runs.
 */
export function registerBuddyIpc(ctx: AppContext): void {
  onSend('buddy:requestMode', (_s, mode) => {
    // The live chat was minimized into the owl: opening the chat brings it back out.
    if (mode === 'card' && ctx.capture.restore()) return
    ctx.buddy.request(mode)
  })
  onSend('buddy:transitionDone', (_s, id) => ctx.buddy.transitionDone(id))
  onSend('buddy:setIgnoreMouse', (_s, ignore) => ctx.buddy.setIgnoreMouse(ignore))
  onSend('buddy:hitRegions', (_s, rects) => ctx.buddy.setHitRegions(rects))
  onSend('buddy:dragStart', () => ctx.buddy.dragStart())
  onSend('buddy:dragMove', () => ctx.buddy.dragMove())
  onSend('buddy:dragEnd', (_s, v) => ctx.buddy.dragEnd(v))
  onSend('buddy:setCursorTracking', (_s, on) => ctx.buddy.setCursorTracking(on))

  handleInvoke('buddy:dismissGreeting', () => {
    ctx.buddy.dismissGreeting()
  })
}
