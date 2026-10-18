import type { Point, Rect } from '@hoot/core'
import type { Shape } from './shape'

/** The live overlay's palette: light blue glow, white core. */
export const GLOW = '#38bdf8'
export const GLOW_SOFT = '#5cc8ff'
const CORE = '#ffffff'
const PILL_BG = 'rgba(8, 47, 73, 0.88)'
const PILL_TEXT = '#e0f2fe'
const HIGHLIGHT_FILL = 'rgba(56, 189, 248, 0.10)'
/** A deeper blue edge around the white core, so a hairline still reads over a white page. */
const EDGE_INK = '#0284c7'

/** The hollow target ring around a spot (DIP). */
const RING_R = 14
/** Breathing room between a control and its highlight box (DIP). */
const BOX_PAD = 4
/** The gap an arrow leaves before what it points at (DIP). */
const ARROW_GAP = 6
const PULSE_MS = 1400

/** A mark on screen, already in overlay DIP. `rect`: the control's highlight box. */
export type ScreenMark =
  | { kind: 'point'; at: Point; label: string; rect?: Rect }
  | { kind: 'box'; rect: Rect; label: string }
  | {
      kind: 'action'
      at: Point
      label: string
      state: 'pending' | 'clicking' | 'done'
      rect?: Rect
    }

export interface PaintOptions {
  /** ms clock for the pulse; ignored when `still` */
  t: number
  /** prefers-reduced-motion: no pulse, steady rings */
  still: boolean
}

/** Smooth freehand path: quadratic curves through the midpoints, left open. */
function tracePath(ctx: CanvasRenderingContext2D, points: readonly Point[]): void {
  ctx.beginPath()
  const [first, ...rest] = points
  if (!first) return
  ctx.moveTo(first.x, first.y)
  if (rest.length === 0) {
    ctx.lineTo(first.x + 0.01, first.y)
    return
  }
  for (let i = 0; i < rest.length - 1; i++) {
    const p = rest[i]!
    const next = rest[i + 1]!
    ctx.quadraticCurveTo(p.x, p.y, (p.x + next.x) / 2, (p.y + next.y) / 2)
  }
  const last = rest[rest.length - 1]!
  ctx.lineTo(last.x, last.y)
  // Never closePath(): it would draw a chord from the cursor back to the start.
}

function traceShape(ctx: CanvasRenderingContext2D, shape: Shape): void {
  if (shape.kind === 'rect') {
    const { x, y, width, height } = shape.rect
    ctx.beginPath()
    ctx.roundRect(x, y, width, height, Math.min(12, width / 2, height / 2))
    return
  }
  tracePath(ctx, shape.points)
}

/** A glowing light-blue stroke with a crisp white core (the user's shape). */
function glowStroke(ctx: CanvasRenderingContext2D, trace: () => void, width = 3): void {
  ctx.save()
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.strokeStyle = GLOW
  ctx.shadowColor = GLOW
  ctx.shadowBlur = 18
  ctx.lineWidth = width * 2.2
  trace()
  ctx.stroke()
  ctx.restore()
  ctx.save()
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.strokeStyle = CORE
  ctx.lineWidth = Math.max(1.5, width * 0.7)
  trace()
  ctx.stroke()
  ctx.restore()
}

/**
 * Hoot's marks: a hairline white core with a thin blue edge in a soft halo,
 * so they never hide what they point at and read over light and dark screens.
 */
function fineStroke(ctx: CanvasRenderingContext2D, trace: () => void, core = 1.5): void {
  const pass = (style: string, width: number, alpha: number, blur: number): void => {
    ctx.save()
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.globalAlpha = alpha
    ctx.strokeStyle = style
    ctx.shadowColor = blur > 0 ? GLOW : 'transparent'
    ctx.shadowBlur = blur
    ctx.lineWidth = width
    trace()
    ctx.stroke()
    ctx.restore()
  }
  pass(GLOW, core + 5, 0.4, 12)
  pass(EDGE_INK, core + 1.5, 0.95, 0)
  pass(CORE, core, 1, 0)
}

