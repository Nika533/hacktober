import type { Point, Rect } from '@hoot/core'

/**
 * On-screen guidance the model asks for with tags in its answer (the chat
 * system prompt): normalized 0–1000 coordinates of the full-screen frame,
 * 0,0 top-left and 1000,1000 bottom-right.
 */
export type Annotation =
  | { kind: 'point'; x: number; y: number; label: string }
  | { kind: 'box'; x1: number; y1: number; x2: number; y2: number; label: string }
  | { kind: 'action'; x: number; y: number; label: string }

/** At most this many marks on screen at once, whatever the model sends. */
export const MAX_ANNOTATIONS = 8

/** A tag, with the backticks the model sometimes wraps it in. */
const TAG = /`?\[\[\s*(point|box|action)\s*:\s*([^\]]*?)\s*\]\]`?/gi
/** A tag still arriving at the end of a streaming answer (last line only). */
const PARTIAL_TAG = /`?\[\[[^\]\n]*\]?$/
const NUMBER = /-?\d+(?:\.\d+)?/g
/** From the first quote to the closing one at the very end: "Don't save" keeps its apostrophe. */
const QUOTED = /["“”'‘’](.*)["“”'‘’]\s*$/

const clamp = (n: number): number => Math.min(1000, Math.max(0, n))

function parseArgs(raw: string): { numbers: number[]; label: string } {
  const quoted = QUOTED.exec(raw)
  const head = quoted ? raw.slice(0, quoted.index) : raw
  const numbers = (head.match(NUMBER) ?? []).map(Number).filter(Number.isFinite)
  const label = (quoted?.[1] ?? head.replace(NUMBER, '').replace(/[,\s]+/g, ' ')).trim()
  return { numbers, label: label.slice(0, 60) }
}

/** The tags in an answer, and the answer with them taken out (for display). */
export function parseAnnotations(
  text: string,
  streaming = false
): { text: string; annotations: Annotation[] } {
  const annotations: Annotation[] = []
  const take = (_match: string, kind: string, args: string): string => {
    const { numbers, label } = parseArgs(args)
    const k = kind.toLowerCase()
    if (annotations.length >= MAX_ANNOTATIONS) return ''
    if (k === 'box' && numbers.length >= 4) {
      const [a, b, c, d] = numbers.map(clamp) as [number, number, number, number]
      annotations.push({
        kind: 'box',
        x1: Math.min(a, c),
        y1: Math.min(b, d),
        x2: Math.max(a, c),
        y2: Math.max(b, d),
        label
      })
    } else if ((k === 'point' || k === 'action') && numbers.length >= 2) {
      const [x, y] = numbers.map(clamp) as [number, number]
      annotations.push({ kind: k, x, y, label })
    }
    return ''
  }
  const lines: string[] = []
  const source = streaming ? text.replace(PARTIAL_TAG, '') : text
  for (const line of source.split('\n')) {
    const out = line.replace(TAG, take)
    // A line that held only tags goes away; real blank lines (paragraphs) stay.
    if (out !== line && out.trim() === '') continue
    lines.push(out)
  }
  return {
    text: lines
      .join('\n')
      // A code fence left empty by a tag taken out of it.
      .replace(/^```[\w-]*\n(?:[ \t]*\n)*```[ \t]*$/gm, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim(),
    annotations
  }
}

/** Normalized 0–1000 → overlay DIP (the overlay covers the display 1:1). */
export function toScreen(
  p: { x: number; y: number },
  size: { width: number; height: number }
): Point {
  return { x: (p.x * size.width) / 1000, y: (p.y * size.height) / 1000 }
}

const overlaps = (a: Rect, b: Rect): boolean =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height

/**
 * Where the chat box goes: beside the shape (right, left, below, above, in
 * that order), clamped to the screen and never covering the shape when there
 * is room anywhere; otherwise the corner farthest from it.
 */
export function chatPlacement(
  shape: Rect,
  view: { width: number; height: number },
  box: { width: number; height: number },
  gap = 16,
  margin = 16
): Point {
  const clampX = (x: number): number =>
    Math.min(Math.max(margin, x), Math.max(margin, view.width - box.width - margin))
  const clampY = (y: number): number =>
    Math.min(Math.max(margin, y), Math.max(margin, view.height - box.height - margin))
  const candidates: Point[] = [
    { x: shape.x + shape.width + gap, y: clampY(shape.y) },
    { x: shape.x - gap - box.width, y: clampY(shape.y) },
    { x: clampX(shape.x), y: shape.y + shape.height + gap },
    { x: clampX(shape.x), y: shape.y - gap - box.height }
  ]
  for (const c of candidates) {
    const fits =
      c.x >= margin &&
      c.y >= margin &&
      c.x + box.width <= view.width - margin &&
      c.y + box.height <= view.height - margin
    if (fits && !overlaps({ ...c, ...box }, shape)) return c
  }
  // No side has room (a huge shape): the corner farthest from its centre.
  const cx = shape.x + shape.width / 2
  const cy = shape.y + shape.height / 2
  return {
    x: cx < view.width / 2 ? clampX(view.width) : margin,
    y: cy < view.height / 2 ? clampY(view.height) : margin
  }
}
