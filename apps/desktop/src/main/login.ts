import type { Logger } from './log'

/** Login item starts hidden — the tray icon (or the next hotkey) brings it up. */
export const loginItemArgs = (): string[] => ['--hidden']

export interface LoginItemApi {
  isPackaged: boolean
  getLoginItemSettings(): { openAtLogin: boolean }
  setLoginItemSettings(opts: { openAtLogin: boolean; args?: string[] }): void
}

/**
 * Settings wins at startup: if Windows disagrees with `settings.launchAtLogin`
 * (e.g. the user toggled it in Task Manager), write our value back.
 */
export function reconcileLoginItem(api: LoginItemApi, launchAtLogin: boolean, log: Logger): void {
  if (!api.isPackaged) return
  if (api.getLoginItemSettings().openAtLogin === launchAtLogin) return
  api.setLoginItemSettings({ openAtLogin: launchAtLogin, args: loginItemArgs() })
  log.info(`login item reconciled: openAtLogin=${launchAtLogin}`)
}
