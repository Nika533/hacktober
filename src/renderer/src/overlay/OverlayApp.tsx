import { useEffect, useRef, useState } from 'react'
import type { CaptureMode, OverlayInit, Point, Rect } from '../../../shared/types'

const VEIL = 'rgba(0,0,0,0.25)'
const MIN_SHAPE = 8

type Shape = { kind: 'lasso'; points: Point[] } | { kind: 'rect'; rect: Rect }

interface Gesture {
  kind: 'lasso' | 'rect'
  start: Point
  pointerId: number
}

function hexA(hex: string, a: number): string {
  const h = hex.replace('#', '')
  const r = parseInt(h.slice(0, 2), 16)
  const g = parseInt(h.slice(2, 4), 16)
  const b = parseInt(h.slice(4, 6), 16)
  return `rgba(${r},${g},${b},${a})`
}

function trace(ctx: CanvasRenderingContext2D, shape: Shape): void {
  ctx.beginPath()
  if (shape.kind === 'rect') {
    ctx.rect(shape.rect.x, shape.rect.y, shape.rect.width, shape.rect.height)
  } else {
    const pts = shape.points
    if (pts.length === 0) return
    ctx.moveTo(pts[0].x, pts[0].y)
    for (const p of pts) ctx.lineTo(p.x, p.y)
    ctx.closePath()
  }
}

function bboxOk(shape: Shape): boolean {
  if (shape.kind === 'rect') return shape.rect.width >= MIN_SHAPE && shape.rect.height >= MIN_SHAPE
  if (shape.points.length < 3) return false
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity
  for (const p of shape.points) {
    minX = Math.min(minX, p.x)
    minY = Math.min(minY, p.y)
    maxX = Math.max(maxX, p.x)
    maxY = Math.max(maxY, p.y)
  }
  return maxX - minX >= MIN_SHAPE && maxY - minY >= MIN_SHAPE
}

