import type { Shape } from './shape'

/** Draw the veil over the screenshot, punch the shape out of it and outline it. */
export function paint(
  ctx: CanvasRenderingContext2D,
  size: { width: number; height: number },
  shape: Shape | null,
  accent: string
): void {
  ctx.clearRect(0, 0, size.width, size.height)
  ctx.fillStyle = 'rgba(0, 0, 0, 0.32)'
  ctx.fillRect(0, 0, size.width, size.height)
  if (!shape) return
  const trace = (): void => {
    ctx.beginPath()
    if (shape.kind === 'rect') {
      ctx.rect(shape.rect.x, shape.rect.y, shape.rect.width, shape.rect.height)
      return
    }
    const [first, ...rest] = shape.points
    if (!first) return
    ctx.moveTo(first.x, first.y)
    for (const p of rest) ctx.lineTo(p.x, p.y)
    ctx.closePath()
  }
  ctx.save()
  ctx.globalCompositeOperation = 'destination-out'
  trace()
  ctx.fill()
  ctx.restore()
  ctx.save()
  ctx.strokeStyle = accent
  ctx.lineWidth = 3
  ctx.lineJoin = 'round'
  ctx.shadowColor = 'rgba(0, 0, 0, 0.45)'
  ctx.shadowBlur = 8
  trace()
  ctx.stroke()
  ctx.restore()
}
