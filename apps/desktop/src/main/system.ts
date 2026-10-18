import { app, nativeTheme, systemPreferences } from 'electron'
import type { StateSlices, Unsubscribe } from '@hoot/core'
import type { Store } from './store/store'

type SystemSlice = StateSlices['system']

/**
 * The `system` slice. `darkMode` is `nativeTheme.shouldUseDarkColors`:
 * `themeSource` doesn't reliably flip `prefers-color-scheme` in a sandboxed
 * renderer, so this slice is the source of truth for renderers.
 */
const FALLBACK_ACCENT = '#0A84FF'

/** Windows and macOS report an accent colour; Linux has no API for it. */
function readAccent(): string {
  if (process.platform === 'linux') return FALLBACK_ACCENT
  // Electron returns 'RRGGBBAA'; the slice wants '#RRGGBB' (drop the alpha).
  const accent = systemPreferences.getAccentColor()
  return /^[0-9a-fA-F]{6}/.test(accent) ? `#${accent.slice(0, 6)}` : FALLBACK_ACCENT
}

export function readSystem(): SystemSlice {
  return {
    platform: process.platform as SystemSlice['platform'],
    version: app.getVersion(),
    packaged: app.isPackaged,
    accentColor: readAccent(),
    darkMode: nativeTheme.shouldUseDarkColors,
    highContrast: nativeTheme.shouldUseHighContrastColors
  }
}

/** Push OS theme/accent changes into the slice. Returns an unsubscribe. */
export function watchSystem(store: Store): Unsubscribe {
  const update = (): void => {
    const s = readSystem()
    store.update('system', {
      accentColor: s.accentColor,
      darkMode: s.darkMode,
      highContrast: s.highContrast
    })
  }
  nativeTheme.on('updated', update)
  systemPreferences.on('accent-color-changed', update)
  return () => {
    nativeTheme.off('updated', update)
    systemPreferences.off('accent-color-changed', update)
  }
}
