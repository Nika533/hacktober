import { describe, expect, it } from 'vitest'
import { join, resolve } from 'node:path'
import { contentTypeFor, resolveHootUrl } from '../src/main/windows/protocol'

const ROOT = resolve('C:\\hoot\\renderer')

describe('resolveHootUrl', () => {
  it('maps hoot://app/<path> into rendererDir', () => {
    expect(resolveHootUrl('hoot://app/studio.html', ROOT)).toBe(join(ROOT, 'studio.html'))
    expect(resolveHootUrl('hoot://app/assets/app.js', ROOT)).toBe(join(ROOT, 'assets/app.js'))
  })

  it('rejects traversal escapes', () => {
    // WHATWG URL parsing collapses ".." (including %2e forms) before join(),
    // so these resolve inside the root — safe, they just 404 if absent.
    expect(resolveHootUrl('hoot://app/../secret.txt', ROOT)).toBe(join(ROOT, 'secret.txt'))
    expect(resolveHootUrl('hoot://app/%2e%2e/%2e%2e/etc/passwd', ROOT)).toBe(
      join(ROOT, 'etc/passwd')
    )
    // An encoded slash slips ".." past URL normalization; the normalized-path
    // check must catch the escape.
    expect(resolveHootUrl('hoot://app/x%2f..%2f..%2fevil.js', ROOT)).toBeNull()
  })

  it('rejects the wrong scheme or host', () => {
    expect(resolveHootUrl('https://app/studio.html', ROOT)).toBeNull()
    expect(resolveHootUrl('hoot://evil/studio.html', ROOT)).toBeNull()
    expect(resolveHootUrl('file:///C:/x.html', ROOT)).toBeNull()
  })
})

describe('contentTypeFor', () => {
  it('maps known extensions', () => {
    expect(contentTypeFor('a.html')).toContain('text/html')
    expect(contentTypeFor('a.js')).toContain('text/javascript')
    expect(contentTypeFor('a.css')).toContain('text/css')
    expect(contentTypeFor('a.svg')).toBe('image/svg+xml')
    expect(contentTypeFor('a.png')).toBe('image/png')
    expect(contentTypeFor('a.woff2')).toBe('font/woff2')
    expect(contentTypeFor('a.wasm')).toBe('application/wasm')
    expect(contentTypeFor('a.map')).toBe('application/json')
  })

  it('falls back to octet-stream', () => {
    expect(contentTypeFor('a.xyz')).toBe('application/octet-stream')
  })
})
