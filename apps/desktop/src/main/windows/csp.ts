import { DEFAULT_SUBSCRIPTIONS, type WindowKind } from '@hoot/core'

/**
 * CSP is delivered as a response header, never a meta tag (D1-00). prod is
 * served from `hoot://app`, dev from the Vite origin (needs inline styles for
 * injected <style> tags and a websocket for HMR). Never `unsafe-eval`.
 */
export function cspFor(kind: WindowKind, mode: 'dev' | 'prod', devOrigin?: string): string {
  // Dev needs 'unsafe-inline' scripts: @vitejs/plugin-react injects an inline
  // preamble <script> that has no hash/nonce seam. Prod stays strict.
  const script =
    mode === 'dev' ? `script-src 'self' 'unsafe-inline' ${devOrigin}` : `script-src 'self'`
  const style = mode === 'dev' ? `style-src 'self' 'unsafe-inline'` : `style-src 'self'`
  const connect =
    mode === 'dev' && devOrigin
      ? `connect-src 'self' ${devOrigin} ${devOrigin.replace(/^http/, 'ws')}`
      : `connect-src 'self'`
  const worker = kind === 'reader' ? `worker-src 'self' blob:` : `worker-src 'none'`
  return [
    `default-src 'none'`,
    script,
    style,
    `img-src 'self' data: blob:`,
    `font-src 'self' data:`,
    connect,
    worker,
    `base-uri 'none'`,
    `form-action 'none'`,
    `frame-ancestors 'none'`,
    `object-src 'none'`
  ].join('; ')
}

/** Minimal `session` surface so tests can substitute a fake. */
export interface HeaderSession {
  webRequest: Pick<Electron.WebRequest, 'onHeadersReceived'>
}

/** Every window kind has a subscription entry, so this list never drifts. */
const WINDOW_KINDS: readonly string[] = Object.keys(DEFAULT_SUBSCRIPTIONS)

/** The window kind an html response belongs to (`studio.html` → 'studio'). */
export function kindFromHtmlPath(pathname: string): WindowKind | null {
  const base = pathname.split('/').pop() ?? ''
  const kind = base.endsWith('.html') ? base.slice(0, -'.html'.length) : null
  return kind !== null && WINDOW_KINDS.includes(kind) ? (kind as WindowKind) : null
}

/** Inject the dev CSP into the Vite server's html responses only. */
export function installDevCsp(ses: HeaderSession, devOrigin: string): void {
  ses.webRequest.onHeadersReceived((details, done) => {
    const url = details.url
    let kind: WindowKind | null = null
    if (url.startsWith(devOrigin)) {
      try {
        kind = kindFromHtmlPath(new URL(url).pathname)
      } catch {
        kind = null
      }
    }
    const responseHeaders =
      kind === null
        ? details.responseHeaders
        : {
            ...details.responseHeaders,
            'Content-Security-Policy': [cspFor(kind, 'dev', devOrigin)]
          }
    done({ responseHeaders })
  })
}
