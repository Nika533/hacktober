import { bridgeDir, type BridgeEnv } from '../protocol/constants'
import type { Platform } from '../types/app'

/** Bumped on any breaking change to the code link messages. */
export const CODE_LINK_PROTOCOL_VERSION = 1

/** Size limits on what crosses the code link (and what goes to the model). */
export const CODE_LIMITS = {
  /** The focused file's text: whole when it fits, else a window around the user's view. */
  fileChars: 40_000,
  fileLines: 1200,
  /** Each other visible editor (split view). */
  otherChars: 6_000,
  others: 2,
  selectionChars: 2_000,
  diagnostics: 40,
  diagnosticChars: 300,
  /** Marks and edits in one `code.show`. */
  tags: 20,
  labelChars: 200,
  replacementChars: 50_000,
  pathChars: 1024,
  uriChars: 2048
} as const

/**
 * Where the app listens for the VS Code extension's code link: a named pipe
 * on Windows, a unix socket elsewhere. Scoped per OS user, like the Lens
 * bridge, but its own pipe and token: it carries code and can edit files.
 */
export function codeLinkPipePath(platform: Platform, user: string, tmpDir: string): string {
  const safeUser = user.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 64) || 'user'
  if (platform === 'win32') return `\\\\.\\pipe\\hoot-code-${safeUser}`
  const path = `${tmpDir.replace(/\/+$/, '')}/hoot-code-${safeUser}.sock`
  // Unix socket paths are limited to ~104 bytes (macOS); fall back to /tmp.
  return path.length <= 100 ? path : `/tmp/hoot-code-${safeUser}.sock`
}

/** The per-launch code link token, next to the bridge token. */
export const codeLinkTokenPath = (platform: Platform, env: BridgeEnv): string =>
  `${bridgeDir(platform, env)}${platform === 'win32' ? '\\' : '/'}code-token`