export function OverlayApp(): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [init, setInit] = useState<OverlayInit | null>(null)
  const [mode, setMode] = useState<CaptureMode>('lasso')
  const [shape, setShape] = useState<Shape | null>(null)
  const [drawing, setDrawing] = useState(false)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const gestureRef = useRef<Gesture | null>(null)
  const modeRef = useRef<CaptureMode>('lasso')
  const shapeRef = useRef<Shape | null>(null)

  useEffect(() => {
    modeRef.current = mode
  }, [mode])
  const setShapeSynced = (s: Shape | null): void => {
    shapeRef.current = s
    setShape(s)
  }

  useEffect(() => {
    const load = async (): Promise<void> => {
      const i = await window.hoot.overlay.getInit()
      if (i) {
        setInit(i)
        setMode(i.mode)
      }
    }
    const offOpen = window.hoot.overlay.onOpen(() => {
      setShapeSynced(null)
      setDrawing(false)
      gestureRef.current = null
      setOpen(true)
      void load()
    })
    const offClosed = window.hoot.overlay.onClosed(() => {
      // honest teardown: nothing stays mounted while the window is hidden
      setOpen(false)
      setInit(null)
      setShapeSynced(null)
      setDrawing(false)
      gestureRef.current = null
    })
    void load()
    return () => {
      offOpen()
      offClosed()
    }
  }, [])

  // repaint the veil + shape
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !init) return
    const dpr = window.devicePixelRatio || 1
    const w = init.displayWidth
    const h = init.displayHeight
    if (canvas.width !== Math.round(w * dpr)) {
      canvas.width = Math.round(w * dpr)
      canvas.height = Math.round(h * dpr)
      canvas.style.width = `${w}px`
      canvas.style.height = `${h}px`
    }
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, w, h)
    ctx.fillStyle = VEIL
    ctx.fillRect(0, 0, w, h)
    if (shape) {
      // punch the enclosed region out of the veil, then stroke it
      ctx.save()
      ctx.globalCompositeOperation = 'destination-out'
      trace(ctx, shape)
      ctx.fill()
      ctx.restore()
      ctx.save()
      ctx.strokeStyle = init.accentColor
      ctx.lineWidth = 3
      ctx.shadowColor = hexA(init.accentColor, 0.6)
      ctx.shadowBlur = 12
      trace(ctx, shape)
      ctx.stroke()
      ctx.restore()
    }
  }, [init, shape])

  // keyboard: Esc cancel · F full · L/R mode
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') window.hoot.overlay.cancel()
      else if (e.key === 'f' || e.key === 'F') window.hoot.overlay.commit({ kind: 'full' })
      else if (e.key === 'l' || e.key === 'L') setMode('lasso')
      else if (e.key === 'r' || e.key === 'R') setMode('rect')
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const pt = (e: React.PointerEvent): Point => ({ x: e.clientX, y: e.clientY })

  const onPointerDown = (e: React.PointerEvent): void => {
    if (e.button !== 0) return
    e.currentTarget.setPointerCapture(e.pointerId)
    const kind = modeRef.current === 'rect' || e.shiftKey ? 'rect' : 'lasso'
    gestureRef.current = { kind, start: pt(e), pointerId: e.pointerId }
    setDrawing(true)
    if (kind === 'rect') {
      setShapeSynced({
        kind: 'rect',
        rect: { x: e.clientX, y: e.clientY, width: 0, height: 0 }
      })
    } else {
      setShapeSynced({ kind: 'lasso', points: [pt(e)] })
    }
  }

  const onPointerMove = (e: React.PointerEvent): void => {
    const g = gestureRef.current
    if (!g) return
    if (g.kind === 'rect') {
      const x0 = Math.min(g.start.x, e.clientX)
      const y0 = Math.min(g.start.y, e.clientY)
      setShapeSynced({
        kind: 'rect',
        rect: {
          x: x0,
          y: y0,
          width: Math.abs(e.clientX - g.start.x),
          height: Math.abs(e.clientY - g.start.y)
        }
      })
    } else {
      const evts = e.nativeEvent.getCoalescedEvents?.() ?? [e.nativeEvent]
      const pts = evts.map((ev) => ({ x: ev.clientX, y: ev.clientY }))
      const prev = shapeRef.current
      if (prev?.kind === 'lasso') {
        setShapeSynced({ kind: 'lasso', points: [...prev.points, ...pts] })
      }
    }
  }

  const onPointerUp = (): void => {
    const g = gestureRef.current
    gestureRef.current = null
    setDrawing(false)
    if (!g) return
    const cur = shapeRef.current
    if (cur && bboxOk(cur)) {
      if (cur.kind === 'rect') window.hoot.overlay.commit({ kind: 'rect', rect: cur.rect })
      else window.hoot.overlay.commit({ kind: 'lasso', points: cur.points })
    } else {
      // too small — stay in the overlay, clear the shape
      setShapeSynced(null)
    }
  }

  const MODES: { id: CaptureMode; label: string }[] = [
    { id: 'lasso', label: 'Lasso' },
    { id: 'rect', label: 'Rectangle' },
    { id: 'full', label: 'Full screen' }
  ]

  if (!open || !init) {
    return <div className="overlay-root" data-state="closed" />
  }

  return (
    <div
      className="overlay-root"
      data-state="open"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      <img className="overlay-shot" src={init.imageDataUrl} alt="" draggable={false} />
      <canvas ref={canvasRef} className="overlay-canvas" />
      <div
        className="overlay-toolbar material-chip"
        style={{ opacity: drawing ? 0 : 1 }}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <div className="overlay-seg" role="tablist">
          {MODES.map((m) => (
            <button
              key={m.id}
              type="button"
              className={`overlay-seg-btn t-small ${mode === m.id ? 'active' : ''}`}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => {
                if (m.id === 'full') window.hoot.overlay.commit({ kind: 'full' })
                else setMode(m.id)
              }}
            >
              {m.label}
            </button>
          ))}
        </div>
        <span className="t-small overlay-hint">Esc to cancel</span>
      </div>
    </div>
  )
}
