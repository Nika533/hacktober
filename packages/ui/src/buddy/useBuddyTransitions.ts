import type { BuddyMode, BuddyTransition, HootApi, ModeLayout } from '@hoot/core'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { isGrow, layoutFits } from './geometry'

/** The animated pieces: the owl alone is the dot; pill and card are surfaces around it. */
export type BuddyPart = 'owl' | 'pill' | 'card'

const partOf = (mode: BuddyMode): BuddyPart | null =>
  mode === 'hidden' ? null : mode === 'dot' ? 'owl' : mode

/** Ack anyway if an animation never reports back (occluded window, no frames). */
export const ACK_FALLBACK_MS = 900
/** Mount a mode's surface even if main's layout for it hasn't arrived by then. */
export const LAYOUT_WAIT_MS = 250
/** Follow the slice's mode when no transition explains a change. */
export const RECONCILE_MS = 400

interface Pending {
  id: number
  part: BuddyPart | null
  kind: 'enter' | 'exit'
}

interface Target {
  mode: BuddyMode
  /** The owl itself is appearing, so it waits for its layout too. */
  waking: boolean
}

export interface BuddyTransitions {
  /** Where the renderer is heading: main's latest transition target. */
  mode: BuddyMode
  /** The surface to mount: the target's, once its layout has arrived (or waiting gave up). */
  surface: 'pill' | 'card' | null
  /** The owl is on screen (or arriving). */
  owlVisible: boolean
  /** An element finished its enter or exit; acks the transition waiting for it. */
  settled: (part: BuddyPart, kind: 'enter' | 'exit') => void
}

type Driver = Pick<HootApi['buddy'], 'onTransition' | 'transitionDone'>

/**
 * Main decides, the renderer animates, then acks: one source of timing.
 * Growing transitions wait for the new part's enter; shrinking ones for the
 * old part's exit, so main resizes the window only after it. A newer
 * transition supersedes an unfinished one (only the latest id is acked), and
 * every animation starts from the current on-screen values.
 */
export function useBuddyTransitions(
  driver: Driver,
  sliceMode: BuddyMode,
  layout: ModeLayout | null
): BuddyTransitions {
  const [target, setTarget] = useState<Target>({ mode: sliceMode, waking: false })
  const targetRef = useRef(target)
  const pending = useRef<Pending | null>(null)
  const fallback = useRef<ReturnType<typeof setTimeout>>(undefined)

  const go = useCallback((next: Target): void => {
    targetRef.current = next
    setTarget(next)
  }, [])

  const ack = useCallback(
    (id: number): void => {
      if (pending.current?.id !== id) return
      pending.current = null
      clearTimeout(fallback.current)
      driver.transitionDone(id)
    },
    [driver]
  )

  // Surfaces in the DOM, entering, resting or still exiting.
  const present = useRef(new Set<BuddyPart>())

  useEffect(() => {
    const off = driver.onTransition((t: BuddyTransition) => {
      const cur = targetRef.current.mode
      clearTimeout(fallback.current)
      let part: BuddyPart | null
      let kind: Pending['kind']
      if (t.to === cur) {
        // Already there, or already heading there: adopt the newer id.
        if (!pending.current) {
          driver.transitionDone(t.id)
          return
        }
        ;({ part, kind } = pending.current)
      } else if (isGrow(cur, t.to)) {
        part = partOf(t.to)
        kind = 'enter'
      } else {
        // Wait for whatever is really on screen to leave (an interrupted exit included).
        const p = present.current
        part = p.has('card') ? 'card' : p.has('pill') ? 'pill' : t.to === 'hidden' ? 'owl' : null
        kind = 'exit'
      }
      if (t.to !== cur) go({ mode: t.to, waking: cur === 'hidden' })
      if (!part) {
        pending.current = null
        driver.transitionDone(t.id)
        return
      }
      pending.current = { id: t.id, part, kind }
      fallback.current = setTimeout(() => ack(t.id), ACK_FALLBACK_MS)
    })
    return () => {
      off()
      clearTimeout(fallback.current)
    }
  }, [driver, ack, go])

  // The slice's mode changed and no transition followed (a restarted main, a
  // dropped event): follow it. Only a change counts, so a slow patch after an
  // ack never pulls the renderer back to the old mode.
  useEffect(() => {
    const t = setTimeout(() => {
      const cur = targetRef.current.mode
      if (!pending.current && cur !== sliceMode) go({ mode: sliceMode, waking: cur === 'hidden' })
    }, RECONCILE_MS)
    return () => clearTimeout(t)
  }, [sliceMode, go])

  const fits = layoutFits(target.mode, layout)
  const [lateFor, setLateFor] = useState<Target | null>(null)
  useEffect(() => {
    if (fits) return
    const t = setTimeout(() => setLateFor(target), LAYOUT_WAIT_MS)
    return () => clearTimeout(t)
  }, [fits, target])
  const ready = layout !== null && (fits || lateFor === target)
  const surface = (target.mode === 'pill' || target.mode === 'card') && ready ? target.mode : null
  useLayoutEffect(() => {
    if (surface) present.current.add(surface)
  }, [surface])

  const settled = useCallback(
    (part: BuddyPart, kind: 'enter' | 'exit'): void => {
      if (kind === 'exit') present.current.delete(part)
      const p = pending.current
      if (p && p.part === part && p.kind === kind) ack(p.id)
    },
    [ack]
  )

  return {
    mode: target.mode,
    surface,
    owlVisible: target.mode !== 'hidden' && layout !== null && (!target.waking || ready),
    settled
  }
}
