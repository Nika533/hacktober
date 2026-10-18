import type { Point } from '@hoot/core'

/**
 * Apple's default spring: critically damped (no overshoot), ~0.35 s response
 * (springs.standard in @hoot/ui, which is motion's preset of the same spring).
 */
export const RESPONSE_S = 0.35

const KEYS = ['x', 'y', 'width', 'height'] as const
type Key = (typeof KEYS)[number]
/** The chat panel's place and size, in overlay DIP. */
export type Frame = Record<Key, number>

interface Axis {
  value: number
  velocity: number
  target: number
}

/**
 * One step of a critically damped spring, solved exactly (stable for any
 * frame time): d(t) = (d0 + (v0 + ω·d0)·t)·e^(−ωt). True once it has settled.
 */
export function stepSpring(a: Axis, dt: number, response = RESPONSE_S): boolean {
  const w = (2 * Math.PI) / response
  const d0 = a.value - a.target
  const b = a.velocity + w * d0
  const decay = Math.exp(-w * dt)
  const d = (d0 + b * dt) * decay
  a.velocity = (a.velocity - w * b * dt) * decay
  a.value = a.target + d
  if (Math.abs(d) < 0.2 && Math.abs(a.velocity) < 2) {
    a.value = a.target
    a.velocity = 0
    return true
  }
  return false
}

export interface PanelMotion {
  /** Spring towards `target`; `immediate` jumps (a gesture tracking 1:1, reduced motion). */
  to(target: Partial<Frame>, immediate?: boolean): void
  /** Where the panel is on screen right now (the presentation value). */
  current(): Frame
  /** Where it's heading. */
  target(): Frame
  dispose(): void
}

/**
 * Springs the chat panel's place and size: one spring per axis, so a new
 * target mid-flight keeps the current value and velocity (no jumps, no
 * brick walls). Writes left/top/width/height straight to the element, so
 * nothing re-renders per frame.
 */
export function createPanelMotion(
  el: HTMLElement,
  initial: Frame,
  still: () => boolean
): PanelMotion {
  const axes = Object.fromEntries(
    KEYS.map((k) => [k, { value: initial[k], velocity: 0, target: initial[k] }])
  ) as Record<Key, Axis>
  let raf = 0
  let last = 0

  const write = (): void => {
    el.style.left = `${axes.x.value}px`
    el.style.top = `${axes.y.value}px`
    el.style.width = `${axes.width.value}px`
    el.style.height = `${axes.height.value}px`
  }

  const tick = (t: number): void => {
    // A dropped frame (or a hidden window) never turns into a jump.
    const dt = Math.min(0.05, Math.max(0, (t - last) / 1000))
    last = t
    let done = true
    for (const k of KEYS) done = stepSpring(axes[k], dt) && done
    write()
    raf = done ? 0 : requestAnimationFrame(tick)
  }

  write()
  return {
    to(target, immediate = false) {
      const jump = immediate || still()
      let moved = false
      for (const k of KEYS) {
        const v = target[k]
        if (v === undefined || !Number.isFinite(v)) continue
        const a = axes[k]
        if (jump) {
          a.value = v
          a.velocity = 0
        }
        if (a.target !== v || a.value !== v) moved = true
        a.target = v
      }
      if (jump) {
        write()
        return
      }
      if (moved && raf === 0) {
        last = performance.now()
        raf = requestAnimationFrame(tick)
      }
    },
    current: () => Object.fromEntries(KEYS.map((k) => [k, axes[k].value])) as Frame,
    target: () => Object.fromEntries(KEYS.map((k) => [k, axes[k].target])) as Frame,
    dispose() {
      if (raf !== 0) cancelAnimationFrame(raf)
      raf = 0
    }
  }
}

/**
 * The same critically damped spring as a CSS `linear()` easing, for one-shot
 * Web Animations (the chat shrinking into the owl and coming back out).
 */
export function springEasing(durationMs: number, response = RESPONSE_S, samples = 32): string {
  const w = (2 * Math.PI) / response
  const points: string[] = []
  for (let i = 0; i <= samples; i++) {
    const t = ((i / samples) * durationMs) / 1000
    const p = i === samples ? 1 : 1 - (1 + w * t) * Math.exp(-w * t)
    points.push(p.toFixed(4))
  }
  return `linear(${points.join(', ')})`
}

/**
 * Scale around the owl's spot. Layout offsets ignore transforms, so this is
 * right even while the panel is still scaled down (the overlay's root is the
 * whole display, so offsets are overlay DIP).
 */
function aimAt(el: HTMLElement, owl: Point): void {
  el.style.transformOrigin = `${owl.x - el.offsetLeft}px ${owl.y - el.offsetTop}px`
}

/** How long the chat takes to shrink into the owl (or grow back out). */
export const MINIMIZE_MS = 460
const MINIMIZED_SCALE = 0.05

/**
 * The chat shrinks into the owl: it scales down around the owl's spot, so it
 * travels there as it shrinks, and fades on the way in. `fill: forwards`
 * keeps it there (invisible) while the window is hidden. Reduced motion: a
 * plain fade.
 */
export function shrinkInto(el: HTMLElement, owl: Point, still: boolean): Animation[] {
  aimAt(el, owl)
  if (still) {
    return [el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 160, fill: 'forwards' })]
  }
  return [
    el.animate([{ transform: 'scale(1)' }, { transform: `scale(${MINIMIZED_SCALE})` }], {
      duration: MINIMIZE_MS,
      easing: springEasing(MINIMIZE_MS, 0.32),
      fill: 'forwards'
    }),
    // Mostly at the end, once it's small: it's seen going into the owl.
    el.animate([{ opacity: 1 }, { opacity: 1, offset: 0.35 }, { opacity: 0 }], {
      duration: MINIMIZE_MS * 0.8,
      easing: 'cubic-bezier(0.4, 0, 1, 1)',
      fill: 'forwards'
    })
  ]
}

/** The way back: out of the owl along the same path (spatial consistency). */
export function growFrom(el: HTMLElement, owl: Point, still: boolean): Animation[] {
  aimAt(el, owl)
  if (still) return [el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 160 })]
  return [
    el.animate([{ transform: `scale(${MINIMIZED_SCALE})` }, { transform: 'scale(1)' }], {
      duration: MINIMIZE_MS,
      easing: springEasing(MINIMIZE_MS, 0.32)
    }),
    el.animate([{ opacity: 0 }, { opacity: 1, offset: 0.45 }, { opacity: 1 }], {
      duration: MINIMIZE_MS,
      easing: 'cubic-bezier(0, 0, 0.2, 1)'
    })
  ]
}
