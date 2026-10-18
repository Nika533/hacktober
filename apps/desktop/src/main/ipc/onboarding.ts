import type { AppContext } from '../context'
import { handleInvoke } from './handle'

export function registerOnboardingIpc(ctx: AppContext): void {
  handleInvoke('onboarding:setStep', (_s, step) => {
    ctx.store.update('studio', { onboardingStep: step })
  })

  handleInvoke('onboarding:finish', () => {
    const settings = ctx.store.get('settings').settings
    ctx.store.update('settings', { settings: { ...settings, onboardingDone: true } })
    ctx.store.update('studio', { onboardingStep: 0, view: 'chat' })
    // The pill summon arrives in D1-14; for now Studio closes.
    ctx.studio.lock()
  })
}
