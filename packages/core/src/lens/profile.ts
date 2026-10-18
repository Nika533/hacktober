import type { ProfilePatch, ProfileSnapshot, ReaderProfile } from '../types/lens'

/** θu with the 30-second setup done (hoot-lens.md §6.2). */
export const DEFAULT_THRESHOLD = 0.75
/** θu without setup: more conservative (§8.4). */
export const COLD_START_THRESHOLD = 0.8
/** Triggers that stay Ask-first before Auto may act (§8.4). */
export const COLD_START_ASK_FIRST = 10
export const THRESHOLD_MIN = 0.55
export const THRESHOLD_MAX = 0.95

/** Known terms sent to in-page code (s7); the rest stay in the app. */
export const SNAPSHOT_MAX_KNOWN_TERMS = 500

export function createDefaultProfile(opts: { coldStart: boolean }): ReaderProfile {
  return {
    version: 1,
    readingLevel: { estimate: 10, confidence: 0 },
    readingPaceWpm: 230,
    terms: {},
    topics: {},
    style: { length: 'same', analogies: false, plainWords: true },
    threshold: opts.coldStart ? COLD_START_THRESHOLD : DEFAULT_THRESHOLD,
    askFirstRemaining: opts.coldStart ? COLD_START_ASK_FIRST : 0,
    perSite: {}
  }
}

export function profileSnapshot(profile: ReaderProfile): ProfileSnapshot {
  const knownTerms = Object.entries(profile.terms)
    .filter(([, t]) => t.state === 'known')
    .sort((a, b) => b[1].updatedAt - a[1].updatedAt)
    .slice(0, SNAPSHOT_MAX_KNOWN_TERMS)
    .map(([term]) => term)
  return {
    version: profile.version,
    threshold: profile.threshold,
    askFirstRemaining: profile.askFirstRemaining,
    knownTerms,
    perSite: profile.perSite
  }
}

/** Terms and topics are keyed case-insensitively. */
export const profileKey = (term: string): string => term.trim().toLowerCase()

/**
 * Apply an edit from "What Hoot knows about me". Returns a new profile with
 * `version` bumped (which also invalidates cached rewrites).
 */
export function applyProfilePatch(
  profile: ReaderProfile,
  patch: ProfilePatch,
  now: number
): ReaderProfile {
  const next: ReaderProfile = {
    ...profile,
    terms: { ...profile.terms },
    topics: { ...profile.topics },
    style: { ...profile.style, ...stripUndefined(patch.style ?? {}) },
    version: profile.version + 1
  }
  for (const [raw, state] of Object.entries(patch.terms ?? {})) {
    const key = profileKey(raw)
    if (!key) continue
    if (state === null) delete next.terms[key]
    else next.terms[key] = { state, seen: next.terms[key]?.seen ?? 0, updatedAt: now }
  }
  for (const [raw, familiarity] of Object.entries(patch.topics ?? {})) {
    const key = profileKey(raw)
    if (!key) continue
    if (familiarity === null) delete next.topics[key]
    else next.topics[key] = { familiarity, depth: next.topics[key]?.depth ?? 0, updatedAt: now }
  }
  return next
}

function stripUndefined<T extends object>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>
}
