import { protocol } from 'electron'
import { promises as fs } from 'node:fs'
import { extname, join, normalize, sep } from 'node:path'
import type { WindowKind } from '@hoot/core'
import { kindFromHtmlPath } from './csp'

/** `hoot://app/<path>` serves the packaged renderer build. */
export const HOOT_ORIGIN = 'hoot://app'

/**
 * Privileged scheme registration — must run before `app.whenReady()`.
 */
export function registerHootScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: 'hoot',
      privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: false }
    }
  ])
}

// ---- pure part (tested without Electron) ----

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.json': 'application/json',
  '.wasm': 'application/wasm',
  '.map': 'application/json'
}

export function contentTypeFor(path: string): string {
  return CONTENT_TYPES[extname(path).toLowerCase()] ?? 'application/octet-stream'
}

/**
 * Resolve `hoot://app/<rel>` to a filesystem path under `rendererDir`.
 * Returns null for a wrong origin/host, a traversal escape, or a non-file.
 */
export function resolveHootUrl(url: string, rendererDir: string): string | null {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  if (parsed.protocol !== 'hoot:' || parsed.host !== 'app') return null
  const rel = decodeURIComponent(parsed.pathname).replace(/^\/+/, '')
  const resolved = normalize(join(rendererDir, rel))
  const root = normalize(rendererDir)
  if (resolved !== root && !resolved.startsWith(root + sep)) return null
  return resolved
}

// ---- Electron part ----

export function installHootProtocol(rendererDir: string, csp: (kind: WindowKind) => string): void {
  protocol.handle('hoot', async (req) => {
    const path = resolveHootUrl(req.url, rendererDir)
    if (path === null) {
      return new Response('forbidden', { status: 403 })
    }
    let body: Buffer
    try {
      body = await fs.readFile(path)
    } catch {
      return new Response('not found', { status: 404 })
    }
    const headers = new Headers({
      'Content-Type': contentTypeFor(path),
      'Cache-Control': 'no-cache'
    })
    const kind = kindFromHtmlPath(new URL(req.url).pathname)
    if (kind !== null) headers.set('Content-Security-Policy', csp(kind))
    return new Response(new Uint8Array(body), { headers })
  })
}
