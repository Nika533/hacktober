import '@hoot/ui/styles.css'
import './capture.css'
import {
  DEFAULT_SUBSCRIPTIONS,
  type CaptureMode,
  type HootApi,
  type OverlayCommit,
  type OverlayInit,
  type Point
} from '@hoot/core'
import {
  applyAccent,
  applyTheme,
  Button,
  HootUIProvider,
  Kbd,
  Segmented,
  useHootState
} from '@hoot/ui'
import { useCallback, useEffect, useRef, useState } from 'react'
import { paint } from './paint'
import { commitFor, rectBetween, type Shape } from './shape'

const SLICES = DEFAULT_SUBSCRIPTIONS.capture
const MAX_PENDING = 4

type DrawMode = Exclude<CaptureMode, 'full'>

const SHAPES = [
  { value: 'lasso', label: 'Lasso' },
  { value: 'rect', label: 'Rectangle' }
] as const

export function App(): React.JSX.Element {
  return (
    <HootUIProvider>
      <Overlay hoot={typeof window.hoot === 'object' ? window.hoot : undefined} />
    </HootUIProvider>
  )
}

interface Gesture {
  kind: DrawMode
  start: Point
  /** Only this pointer, with its button held, draws (a second pen or mouse can't join in). */
  pointerId: number
}

/** Circle anything: a full-screen window over a still of the display. */
function Overlay({ hoot }: { hoot: HootApi | undefined }): React.JSX.Element {
  const { state } = useHootState(hoot, SLICES)
  const [init, setInit] = useState<OverlayInit | null>(null)
  const [mode, setMode] = useState<DrawMode>('lasso')
  const [shape, setShape] = useState<Shape | null>(null)
  const [drawing, setDrawing] = useState(false)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const gesture = useRef<Gesture | null>(null)
  const shapeRef = useRef<Shape | null>(null)
  const done = useRef(false)

  const system = state?.system
  useEffect(() => {
    if (!system) return
    applyTheme(system.darkMode ? 'dark' : 'light')
    applyAccent(system.accentColor)
  }, [system])

  const draw = (next: Shape | null): void => {
    shapeRef.current = next
    setShape(next)
  }

  const commit = useCallback(
    (payload: OverlayCommit): void => {
      if (!hoot || done.current) return
      done.current = true
      void hoot.capture.commit(payload)
    },
    [hoot]
  )

  const cancel = useCallback((): void => {
    if (!hoot || done.current) return
    done.current = true
    void hoot.capture.cancel()
  }, [hoot])

  // Main sends open/closed around each capture; the init is pulled, and also
  // on load, in case the window loaded after the open event.
  useEffect(() => {
    if (!hoot) return
    const reset = (): void => {
      gesture.current = null
      shapeRef.current = null
      setShape(null)
      setDrawing(false)
    }
    const load = (): void => {
      void hoot.capture.getInit().then((next) => {
        if (!next) return
        done.current = false
        setInit(next)
        setMode(next.mode === 'rect' ? 'rect' : 'lasso')
      })
    }
    const offOpen = hoot.capture.onOpen(() => {
      reset()
      load()
    })
    const offClosed = hoot.capture.onClosed(() => {
      reset()
      setInit(null)
    })
    load()
    return () => {
      offOpen()
      offClosed()
    }
  }, [hoot])

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx || !init) return
    const dpr = window.devicePixelRatio || 1
    const size = { width: init.displayWidth, height: init.displayHeight }
    if (canvas.width !== Math.round(size.width * dpr)) {
      canvas.width = Math.round(size.width * dpr)
      canvas.height = Math.round(size.height * dpr)
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    paint(ctx, size, shape, init.accentColor)
  }, [init, shape])

  // Esc cancels, F takes the full screen, L and R pick the shape.
  useEffect(() => {
    if (!init) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.ctrlKey || e.altKey || e.metaKey || e.repeat) return
      const key = e.key.toLowerCase()
      if (key === 'escape') cancel()
      else if (key === 'f') commit({ kind: 'full' })
      else if (key === 'l') setMode('lasso')
      else if (key === 'r') setMode('rect')
      else return
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [init, cancel, commit])

  if (!init) return <div className="capture" data-state="closed" />

  const at = (e: React.PointerEvent): Point => ({ x: e.clientX, y: e.clientY })

  const onPointerDown = (e: React.PointerEvent<HTMLElement>): void => {
    if (e.button !== 0 || done.current) return
    e.currentTarget.setPointerCapture(e.pointerId)
    // Shift draws a rectangle in lasso mode too.
    const kind: DrawMode = mode === 'rect' || e.shiftKey ? 'rect' : 'lasso'
    gesture.current = { kind, start: at(e), pointerId: e.pointerId }
    setDrawing(true)
    draw(kind === 'rect' ? { kind, rect: rectBetween(at(e), at(e)) } : { kind, points: [at(e)] })
  }

  const onPointerMove = (e: React.PointerEvent<HTMLElement>): void => {
    const g = gesture.current
    if (!g || e.pointerId !== g.pointerId || (e.buttons & 1) === 0) return
    if (g.kind === 'rect') {
      draw({ kind: 'rect', rect: rectBetween(g.start, at(e)) })
      return
    }
    const prev = shapeRef.current
    if (prev?.kind !== 'lasso') return
    const events = e.nativeEvent.getCoalescedEvents?.() ?? []
    const points = events.length ? events.map((ev) => ({ x: ev.clientX, y: ev.clientY })) : [at(e)]
    draw({ kind: 'lasso', points: [...prev.points, ...points] })
  }

  const onPointerUp = (e: React.PointerEvent<HTMLElement>): void => {
    if (gesture.current?.pointerId !== e.pointerId) return
    gesture.current = null
    setDrawing(false)
    const finished = shapeRef.current
    const payload = finished && commitFor(finished)
    // Too small: stay open and let them try again.
    if (payload) commit(payload)
    else draw(null)
  }

  // The system took the pointer (e.g. a touch turned into a scroll): drop the shape, stay open.
  const onPointerCancel = (e: React.PointerEvent<HTMLElement>): void => {
    if (gesture.current?.pointerId !== e.pointerId) return
    gesture.current = null
    setDrawing(false)
    draw(null)
  }

  const stop = (e: React.PointerEvent): void => e.stopPropagation()

  return (
    <main
      className="capture hoot-chrome"
      aria-label="Capture the screen"
      data-state="open"
      data-drawing={drawing || undefined}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
    >
      <img className="capture__shot" src={init.imageDataUrl} alt="" draggable={false} />
      <canvas ref={canvasRef} className="capture__veil" aria-hidden />
      <div
        className="capture__toolbar"
        role="toolbar"
        aria-label="Capture options"
        onPointerDown={stop}
        onPointerUp={stop}
      >
        <Segmented
          label="Shape"
          hideLabel
          size="sm"
          value={mode}
          options={SHAPES}
          onChange={setMode}
        />
        <Button size="sm" variant="ghost" onClick={() => commit({ kind: 'full' })}>
          Full screen
        </Button>
        <p className="capture__hint hoot-t-caption" aria-live="polite">
          {mode === 'rect' ? 'Drag a rectangle' : 'Draw around anything'}
          {init.pendingCount > 0 && ` · capture ${init.pendingCount + 1} of ${MAX_PENDING}`}
          {' · '}
          <Kbd keys="Esc" /> to cancel
        </p>
      </div>
    </main>
  )
}
