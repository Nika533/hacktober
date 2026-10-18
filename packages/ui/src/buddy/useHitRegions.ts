import type { HootApi, Rect } from '@hoot/core'
import { useCallback, useEffect, useRef, type RefObject } from 'react'
import { measureHitRegions, sameRects } from './geometry'

type Host = Pick<HootApi['buddy'], 'setHitRegions' | 'setIgnoreMouse'>

/**
 * Keeps main told which parts of the transparent window are clickable: the
 * `[data-hit]` rects (main polls the cursor against them), plus the
 * mousemove fast path for a physical mouse. Attach `root` to the element that
 * fills the window; call `remeasure` once an animation settles (running
 * transforms aren't tracked).
 */
export function useHitRegions(
  host: Host,
  dragging: RefObject<boolean>
): { root: RefObject<HTMLDivElement | null>; remeasure: () => void } {
  const root = useRef<HTMLDivElement>(null)
  const last = useRef<Rect[] | null>(null)
  const frame = useRef(0)

  const remeasure = useCallback((): void => {
    if (frame.current) return
    frame.current = requestAnimationFrame(() => {
      frame.current = 0
      const el = root.current
      if (!el) return
      const rects = measureHitRegions(el)
      if (last.current && sameRects(last.current, rects)) return
      last.current = rects
      host.setHitRegions(rects)
    })
  }, [host])

  useEffect(() => {
    const el = root.current
    if (!el) return
    remeasure()
    // Structure changes (a surface mounts or leaves) and size changes; not
    // per-frame style writes from running animations.
    const mo = new MutationObserver(remeasure)
    mo.observe(el, { childList: true, subtree: true, attributeFilter: ['data-hit'] })
    const ro = new ResizeObserver(remeasure)
    ro.observe(el)
    window.addEventListener('resize', remeasure)
    return () => {
      mo.disconnect()
      ro.disconnect()
      window.removeEventListener('resize', remeasure)
      cancelAnimationFrame(frame.current)
      frame.current = 0
    }
  }, [remeasure])

  useEffect(() => {
    let ignoring: boolean | null = null
    const send = (ignore: boolean): void => {
      if (ignore === ignoring || dragging.current) return
      ignoring = ignore
      host.setIgnoreMouse(ignore)
    }
    const onMove = (e: MouseEvent): void => {
      const t = e.target
      send(!(t instanceof Element && t.closest('[data-hit]')))
    }
    const onLeave = (): void => send(true)
    window.addEventListener('mousemove', onMove)
    document.documentElement.addEventListener('mouseleave', onLeave)
    return () => {
      window.removeEventListener('mousemove', onMove)
      document.documentElement.removeEventListener('mouseleave', onLeave)
    }
  }, [host, dragging])

  return { root, remeasure }
}
