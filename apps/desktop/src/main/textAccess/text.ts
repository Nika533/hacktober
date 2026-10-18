import type { Rect } from '@hoot/core'
import { TEXT_IN_RECT_MAX } from './types'

/** A piece of text the helper found in a rect, at its top-left (physical px). */
export interface RectItem {
  text: string
  x: number
  y: number
}

/** Items whose tops are this close (px) read as one row. */
const ROW_PX = 8

/** Line endings normalized; Chromium's embedded-object marks and icon-font glyphs dropped. */
export const cleanText = (s: string, max = Infinity): string =>
  s
    .replace(/\r\n?/g, '\n')
    .replace(/[\uFFFC\uE000-\uF8FF]/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, max)
    .trim()

/** Reading order: rows top to bottom, left to right inside a row; exact repeats dropped. */
export function joinItems(items: readonly RectItem[], max = TEXT_IN_RECT_MAX): string {
  const seen = new Set<string>()
  const unique = items
    .map((it) => ({ ...it, text: cleanText(it.text) }))
    .filter((it) => it.text !== '' && !seen.has(it.text) && seen.add(it.text))
    .sort((a, b) => a.y - b.y)
  const rows: RectItem[][] = []
  for (const it of unique) {
    const row = rows.at(-1)
    if (row && it.y - row[0]!.y < ROW_PX) row.push(it)
    else rows.push([it])
  }
  return cleanText(
    rows
      .map((row) =>
        row
          .sort((a, b) => a.x - b.x)
          .map((it) => it.text)
          .join(' ')
      )
      .join('\n'),
    max
  )
}

/** A whole-pixel rect covering `{x, y, w, h}` (UI Automation returns fractions). */
export function pixelRect(r: { x: number; y: number; w: number; h: number }): Rect {
  const x = Math.floor(r.x)
  const y = Math.floor(r.y)
  return { x, y, width: Math.ceil(r.x + r.w) - x, height: Math.ceil(r.y + r.h) - y }
}
