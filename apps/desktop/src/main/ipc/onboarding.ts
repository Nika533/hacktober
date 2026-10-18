import type { AppContext } from '../context'
import { handleInvoke } from './handle'

/**
 * Ends onboarding: flags done, resets the Studio view, then locks Studio.
 * `lock()` fires `onLock`, which requests buddy card — so onboarding asks
 * for pill afterwards and ends there (G1: the owl collapses to a dot).
 */
export function finishOnboarding(ctx: AppContext): void {
  const settings = ctx.store.get('settings').settings
  ctx.store.update('settings', { settings: { ...settings, onboardingDone: true } })
  ctx.store.update('studio', { onboardingStep: 0, view: 'chat' })
  ctx.studio.lock()
  ctx.buddy.request('pill')
}

export function registerOnboardingIpc(ctx: AppContext): void {
  handleInvoke('onboarding:setStep', (_s, step) => {
    ctx.store.update('studio', { onboardingStep: step })
  })

  handleInvoke('onboarding:finish', () => {
    finishOnboarding(ctx)
  })
}
