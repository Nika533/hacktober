export type ThemePreference = 'system' | 'light' | 'dark'

export interface Rgb {
  r: number
  g: number
  b: number
}

/** Forces the colour scheme, or hands it back to the OS with 'system'. */
export function applyTheme(
  pref: ThemePreference,
  root: HTMLElement = document.documentElement
): void {
  if (pref === 'system') delete root.dataset.theme
  else root.dataset.theme = pref
}

/**
 * Parses '#RGB', '#RRGGBB' or '#RRGGBBAA' (the '#' is optional, because
 * Electron's systemPreferences.getAccentColor() returns 'RRGGBBAA').
 * Alpha is ignored. Returns null for anything else.
 */
export function parseHexColor(input: string): Rgb | null {
  const hex = input.trim().replace(/^#/, '')
  if (!/^(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(hex)) return null
  const full =
    hex.length === 3
      ? hex
          .split('')
          .map((c) => c + c)
          .join('')
      : hex.slice(0, 6)
  return {
    r: parseInt(full.slice(0, 2), 16),
    g: parseInt(full.slice(2, 4), 16),
    b: parseInt(full.slice(4, 6), 16)
  }
}

export function toHex({ r, g, b }: Rgb): string {
  return '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')
}

/** WCAG 2 relative luminance. */
export function relativeLuminance({ r, g, b }: Rgb): number {
  const lin = (v: number): number => {
    const c = v / 255
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}

export function contrastRatio(a: Rgb, b: Rgb): number {
  const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x) as [
    number,
    number
  ]
  return (hi + 0.05) / (lo + 0.05)
}

const WHITE: Rgb = { r: 255, g: 255, b: 255 }
const BLACK: Rgb = { r: 0, g: 0, b: 0 }

/** Text colour for content on an accent fill: white when it passes AA, else the stronger one. */
export function onAccentFor(accent: Rgb): '#ffffff' | '#000000' {
  const white = contrastRatio(accent, WHITE)
  if (white >= 4.5) return '#ffffff'
  return white >= contrastRatio(accent, BLACK) ? '#ffffff' : '#000000'
}

/**
 * Sets --accent (and a readable --on-accent) from the OS accent colour.
 * Passing null, or a value that doesn't parse, restores the token default.
 */
export function applyAccent(
  accent: string | null,
  root: HTMLElement = document.documentElement
): void {
  const rgb = accent === null ? null : parseHexColor(accent)
  if (!rgb) {
    root.style.removeProperty('--accent')
    root.style.removeProperty('--on-accent')
    return
  }
  root.style.setProperty('--accent', toHex(rgb))
  root.style.setProperty('--on-accent', onAccentFor(rgb))
}