function pill(ctx: CanvasRenderingContext2D, text: string, at: Point, size: Rect): void {
  if (!text) return
  ctx.save()
  ctx.font = '600 13px "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif'
  const w = Math.ceil(ctx.measureText(text).width) + 20
  const h = 26
  const x = Math.min(Math.max(8, at.x - w / 2), size.width - w - 8)
  const y = Math.min(Math.max(8, at.y - h / 2), size.height - h - 8)
  ctx.shadowColor = GLOW
  ctx.shadowBlur = 14
  ctx.fillStyle = PILL_BG
  ctx.beginPath()
  ctx.roundRect(x, y, w, h, h / 2)
  ctx.fill()
  ctx.shadowBlur = 0
  ctx.strokeStyle = GLOW_SOFT
  ctx.lineWidth = 1
  ctx.stroke()
  ctx.fillStyle = PILL_TEXT
  ctx.textBaseline = 'middle'
  ctx.fillText(text, x + 10, y + h / 2 + 0.5)
  ctx.restore()
}

const inflate = (r: Rect, by: number): Rect => ({
  x: r.x - by,
  y: r.y - by,
  width: r.width + 2 * by,
  height: r.height + 2 * by
})

/**
 * Where the arrow to a target starts: out from it towards the middle of the
 * screen (so it stays on screen), clear of a highlight box.
 */
function arrowTail(at: Point, size: Rect, rect?: Rect): Point {
  const dx = at.x < size.width / 2 ? 1 : -1
  const dy = at.y < size.height / 2 ? 1 : -1
  const reachX = (rect ? rect.width / 2 : 0) + 88
  const reachY = (rect ? rect.height / 2 : 0) + 64
  return {
    x: Math.min(Math.max(24, at.x + dx * reachX), size.width - 24),
    y: Math.min(Math.max(24, at.y + dy * reachY), size.height - 24)
  }
}

/** Where the arrow from `tail` should stop: just outside the ring or the highlight box. */
function arrowTip(tail: Point, at: Point, rect?: Rect): Point {
  const ux = tail.x - at.x
  const uy = tail.y - at.y
  const len = Math.hypot(ux, uy) || 1
  if (!rect) {
    const off = RING_R + ARROW_GAP
    return { x: at.x + (ux / len) * off, y: at.y + (uy / len) * off }
  }
  // Leave the box along the line to the tail, then step out by the gap.
  const s = Math.min(
    rect.width / 2 / Math.max(Math.abs(ux), 1e-6),
    rect.height / 2 / Math.max(Math.abs(uy), 1e-6)
  )
  const edge = { x: at.x + ux * Math.min(1, s), y: at.y + uy * Math.min(1, s) }
  return { x: edge.x + (ux / len) * ARROW_GAP, y: edge.y + (uy / len) * ARROW_GAP }
}

/** A slim arrow on a gentle arc, with a small solid head. */
function arrow(ctx: CanvasRenderingContext2D, from: Point, to: Point): void {
  const len = Math.hypot(to.x - from.x, to.y - from.y)
  if (len < 12) return
  // Bend to one side by a fraction of the length: a hand-drawn arc, not a ruler line.
  const nx = -(to.y - from.y) / len
  const ny = (to.x - from.x) / len
  const bend = Math.min(28, len * 0.16)
  const ctrl = {
    x: (from.x + to.x) / 2 + nx * bend,
    y: (from.y + to.y) / 2 + ny * bend
  }
  const angle = Math.atan2(to.y - ctrl.y, to.x - ctrl.x)
  const head = 12
  const spread = 0.45
  // The line ends inside the head, so the tip stays sharp.
  const base = { x: to.x - Math.cos(angle) * head * 0.7, y: to.y - Math.sin(angle) * head * 0.7 }
  fineStroke(
    ctx,
    () => {
      ctx.beginPath()
      ctx.moveTo(from.x, from.y)
      ctx.quadraticCurveTo(ctrl.x, ctrl.y, base.x, base.y)
    },
    1.75
  )
  ctx.save()
  ctx.fillStyle = CORE
  ctx.shadowColor = GLOW
  ctx.shadowBlur = 10
  ctx.beginPath()
  ctx.moveTo(to.x, to.y)
  ctx.lineTo(to.x - Math.cos(angle - spread) * head, to.y - Math.sin(angle - spread) * head)
  ctx.lineTo(to.x - Math.cos(angle) * head * 0.62, to.y - Math.sin(angle) * head * 0.62)
  ctx.lineTo(to.x - Math.cos(angle + spread) * head, to.y - Math.sin(angle + spread) * head)
  ctx.closePath()
  ctx.fill()
  ctx.shadowBlur = 0
  ctx.strokeStyle = EDGE_INK
  ctx.lineWidth = 1
  ctx.lineJoin = 'round'
  ctx.stroke()
  ctx.restore()
}

