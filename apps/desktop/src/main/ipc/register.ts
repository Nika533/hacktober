import type { AppContext } from '../context'
import { registerAppIpc } from './app'
import { registerClipboardIpc } from './clipboard'
import { registerOnboardingIpc } from './onboarding'
import { registerSettingsIpc } from './settings'
import { registerWindowsIpc } from './windows'

/**
 * Domain handlers registered in D1-12 part 1. chat:*, sessions:*,
 * attachments:*, capture:*, pins:*, reader:* and buddy:* land in
 * D1-12 part 2 / D1-13 / D1-14 / D1-20 / D1-22 — an unregistered invoke
 * rejects naturally.
 */
export function registerDomains(ctx: AppContext): void {
  registerSettingsIpc(ctx)
  registerWindowsIpc(ctx)
  registerOnboardingIpc(ctx)
  registerClipboardIpc(ctx)
  registerAppIpc()
}
