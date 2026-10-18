import { win32 } from 'node:path'
import {
  applyRegistration,
  isRegistered,
  nodeRegistrationIO,
  planRegistration,
  type RegistrationIO
} from '@hoot/bridge'
import type { Platform } from '@hoot/core'

export interface NativeHostDeps {
  platform: Platform
  /** `process.resourcesPath` of the packaged app (hoot-bridge.cmd lives there). */
  resourcesPath: string
  home: string
  localAppData?: string
  io?: RegistrationIO
  log?(message: string): void
}

export type NativeHostResult = 'current' | 'registered' | 'unsupported' | 'failed'

/**
 * Packaged builds only: make sure Chrome, Edge, Chromium and Brave can find
 * hoot-bridge. The installer registers it too; this repairs an unpacked
 * build (`build:unpack`), a moved install, or a registration removed by
 * another tool. It never throws: the app works without the extension.
 */
export async function ensureNativeHost(deps: NativeHostDeps): Promise<NativeHostResult> {
  // The launcher is a .cmd; macOS and Linux are cut for the hackathon (finish-plan §1).
  if (deps.platform !== 'win32') return 'unsupported'
  const io = deps.io ?? nodeRegistrationIO
  const plan = planRegistration({
    platform: 'win32',
    home: deps.home,
    localAppData: deps.localAppData,
    launcherPath: win32.join(deps.resourcesPath, 'hoot-bridge.cmd')
  })
  try {
    if (await isRegistered(plan, io)) return 'current'
    await applyRegistration(plan, io)
    deps.log?.(`registered the browser native host → ${plan.manifest.path}`)
    return 'registered'
  } catch (e) {
    deps.log?.(`native host registration failed: ${e instanceof Error ? e.message : String(e)}`)
    return 'failed'
  }
}
