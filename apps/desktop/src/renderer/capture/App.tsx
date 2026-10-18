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
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  boundsToScreen,
  chatPlacement,
  hitsTarget,
  parseAnnotations,
  toScreen,
  type Annotation,
  type Target
} from './annotations'
import {
  CloseIcon,
  CopyIcon,
  DrawIcon,
  FullScreenIcon,
  GripIcon,
  MinimizeIcon,
  NarrowerIcon,
  OpenIcon,
  PinIcon,
  PointerIcon,
  RedrawIcon,
  WiderIcon
} from './icons'
import { createPanelMotion, growFrom, shrinkInto, type Frame, type PanelMotion } from './motion'
import { paint, type ScreenMark } from './paint'
import { bounds, commitFor, rectBetween, type Shape } from './shape'

/** The chat slice too: the live overlay shows the conversation about what was circled. */
const SLICES: readonly SliceName[] = ['system', 'chat']
const MAX_PENDING = 4
/** The glass chat box (DIP); the height is the most it grows to. */
const CHAT_BOX = { width: 380, height: 440 }
/** "Wider": room for code, tables and long answers. */
const WIDE_BOX = { width: 680, height: 760 }
/** Kept between a dragged panel and the screen edge (DIP). */
const EDGE = 8
/** The smallest the user can resize the chat to (DIP). */
const MIN_CHAT = { width: 300, height: 200 }
/** The chat never shrinks below this when it grows with its content (DIP). */
const MIN_CAP = 160

type DrawMode = Exclude<CaptureMode, 'full'>
type Box = { width: number; height: number }
/** The two panels the user can drag around the screen. */
type Panel = 'chat' | 'toolbar'
/** The chat's resize handles: its edges and corners. */
type Edge = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'
const EDGES: readonly Edge[] = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw']

interface PanelDrag {
  panel: Panel
  pointerId: number
  /** Pointer offset from the panel's top-left corner, and the panel's size. */
  dx: number
  dy: number
  width: number
  height: number
}

interface ResizeDrag {
  pointerId: number
  edge: Edge
  start: Point
  /** The chat's frame when the resize started. */
  from: Frame
}

/**
 * Where the chat goes and how big it is. `height` null: it grows with its
 * content, up to `cap`; a number: the size the user dragged it to.
 */
interface PanelTarget {
  x: number
  y: number
  width: number
  height: number | null
  cap: number
}

const clampTo = (p: Point, box: Box, view: Box): Point => ({
  x: Math.min(Math.max(EDGE, p.x), Math.max(EDGE, view.width - box.width - EDGE)),
  y: Math.min(Math.max(EDGE, p.y), Math.max(EDGE, view.height - box.height - EDGE))
})

const clamp = (v: number, min: number, max: number): number => Math.max(min, Math.min(v, max))

const boxFor = (isWide: boolean, view: Box): Box =>
  isWide
    ? {
        width: Math.min(WIDE_BOX.width, view.width - 2 * EDGE),
        height: Math.min(WIDE_BOX.height, view.height - 2 * EDGE)
      }
    : CHAT_BOX

const px = (v: string): number => parseFloat(v) || 0

/**
 * The chat's height if nothing held it back: its padding, its parts and the
 * gaps between them, with the transcript at its content's height (it's the
 * part that scrolls when the chat is held shorter).
 */
function naturalHeight(section: HTMLElement): number {
  const cs = getComputedStyle(section)
  let h =
    px(cs.paddingTop) + px(cs.paddingBottom) + px(cs.borderTopWidth) + px(cs.borderBottomWidth)
  let parts = 0
  for (const child of Array.from(section.children)) {
    if (!(child instanceof HTMLElement)) continue
    const s = getComputedStyle(child)
    if (s.position === 'absolute' || s.display === 'none') continue
    const body = child.dataset['grow'] !== undefined ? child.firstElementChild : null
    h +=
      (body instanceof HTMLElement ? body.offsetHeight : child.offsetHeight) +
      px(s.marginTop) +
      px(s.marginBottom)
    parts++
  }
  // offsetHeight rounds each part (and ignores transforms, so the entrance
  // scale can't skew it): a pixel of slack keeps the composer from being clipped.
  return Math.ceil(h + Math.max(0, parts - 1) * px(cs.rowGap)) + 1
}

