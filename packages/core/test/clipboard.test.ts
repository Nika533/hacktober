import { describe, expect, it } from 'vitest'
import {
  decideHint,
  imageFingerprint,
  textFingerprint,
  type ClipboardProbe
} from '../src/util/clipboard'

const textProbe = (t: string): ClipboardProbe | null => {
  const fp = textFingerprint(t)
  return fp ? { fp, hint: { kind: 'text', chars: t.length } } : null
}
const imgProbe = (w: number, h: number, fill: number): ClipboardProbe | null => {
  const fp = imageFingerprint(w, h, new Uint8Array(w * h * 4).fill(fill))
  return fp ? { fp, hint: { kind: 'image' } } : null
}

describe('clipboard fingerprints', () => {
  it('text: null on empty/blank, stable + distinct hashes', () => {
    expect(textFingerprint('')).toBeNull()
    expect(textFingerprint('   ')).toBeNull()
    const a = textFingerprint('hello')!
    const b = textFingerprint('hello')!
    const c = textFingerprint('world')!
    expect(a.hash).toBe(b.hash)
    expect(a.hash).not.toBe(c.hash)
    expect(a.kind).toBe('text')
  })

  it('image: null on degenerate input; size+bitmap feed the hash', () => {
    expect(imageFingerprint(0, 10, new Uint8Array(4))).toBeNull()
    expect(imageFingerprint(10, 10, new Uint8Array(0))).toBeNull()
    const a = imgProbe(8, 8, 7)!.fp
    const b = imgProbe(8, 8, 7)!.fp
    const c = imgProbe(8, 8, 9)!.fp
    const d = imgProbe(16, 16, 7)!.fp
    expect(a.hash).toBe(b.hash)
    expect(a.hash).not.toBe(c.hash)
    expect(a.hash).not.toBe(d.hash)
    expect(a.kind).toBe('image')
  })
})

describe('decideHint', () => {
  it('shows only when the fingerprint changed since the last check', () => {
    const p = textProbe('copied me')!
    // boot-time content: same fingerprint → no hint
    expect(decideHint(p.fp, p, true)).toBe(false)
    // changed content → hint
    expect(decideHint(p.fp, textProbe('something else'), true)).toBe(true)
    // no prior fingerprint (e.g. boot with empty clipboard) → hint
    expect(decideHint(null, p, true)).toBe(true)
  })

  it('empty clipboard never hints; setting off never hints', () => {
    expect(decideHint(null, null, true)).toBe(false)
    expect(decideHint(null, textProbe('x'), false)).toBe(false)
    expect(decideHint(textProbe('x')!.fp, imgProbe(4, 4, 1), false)).toBe(false)
  })

  it('re-summon with the same content does not re-hint', () => {
    const p = textProbe('hello again')!
    expect(decideHint(null, p, true)).toBe(true) // first summon shows it
    expect(decideHint(p.fp, p, true)).toBe(false) // same clipboard → quiet
  })
})
