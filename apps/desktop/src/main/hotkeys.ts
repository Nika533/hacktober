import { globalShortcut } from 'electron'
import type { HotkeyError } from '@hoot/core'
import type { Logger } from './log'
import type { Store } from './store/store'

/** The slice of `globalShortcut` the service needs (injected in tests). */
export interface ShortcutApi {
  register(accelerator: string, cb: () => void): boolean
  unregister(accelerator: string): void
}

export interface HotkeyTimers {
  setTimeout(fn: () => void, ms: number): unknown
  clearTimeout(handle: unknown): void
}

export interface HotkeyDeps {
  store: Store
  log: Logger
  /** False under HOOT_TEST — nothing is ever registered. */
  enabled: boolean
  onSummon(): void
  onCapture(): void
  shortcuts?: ShortcutApi
  timers?: HotkeyTimers
}

export interface Hotkeys {
  apply(): void
  /** Suspend while a settings/hotkey-recorder window captures keys; 60 s cap. */
  suspend(on: boolean, senderId?: number): void
  dispose(): void
}

const SUSPEND_RESUME_MS = 60_000

const defaultTimers: HotkeyTimers = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (h) => clearTimeout(h as NodeJS.Timeout)
}

/**
 * Global summon/capture shortcuts (D1-21). Registration failures go to the
 * settings slice as structured `HotkeyError`s — Settings renders them on the
 * matching row. `suspend(true)` parks both hotkeys (with a 60 s resume cap)
 * so a recorder can grab the combo itself.
 */
export function createHotkeys(deps: HotkeyDeps): Hotkeys {
  const { store, log } = deps
  const shortcuts: ShortcutApi = deps.shortcuts ?? globalShortcut
  const timers = deps.timers ?? defaultTimers

  let applied: string[] = []
  let suspendedBy: number | null = null
  let suspendTimer: unknown = null
  let last = { summon: '', capture: '' }

  const unregisterAll = (): void => {
    for (const acc of applied) shortcuts.unregister(acc)
    applied = []
  }

  const tryRegister = (
    which: HotkeyError['which'],
    accelerator: string,
    cb: () => void
  ): HotkeyError | null => {
    try {
      if (shortcuts.register(accelerator, cb)) {
        applied.push(accelerator)
        return null
      }
      return { which, accelerator, message: `"${accelerator}" is already taken by another app` }
    } catch (e) {
      return { which, accelerator, message: e instanceof Error ? e.message : String(e) }
    }
  }

  const apply = (): void => {
    unregisterAll()
    const s = store.get('settings').settings
    last = { summon: s.summonHotkey, capture: s.captureHotkey }
    // Suspended: the settings change is remembered but nothing registers
    // until resume, and the previous errors stay.
    if (!deps.enabled || suspendedBy !== null) return
    const errors = [
      tryRegister('summonHotkey', s.summonHotkey, deps.onSummon),
      tryRegister('captureHotkey', s.captureHotkey, deps.onCapture)
    ].filter((e): e is HotkeyError => e !== null)
    for (const e of errors) log.warn(`hotkey ${e.which}: ${e.message}`)
    store.update('settings', { hotkeyErrors: errors })
  }

  const resume = (): void => {
    if (suspendTimer !== null) {
      timers.clearTimeout(suspendTimer)
      suspendTimer = null
    }
    suspendedBy = null
    apply()
  }

  // Re-apply when the accelerators change (settings:update or reset).
  const unwatch = store.onChange((changed) => {
    if (!changed.has('settings')) return
    const s = store.get('settings').settings
    if (s.summonHotkey !== last.summon || s.captureHotkey !== last.capture) apply()
  })

  return {
    apply,
    suspend(on, senderId) {
      if (on) {
        suspendedBy = senderId ?? -1
        unregisterAll()
        if (suspendTimer !== null) timers.clearTimeout(suspendTimer)
        suspendTimer = timers.setTimeout(resume, SUSPEND_RESUME_MS)
      } else if (suspendedBy !== null) {
        resume()
      }
    },
    dispose() {
      unwatch()
      if (suspendTimer !== null) {
        timers.clearTimeout(suspendTimer)
        suspendTimer = null
      }
      unregisterAll()
    }
  }
}
