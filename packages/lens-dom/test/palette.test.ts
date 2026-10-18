import { describe, expect, it } from 'vitest'
import { ACCENT, PALETTE, TOKENS_CSS } from '../src/ui/styles'

type Rgb = [number, number, number]

const rgb = (hex: string): Rgb => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as Rgb
const over = (fg: Rgb, a: number, bg: Rgb): Rgb => fg.map((c, i) => c * a + bg[i]! * (1 - a)) as Rgb
const luminance = (color: Rgb): number => {
  const [r, g, b] = color.map((c) => {
    const s = c / 255
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }) as Rgb
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
const contrast = (a: Rgb, b: Rgb): number => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number]
  return (hi + 0.05) / (lo + 0.05)
}

const PAGES: Record<string, Rgb> = { 'a white page': [255, 255, 255], 'a black page': [0, 0, 0] }

describe('Lens UI colours', () => {
  for (const [scheme, p] of Object.entries(PALETTE)) {
    for (const [name, page] of Object.entries(PAGES)) {
      it(`keep AA contrast in ${scheme} mode over ${name}`, () => {
        const surface = over(rgb(p.surface), p.surfaceAlpha, page)
        expect(contrast(rgb(p.text), surface)).toBeGreaterThanOrEqual(7)
        expect(contrast(over(rgb(p.text), p.text2Alpha, surface), surface)).toBeGreaterThanOrEqual(
          4.5
        )
        expect(contrast(rgb(p.accentText), surface)).toBeGreaterThanOrEqual(4.5)
      })
    }
  }

  it('keeps white text readable on accent buttons', () => {
    expect(contrast([255, 255, 255], rgb(ACCENT))).toBeGreaterThanOrEqual(4.5)
  })

  it('writes the palette into the tokens', () => {
    expect(TOKENS_CSS).toContain(`--hl-accent-text: ${PALETTE.light.accentText};`)
    expect(TOKENS_CSS).toContain(`--hl-accent-text: ${PALETTE.dark.accentText};`)
    expect(TOKENS_CSS).toContain('--hl-text-2: rgb(29 29 31 / 0.68);')
  })
})
