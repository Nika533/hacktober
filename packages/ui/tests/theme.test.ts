import { describe, expect, it } from 'vitest'
import {
  applyAccent,
  applyTheme,
  contrastRatio,
  onAccentFor,
  parseHexColor,
  toHex
} from '../src/theme'

describe('parseHexColor', () => {
  it('reads #RGB, #RRGGBB and Electron-style RRGGBBAA', () => {
    expect(parseHexColor('#fff')).toEqual({ r: 255, g: 255, b: 255 })
    expect(parseHexColor('#0078d4')).toEqual({ r: 0, g: 120, b: 212 })
    expect(parseHexColor('0078d4ff')).toEqual({ r: 0, g: 120, b: 212 })
    expect(parseHexColor('  #CA5010 ')).toEqual({ r: 202, g: 80, b: 16 })
  })

  it('rejects anything else', () => {
    for (const bad of ['', '#12', '#12345', 'red', 'rgb(0,0,0)', '#gggggg', '#1234567']) {
      expect(parseHexColor(bad)).toBeNull()
    }
  })

  it('round-trips through toHex', () => {
    const rgb = parseHexColor('#9a0089')
    expect(rgb && toHex(rgb)).toBe('#9a0089')
  })
})

describe('contrast', () => {
  it('matches the WCAG extremes', () => {
    const white = { r: 255, g: 255, b: 255 }
    const black = { r: 0, g: 0, b: 0 }
    expect(contrastRatio(white, black)).toBeCloseTo(21, 5)
    expect(contrastRatio(black, white)).toBeCloseTo(21, 5)
    expect(contrastRatio(white, white)).toBe(1)
  })

  it('picks white on dark accents and black on light ones', () => {
    const on = (hex: string): string => onAccentFor(parseHexColor(hex)!)
    expect(on('#0078d4')).toBe('#ffffff') // Windows default blue
    expect(on('#2f6bd8')).toBe('#ffffff') // token default
    expect(on('#9a0089')).toBe('#ffffff')
    expect(on('#ffb900')).toBe('#000000') // Windows gold
    expect(on('#00b7c3')).toBe('#000000') // Windows teal
  })
})

describe('applyTheme / applyAccent', () => {
  it('forces a scheme or hands it back to the OS', () => {
    const root = document.documentElement
    applyTheme('dark', root)
    expect(root.dataset.theme).toBe('dark')
    applyTheme('light', root)
    expect(root.dataset.theme).toBe('light')
    applyTheme('system', root)
    expect(root.dataset.theme).toBeUndefined()
  })

  it('sets the accent and a readable on-accent, and resets on bad input', () => {
    const root = document.documentElement
    applyAccent('ffb900ff', root)
    expect(root.style.getPropertyValue('--accent')).toBe('#ffb900')
    expect(root.style.getPropertyValue('--on-accent')).toBe('#000000')
    applyAccent('not a colour', root)
    expect(root.style.getPropertyValue('--accent')).toBe('')
    applyAccent('#0078d4', root)
    applyAccent(null, root)
    expect(root.style.getPropertyValue('--on-accent')).toBe('')
  })
})
