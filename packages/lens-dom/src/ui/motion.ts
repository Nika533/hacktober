import { prefersReducedMotion } from '../dom'

export function criticallyDamped(steps = 24, settle = 7.4): string {
  const end = 1 - (1 + settle) * Math.exp(-settle)
  const points = Array.from({ length: steps + 1 }, (_, index) => {
    const u = index / steps
    return ((1 - (1 + settle * u) * Math.exp(-settle * u)) / end).toFixed(4)
  })
  return `linear(${points.join(', ')})`
}

export const SPRING_EASE = criticallyDamped()
export const FALLBACK_EASE = 'cubic-bezier(0.2, 0, 0, 1)'

export const DURATION = {
  swapHalf: 90,
  reducedFade: 120,
  popover: 220,
  pill: 240,
  chip: 180
} as const

export function easing(doc: Document): string {
  const css = (doc.defaultView as (Window & typeof globalThis) | null)?.CSS
  try {
    return css?.supports?.('transition-timing-function', 'linear(0, 1)')
      ? SPRING_EASE
      : FALLBACK_EASE
  } catch {
    return FALLBACK_EASE
  }
}

export function play(
  element: Element,
  keyframes: Keyframe[],
  options: KeyframeAnimationOptions
): Animation | null {
  if (typeof (element as HTMLElement).animate !== 'function') return null
  try {
    return element.animate(keyframes, options)
  } catch {
    return null
  }
}

export function settled(animation: Animation | null): Promise<void> {
  return animation
    ? animation.finished.then(
        () => undefined,
        () => undefined
      )
    : Promise.resolve()
}

export function materialize(reduced: boolean): Keyframe[] {
  return reduced
    ? [{ opacity: 0 }, { opacity: 1 }]
    : [
        { opacity: 0, filter: 'blur(2px)' },
        { opacity: 1, filter: 'blur(0px)' }
      ]
}

export function dematerialize(reduced: boolean): Keyframe[] {
  return [...materialize(reduced)].reverse()
}

export interface MotionContext {
  document: Document
  animate: boolean
}

export function reduced(context: MotionContext): boolean {
  return prefersReducedMotion(context.document)
}

export class Presence {
  readonly #element: HTMLElement
  readonly #context: MotionContext
  readonly #frames: (reduced: boolean) => Keyframe[]
  readonly #duration: number
  #animation: Animation | null = null
  #visible = false

  constructor(
    element: HTMLElement,
    context: MotionContext,
    frames: (reduced: boolean) => Keyframe[],
    duration: number
  ) {
    this.#element = element
    this.#context = context
    this.#frames = frames
    this.#duration = duration
  }

  get visible(): boolean {
    return this.#visible
  }

  show(): void {
    const wasVisible = this.#visible
    this.#visible = true
    this.#element.hidden = false
    const current = this.#animation
    if (current && current.playbackRate < 0 && current.playState === 'running') {
      current.reverse()
      return
    }
    if (wasVisible) return
    current?.cancel()
    this.#animation = null
    if (!this.#context.animate) return
    const isReduced = reduced(this.#context)
    this.#animation = play(this.#element, this.#frames(isReduced), {
      duration: isReduced ? DURATION.reducedFade : this.#duration,
      easing: easing(this.#context.document),
      fill: 'both'
    })
  }

  hide(): Promise<void> {
    if (!this.#visible) return Promise.resolve()
    this.#visible = false
    const animation = this.#animation
    if (!animation) {
      this.#element.hidden = true
      return Promise.resolve()
    }
    animation.reverse()
    return settled(animation).then(() => {
      if (this.#visible || this.#animation !== animation) return
      this.#element.hidden = true
      animation.cancel()
      this.#animation = null
    })
  }

  hideNow(): void {
    this.#visible = false
    this.#animation?.cancel()
    this.#animation = null
    this.#element.hidden = true
  }
}
