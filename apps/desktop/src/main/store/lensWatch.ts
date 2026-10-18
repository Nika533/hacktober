import type { LensSettings, Unsubscribe } from '@hoot/core'
import type { Store } from './store'

/** The bridge's settings push; the real one is BridgeServer.pushSettings. */
export interface LensSettingsSink {
  pushSettings(lens: LensSettings): void
}

/**
 * Push Lens settings to the bridge whenever the `lens` object inside the
 * settings slice is replaced (reference compare — unrelated settings edits
 * must not push, per finish-plan wiring rules).
 */
export function watchLensSettings(store: Store, bridge: LensSettingsSink): Unsubscribe {
  let last = store.get('settings').settings.lens
  return store.onChange((changed) => {
    if (!changed.has('settings')) return
    const lens = store.get('settings').settings.lens
    if (lens === last) return
    last = lens
    bridge.pushSettings(lens)
  })
}
