import { describe, expect, it } from 'vitest'
import { isAllowedExternal } from '../src/main/ipc/app'

describe('isAllowedExternal', () => {
  it('allows any http(s) URL (links in model answers open through here)', () => {
    expect(isAllowedExternal('https://aistudio.google.com/keys')).toBe(true)
    expect(isAllowedExternal('https://github.com/Nika533/hacktober')).toBe(true)
    expect(isAllowedExternal('https://en.wikipedia.org/wiki/Owl')).toBe(true)
    expect(isAllowedExternal('http://example.com/plain')).toBe(true)
    expect(isAllowedExternal('https://sub.domain.example.org/a?b=c#d')).toBe(true)
  })

  it('rejects credentials embedded in the URL', () => {
    expect(isAllowedExternal('https://user:pass@example.com/')).toBe(false)
    expect(isAllowedExternal('https://user@example.com/')).toBe(false)
  })

  it('rejects non-URL input and other schemes', () => {
    expect(isAllowedExternal('not a url')).toBe(false)
    expect(isAllowedExternal('file:///C:/x')).toBe(false)
    expect(isAllowedExternal('javascript:alert(1)')).toBe(false)
    expect(isAllowedExternal('hoot://app/studio.html')).toBe(false)
    expect(isAllowedExternal('mailto:a@b.c')).toBe(false)
    expect(isAllowedExternal('ftp://example.com/f')).toBe(false)
  })
})
