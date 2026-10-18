import type { Platform } from '../types/app'

/** Native messaging host name registered for Chrome and Edge. */
export const NATIVE_HOST_NAME = 'com.hoot.lens'

/** Bumped on any breaking change to the bridge messages. */
export const BRIDGE_PROTOCOL_VERSION = 1

/**
 * ID of the unpacked dev extension. It is fixed by the `key` field in
 * apps/extension/static/manifest.json. A Chrome Web Store or Edge Add-ons listing
 * gets its own ID, which must be added to `allowedExtensionIds()` then.
 */
export const DEV_EXTENSION_ID = 'angnmpllmankipgoikeahfhidpcjninj'

export function allowedExtensionIds(): readonly string[] {
  return [DEV_EXTENSION_ID]
}

export const extensionOrigin = (id: string): string => `chrome-extension://${id}/`

/**
 * Where the app listens for hoot-bridge: a named pipe on Windows, a unix
 * socket elsewhere (dev on macOS/Linux). Scoped per OS user.
 */
export function bridgePipePath(platform: Platform, user: string, tmpDir: string): string {
  const safeUser = user.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 64) || 'user'
  if (platform === 'win32') return `\\\\.\\pipe\\hoot-lens-${safeUser}`
  return `${tmpDir.replace(/\/+$/, '')}/hoot-lens-${safeUser}.sock`
}
