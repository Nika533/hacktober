import { useEffect, useReducer, useRef, useState } from 'react'
import type { AppState, Point } from '../../../shared/types'
import type { DeltaPayload } from '../../../shared/ipc'

/**
 * Live AppState mirror — one source of truth.
 * `state:changed` replaces the whole state; `ai:delta` appends to the
 * matching message in the current state. Main guarantees a snapshot
 * contains exactly the deltas broadcast before it, so appends never
 * double-count.
 */
type StateAction = { type: 'snapshot'; state: AppState } | { type: 'delta'; d: DeltaPayload }

function stateReducer(prev: AppState | null, action: StateAction): AppState | null {
  if (action.type === 'snapshot') return action.state
  const s = prev
  if (!s?.activeSession || s.activeSession.id !== action.d.sessionId) return s
  if (!s.activeSession.messages.some((m) => m.id === action.d.messageId)) return s
  const messages = s.activeSession.messages.map((m) =>
    m.id === action.d.messageId ? { ...m, text: m.text + action.d.delta } : m
  )
  return { ...s, activeSession: { ...s.activeSession, messages } }
}

export function useAppState(): AppState | null {
  const [state, dispatch] = useReducer(stateReducer, null)
  useEffect(() => {
    let mounted = true
    void window.hoot.getState().then((s) => {
      if (mounted) dispatch({ type: 'snapshot', state: s })
    })
    const offState = window.hoot.onState((s) => dispatch({ type: 'snapshot', state: s }))
    const offDelta = window.hoot.onDelta((d) => dispatch({ type: 'delta', d }))
    return () => {
      mounted = false
      offState()
      offDelta()
    }
  }, [])
  // prefers-color-scheme doesn't track nativeTheme.themeSource, so main
  // broadcasts darkMode and CSS keys off [data-theme] alongside the media query.
  const dark = state?.darkMode
  useEffect(() => {
    if (dark !== undefined) document.documentElement.dataset.theme = dark ? 'dark' : 'light'
  }, [dark])
  return state
}

/** Subscribe to streamed text deltas. */
export function useDelta(cb: (d: DeltaPayload) => void): void {
  const ref = useRef(cb)
  useEffect(() => {
    ref.current = cb
  })
  useEffect(() => window.hoot.onDelta((d) => ref.current(d)), [])
}

/** Cursor offset relative to the owl centre (DIP), pushed ~20 Hz by main. */
export function useCursor(): Point {
  const [offset, setOffset] = useState<Point>({ x: 0, y: 0 })
  useEffect(() => window.hoot.onCursor(setOffset), [])
  return offset
}

/** Sets data-reduced-motion on <html> and keeps it in sync (a11y gate for CSS). */
export function initReducedMotionAttr(): () => void {
  const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
  const apply = (): void => {
    document.documentElement.dataset.reducedMotion = mq.matches ? 'true' : 'false'
  }
  apply()
  mq.addEventListener('change', apply)
  return () => mq.removeEventListener('change', apply)
}

/**
 * Dark-scheme flag driven by `data-theme` (set from AppState.darkMode — media
 * queries don't follow nativeTheme.themeSource), falling back to the OS media
 * query before the first state arrives.
 */
export function usePrefersDark(): boolean {
  const read = (): boolean => {
    const t = document.documentElement.dataset.theme
    return t ? t === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches
  }
  const [dark, setDark] = useState(read)
  useEffect(() => {
    const mo = new MutationObserver(() => setDark(read()))
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const on = (): void => setDark(read())
    mq.addEventListener('change', on)
    return () => {
      mo.disconnect()
      mq.removeEventListener('change', on)
    }
  }, [])
  return dark
}

/**
 * Screen-reader announcements for an aria-live region: "Hoot answered" when a
 * stream completes and "Capture added" when a pending capture lands.
 */
export function useAnnouncements(state: AppState | null): string {
  const [msg, setMsg] = useState('')
  const prev = useRef<{ streaming: boolean; pending: number } | null>(null)
  useEffect(() => {
    if (!state) return
    const p = prev.current
    if (p) {
      if (p.streaming && !state.streaming) setMsg('Hoot answered')
      else if (state.pendingAttachments.length > p.pending) setMsg('Capture added')
    }
    prev.current = { streaming: state.streaming, pending: state.pendingAttachments.length }
  }, [state])
  return msg
}

export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(
    () => window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const on = (): void => setReduced(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  return reduced
}
