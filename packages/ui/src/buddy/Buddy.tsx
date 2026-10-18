import type { Greeting, ModeLayout, OwlMood, Point, StateSlices } from '@hoot/core'
import { MessageCircle, PencilLine } from 'lucide-react'
import { AnimatePresence, motion, useReducedMotion, type Variants } from 'motion/react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { IconButton } from '../components/IconButton'
import { Owl } from '../components/Owl'
import { crossFade, springs } from '../motion/springs'
import { formatAccelerator } from '../settings/accelerator'
import { BuddyCard } from './BuddyCard'
import { capsuleRect, owlRect } from './geometry'
import type { BuddyHost } from './host'
import { useBuddyTransitions, type BuddyPart } from './useBuddyTransitions'
import { useHitRegions } from './useHitRegions'
import { useOwlDrag } from './useOwlDrag'

export interface BuddyProps {
  host: BuddyHost
  buddy: StateSlices['buddy']
  chat: StateSlices['chat']
  voice?: StateSlices['voice']
  /** The circle-anything accelerator from settings, e.g. 'Control+Alt+Space'. */
  captureHotkey: string
}

/** A greeting stays up this long unless the user acts first. */
export const GREETING_MS = 6000

const fire = (p: Promise<unknown>): void => void p.catch(() => undefined)

/** Enter and exit share one path: out of, and back into, the owl. */
function materialize(scale: number, blur: number): Variants {
  return {
    out: { opacity: 0, scale, filter: `blur(${blur}px)`, transition: springs.sheet },
    rest: { opacity: 1, scale: 1, filter: 'blur(0px)', transition: springs.standard }
  }
}
const OWL_IN = materialize(0.6, 4)
const PILL_IN = materialize(0.5, 6)
const CARD_IN = materialize(0.75, 8)
const GREETING_IN = materialize(0.92, 4)
const FADE: Variants = {
  out: { opacity: 0, transition: crossFade },
  rest: { opacity: 1, transition: crossFade }
}

const OWL_LABEL = { dot: 'Open Hoot', pill: 'Chat with Hoot', card: 'Close chat' } as const

/**
 * The Buddy window: the owl, and the pill or card that grows out of it.
 * Main owns the mode and the window; this animates each `buddy:transition`,
 * acks it, and reports which pixels are clickable.
 */
