import type { InvokeChannel, InvokeResult, SendChannel } from '@hoot/core'
import type { InvokeArgs, SendArgs } from '@hoot/core/schemas'
import type { AppContext } from '../context'
import { createAgentsHandlers } from '../agents'
import { createAnywhereHandlers } from '../anywhere'
import { createCaptureHandlers } from '../capture'
import { createChatHandlers } from '../chat'
import { createCodeHandlers } from '../code'
import { createLensHandlers } from '../lens'
import { createPinsHandlers } from '../pins'
import { createVoiceHandlers } from '../voice'
import { registerAppIpc } from './app'
import { registerBuddyIpc } from './buddy'
import { registerClipboardIpc } from './clipboard'
import { handleInvoke, onSend } from './handle'
import { registerOnboardingIpc } from './onboarding'
import { registerReaderIpc } from './reader'
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
 *   registerHandlerMap(createCaptureHandlers(ctx.capture))
 *   // pins needs the sender: registerSenderHandlerMap(h.invoke) + registerSenderSendMap(h.send)
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
 * Like `HandlerMap`, but the handler also receives the calling WebContents
 * (the `Sender` shape feature folders use: `{ id }`). Pins needs it — note
 * windows are identified by their sender.
 */
export type SenderHandlerMap = Partial<{
  [C in InvokeChannel]: (
    sender: { id: number },
    ...args: InvokeArgs<C>
  ) => Promise<InvokeResult<C>> | InvokeResult<C>
}>

export function registerSenderHandlerMap(map: SenderHandlerMap): void {
  for (const channel of Object.keys(map) as InvokeChannel[]) {
    const fn = map[channel]
    if (fn === undefined) continue
    handleInvoke(channel, (sender, ...args: InvokeArgs<InvokeChannel>) =>
      (fn as (s: { id: number }, ...a: unknown[]) => InvokeResult<InvokeChannel>)(sender, ...args)
    )
  }
}

/** Sender-aware variant for fire-and-forget channels (`pins:resize`). */
export type SenderSendMap = Partial<{
  [C in SendChannel]: (sender: { id: number }, ...args: SendArgs<C>) => void
}>

export function registerSenderSendMap(map: SenderSendMap): void {
  for (const channel of Object.keys(map) as SendChannel[]) {
    const fn = map[channel]
    if (fn === undefined) continue
    onSend(channel, (sender, ...args: SendArgs<SendChannel>) =>
      (fn as (s: { id: number }, ...a: unknown[]) => void)(sender, ...args)
    )
  }
}

/** Domain handlers — all feature folders are wired now. */
export function registerDomains(ctx: AppContext): void {
  registerSettingsIpc(ctx)
  registerWindowsIpc(ctx)
  registerOnboardingIpc(ctx)
  registerClipboardIpc(ctx)
  registerReaderIpc(ctx)
  registerAppIpc()
  registerBuddyIpc(ctx)
  registerHandlerMap(createLensHandlers(ctx.lens))
  registerHandlerMap(createChatHandlers(ctx.chat))
  registerHandlerMap(createCaptureHandlers(ctx.capture))
  registerHandlerMap(createCodeHandlers(ctx.code))
  registerHandlerMap(createVoiceHandlers(ctx.voice))
  const pinsHandlers = createPinsHandlers(ctx.pins)
  registerSenderHandlerMap(pinsHandlers.invoke)
  registerSenderSendMap(pinsHandlers.send)
  const anywhereHandlers = createAnywhereHandlers(ctx.anywhere)
  registerSenderHandlerMap(anywhereHandlers.invoke)
  registerSenderSendMap(anywhereHandlers.send)
  const agentsHandlers = createAgentsHandlers(ctx.agents)
  registerSenderHandlerMap(agentsHandlers.invoke)
  registerSenderSendMap(agentsHandlers.send)
}
