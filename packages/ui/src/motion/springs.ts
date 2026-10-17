import type { Transition } from 'motion/react'

/**
 * Spring presets (motion's bounce + duration ≈ Apple's damping + response).
 * Critically damped by default; bounce only after a gesture that carried
 * momentum. CSS transitions use the matching --ease-spring / --dur-* tokens.
 */
export const springs = {
  /** Default for anything that moves: repositioning, materialising, layout. */
  standard: { type: 'spring', bounce: 0, duration: 0.35 },
  /** Sheets and drawers. */
  sheet: { type: 'spring', bounce: 0, duration: 0.3 },
  /** Press feedback and small state changes (thumbs, indicators). */
  press: { type: 'spring', bounce: 0, duration: 0.15 },
  /** Eye tracking: snappy, never bouncy. */
  pupil: { type: 'spring', bounce: 0, duration: 0.25 },
  /** Only after a flick or drag release (damping ≈ 0.8). */
  momentum: { type: 'spring', bounce: 0.2, duration: 0.4 }
} as const satisfies Record<string, Transition>

/** The reduced-motion replacement for any of the above. */
export const crossFade = { duration: 0.12, ease: 'linear' } as const satisfies Transition
