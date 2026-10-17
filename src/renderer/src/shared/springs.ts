import type { Transition } from 'motion/react'

/** Critically damped default — the house style for anything a user can touch. */
export const springGentle: Transition = { type: 'spring', bounce: 0, duration: 0.35 }

/** Content materialising from the owl (grow transitions). */
export const springMaterialize: Transition = { type: 'spring', bounce: 0, duration: 0.35 }

/** Small press feedback. */
export const springPress: Transition = { type: 'spring', bounce: 0, duration: 0.15 }

/** Only for momentum-driven motion (drag release, celebrate). */
export const springMomentum: Transition = { type: 'spring', bounce: 0.3, duration: 0.5 }

/** Pupil tracking — snappy, never bouncy. */
export const springPupil: Transition = { type: 'spring', bounce: 0, duration: 0.25 }

export const EXIT_MS = 260
