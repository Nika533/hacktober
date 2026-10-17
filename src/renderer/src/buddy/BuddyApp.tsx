import { MotionConfig, AnimatePresence } from 'motion/react'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { AppState, BuddyMode } from '../../../shared/types'
import { useAnnouncements, useAppState, useReducedMotion } from '../shared/hooks'
import { Dot } from './Dot'
import { Pill } from './Pill'
import { Card } from './Card'

const RANK: Record<BuddyMode, number> = { hidden: 0, dot: 1, pill: 2, card: 3 }
const DRAG_THRESHOLD = 6
const GREETING_MS = 6000

interface DragState {
  pointerId: number
  startX: number
  startY: number
  active: boolean
  hist: { t: number; x: number; y: number }[]
}

export function BuddyApp(): React.JSX.Element | null {
  const state = useAppState()
  const reduced = useReducedMotion()
  const liveMsg = useAnnouncements(state)

  const [display, setDisplay] = useState<BuddyMode>('hidden')
  const [seed, setSeed] = useState<string | undefined>()
  const displayRef = useRef<BuddyMode>('hidden')
  const dragRef = useRef<DragState | null>(null)
  const rafRef = useRef(0)
  const stateRef = useRef<AppState | null>(null)
  useEffect(() => {
    stateRef.current = state
  })

  // ---- grow/shrink choreography -------------------------------------------
  useEffect(() => {
    if (!state) return
    const next = state.buddyMode
    const cur = displayRef.current
    if (next === cur) return
    if (RANK[next] > RANK[cur]) {
      displayRef.current = next
      setDisplay(next)
    } else {
      // shrink: keep showing `cur`, play its exit, then exitDone
      const t = setTimeout(() => {
        window.hoot.buddy.exitDone()
        displayRef.current = next
        setDisplay(next)
      }, 240)
      return () => clearTimeout(t)
    }
    return undefined
  }, [state])

  // ---- cursor tracking off under reduced motion ---------------------------
  useEffect(() => {
    window.hoot.buddy.setCursorTracking(!reduced)
  }, [reduced])

  // ---- click-through on transparent pixels ---------------------------------
  useEffect(() => {
    let last = true
    const send = (ignore: boolean): void => {
      if (ignore !== last && !dragRef.current?.active) {
        last = ignore
        window.hoot.buddy.setIgnoreMouse(ignore)
      }
    }
    const onMove = (e: MouseEvent): void => {
      const el = e.target as Element | null
      send(!(el && typeof el.closest === 'function' && el.closest('[data-hit]')))
    }
    const onLeave = (): void => send(true)
    window.addEventListener('mousemove', onMove)
    document.documentElement.addEventListener('mouseleave', onLeave)
    return () => {
      window.removeEventListener('mousemove', onMove)
      document.documentElement.removeEventListener('mouseleave', onLeave)
    }
  }, [])

  // ---- owl drag ------------------------------------------------------------
  const onOwlPointerDown = useCallback((e: React.PointerEvent): void => {
    e.currentTarget.setPointerCapture(e.pointerId)
    dragRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      active: false,
      hist: [{ t: performance.now(), x: e.clientX, y: e.clientY }]
    }
  }, [])

  const onOwlPointerMove = useCallback((e: React.PointerEvent): void => {
    const d = dragRef.current
    if (!d) return
    const now = performance.now()
    d.hist.push({ t: now, x: e.clientX, y: e.clientY })
    if (d.hist.length > 12) d.hist.shift()
    if (!d.active) {
      const dist = Math.hypot(e.clientX - d.startX, e.clientY - d.startY)
      if (dist > DRAG_THRESHOLD) {
        d.active = true
        window.hoot.buddy.dragStart()
      }
    }
    if (d.active && !rafRef.current) {
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = 0
        window.hoot.buddy.dragMove()
      })
    }
  }, [])

  const onOwlPointerUp = useCallback((e: React.PointerEvent, click: () => void): void => {
    const d = dragRef.current
    dragRef.current = null
    if (!d) return
    if (d.active) {
      // release velocity from the recent pointer history
      const now = performance.now()
      const recent = d.hist.filter((p) => now - p.t < 90)
      const first = recent[0] ?? d.hist[0]
      const last = d.hist[d.hist.length - 1]
      const dt = Math.max(last.t - first.t, 1) / 1000
      const vx = (last.x - first.x) / dt
      const vy = (last.y - first.y) / dt
      window.hoot.buddy.dragEnd({ vx, vy })
      // let the window go transparent-pixel click-through again
      window.hoot.buddy.setIgnoreMouse(true)
    } else {
      click()
    }
    e.currentTarget.releasePointerCapture?.(e.pointerId)
  }, [])

  // ---- Esc + type-to-ask -----------------------------------------------------
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const s = stateRef.current
      if (!s) return
      if (e.key === 'Escape') {
        if (s.buddyMode === 'card') {
          if (s.streaming) window.hoot.ai.stop()
          else window.hoot.buddy.requestMode('pill')
        } else if (s.buddyMode === 'pill' || s.buddyMode === 'dot') {
          window.hoot.buddy.requestMode('hidden')
        }
        return
      }
      if (e.ctrlKey && !e.altKey && !e.shiftKey) {
        if (e.key === 'l' && s.buddyMode === 'card') window.hoot.windows.unlock()
        else if (e.key === 'n') window.hoot.sessions.new()
        else return
        e.preventDefault()
        return
      }
      // type-to-ask: printable key on a focused pill seeds the composer
      if (
        s.buddyMode === 'pill' &&
        e.key.length === 1 &&
        !e.ctrlKey &&
        !e.metaKey &&
        !e.altKey &&
        document.hasFocus()
      ) {
        setSeed(e.key)
        window.hoot.buddy.requestMode('card')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // ---- greeting auto-dismiss ------------------------------------------------
  useEffect(() => {
    if (!state?.greeting) return
    const t = setTimeout(() => window.hoot.buddy.dismissGreeting(), GREETING_MS)
    const dismissOnInteract = (): void => window.hoot.buddy.dismissGreeting()
    window.addEventListener('pointerdown', dismissOnInteract, { capture: true, once: true })
    return () => {
      clearTimeout(t)
      window.removeEventListener('pointerdown', dismissOnInteract, { capture: true })
    }
  }, [state?.greeting])

  // ---- dot hover → pill (pointerenter is on the owl in Dot) -----------------

  if (!state || display === 'hidden') {
    return null
  }

  // While the shown layout differs from the target mode we are mid-exit.
  // Derived (not stored) so an interrupted shrink can never leave it stuck.
  const exiting = display !== state.buddyMode

  const onGreetingAction = (action: 'continue' | 'clipboard'): void => {
    // 'clipboard' opens the card with the chip pre-selected — never auto-sends.
    if (action === 'clipboard') window.hoot.clipboard.arm()
    window.hoot.buddy.requestMode('card')
  }

  const owlHandlers = { onOwlPointerDown, onOwlPointerMove, onOwlPointerUp }

  return (
    <MotionConfig reducedMotion="user">
      <div className="buddy-root">
        <div className="visually-hidden" aria-live="polite">
          {liveMsg}
        </div>
        <AnimatePresence>
          {display === 'dot' && state.buddyLayout ? (
            <Dot key="dot" state={state} exiting={exiting} {...owlHandlers} />
          ) : null}
          {display === 'pill' && state.buddyLayout ? (
            <Pill
              key="pill"
              state={state}
              exiting={exiting}
              composerFocused={false}
              onGreetingAction={onGreetingAction}
              {...owlHandlers}
            />
          ) : null}
          {display === 'card' && state.buddyLayout ? (
            <Card
              key="card"
              state={state}
              exiting={exiting}
              seed={seed}
              onSeedConsumed={() => setSeed(undefined)}
              {...owlHandlers}
            />
          ) : null}
        </AnimatePresence>
      </div>
    </MotionConfig>
  )
}
