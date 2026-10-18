import type { OwlMood } from '@hoot/core'

export type { OwlMood }

/** Every mood, in display order. `satisfies` keeps it in step with core's union. */
export const OWL_MOODS = [
  'idle',
  'listening',
  'thinking',
  'talking',
  'celebrate',
  'error'
] as const satisfies readonly OwlMood[]

// Compile-time check that OWL_MOODS lists every mood core defines.
const _all: Exclude<OwlMood, (typeof OWL_MOODS)[number]> extends never ? true : never = true
void _all
