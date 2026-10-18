import type { Unsubscribe } from '@hoot/core'

/** The part of Electron's `powerMonitor` the watcher needs. */
export interface PowerLike {
  on(event: 'resume' | 'unlock-screen', cb: () => void): void
  removeListener(event: 'resume' | 'unlock-screen', cb: () => void): void
}

/**
 * Wake/unlock recovery: transparent windows can come back blank, so the
 * buddy repaints + relayouts, and the hotkeys re-register defensively
 * (harmless when still registered). Returns an unsubscribe.
 */
export function watchPower(deps: {
  powerMonitor: PowerLike
  buddy: { resume(): void }
  hotkeys: { apply(): void }
}): Unsubscribe {
  const onWake = (): void => {
    deps.buddy.resume()
    deps.hotkeys.apply()
  }
  deps.powerMonitor.on('resume', onWake)
  deps.powerMonitor.on('unlock-screen', onWake)
  return () => {
    deps.powerMonitor.removeListener('resume', onWake)
    deps.powerMonitor.removeListener('unlock-screen', onWake)
  }
}
