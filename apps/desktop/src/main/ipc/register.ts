import type { InvokeChannel, InvokeResult } from '@hoot/core'
import type { InvokeArgs } from '@hoot/core/schemas'
import type { AppContext } from '../context'
import { createLensHandlers } from '../lens'
import { registerAppIpc } from './app'
import { registerClipboardIpc } from './clipboard'
import { handleInvoke } from './handle'
import { registerOnboardingIpc } from './onboarding'
import { registerSettingsIpc } from './settings'
import { registerWindowsIpc } from './windows'

/**
 * A feature folder's handler factory result: a function per invoke channel,
 * each taking the channel's validated argument tuple.
 */
export type HandlerMap = Partial<{
  [C in InvokeChannel]: (...args: InvokeArgs<C>) => Promise<InvokeResult<C>> | InvokeResult<C>
}>

/**
 * Register every entry of a feature's handler map through the same argument
 * validation as the hand-written domains.
 *
 * Feature folders (main/<feature>/index.ts, finish-plan §2) export
 * `create<Feature>Service` + `create<Feature>Handlers`; AppContext wires each
 * once here — this is the only call a feature ever needs:
 *
 *   registerHandlerMap(createChatHandlers(ctx.chat))
 *   registerHandlerMap(createPinsHandlers(ctx.pins))
 *   registerHandlerMap(createCaptureHandlers(ctx.capture))
 */
export function registerHandlerMap(map: HandlerMap): void {
  for (const channel of Object.keys(map) as InvokeChannel[]) {
    const fn = map[channel]
    if (fn === undefined) continue
    handleInvoke(channel, (_sender, ...args: InvokeArgs<InvokeChannel>) =>
      // The map entry is typed for exactly this channel's args; indexing a
      // Partial loses that link, so call through the erased signature.
      (fn as (...a: unknown[]) => InvokeResult<InvokeChannel>)(...args)
    )
  }
}

/**
 * Domain handlers. capture:*, pins:*, chat:* and buddy:* land when their
 * feature folders do — an unregistered invoke rejects naturally.
 */
export function registerDomains(ctx: AppContext): void {
  registerSettingsIpc(ctx)
  registerWindowsIpc(ctx)
  registerOnboardingIpc(ctx)
  registerClipboardIpc(ctx)
  registerAppIpc()
  registerHandlerMap(createLensHandlers(ctx.lens))
}