export function Buddy({ host, buddy, chat, voice, captureHotkey }: BuddyProps): React.JSX.Element {
  const reduced = useReducedMotion() ?? false
  const t = useBuddyTransitions(host.buddy, buddy.mode, buddy.layout)
  const drag = useOwlDrag(host.buddy)
  const { root, remeasure } = useHitRegions(host.buddy, drag.dragging)
  const { settled: settle } = t
  const settled = useCallback(
    (part: BuddyPart, kind: 'enter' | 'exit'): void => {
      settle(part, kind)
      remeasure()
    },
    [settle, remeasure]
  )

  const [gaze, setGaze] = useState<Point>()
  useEffect(() => host.buddy.onCursor(setGaze), [host])
  const tracking = !reduced && t.mode !== 'hidden'
  useEffect(() => host.buddy.setCursorTracking(tracking), [host, tracking])

  const [talk, setTalk] = useState(0)
  useEffect(() => host.chat.onDelta(() => setTalk((n) => n + 1)), [host])

  const [seed, setSeed] = useState({ key: 0, text: '' })
  const [composerFocused, setComposerFocused] = useState(false)
  const [composerEmpty, setComposerEmpty] = useState(true)
  const streaming = chat.stream !== null
  const talking = (voice?.phase ?? 'off') !== 'off'

  // Window keys: Esc steps back, Ctrl+N / Ctrl+L in the card, type-to-ask on the pill.
  const live = useRef({ mode: t.mode, streaming, talking })
  useEffect(() => {
    live.current = { mode: t.mode, streaming, talking }
  })
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const { mode, streaming, talking } = live.current
      if (e.defaultPrevented || mode === 'hidden') return
      // Only keys meant for the Buddy (the gallery shares its document with other demos).
      const focus = document.activeElement
      if (focus && focus !== document.body && !root.current?.contains(focus)) return
      if (e.key === 'Escape') {
        // A voice chat ends first; the answer keeps streaming as text.
        if (mode === 'card' && talking) fire(host.voice.stop())
        else if (mode === 'card' && streaming) fire(host.chat.stop())
        else host.buddy.requestMode(mode === 'card' ? 'pill' : 'hidden')
      } else if (mode === 'card' && e.ctrlKey && !e.altKey && !e.shiftKey && !e.metaKey) {
        const k = e.key.toLowerCase()
        if (k === 'n') fire(host.chat.newChat())
        else if (k === 'l') fire(host.windows.openStudio('chat'))
        else return
      } else if (
        mode === 'pill' &&
        e.key.length === 1 &&
        !e.ctrlKey &&
        !e.altKey &&
        !e.metaKey &&
        !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)
      ) {
        setSeed((s) => ({ key: s.key + 1, text: e.key }))
        host.buddy.requestMode('card')
      } else return
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [host, root])

  // A greeting leaves after a while, or as soon as the user does anything else.
  const greeting = t.surface === 'pill' ? buddy.greeting : null
  useEffect(() => {
    if (!greeting) return
    const dismiss = (): void => fire(host.buddy.dismissGreeting())
    const onDown = (e: PointerEvent): void => {
      if (!(e.target instanceof Element && e.target.closest('.hoot-buddy-greeting'))) dismiss()
    }
    const timer = setTimeout(dismiss, GREETING_MS)
    window.addEventListener('pointerdown', onDown, true)
    return () => {
      clearTimeout(timer)
      window.removeEventListener('pointerdown', onDown, true)
    }
  }, [greeting, host])

  const layout = buddy.layout
  // Positions come from the layout as inline styles, which the observers skip.
  useEffect(remeasure, [layout, remeasure])
  const mood: OwlMood =
    voice?.phase === 'listening'
      ? 'listening'
      : voice?.phase === 'speaking'
        ? 'talking'
        : t.mode === 'card' && composerFocused && composerEmpty && !streaming
          ? 'listening'
          : buddy.mood
  const captureShortcut = formatAccelerator(captureHotkey)
  const ready = buddy.answerReady && t.mode !== 'card'

  const onOwl = (): void => {
    if (drag.consumeDrag()) return
    host.buddy.requestMode(t.mode === 'pill' ? 'card' : 'pill')
  }

  return (
    <div ref={root} className="hoot-buddy" data-mode={t.mode}>
      <div role="status" className="hoot-visually-hidden">
        {greeting ? `${greeting.title}. ${greeting.subtitle}` : ''}
      </div>
      {layout && (
        <>
          <AnimatePresence initial={false} onExitComplete={() => settled('pill', 'exit')}>
            {t.surface === 'pill' && (
              <Layer
                key="pill"
                layout={layout}
                variants={reduced ? FADE : PILL_IN}
                onEntered={() => settled('pill', 'enter')}
              >
                <Pill
                  layout={layout}
                  captureShortcut={captureShortcut}
                  onCapture={() => fire(host.capture.start())}
                  onChat={() => host.buddy.requestMode('card')}
                />
                <AnimatePresence>
                  {greeting && (
                    <GreetingBubble
                      key="greeting"
                      layout={layout}
                      greeting={greeting}
                      variants={reduced ? FADE : GREETING_IN}
                      onPress={() => {
                        if (greeting.action === 'clipboard') fire(host.clipboard.arm())
                        if (greeting.action) host.buddy.requestMode('card')
                        fire(host.buddy.dismissGreeting())
                      }}
                    />
                  )}
                </AnimatePresence>
              </Layer>
            )}
          </AnimatePresence>

          <AnimatePresence initial={false} onExitComplete={() => settled('card', 'exit')}>
            {t.surface === 'card' && (
              <Layer
                key="card"
                layout={layout}
                variants={reduced ? FADE : CARD_IN}
                onEntered={() => settled('card', 'enter')}
              >
                <BuddyCard
                  host={host}
                  layout={layout}
                  chat={chat}
                  voice={voice}
                  greeting={buddy.greeting}
                  captureShortcut={captureShortcut}
                  composerSeed={seed}
                  onComposerFocus={setComposerFocused}
                  onComposerEmpty={setComposerEmpty}
                />
              </Layer>
            )}
          </AnimatePresence>

          <AnimatePresence initial={false} onExitComplete={() => settled('owl', 'exit')}>
            {t.owlVisible && t.mode !== 'hidden' && (
              <motion.button
                key="owl"
                type="button"
                className="hoot-buddy-owl hoot-chrome"
                data-hit
                aria-label={ready ? `${OWL_LABEL[t.mode]}, an answer is ready` : OWL_LABEL[t.mode]}
                style={{ left: owlRect(layout).x, top: owlRect(layout).y }}
                variants={reduced ? FADE : OWL_IN}
                initial="out"
                animate="rest"
                exit="out"
                onAnimationComplete={(d) => d === 'rest' && settled('owl', 'enter')}
                onClick={onOwl}
                onPointerEnter={t.mode === 'dot' ? () => host.buddy.requestMode('pill') : undefined}
                {...drag.handlers}
              >
                <Owl mood={mood} gaze={gaze} talkSignal={mood === 'talking' ? talk : undefined} />
                {ready && <span className="hoot-buddy-owl__badge" aria-hidden />}
              </motion.button>
            )}
          </AnimatePresence>
        </>
      )}
    </div>
  )
}