/** 0→1 over each pulse; a steady midpoint when still. */
const pulsePhase = (o: PaintOptions): number => (o.still ? 0.5 : (o.t % PULSE_MS) / PULSE_MS)

/** A thin, hollow target ring, with a fainter ring breathing out of it. */
function ring(ctx: CanvasRenderingContext2D, at: Point, o: PaintOptions, pulse: boolean): void {
  if (pulse && !o.still) {
    const phase = pulsePhase(o)
    ctx.save()
    ctx.globalAlpha = 0.75 * (1 - phase)
    ctx.strokeStyle = GLOW_SOFT
    ctx.shadowColor = GLOW
    ctx.shadowBlur = 10
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.arc(at.x, at.y, RING_R + phase * 16, 0, Math.PI * 2)
    ctx.stroke()
    ctx.restore()
  }
  fineStroke(ctx, () => {
    ctx.beginPath()
    ctx.arc(at.x, at.y, RING_R, 0, Math.PI * 2)
  })
}

/** A highlighter box: a faint wash, a hairline edge, and (for a step) an edge breathing out. */
function highlight(
  ctx: CanvasRenderingContext2D,
  rect: Rect,
  o: PaintOptions,
  pulse: boolean
): void {
  const r = inflate(rect, BOX_PAD)
  const radius = Math.min(8, r.width / 2, r.height / 2)
  const trace = (box: Rect, rr: number) => (): void => {
    ctx.beginPath()
    ctx.roundRect(box.x, box.y, box.width, box.height, rr)
  }
  ctx.save()
  ctx.fillStyle = HIGHLIGHT_FILL
  trace(r, radius)()
  ctx.fill()
  ctx.restore()
  if (pulse && !o.still) {
    const phase = pulsePhase(o)
    const out = inflate(r, phase * 8)
    ctx.save()
    ctx.globalAlpha = 0.7 * (1 - phase)
    ctx.strokeStyle = GLOW_SOFT
    ctx.shadowColor = GLOW
    ctx.shadowBlur = 10
    ctx.lineWidth = 1
    trace(out, radius + phase * 8)()
    ctx.stroke()
    ctx.restore()
  }
  fineStroke(ctx, trace(r, radius))
}

/**
 * The overlay canvas: the user's shape and the model's marks, over a
 * transparent background (live) or the still of the screen (tests).
 */
export function paint(
  ctx: CanvasRenderingContext2D,
  size: { width: number; height: number },
  shape: Shape | null,
  marks: readonly ScreenMark[] = [],
  options: PaintOptions = { t: 0, still: true }
): void {
  ctx.clearRect(0, 0, size.width, size.height)
  const view: Rect = { x: 0, y: 0, ...size }
  if (shape) glowStroke(ctx, () => traceShape(ctx, shape))
  // Labels go on last, so no stroke ever crosses one.
  const labels: { text: string; at: Point }[] = []
  for (const mark of marks) {
    if (mark.kind === 'box') {
      const { x, y, width, height } = mark.rect
      highlight(ctx, mark.rect, options, false)
      labels.push({
        text: mark.label,
        at: { x: x + width / 2, y: y > 40 ? y - 22 : y + height + 22 }
      })
      continue
    }
    const pending = mark.kind === 'point' || mark.state !== 'done'
    const tail = arrowTail(mark.at, view, mark.rect && inflate(mark.rect, BOX_PAD))
    if (mark.rect) highlight(ctx, mark.rect, options, pending)
    else ring(ctx, mark.at, options, pending)
    arrow(ctx, tail, arrowTip(tail, mark.at, mark.rect && inflate(mark.rect, BOX_PAD)))
    labels.push({
      text:
        mark.kind === 'action' && mark.state === 'done'
          ? `✓ ${mark.label}`
          : mark.kind === 'action'
            ? `Click: ${mark.label || 'here'}`
            : mark.label,
      at: tail
    })
  }
  for (const l of labels) pill(ctx, l.text, l.at, view)
}
