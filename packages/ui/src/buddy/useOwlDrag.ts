import type { HootApi } from '@hoot/core'
import { useCallback, useMemo, useRef } from 'react'

type Host = Pick<HootApi['buddy'], 'dragStart' | 'dragMove' | 'dragEnd' | 'setIgnoreMouse'>

/** Movement before a press becomes a drag (hysteresis, so taps stay taps). */
export const DRAG_THRESHOLD = 6
/** Release velocity comes from the pointer's last ~90 ms. */
const VELOCITY_WINDOW_MS = 90

interface Track {
  pointerId: number
  x: number
  y: number
  active: boolean
  hist: { t: number; x: number; y: number }[]
}

export interface OwlDrag {
  dragging: React.RefObject<boolean>
  handlers: {
    onPointerDown: (e: React.PointerEvent<HTMLElement>) => void
    onPointerMove: (e: React.PointerEvent<HTMLElement>) => void
    onPointerUp: (e: React.PointerEvent<HTMLElement>) => void
    onPointerCancel: (e: React.PointerEvent<HTMLElement>) => void
  }
  /** True once per drag: the click that ends a drag must not also activate. */
  consumeDrag: () => boolean
}

/**
 * The owl is the drag handle. Main moves the window 1:1 with the cursor
 * (renderer coordinates move with it, so only the gesture is reported), and
 * the release velocity drives main's flick and snap.
 */
export function useOwlDrag(host: Host): OwlDrag {
  const track = useRef<Track | null>(null)
  const dragging = useRef(false)
  const dragged = useRef(false)
  const raf = useRef(0)

  const end = useCallback(
    (e: React.PointerEvent<HTMLElement>, cancelled: boolean): void => {
      const d = track.current
      track.current = null
      if (!d || d.pointerId !== e.pointerId) return
      if (e.currentTarget.hasPointerCapture?.(e.pointerId))
        e.currentTarget.releasePointerCapture(e.pointerId)
      if (!d.active) return
      cancelAnimationFrame(raf.current)
      raf.current = 0
      const now = performance.now()
      const recent = d.hist.filter((p) => now - p.t <= VELOCITY_WINDOW_MS)
      const first = recent[0] ?? d.hist[0]
      const last = d.hist[d.hist.length - 1]
      const dt = first && last ? Math.max(last.t - first.t, 1) / 1000 : 1
      const v =
        cancelled || !first || !last
          ? { vx: 0, vy: 0 }
          : { vx: (last.x - first.x) / dt, vy: (last.y - first.y) / dt }
      dragging.current = false
      host.dragEnd(v)
    },
    [host]
  )

  const handlers = useMemo<OwlDrag['handlers']>(
    () => ({
      onPointerDown: (e) => {
        if (e.button !== 0) return
        e.currentTarget.setPointerCapture?.(e.pointerId)
        dragged.current = false
        track.current = {
          pointerId: e.pointerId,
          x: e.screenX,
          y: e.screenY,
          active: false,
          hist: [{ t: performance.now(), x: e.screenX, y: e.screenY }]
        }
      },
      onPointerMove: (e) => {
        const d = track.current
        if (!d || d.pointerId !== e.pointerId) return
        // Screen coordinates: the window itself moves under a drag.
        d.hist.push({ t: performance.now(), x: e.screenX, y: e.screenY })
        if (d.hist.length > 12) d.hist.shift()
        if (!d.active && Math.hypot(e.screenX - d.x, e.screenY - d.y) > DRAG_THRESHOLD) {
          d.active = true
          dragging.current = true
          dragged.current = true
          host.setIgnoreMouse(false)
          host.dragStart()
        }
        if (d.active && !raf.current) {
          raf.current = requestAnimationFrame(() => {
            raf.current = 0
            host.dragMove()
          })
        }
      },
      onPointerUp: (e) => end(e, false),
      onPointerCancel: (e) => end(e, true)
    }),
    [host, end]
  )

  const consumeDrag = useCallback((): boolean => {
    const was = dragged.current
    dragged.current = false
    return was
  }, [])

  return { dragging, handlers, consumeDrag }
}