/** A surface layer that scales out of the owl's centre and back into it. */
function Layer({
  layout,
  variants,
  onEntered,
  children
}: {
  layout: ModeLayout
  variants: Variants
  onEntered: () => void
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <motion.div
      className="hoot-buddy__layer"
      style={{ transformOrigin: `${layout.owl.x}px ${layout.owl.y}px` }}
      variants={variants}
      initial="out"
      animate="rest"
      exit="out"
      onAnimationComplete={(d) => d === 'rest' && onEntered()}
    >
      {children}
    </motion.div>
  )
}

function Pill({
  layout,
  captureShortcut,
  onCapture,
  onChat
}: {
  layout: ModeLayout
  captureShortcut: string
  onCapture: () => void
  onChat: () => void
}): React.JSX.Element {
  const r = capsuleRect(layout)
  return (
    <div
      className="hoot-buddy-pill hoot-material hoot-material--chip hoot-chrome"
      data-hit
      data-owl-side={layout.openX === 'right' ? 'start' : 'end'}
      style={{ left: r.x, top: r.y, width: r.width, height: r.height }}
    >
      <div role="toolbar" aria-label="Hoot" className="hoot-buddy-pill__tools">
        <IconButton label="Circle anything" shortcut={captureShortcut} onClick={onCapture}>
          <PencilLine />
        </IconButton>
        <IconButton label="Chat" onClick={onChat}>
          <MessageCircle />
        </IconButton>
      </div>
    </div>
  )
}

/** Sits on the screen-centre side of the capsule, aligned to the owl's end. */
function GreetingBubble({
  layout,
  greeting,
  variants,
  onPress
}: {
  layout: ModeLayout
  greeting: Greeting
  variants: Variants
  onPress: () => void
}): React.JSX.Element {
  const r = capsuleRect(layout)
  const above = layout.openY === 'up'
  const fromStart = layout.openX === 'right'
  const style: React.CSSProperties = {
    ...(above ? { bottom: `calc(100% - ${r.y - 8}px)` } : { top: r.y + r.height + 8 }),
    ...(fromStart ? { left: r.x } : { right: `calc(100% - ${r.x + r.width}px)` }),
    transformOrigin: `${fromStart ? '28px' : 'calc(100% - 28px)'} ${above ? '100%' : '0%'}`
  }
  return (
    <motion.button
      type="button"
      className="hoot-buddy-greeting hoot-material hoot-chrome"
      data-hit
      data-tail={`${above ? 'bottom' : 'top'}-${fromStart ? 'start' : 'end'}`}
      style={style}
      variants={variants}
      initial="out"
      animate="rest"
      exit="out"
      onClick={onPress}
    >
      <span className="hoot-buddy-greeting__title">{greeting.title}</span>
      <span className="hoot-buddy-greeting__subtitle">{greeting.subtitle}</span>
    </motion.button>
  )
}