/** Buttons, fields and the shape switch keep their clicks; the rest of a panel drags it. */
const isControl = (target: EventTarget | null): boolean =>
  target instanceof Element &&
  target.closest('button, textarea, input, a, label, [role="radiogroup"]') !== null

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

/** Follow-up sent after a step is clicked (with a fresh screen). */
const NEXT_STEP_PROMPT =
  'I clicked that. Look at my screen now: if there is another step to reach my goal, show me the next one; if I am there, tell me.'
/** Give the app a moment to open its menu/dialog after a click before grabbing the next frame. */
const CLICK_SETTLE_MS = 380
/** When Auto-click is on, show the arrow briefly before Hoot clicks the spot. */
const AUTO_CLICK_DELAY_MS = 650

type ActionState = 'clicking' | 'dismissed' | 'done'

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

/** A point's or step's target on screen: its centre, and its highlight box when the model gave edges. */
const targetOf = (a: Extract<Annotation, { kind: 'point' | 'action' }>, size: Box): Target => ({
  at: toScreen(a, size),
  ...(a.bounds ? { rect: boundsToScreen(a.bounds, size) } : {})
})

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
  /** Agent mode: Hoot clicks each [[action]] step on its own until the goal is reached. */
  const [autoClick, setAutoClick] = useState(false)
  /** Live: clicks go to the apps under the overlay instead of drawing. */
  const [interact, setInteract] = useState(false)
  const [wide, setWide] = useState(false)
  /** Where the user dragged the chat / toolbar to; null = the default spot. */
  const [chatAt, setChatAt] = useState<Point | null>(null)
  const [toolbarAt, setToolbarAt] = useState<Point | null>(null)
  const [dragging, setDragging] = useState<Panel | null>(null)
  /** The size the user dragged the chat to; null = the preset, growing with its content. */
  const [custom, setCustom] = useState<Box | null>(null)
  const [resizing, setResizing] = useState<Edge | null>(null)
  /** Live: the chat is shrinking into the owl, or sitting in it. */
  const [minimized, setMinimized] = useState(false)
  /** The answer just pinned or copied, for the button's feedback. */
  const [pinned, setPinned] = useState<string | null>(null)
  const [copied, setCopied] = useState<string | null>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const transcriptRef = useRef<HTMLDivElement>(null)
  const transcriptBodyRef = useRef<HTMLDivElement>(null)
  const chatRef = useRef<HTMLElement>(null)
  const toolbarRef = useRef<HTMLDivElement>(null)
  const panelDrag = useRef<PanelDrag | null>(null)
  const resizeDrag = useRef<ResizeDrag | null>(null)
  /** Springs the chat's place and size, outside React (see motion.ts). */
  const motionRef = useRef<PanelMotion | null>(null)
  const observer = useRef<ResizeObserver | null>(null)
  /** The newest panel target, for the observer and gestures (set after each render). */
  const panelTarget = useRef<PanelTarget | null>(null)
  /** The shrink-into-the-owl animations, held at their end while minimized. */
  const minimizeAnims = useRef<Animation[]>([])
  const gesture = useRef<Gesture | null>(null)
  const shapeRef = useRef<Shape | null>(null)
  const done = useRef(false)
  const still = useReducedMotion() ?? false
  const stillRef = useRef(still)

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

  /**
   * Live: the shape stays on screen and the chat opens beside it. The whole
   * screen has no shape: a line drawn before it goes away.
   */
  const commitLive = useCallback(
    (payload: OverlayCommit, around: Rect): void => {
      if (!hoot) return
      void hoot.capture.commit(payload)
      if (payload.kind === 'full') {
        gesture.current = null
        shapeRef.current = null
        setShape(null)
        setDrawing(false)
      }
      setAnchor(around)
      setActions({})
      setChatAt(null)
      setInteract(false)
      setPhase('chat')
    },
    [hoot]
  )

  const redraw = (): void => {
    gesture.current = null
    draw(null)
    setAnchor(null)
    setActions({})
    setChatAt(null)
    setInteract(false)
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
      setAutoClick(false)
      setInteract(false)
      setWide(false)
      setChatAt(null)
      setToolbarAt(null)
      setDragging(null)
      setCustom(null)
      setResizing(null)
      setMinimized(false)
      panelDrag.current = null
      resizeDrag.current = null
      for (const a of minimizeAnims.current) a.cancel()
      minimizeAnims.current = []
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

  // Back out of the owl, along the path it went in; "circle something" goes
  // straight back to drawing.
  useEffect(() => {
    if (!hoot) return
    return hoot.capture.onRestore((restore) => {
      setMinimized(false)
      const held = minimizeAnims.current
      minimizeAnims.current = []
      const el = chatRef.current
      if (el && !restore.draw) {
        const owl = restore.owlAt ?? { x: window.innerWidth - 48, y: window.innerHeight - 48 }
        growFrom(el, owl, stillRef.current)
        inputRef.current?.focus()
      }
      // After the way back exists, so no frame shows the chat at full size first.
      for (const a of held) a.cancel()
      if (!restore.draw) return
      gesture.current = null
      shapeRef.current = null
      setShape(null)
      setAnchor(null)
      setActions({})
      setChatAt(null)
      setInteract(false)
      setPhase('draw')
    })
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
      if (a.kind === 'box') return [{ kind: 'box', rect: boundsToScreen(a, size), label: a.label }]
      const target = targetOf(a, size)
      if (a.kind === 'point') return [{ kind: 'point', ...target, label: a.label }]
      const s = actions[`${answer.id}:${i}`]
      if (s === 'dismissed') return []
      return [{ kind: 'action', ...target, label: a.label, state: s ?? 'pending' }]
    })
  }, [init, answer, parsed, actions])

  // Paint the shape and marks; once Hoot is pointing at spots on screen, the
  // initial lasso gets out of the way so only the current step is highlighted.
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
    const activeShape = marks.length > 0 ? null : shape
    const frame = (t: number): void => paint(ctx, size, activeShape, marks, { t, still })
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

  const answerDone =
    answer !== undefined && answer.status !== 'streaming' && answer.status !== 'error'
  const pendingActions = useMemo(
    () =>
      answer && init
        ? parsed.annotations
            .map((a, i) => ({ a, key: `${answer.id}:${i}` }))
            .filter(
              (x): x is { a: Extract<Annotation, { kind: 'action' }>; key: string } =>
                x.a.kind === 'action'
            )
            .filter(({ key }) => actions[key] !== 'dismissed')
            .map(({ a, key }) => ({
              a,
              key,
              target: targetOf(a, { width: init.displayWidth, height: init.displayHeight })
            }))
        : [],
    [answer, init, parsed.annotations, actions]
  )
  /** The first unfinished step on screen: the one Hoot or the user clicks next. */
  const nextAction = pendingActions.find(({ key }) => actions[key] === undefined)

  /** Advance after a step was clicked: wait for the UI to settle, then ask for the next step. */
  const advanceAfterClick = useCallback(
    (key: string): void => {
      setActions((m) => ({ ...m, [key]: 'clicking' }))
      setTimeout(() => {
        if (!hoot) return
        void hoot.chat.send({ text: NEXT_STEP_PROMPT })
        setActions((m) => ({ ...m, [key]: 'done' }))
      }, CLICK_SETTLE_MS)
    },
    [hoot]
  )

  /** Hoot clicks the highlighted spot for the user, then advances to the next step. */
  const clickForMe = useCallback(
    async (key: string, at: Point): Promise<void> => {
      if (!hoot || streaming) return
      setActions((m) => ({ ...m, [key]: 'clicking' }))
      const ok = await hoot.capture.click(at).catch(() => false)
      if (!ok) {
        setActions((m) => {
          const next = { ...m }
          delete next[key]
          return next
        })
        return
      }
      setTimeout(() => {
        void hoot.chat.send({ text: NEXT_STEP_PROMPT })
        setActions((m) => ({ ...m, [key]: 'done' }))
      }, CLICK_SETTLE_MS)
    },
    [hoot, streaming]
  )

  // When the user clicks the highlighted spot themselves, advance automatically
  // (not while the chat sits in the owl: those clicks are just the user working).
  useEffect(() => {
    if (!hoot || !live || phase !== 'chat' || !answerDone || streaming || !init || minimized) return
    const sizeNow = { width: init.displayWidth, height: init.displayHeight }
    return hoot.capture.onUserClick((clicked) => {
      // Check the active [[action]] first; if the model used [[point]] for a step,
      // a click on that pointed-at spot also advances the walkthrough.
      if (nextAction) {
        if (hitsTarget(clicked, nextAction.target)) advanceAfterClick(nextAction.key)
        return
      }
      if (!answer) return
      for (let i = 0; i < parsed.annotations.length; i++) {
        const a = parsed.annotations[i]!
        if (a.kind !== 'point') continue
        const key = `${answer.id}:${i}`
        if (actions[key]) continue
        if (hitsTarget(clicked, targetOf(a, sizeNow))) {
          advanceAfterClick(key)
          return
        }
      }
    })
  }, [
    hoot,
    live,
    phase,
    answerDone,
    streaming,
    init,
    minimized,
    nextAction,
    answer,
    parsed.annotations,
    actions,
    advanceAfterClick
  ])

  // Auto-click: once an answer with a step finishes, show the arrow briefly, then click it.
  useEffect(() => {
    if (!autoClick || !answerDone || streaming || !nextAction || minimized) return
    const timer = setTimeout(
      () => void clickForMe(nextAction.key, nextAction.target.at),
      AUTO_CLICK_DELAY_MS
    )
    return () => clearTimeout(timer)
  }, [autoClick, answerDone, streaming, nextAction, minimized, clickForMe])

  // ---- The chat panel: springs for its place and size ----------------------

  const view = useMemo(
    () => (init ? { width: init.displayWidth, height: init.displayHeight } : null),
    [init]
  )
  const chatPanel = useMemo((): PanelTarget | null => {
    if (!view || !anchor || !live || phase !== 'chat') return null
    const size = custom ?? boxFor(wide, view)
    const at = chatAt ?? chatPlacement(anchor, view, size)
    const room = view.height - at.y - EDGE
    return {
      x: at.x,
      y: at.y,
      width: size.width,
      height: custom ? Math.max(MIN_CHAT.height, Math.min(custom.height, room)) : null,
      cap: Math.max(MIN_CAP, Math.min(size.height, room))
    }
  }, [view, anchor, live, phase, custom, wide, chatAt])

  useLayoutEffect(() => {
    panelTarget.current = chatPanel
    stillRef.current = still
  })

  /** Growing with its content: the chat springs to its content's height, up to the cap. */
  const refit = useCallback((): void => {
    const el = chatRef.current
    const m = motionRef.current
    const t = panelTarget.current
    if (!el || !m || !t || t.height !== null || resizeDrag.current) return
    m.to({ height: Math.min(naturalHeight(el), t.cap) })
  }, [])

  const panelOn = chatPanel !== null
  useLayoutEffect(() => {
    if (!panelOn) return
    const ro = new ResizeObserver(refit)
    observer.current = ro
    return () => {
      ro.disconnect()
      observer.current = null
      motionRef.current?.dispose()
      motionRef.current = null
    }
  }, [panelOn, refit])

  const tx = chatPanel?.x
  const ty = chatPanel?.y
  const tw = chatPanel?.width
  const th = chatPanel?.height
  const tcap = chatPanel?.cap
  useLayoutEffect(() => {
    const el = chatRef.current
    if (!el || tx === undefined || ty === undefined || tw === undefined || th === undefined) return
    const m = motionRef.current
    if (!m) {
      // First paint: right in place (its entrance is the fade-in, not a flight from nowhere).
      el.style.width = `${tw}px`
      const height = th ?? Math.min(naturalHeight(el), tcap ?? CHAT_BOX.height)
      motionRef.current = createPanelMotion(
        el,
        { x: tx, y: ty, width: tw, height },
        () => stillRef.current
      )
      return
    }
    // A gesture is driving it 1:1; the target catches up when it ends.
    if (resizeDrag.current || panelDrag.current?.panel === 'chat') return
    m.to({ x: tx, y: ty, width: tw })
    if (th !== null) m.to({ height: th })
    else refit()
  }, [tx, ty, tw, th, tcap, refit])

  // Every part of the chat (and the transcript's content) reports its size,
  // so the chat follows streaming text, a step card appearing, a reflow.
  useLayoutEffect(() => {
    const ro = observer.current
    const el = chatRef.current
    if (!ro || !el) return
    ro.disconnect()
    for (const child of Array.from(el.children)) ro.observe(child)
    if (transcriptBodyRef.current) ro.observe(transcriptBodyRef.current)
  })

  if (!init) return <div className="capture" data-state="closed" />

  const size = { width: init.displayWidth, height: init.displayHeight }
  const at = (e: React.PointerEvent): Point => ({ x: e.clientX, y: e.clientY })
  const drawingPhase = !live || phase === 'draw'
  /**
   * The overlay takes the pointer: drawing (unless the user asked for their
   * apps), or dragging / resizing a panel; never on the way into the owl.
   */
  const takesPointer =
    !minimized && ((drawingPhase && !interact) || dragging !== null || resizing !== null)

  const onPointerDown = (e: React.PointerEvent<HTMLElement>): void => {
    if (e.button !== 0 || done.current || !drawingPhase || interact) return
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

  /** Back to drawing: from "Use apps", or a new shape after a chat. */
  const drawAgain = (): void => {
    if (phase === 'chat') redraw()
    else setInteract(false)
  }

  const pickShape = (next: DrawMode): void => {
    setMode(next)
    if (live && (phase === 'chat' || interact)) drawAgain()
  }

  const startPanelDrag = (panel: Panel, e: React.PointerEvent<HTMLElement>): void => {
    const el = panel === 'chat' ? chatRef.current : toolbarRef.current
    if (e.button !== 0 || !el || isControl(e.target)) return
    // The chat: from where it is on screen right now, even mid-spring.
    const f = panel === 'chat' ? motionRef.current?.current() : undefined
    const r = f
      ? { left: f.x, top: f.y, width: f.width, height: f.height }
      : el.getBoundingClientRect()
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    if (f) motionRef.current?.to(f, true)
    panelDrag.current = {
      panel,
      pointerId: e.pointerId,
      dx: e.clientX - r.left,
      dy: e.clientY - r.top,
      width: r.width,
      height: r.height
    }
    setDragging(panel)
  }

  const movePanel = (e: React.PointerEvent<HTMLElement>): void => {
    const d = panelDrag.current
    if (!d || d.pointerId !== e.pointerId) return
    const next = clampTo({ x: e.clientX - d.dx, y: e.clientY - d.dy }, d, size)
    // The chat follows the pointer 1:1, straight on the element (no re-render per move).
    if (d.panel === 'chat') motionRef.current?.to(next, true)
    else setToolbarAt(next)
  }

  const endPanelDrag = (e: React.PointerEvent<HTMLElement>): void => {
    const d = panelDrag.current
    if (d?.pointerId !== e.pointerId) return
    panelDrag.current = null
    const f = d.panel === 'chat' ? motionRef.current?.target() : undefined
    if (f) setChatAt({ x: f.x, y: f.y })
    setDragging(null)
  }

  /** Drag an edge or corner: the chat tracks the pointer 1:1 and keeps that size. */
  const startResize = (edge: Edge, e: React.PointerEvent<HTMLElement>): void => {
    const m = motionRef.current
    e.stopPropagation()
    if (e.button !== 0 || !m) return
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    const from = m.current()
    m.to(from, true)
    resizeDrag.current = { pointerId: e.pointerId, edge, start: at(e), from }
    setResizing(edge)
  }

  const moveResize = (e: React.PointerEvent<HTMLElement>): void => {
    const d = resizeDrag.current
    if (!d || d.pointerId !== e.pointerId) return
    const dx = e.clientX - d.start.x
    const dy = e.clientY - d.start.y
    const { from } = d
    let { x, y, width, height } = from
    if (d.edge.includes('e')) width = clamp(from.width + dx, MIN_CHAT.width, size.width - EDGE - x)
    if (d.edge.includes('w')) {
      width = clamp(from.width - dx, MIN_CHAT.width, from.x + from.width - EDGE)
      x = from.x + from.width - width
    }
    if (d.edge.includes('s'))
      height = clamp(from.height + dy, MIN_CHAT.height, size.height - EDGE - y)
    if (d.edge.includes('n')) {
      height = clamp(from.height - dy, MIN_CHAT.height, from.y + from.height - EDGE)
      y = from.y + from.height - height
    }
    motionRef.current?.to({ x, y, width, height }, true)
  }

  const endResize = (e: React.PointerEvent<HTMLElement>): void => {
    e.stopPropagation()
    if (resizeDrag.current?.pointerId !== e.pointerId) return
    resizeDrag.current = null
    setResizing(null)
    const f = motionRef.current?.target()
    if (!f) return
    setChatAt({ x: f.x, y: f.y })
    setCustom({ width: f.width, height: f.height })
  }

  /** Into the owl: the chat shrinks into it, then main hides the overlay and shows the owl. */
  const minimize = (): void => {
    const el = chatRef.current
    if (!hoot || !el || minimized) return
    setMinimized(true)
    for (const a of minimizeAnims.current) a.cancel()
    const anims = shrinkInto(el, init.owlAt ?? { x: size.width - 48, y: size.height - 48 }, still)
    minimizeAnims.current = anims
    void Promise.all(anims.map((a) => a.finished)).then(
      () => hoot.capture.minimize(),
      () => undefined
    )
  }

  const panelHandlers = (
    panel: Panel
  ): Pick<
    React.HTMLAttributes<HTMLElement>,
    'onPointerDown' | 'onPointerMove' | 'onPointerUp' | 'onPointerCancel'
  > => ({
    onPointerDown: (e) => {
      if (live) startPanelDrag(panel, e)
      stop(e)
    },
    onPointerMove: movePanel,
    onPointerUp: (e) => {
      endPanelDrag(e)
      stop(e)
    },
    onPointerCancel: endPanelDrag
  })

  /** Wider / Narrower: the chat springs to the preset (a dragged size gives way to it). */
  const toggleWide = (): void => {
    const next = !wide
    // A dragged chat stays put, pulled back in if the wider box would spill off screen.
    setChatAt((p) => p && clampTo(p, boxFor(next, size), size))
    setCustom(null)
    setWide(next)
  }

  /** The conversation continues in Studio's full chat; the overlay closes. */
  const openInChat = (): void => {
    if (!hoot) return
    void hoot.windows.openStudio('chat').then(cancel, cancel)
  }

  const pinAnswer = (id: string): void => {
    void hoot?.pins.create(id).then(
      () => setPinned(id),
      () => undefined
    )
  }

  const copyAnswer = (id: string, text: string): void => {
    void hoot?.clipboard.writeText(text).then(() => {
      setCopied(id)
      setTimeout(() => setCopied((c) => (c === id ? null : c)), 1500)
    })
  }

  const hint = !live
    ? mode === 'rect'
      ? 'Drag a rectangle'
      : 'Draw around anything'
    : phase === 'chat'
      ? 'Draw again for something new'
      : interact
        ? 'Clicks go to your apps'
        : mode === 'rect'
          ? 'Drag a rectangle'
          : 'Draw around anything'

  return (
    <main
      className="capture hoot-chrome"
      aria-label="Capture the screen"
      data-state="open"
      data-live={live || undefined}
      data-phase={live ? phase : undefined}
      data-drawing={drawing || undefined}
      data-interact={(live && drawingPhase && interact) || undefined}
      data-dragging={dragging ?? undefined}
      data-resizing={resizing ?? undefined}
      data-minimized={minimized || undefined}
      data-full={(live && phase === 'chat' && chatPanel !== null && !shape) || undefined}
      // While drawing, the whole screen is ours; while chatting (or using
      // apps), only the chat and toolbar; while dragging a panel, all of it.
      data-hit={takesPointer || undefined}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
    >
      {!live && <img className="capture__shot" src={init.imageDataUrl} alt="" draggable={false} />}
      {live && <div className="capture__edge-glow" aria-hidden />}
      <canvas ref={canvasRef} className="capture__veil" aria-hidden />
      {(live || drawingPhase) && (
        <div
          ref={toolbarRef}
          className="capture__toolbar"
          role="toolbar"
          aria-label="Capture options"
          data-hit
          data-moved={toolbarAt ? true : undefined}
          style={toolbarAt ? { left: toolbarAt.x, top: toolbarAt.y } : undefined}
          {...panelHandlers('toolbar')}
        >
          {live && (
            <span className="capture__grip" title="Drag to move" aria-hidden>
              <GripIcon />
            </span>
          )}
          <Segmented
            label="Shape"
            hideLabel
            size="sm"
            value={mode}
            options={SHAPES}
            onChange={pickShape}
          />
          <Button size="sm" variant="ghost" icon={<FullScreenIcon />} onClick={fullScreen}>
            Full screen
          </Button>
          {live &&
            (drawingPhase && !interact ? (
              <Button
                size="sm"
                variant="ghost"
                icon={<PointerIcon />}
                title="Let clicks reach your apps (scroll, switch, move windows), then draw again"
                onClick={() => setInteract(true)}
              >
                Use apps
              </Button>
            ) : (
              <Button size="sm" variant="ghost" icon={<DrawIcon />} onClick={drawAgain}>
                Draw
              </Button>
            ))}
          <p className="capture__hint hoot-t-caption" aria-live="polite">
            {hint}
            {!live &&
              init.pendingCount > 0 &&
              ` · capture ${init.pendingCount + 1} of ${MAX_PENDING}`}
            {' · '}
            <Kbd keys="Esc" /> to {live ? 'close' : 'cancel'}
          </p>
          {live && (
            <button
              type="button"
              className="capture__icon capture__icon--bar"
              aria-label="Close"
              title="Close (Esc)"
              onClick={cancel}
            >
              <CloseIcon />
            </button>
          )}
        </div>
      )}
      {chatPanel && (
        // Place and size come from the panel springs (motion.ts), not from React.
        <section
          ref={chatRef}
          className="capture__chat"
          aria-label="Ask Hoot about this"
          data-hit
          data-wide={wide || undefined}
          onPointerDown={stop}
          onPointerUp={stop}
        >
          <header className="capture__chat-head" title="Drag to move" {...panelHandlers('chat')}>
            <span className="capture__chat-title">
              <span className="capture__live-dot" aria-hidden /> Hoot sees your screen
            </span>
            <button
              type="button"
              className="capture__icon"
              aria-label={wide ? 'Narrower chat' : 'Wider chat'}
              aria-pressed={wide}
              title={wide ? 'Narrower' : 'Wider'}
              onClick={toggleWide}
            >
              {wide ? <NarrowerIcon /> : <WiderIcon />}
            </button>
            <button
              type="button"
              className="capture__icon"
              aria-label="Open in Hoot chat"
              title="Open in Hoot chat"
              onClick={openInChat}
            >
              <OpenIcon />
            </button>
            <button
              type="button"
              className="capture__icon"
              aria-label="Redraw"
              title="Redraw"
              onClick={redraw}
            >
              <RedrawIcon />
            </button>
            <button
              type="button"
              className="capture__icon"
              aria-label="Minimize to Hoot"
              title="Minimize to Hoot (open its chat to bring this back)"
              onClick={minimize}
            >
              <MinimizeIcon />
            </button>
            <button
              type="button"
              className="capture__icon"
              aria-label="Close"
              title="Close (Esc)"
              onClick={cancel}
            >
              <CloseIcon />
            </button>
          </header>
          {(question || answer) && (
            <div className="capture__transcript" ref={transcriptRef} aria-live="polite" data-grow>
              <div className="capture__transcript-body" ref={transcriptBodyRef}>
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
                    {answerDone && parsed.text && (
                      <div className="capture__answer-actions" role="group" aria-label="Answer">
                        <button
                          type="button"
                          className="capture__pill capture__pill--quiet"
                          onClick={() => copyAnswer(answer.id, parsed.text)}
                        >
                          <CopyIcon /> {copied === answer.id ? 'Copied' : 'Copy'}
                        </button>
                        <button
                          type="button"
                          className="capture__pill capture__pill--quiet"
                          title="Keep this answer on screen as a sticky note"
                          disabled={pinned === answer.id}
                          onClick={() => pinAnswer(answer.id)}
                        >
                          <PinIcon /> {pinned === answer.id ? 'Pinned' : 'Pin'}
                        </button>
                        <button
                          type="button"
                          className="capture__pill capture__pill--quiet"
                          title="Continue in Hoot’s full chat"
                          onClick={openInChat}
                        >
                          <OpenIcon /> Open in chat
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}
          {pendingActions.map(({ a, key, target: { at: target } }) => {
            const s = actions[key]
            return (
              <div key={key} className="capture__permission" data-state={s ?? 'pending'}>
                {s === undefined && (
                  <>
                    <span className="capture__permission-text">
                      Next: {a.label || 'click the highlighted spot'}
                    </span>
                    <button
                      type="button"
                      className="capture__pill capture__pill--primary"
                      disabled={streaming}
                      title="Move the pointer to the highlighted spot and click it for me"
                      onClick={() => void clickForMe(key, target)}
                    >
                      <PointerIcon /> Click for me
                    </button>
                    <button
                      type="button"
                      className="capture__pill"
                      aria-pressed={autoClick}
                      title="Keep clicking each step automatically until we reach the goal"
                      onClick={() => {
                        const next = !autoClick
                        setAutoClick(next)
                        if (next && !streaming) void clickForMe(key, target)
                      }}
                    >
                      {autoClick ? 'Auto-click: on' : 'Auto-click'}
                    </button>
                    <button
                      type="button"
                      className="capture__pill"
                      disabled={streaming}
                      title="I already clicked it — show the next step"
                      onClick={() => advanceAfterClick(key)}
                    >
                      Next step
                    </button>
                    <button
                      type="button"
                      className="capture__pill"
                      onClick={() => {
                        setAutoClick(false)
                        setActions((m) => ({ ...m, [key]: 'dismissed' }))
                      }}
                    >
                      Dismiss
                    </button>
                  </>
                )}
                {s === 'clicking' && (
                  <span className="capture__permission-text">
                    Clicking {a.label || 'that spot'}… looking for the next step
                  </span>
                )}
                {s === 'done' && (
                  <span className="capture__permission-text">
                    ✓ {a.label || 'Step'} — checking what’s next…
                  </span>
                )}
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
          {EDGES.map((edge) => (
            <span
              key={edge}
              className={`capture__resize capture__resize--${edge}`}
              aria-hidden
              title="Drag to resize (double-click: back to the default size)"
              onPointerDown={(e) => startResize(edge, e)}
              onPointerMove={moveResize}
              onPointerUp={endResize}
              onPointerCancel={endResize}
              onDoubleClick={() => setCustom(null)}
            />
          ))}
        </section>
      )}
    </main>
  )
}
