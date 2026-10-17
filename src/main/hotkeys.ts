import { globalShortcut, Notification } from 'electron'
import type { Settings } from '../shared/types'

export interface HotkeyDeps {
  onSummon(): void
  onCapture(): void
  onErrors(errors: string[]): void
}

export function registerHotkeys(settings: Settings, deps: HotkeyDeps): void {
  const errors: string[] = []
  const tryRegister = (accelerator: string, label: string, cb: () => void): void => {
    try {
      if (!globalShortcut.register(accelerator, cb)) {
        errors.push(`${label} hotkey "${accelerator}" is already taken by another app`)
      }
    } catch {
      errors.push(`${label} hotkey "${accelerator}" could not be registered`)
    }
  }
  tryRegister(settings.summonHotkey, 'Summon Hoot', deps.onSummon)
  tryRegister(settings.captureHotkey, 'Circle something', deps.onCapture)

  deps.onErrors(errors)
  if (errors.length > 0) {
    new Notification({
      title: 'Hoot',
      body: errors.join('\n')
    }).show()
  }
}

export function unregisterHotkeys(): void {
  globalShortcut.unregisterAll()
}
