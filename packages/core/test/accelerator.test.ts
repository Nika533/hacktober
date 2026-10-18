import { describe, expect, it } from 'vitest'
import { toAccelerator, type KeyEventLike } from '../src/util/accelerator'

const ev = (
  key: string,
  mods: Partial<Record<'ctrl' | 'alt' | 'shift' | 'meta', boolean>> = {}
): KeyEventLike => ({
  key,
  ctrlKey: !!mods.ctrl,
  altKey: !!mods.alt,
  shiftKey: !!mods.shift,
  metaKey: !!mods.meta
})

describe('toAccelerator', () => {
  it('Ctrl+Shift+Space → CommandOrControl+Shift+Space', () => {
    expect(toAccelerator(ev(' ', { ctrl: true, shift: true }))).toBe('CommandOrControl+Shift+Space')
  })

  it('Ctrl+Alt+Space → CommandOrControl+Alt+Space', () => {
    expect(toAccelerator(ev(' ', { ctrl: true, alt: true }))).toBe('CommandOrControl+Alt+Space')
  })

  it('letters upper-case, modifier order is Cmd/Alt/Shift', () => {
    expect(toAccelerator(ev('k', { ctrl: true, shift: true, alt: true }))).toBe(
      'CommandOrControl+Alt+Shift+K'
    )
  })

  it('meta counts as CommandOrControl too', () => {
    expect(toAccelerator(ev('l', { meta: true }))).toBe('CommandOrControl+L')
  })

  it('special keys map to Electron names', () => {
    expect(toAccelerator(ev('ArrowUp', { ctrl: true }))).toBe('CommandOrControl+Up')
    expect(toAccelerator(ev('Enter', { ctrl: true }))).toBe('CommandOrControl+Enter')
    expect(toAccelerator(ev('Escape', { ctrl: true }))).toBe('CommandOrControl+Esc')
  })

  it('rejects modifier-only and modifierless keys', () => {
    expect(toAccelerator(ev('Control', { ctrl: true }))).toBeNull()
    expect(toAccelerator(ev('Shift', { shift: true }))).toBeNull()
    expect(toAccelerator(ev('k'))).toBeNull()
    expect(toAccelerator(ev(' '))).toBeNull()
    expect(toAccelerator(ev('k', { shift: true }))).toBeNull() // shift alone isn't enough
  })
})
