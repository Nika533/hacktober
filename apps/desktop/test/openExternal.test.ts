import { describe, expect, it } from 'vitest'
import { isAllowedExternal } from '../src/main/ipc/app'

describe('isAllowedExternal', () => {
  it('allows exact allowed hosts over https', () => {
    expect(isAllowedExternal('https://aistudio.google.com/keys')).toBe(true)
    expect(isAllowedExternal('https://ai.google.dev/gemini')).toBe(true)
    expect(isAllowedExternal('https://support.google.com/x')).toBe(true)
    expect(isAllowedExternal('https://github.com/Nika533/hacktober')).toBe(true)
  })

  it('allows subdomains of allowed hosts', () => {
    expect(isAllowedExternal('https://docs.github.com/en')).toBe(true)
    expect(isAllowedExternal('https://www.support.google.com/x')).toBe(true)
  })

  it('rejects http', () => {
    expect(isAllowedExternal('http://github.com')).toBe(false)
    expect(isAllowedExternal('http://aistudio.google.com')).toBe(false)
  })

  it('rejects lookalike and unrelated hosts', () => {
    expect(isAllowedExternal('https://github.com.evil.io')).toBe(false)
    expect(isAllowedExternal('https://notgithub.com')).toBe(false)
    expect(isAllowedExternal('https://google.com')).toBe(false)
    expect(isAllowedExternal('https://evil-github.com')).toBe(false)
  })

  it('rejects non-URL input and other schemes', () => {
    expect(isAllowedExternal('not a url')).toBe(false)
    expect(isAllowedExternal('file:///C:/x')).toBe(false)
    expect(isAllowedExternal('javascript:alert(1)')).toBe(false)
    expect(isAllowedExternal('hoot://app/studio.html')).toBe(false)
  })
})
