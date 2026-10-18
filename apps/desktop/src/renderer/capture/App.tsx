import '@hoot/ui/styles.css'
import './capture.css'
import {
  type CaptureMode,
  type HootApi,
  type Message,
  type OverlayCommit,
  type OverlayInit,
  type Point,
  type QuickActionId,
  type Rect,
  type SliceName
} from '@hoot/core'
import {
  applyAccent,
  applyTheme,
  Button,
  HootUIProvider,
  Kbd,
  Markdown,
  Segmented,
  useHootState,
  useReducedMotion
} from '@hoot/ui'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { chatPlacement, parseAnnotations, toScreen, type Annotation } from './annotations'
import { paint, type ScreenMark } from './paint'
import { bounds, commitFor, rectBetween, type Shape } from './shape'

/** The chat slice too: the live overlay shows the conversation about what was circled. */
const SLICES: readonly SliceName[] = ['system', 'chat']
const MAX_PENDING = 4
/** The glass chat box (DIP); the height is the most it grows to. */
const CHAT_BOX = { width: 380, height: 440 }

type DrawMode = Exclude<CaptureMode, 'full'>

const SHAPES = [
  { value: 'lasso', label: 'Lasso' },
  { value: 'rect', label: 'Rectangle' }
] as const

const CHIPS: readonly { id: QuickActionId; label: string }[] = [
  { id: 'explain', label: 'Explain' },
  { id: 'summarize', label: 'Summarize' },
  { id: 'translate', label: 'Translate' },
  { id: 'fix', label: 'Fix' }
]

/** Follow-up sent after the user did an allowed step (with a fresh screen). */
const NEXT_STEP_PROMPT = 'Done. What’s the next step on my screen now?'

type ActionState = 'allowed' | 'dismissed' | 'done'

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

const isTyping = (target: EventTarget | null): boolean =>
  target instanceof HTMLElement &&
  (target.isContentEditable || /^(INPUT|TEXTAREA)$/.test(target.tagName))

const lastOf = (messages: readonly Message[], role: Message['role']): Message | undefined => {
  for (let i = messages.length - 1; i >= 0; i--) if (messages[i]?.role === role) return messages[i]
  return undefined
}

/**
 * Circle anything. Tests (and HOOT_TEST builds) get a still of the display
 * under a full-screen window that closes on commit. The live overlay
 * (`imageDataUrl` is '') sits transparently over the real, moving screen:
 * the shape stays, a glass chat opens beside it, and the model's
 * [[point]] / [[box]] / [[action]] tags are drawn right on the screen.
 */
