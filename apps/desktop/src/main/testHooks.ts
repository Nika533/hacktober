import { SLICE_NAMES, type Point, type RequestedMode, type SettingsPatch } from '@hoot/core'
import type { AppContext } from './context'
import { finishOnboarding } from './ipc/onboarding'
import { applySettingsUpdate } from './ipc/settings'

export interface HootTestHooks {
  getState(): ReturnType<AppContext['store']['snapshot']>
  summon(): void
  hide(): void
  requestMode(mode: RequestedMode): void
  transitionDone(id: number): void
  setAnchor(p: Point): void
  updateSettings(patch: SettingsPatch): void
  openStudio(): void
  lockStudio(): void
  finishOnboarding(): void
}

declare global {
  var __hoot: HootTestHooks | undefined
}

/**
 * E2E seam: only the `--mode e2e` build AND `HOOT_TEST=1` expose main-process
 * handles to Playwright. Both conditions are compile-time / runtime checked
 * so normal builds carry no `__hoot` at all.
 */
export function installTestHooks(ctx: AppContext): void {
  if (import.meta.env.MODE !== 'e2e' || !ctx.env.test) return
  globalThis.__hoot = {
    getState: () => ctx.store.snapshot(SLICE_NAMES),
    summon: () => ctx.buddy.summon(),
    hide: () => ctx.buddy.hide(),
    requestMode: (mode) => ctx.buddy.request(mode),
    transitionDone: (id) => ctx.buddy.transitionDone(id),
    setAnchor: (p) => ctx.buddy.setAnchor(p),
    updateSettings: (patch) => applySettingsUpdate({ store: ctx.store }, patch),
    // Mirrors windows:openStudio — opening Studio hides the buddy.
    openStudio: () => {
      ctx.studio.open()
      ctx.buddy.hide()
    },
    lockStudio: () => ctx.studio.lock(),
    finishOnboarding: () => finishOnboarding(ctx)
  }
}
