import { app, session } from 'electron'
import type { Logger } from '../log'
import { guardContents } from './base'

/**
 * Process-wide hardening, installed once after `ready`: no permission
 * requests or checks ever grant, and the navigation guards cover even
 * webContents created outside `createSecureWindow`.
 */
export function installSessionHardening(log: Logger): void {
  session.defaultSession.setPermissionRequestHandler((_wc, _perm, cb) => cb(false))
  session.defaultSession.setPermissionCheckHandler(() => false)

  app.on('web-contents-created', (_event, contents) => {
    try {
      guardContents(contents)
    } catch (err) {
      log.warn(`guarding foreign webContents failed: ${String(err)}`)
    }
  })
}