function Overlay({ hoot }: { hoot: HootApi | undefined }): React.JSX.Element {
  const { state } = useHootState(hoot, SLICES)
  const [init, setInit] = useState<OverlayInit | null>(null)
  const [mode, setMode] = useState<DrawMode>('lasso')
  const [shape, setShape] = useState<Shape | null>(null)
  const [drawing, setDrawing] = useState(false)
  /** Live only: drawing a shape, or chatting about the one drawn. */
  const [phase, setPhase] = useState<'draw' | 'chat'>('draw')
  const [anchor, setAnchor] = useState<Rect | null>(null)
  const [draft, setDraft] = useState('')
  const [actions, setActions] = useState<Record<string, ActionState>>({})
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const transcriptRef = useRef<HTMLDivElement>(null)
  const gesture = useRef<Gesture | null>(null)
  const shapeRef = useRef<Shape | null>(null)
  const done = useRef(false)
  const still = useReducedMotion() ?? false

  const live = init?.imageDataUrl === ''
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

  /** Live: the shape stays on screen and the chat opens beside it. */
  const commitLive = useCallback(
    (payload: OverlayCommit, around: Rect): void => {
      if (!hoot) return
      void hoot.capture.commit(payload)
      setAnchor(around)
      setActions({})
      setPhase('chat')
    },
    [hoot]
  )

  const redraw = (): void => {
    gesture.current = null
    draw(null)
    setAnchor(null)
    setActions({})
    setPhase('draw')
  }

  // Main sends open/closed around each capture; the init is pulled, and also
  // on load, in case the window loaded after the open event.
  useEffect(() => {
    if (!hoot) return
    const reset = (): void => {
      gesture.current = null
      shapeRef.current = null
      setShape(null)
      setDrawing(false)
      setPhase('draw')
      setAnchor(null)
      setDraft('')
      setActions({})
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

  // The conversation about the circled region (live only).
  const chat = state?.chat
  const session = live && phase === 'chat' ? (chat?.session ?? null) : null
  const messages = session?.messages ?? []
  const question = lastOf(messages, 'user')
  const answer = lastOf(messages, 'assistant')
  const streaming = chat?.stream !== null && chat?.stream !== undefined
  const answering = answer?.status === 'streaming'
  const parsed = useMemo(
    () => parseAnnotations(answer?.text ?? '', answering),
    [answer?.text, answering]
  )

  const marks = useMemo((): ScreenMark[] => {
    if (!init || !answer) return []
    const size = { width: init.displayWidth, height: init.displayHeight }
    return parsed.annotations.flatMap((a: Annotation, i): ScreenMark[] => {
      if (a.kind === 'box') {
        const from = toScreen({ x: a.x1, y: a.y1 }, size)
        const to = toScreen({ x: a.x2, y: a.y2 }, size)
        return [
          {
            kind: 'box',
            rect: { ...from, width: to.x - from.x, height: to.y - from.y },
            label: a.label
          }
        ]
      }
      const at = toScreen(a, size)
      if (a.kind === 'point') return [{ kind: 'point', at, label: a.label }]
      const s = actions[`${answer.id}:${i}`]
      if (s === 'dismissed') return []
      return [{ kind: 'action', at, label: a.label, state: s ?? 'pending' }]
    })
  }, [init, answer, parsed, actions])

  // Paint the shape and marks; pulse while there's something to point at.
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
    const frame = (t: number): void => paint(ctx, size, shape, marks, { t, still })
    frame(performance.now())
    if (still || marks.length === 0) return
    let raf = requestAnimationFrame(function tick(t) {
      frame(t)
      raf = requestAnimationFrame(tick)
    })
    return () => cancelAnimationFrame(raf)
  }, [init, shape, marks, still])

  // Esc closes; F takes the full screen and L / R pick the shape while drawing.
  useEffect(() => {
    if (!init) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.ctrlKey || e.altKey || e.metaKey || e.repeat) return
      const key = e.key.toLowerCase()
      if (key === 'escape') cancel()
      else if (isTyping(e.target) || (live && phase === 'chat')) return
      else if (key === 'f') {
        if (live)
          commitLive(
            { kind: 'full' },
            { x: 0, y: 0, width: init.displayWidth, height: init.displayHeight }
          )
        else commit({ kind: 'full' })
      } else if (key === 'l') setMode('lasso')
      else if (key === 'r') setMode('rect')
      else return
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [init, cancel, commit, commitLive, live, phase])

  // The chat input is ready the moment the shape is done.
  useEffect(() => {
    if (phase === 'chat') inputRef.current?.focus()
  }, [phase])

  // Keep the newest words in view while the answer streams.
  useEffect(() => {
    const el = transcriptRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [parsed.text, question?.id])

  if (!init) return <div className="capture" data-state="closed" />

  const size = { width: init.displayWidth, height: init.displayHeight }
  const at = (e: React.PointerEvent): Point => ({ x: e.clientX, y: e.clientY })
  const drawingPhase = !live || phase === 'draw'

  const onPointerDown = (e: React.PointerEvent<HTMLElement>): void => {
    if (e.button !== 0 || done.current || !drawingPhase) return
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
    if (!payload || !finished) draw(null)
    else if (live) commitLive(payload, bounds(finished))
    else commit(payload)
  }

  // The system took the pointer (e.g. a touch turned into a scroll): drop the shape, stay open.
  const onPointerCancel = (e: React.PointerEvent<HTMLElement>): void => {
    if (gesture.current?.pointerId !== e.pointerId) return
    gesture.current = null
    setDrawing(false)
    draw(null)
  }

  const stop = (e: React.PointerEvent): void => e.stopPropagation()

  /** True when the message went out (main allows one answer at a time). */
  const send = (text: string): boolean => {
    const trimmed = text.trim()
    if (!hoot || !trimmed || streaming) return false
    void hoot.chat.send({ text: trimmed })
    setDraft('')
    return true
  }

  const quick = (id: QuickActionId): void => {
    if (!hoot || streaming) return
    void hoot.chat.send({ quickAction: id })
  }

  const fullScreen = (): void => {
    if (live) commitLive({ kind: 'full' }, { x: 0, y: 0, ...size })
    else commit({ kind: 'full' })
  }

  const place = anchor ? chatPlacement(anchor, size, CHAT_BOX) : null
  const pendingActions = answer
    ? parsed.annotations
        .map((a, i) => ({ a, key: `${answer.id}:${i}` }))
        .filter(
          (x): x is { a: Extract<Annotation, { kind: 'action' }>; key: string } =>
            x.a.kind === 'action'
        )
        .filter(({ key }) => actions[key] !== 'dismissed')
    : []

  return (
    <main
      className="capture hoot-chrome"
      aria-label="Capture the screen"
      data-state="open"
      data-live={live || undefined}
      data-phase={live ? phase : undefined}
      data-drawing={drawing || undefined}
      // While drawing, the whole screen is ours; while chatting, only the chat and toolbar.
      data-hit={drawingPhase || undefined}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
    >
      {!live && <img className="capture__shot" src={init.imageDataUrl} alt="" draggable={false} />}
      {live && <div className="capture__edge-glow" aria-hidden />}
      <canvas ref={canvasRef} className="capture__veil" aria-hidden />
      {drawingPhase && (
        <div
          className="capture__toolbar"
          role="toolbar"
          aria-label="Capture options"
          data-hit
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
          <Button size="sm" variant="ghost" onClick={fullScreen}>
            Full screen
          </Button>
          <p className="capture__hint hoot-t-caption" aria-live="polite">
            {mode === 'rect' ? 'Drag a rectangle' : 'Draw around anything'}
            {!live &&
              init.pendingCount > 0 &&
              ` · capture ${init.pendingCount + 1} of ${MAX_PENDING}`}
            {' · '}
            <Kbd keys="Esc" /> to {live ? 'close' : 'cancel'}
          </p>
        </div>
      )}
      {live && phase === 'chat' && place && (
        <section
          className="capture__chat"
          aria-label="Ask Hoot about this"
          data-hit
          style={{ left: place.x, top: place.y, width: CHAT_BOX.width, maxHeight: CHAT_BOX.height }}
          onPointerDown={stop}
          onPointerUp={stop}
        >
          <header className="capture__chat-head">
            <span className="capture__chat-title">
              <span className="capture__live-dot" aria-hidden /> Hoot sees your screen
            </span>
            <button
              type="button"
              className="capture__icon"
              aria-label="Redraw"
              title="Redraw"
              onClick={redraw}
            >
              ↺
            </button>
            <button
              type="button"
              className="capture__icon"
              aria-label="Close"
              title="Close (Esc)"
              onClick={cancel}
            >
              ×
            </button>
          </header>
          {(question || answer) && (
            <div className="capture__transcript" ref={transcriptRef} aria-live="polite">
              {question && (
                <p className="capture__question">{parseAnnotations(question.text).text}</p>
              )}
              {answer && (
                <div className="capture__answer">
                  {parsed.text ? (
                    <Markdown
                      text={parsed.text}
                      onCopy={(t) => hoot?.clipboard.writeText(t) ?? Promise.resolve()}
                      onOpenLink={(href) => void hoot?.app.openExternal(href)}
                    />
                  ) : answer.status === 'streaming' ? (
                    <p className="capture__thinking">Looking at your screen…</p>
                  ) : null}
                  {answer.status === 'error' && (
                    <p className="capture__error">
                      Hoot couldn’t answer that. Try again in a moment.
                    </p>
                  )}
                </div>
              )}
            </div>
          )}
          {pendingActions.map(({ a, key }) => {
            const s = actions[key]
            return (
              <div key={key} className="capture__permission" data-state={s ?? 'pending'}>
                {s === undefined && (
                  <>
                    <span className="capture__permission-text">
                      Allow Hoot: {a.label || 'this step'}
                    </span>
                    <button
                      type="button"
                      className="capture__pill capture__pill--primary"
                      onClick={() => setActions((m) => ({ ...m, [key]: 'allowed' }))}
                    >
                      Allow
                    </button>
                    <button
                      type="button"
                      className="capture__pill"
                      onClick={() => setActions((m) => ({ ...m, [key]: 'dismissed' }))}
                    >
                      Dismiss
                    </button>
                  </>
                )}
                {s === 'allowed' && (
                  <>
                    <span className="capture__permission-text">
                      Click the highlighted spot, then
                    </span>
                    <button
                      type="button"
                      className="capture__pill capture__pill--primary"
                      disabled={streaming}
                      onClick={() => {
                        // Only once the follow-up actually goes out.
                        if (send(NEXT_STEP_PROMPT)) setActions((m) => ({ ...m, [key]: 'done' }))
                      }}
                    >
                      Next step
                    </button>
                  </>
                )}
                {s === 'done' && <span className="capture__permission-text">✓ Step complete</span>}
              </div>
            )
          })}
          <div className="capture__chips" role="group" aria-label="Quick actions">
            {CHIPS.map((c) => (
              <button
                key={c.id}
                type="button"
                className="capture__pill"
                disabled={streaming}
                onClick={() => quick(c.id)}
              >
                {c.label}
              </button>
            ))}
          </div>
          <form
            className="capture__composer"
            onSubmit={(e) => {
              e.preventDefault()
              send(draft)
            }}
          >
            <textarea
              ref={inputRef}
              className="capture__input"
              aria-label="Ask about this"
              placeholder="Ask about this, or where to click…"
              rows={1}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault()
                  send(draft)
                }
              }}
            />
            {streaming ? (
              <button
                type="button"
                className="capture__pill"
                onClick={() => void hoot?.chat.stop()}
              >
                Stop
              </button>
            ) : (
              <button
                type="submit"
                className="capture__pill capture__pill--primary"
                disabled={!draft.trim()}
              >
                Send
              </button>
            )}
          </form>
        </section>
      )}
    </main>
  )
}
