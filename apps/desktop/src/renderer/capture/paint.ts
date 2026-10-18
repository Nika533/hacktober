import type { Point, Rect } from '@hoot/core'
import type { Shape } from './shape'

/** The live overlay's palette: light blue glow, white core. */
export const GLOW = '#38bdf8'
export const GLOW_SOFT = '#5cc8ff'
const CORE = '#ffffff'
const PILL_BG = 'rgba(8, 47, 73, 0.88)'
const PILL_TEXT = '#e0f2fe'

/** A mark on screen, already in overlay DIP. */
export type ScreenMark =
  | { kind: 'point'; at: Point; label: string }
  | { kind: 'box'; rect: Rect; label: string }
  | { kind: 'action'; at: Point; label: string; state: 'pending' | 'allowed' | 'done' }

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

/** A glowing light-blue stroke with a crisp white core. */
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
  ctx.lineWidth = 1.25
  ctx.stroke()
  ctx.fillStyle = PILL_TEXT
  ctx.textBaseline = 'middle'
  ctx.fillText(text, x + 10, y + h / 2 + 0.5)
  ctx.restore()
}

/** Where an arrow to `at` starts: inward from the nearest edges, so it stays on screen. */
function arrowTail(at: Point, size: Rect): Point {
  const dx = at.x < size.width / 2 ? 1 : -1
  const dy = at.y < size.height / 2 ? 1 : -1
  return { x: at.x + dx * 96, y: at.y + dy * 72 }
}

function arrow(ctx: CanvasRenderingContext2D, from: Point, to: Point, stopShort: number): void {
  const angle = Math.atan2(to.y - from.y, to.x - from.x)
  const tip = { x: to.x - Math.cos(angle) * stopShort, y: to.y - Math.sin(angle) * stopShort }
  const head = 12
  glowStroke(
    ctx,
    () => {
      ctx.beginPath()
      ctx.moveTo(from.x, from.y)
      ctx.lineTo(tip.x, tip.y)
      ctx.moveTo(tip.x - Math.cos(angle - 0.5) * head, tip.y - Math.sin(angle - 0.5) * head)
      ctx.lineTo(tip.x, tip.y)
      ctx.lineTo(tip.x - Math.cos(angle + 0.5) * head, tip.y - Math.sin(angle + 0.5) * head)
    },
    2.5
  )
}

function rings(ctx: CanvasRenderingContext2D, at: Point, o: PaintOptions, locked: boolean): void {
  const phase = o.still ? 0.5 : (o.t % 1400) / 1400
  ctx.save()
  // The pulse: a ring that grows and fades, then the steady target.
  if (!o.still || locked) {
    ctx.globalAlpha = locked ? 0.55 : 1 - phase
    ctx.strokeStyle = GLOW_SOFT
    ctx.shadowColor = GLOW
    ctx.shadowBlur = 16
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.arc(at.x, at.y, 14 + phase * 22, 0, Math.PI * 2)
    ctx.stroke()
  }
  ctx.restore()
  glowStroke(ctx, () => {
    ctx.beginPath()
    ctx.arc(at.x, at.y, 12, 0, Math.PI * 2)
  })
  ctx.save()
  ctx.fillStyle = locked ? GLOW : CORE
  ctx.shadowColor = GLOW
  ctx.shadowBlur = 12
  ctx.beginPath()
  ctx.arc(at.x, at.y, locked ? 6 : 3.5, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
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
  for (const mark of marks) {
    if (mark.kind === 'box') {
      const { x, y, width, height } = mark.rect
      ctx.save()
      ctx.fillStyle = 'rgba(56, 189, 248, 0.10)'
      ctx.beginPath()
      ctx.roundRect(x, y, width, height, 10)
      ctx.fill()
      ctx.restore()
      glowStroke(ctx, () => {
        ctx.beginPath()
        ctx.roundRect(x, y, width, height, 10)
      })
      pill(ctx, mark.label, { x: x + width / 2, y: y > 40 ? y - 22 : y + height + 22 }, view)
      continue
    }
    const tail = arrowTail(mark.at, view)
    const locked = mark.kind === 'action' && mark.state !== 'pending'
    arrow(ctx, tail, mark.at, 18)
    rings(ctx, mark.at, options, locked)
    const label =
      mark.kind === 'action' && mark.state === 'done'
        ? `✓ ${mark.label}`
        : mark.kind === 'action' && mark.state === 'allowed'
          ? `Click here: ${mark.label}`
          : mark.label
    pill(ctx, label, tail, view)
  }
}
