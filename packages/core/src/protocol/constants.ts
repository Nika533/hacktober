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

/** Origin the Hoot Lens VS Code extension (apps/vscode) sends in `bridge.auth`. */
export const VSCODE_EXTENSION_ORIGIN = 'vscode-extension://hoot.hoot-lens/'

/** Every origin the app's pipe accepts in `bridge.auth`: the browser extensions and VS Code. */
export function allowedBridgeOrigins(): readonly string[] {
  return [...allowedExtensionIds().map(extensionOrigin), VSCODE_EXTENSION_ORIGIN]
}

/**
 * Where the app listens for hoot-bridge: a named pipe on Windows, a unix
 * socket elsewhere (dev on macOS/Linux). Scoped per OS user.
 */
export function bridgePipePath(platform: Platform, user: string, tmpDir: string): string {
  const safeUser = user.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 64) || 'user'
  if (platform === 'win32') return `\\\\.\\pipe\\hoot-lens-${safeUser}`
  const path = `${tmpDir.replace(/\/+$/, '')}/hoot-lens-${safeUser}.sock`
  // Unix socket paths are limited to ~104 bytes (macOS); fall back to /tmp.
  return path.length <= 100 ? path : `/tmp/hoot-lens-${safeUser}.sock`
}

export interface BridgeEnv {
  HOOT_BRIDGE_DIR?: string
  LOCALAPPDATA?: string
  HOME?: string
  XDG_CONFIG_HOME?: string
}

/**
 * Directory holding the per-launch bridge token the app writes and
 * hoot-bridge reads. It's per-user and independent of Electron's userData
 * naming, so the packaged app, dev runs and the bridge always agree.
 * `HOOT_BRIDGE_DIR` overrides it for tests and dev.
 */
export function bridgeDir(platform: Platform, env: BridgeEnv): string {
  if (env.HOOT_BRIDGE_DIR) return env.HOOT_BRIDGE_DIR
  if (platform === 'win32') return `${env.LOCALAPPDATA ?? 'C:\\'}\\Hoot\\bridge`
  if (platform === 'darwin') return `${env.HOME ?? ''}/Library/Application Support/Hoot/bridge`
  return `${env.XDG_CONFIG_HOME ?? `${env.HOME ?? ''}/.config`}/Hoot/bridge`
}

export const bridgeTokenPath = (platform: Platform, env: BridgeEnv): string =>
  `${bridgeDir(platform, env)}${platform === 'win32' ? '\\' : '/'}token`
