import type { LensSettingsPatch, ProfilePatch, ReaderProfile } from '@hoot/core'

export interface ColdStartSetup {
  /** Topic keys (lowercase, as the profile stores them). */
  topics: string[]
  style: ReaderProfile['style']
}

/** Familiarity given to a topic the reader says they know well. */
export const KNOWN_TOPIC_FAMILIARITY = 0.85

export const COLD_START_TOPICS = [
  { key: 'software', label: 'Software' },
  { key: 'science', label: 'Science' },
  { key: 'math', label: 'Math' },
  { key: 'engineering', label: 'Engineering' },
  { key: 'medicine', label: 'Medicine' },
  { key: 'law', label: 'Law' },
  { key: 'finance', label: 'Finance' },
  { key: 'business', label: 'Business' },
  { key: 'design', label: 'Design' },
  { key: 'history', label: 'History' },
  { key: 'cooking', label: 'Cooking' },
  { key: 'sports', label: 'Sports' }
] as const

/** The two calls that apply a finished setup: the profile edit, then the settings flag. */
export function coldStartPatches(setup: ColdStartSetup): {
  profile: ProfilePatch
  settings: LensSettingsPatch
} {
  return {
    profile: {
      topics: Object.fromEntries(setup.topics.map((t) => [t, KNOWN_TOPIC_FAMILIARITY])),
      style: setup.style
    },
    settings: { coldStartDone: true }
  }
}
