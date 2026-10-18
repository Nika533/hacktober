import type { InvokeChannel, InvokeResult } from '@hoot/core'
import type { InvokeArgs } from '@hoot/core/schemas'
import type { LensService } from './service'

export type LensChannel = Extract<InvokeChannel, `lens:${string}`>

export type LensHandlers = {
  [C in LensChannel]: (...args: InvokeArgs<C>) => Promise<InvokeResult<C>>
}

/**
 * Handlers for every `lens:*` invoke channel (C-14). d1's IPC layer
 * registers them after validating arguments:
 *
 *   for (const [channel, fn] of Object.entries(createLensHandlers(lens)))
 *     ipcMain.handle(channel, (_e, ...args) => fn(...parseInvokeArgs(channel, args)))
 *
 * and forwards `lens.onProfile` as the `lens:profileChanged` event.
 */
export function createLensHandlers(lens: LensService): LensHandlers {
  return {
    'lens:assess': async (reqId, ctx) => lens.assess(reqId, ctx),
    'lens:rewrite': async (reqId, req) => lens.rewrite(reqId, req),
    'lens:cancel': async (reqId) => lens.cancel(reqId),
    'lens:feedback': async (event) => lens.feedback(event),
    'lens:explain': async (ctx) => lens.explain(ctx),
    'lens:profile': async () => lens.profileView(),
    'lens:snapshot': async () => lens.snapshot(),
    'lens:patchProfile': async (patch) => lens.patchProfile(patch),
    'lens:resetProfile': async () => lens.resetProfile(),
    'lens:exportProfile': async () => lens.exportProfile(),
    'lens:recentChanges': async (limit) => lens.recentChanges(limit),
    'lens:glossary': async () => lens.glossary()
  }
}
