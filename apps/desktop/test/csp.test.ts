import { describe, expect, it } from 'vitest'
import {
  cspFor,
  installDevCsp,
  kindFromHtmlPath,
  type HeaderSession
} from '../src/main/windows/csp'

const DEV = 'http://localhost:5173'

describe('cspFor', () => {
  it('prod: self-only, restrictive defaults, no unsafe-eval', () => {
    const csp = cspFor('studio', 'prod')
    expect(csp).toContain(`default-src 'none'`)
    expect(csp).toContain(`script-src 'self'`)
    expect(csp).toContain(`style-src 'self'`)
    expect(csp).toContain(`img-src 'self' data: blob:`)
    expect(csp).toContain(`font-src 'self' data:`)
    expect(csp).toContain(`connect-src 'self'`)
    expect(csp).toContain(`base-uri 'none'`)
    expect(csp).toContain(`form-action 'none'`)
    expect(csp).toContain(`frame-ancestors 'none'`)
    expect(csp).toContain(`object-src 'none'`)
    expect(csp).not.toContain('unsafe-eval')
    expect(csp).not.toContain('unsafe-inline')
  })

  it('prod: worker-src blob only for reader', () => {
    expect(cspFor('reader', 'prod')).toContain(`worker-src 'self' blob:`)
    expect(cspFor('studio', 'prod')).toContain(`worker-src 'none'`)
    expect(cspFor('buddy', 'prod')).toContain(`worker-src 'none'`)
  })

  it('dev: allows inline styles, dev origin scripts, and ws for HMR', () => {
    const csp = cspFor('studio', 'dev', DEV)
    expect(csp).toContain(`script-src 'self' 'unsafe-inline' ${DEV}`)
    expect(csp).toContain(`style-src 'self' 'unsafe-inline'`)
    expect(csp).toContain(`connect-src 'self' ${DEV} ws://localhost:5173`)
    expect(csp).not.toContain('unsafe-eval')
  })

  it('no mode ever allows unsafe-eval', () => {
    for (const kind of ['buddy', 'studio', 'capture', 'note', 'reader', 'anywhere'] as const) {
      expect(cspFor(kind, 'prod')).not.toContain('unsafe-eval')
      expect(cspFor(kind, 'dev', DEV)).not.toContain('unsafe-eval')
    }
  })
})

describe('kindFromHtmlPath', () => {
  it('maps html basenames to window kinds', () => {
    expect(kindFromHtmlPath('/studio.html')).toBe('studio')
    expect(kindFromHtmlPath('/reader.html')).toBe('reader')
    expect(kindFromHtmlPath('/anywhere.html')).toBe('anywhere')
    expect(kindFromHtmlPath('/assets/x.js')).toBeNull()
    expect(kindFromHtmlPath('/bogus.html')).toBeNull()
  })
})

describe('installDevCsp', () => {
  class FakeSession implements HeaderSession {
    handler:
      | ((
          details: { url: string; responseHeaders?: Record<string, string[]> },
          done: (r: { responseHeaders?: Record<string, string[]> }) => void
        ) => void)
      | null = null
    webRequest = {
      onHeadersReceived: ((cb: FakeSession['handler']) => {
        this.handler = cb
      }) as unknown as Electron.WebRequest['onHeadersReceived']
    }
    apply(url: string): Record<string, string[]> {
      let out: Record<string, string[]> = {}
      this.handler?.(
        { url, responseHeaders: { 'X-Test': ['1'] } },
        (r) => (out = r.responseHeaders ?? {})
      )
      return out
    }
  }

  it('injects CSP on dev-origin html responses only', () => {
    const ses = new FakeSession()
    installDevCsp(ses, DEV)
    const html = ses.apply(`${DEV}/studio.html`)
    expect(html['Content-Security-Policy']).toHaveLength(1)
    expect(html['Content-Security-Policy']?.[0]).toContain(
      `script-src 'self' 'unsafe-inline' ${DEV}`
    )
    // Assets and foreign origins untouched.
    expect(ses.apply(`${DEV}/assets/app.js`)).not.toHaveProperty('Content-Security-Policy')
    expect(ses.apply('https://evil.example/x.html')).not.toHaveProperty('Content-Security-Policy')
  })
})
