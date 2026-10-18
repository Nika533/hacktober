import type { LensEvent, ReaderProfile, TermState } from '../types/lens'
import { profileKey, THRESHOLD_MAX, THRESHOLD_MIN } from './profile'
import { adaptThreshold } from './score'

/**
 * Reader-profile update rules (hoot-lens.md §8.3), applied by the app when
 * lens-dom reports feedback. Pure: (profile, event) → profile.
 *
 * `version` is bumped only when a term becomes known or stops being known.
 * That's what alters what Lens should rewrite, and the version is part of
 * the rewrite cache key. Threshold and
 * familiarity nudges don't bump it, so caches survive ordinary use; they are
 * still pushed to the extension in the snapshot.
 */

export const TERM_REVERTS_TO_KNOWN = 2
export const TOPIC_DECAY_AFTER_MS = 60 * 24 * 60 * 60 * 1000
/** Fraction of the distance to 0.5 that decays per 30 days past the window. */
export const TOPIC_DECAY_RATE = 0.25

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v))

export interface LearningContext {
  /** ms between the change appearing (its `shown` event) and this event, if known */
  msSinceShown: number | null
  now: number
}

function setTerm(
  profile: ReaderProfile,
  rawTerm: string | null,
  update: (prev: ReaderProfile['terms'][string] | undefined) => {
    state: TermState
    seen: number
  } | null,
  now: number
): boolean {
  if (!rawTerm) return false
  const key = profileKey(rawTerm)
  if (!key) return false
  const prev = profile.terms[key]
  const next = update(prev)
  if (!next) return false
  profile.terms[key] = { ...next, updatedAt: now }
  // Only known ⇄ not-known changes what Lens rewrites (s7, "Already knows").
  return (prev?.state === 'known') !== (next.state === 'known')
}

function nudgeTopic(
  profile: ReaderProfile,
  rawTopic: string | null,
  delta: number,
  depth: number,
  now: number
): void {
  if (!rawTopic) return
  const key = profileKey(rawTopic)
  if (!key) return
  const prev = profile.topics[key] ?? { familiarity: 0.5, depth: 0, updatedAt: now }
  profile.topics[key] = {
    familiarity: clamp01(prev.familiarity + delta),
    depth: prev.depth + depth,
    updatedAt: now
  }
}

export function applyLensEvent(
  current: ReaderProfile,
  event: LensEvent,
  ctx: LearningContext
): ReaderProfile {
  const profile: ReaderProfile = {
    ...current,
    terms: { ...current.terms },
    topics: { ...current.topics },
    perSite: { ...current.perSite }
  }
  const { now } = ctx
  let termChanged = false

  switch (event.kind) {
    case 'shown':
      // Cold start: the first triggers stay Ask-first (§8.4).
      if (profile.askFirstRemaining > 0) profile.askFirstRemaining--
      break
    case 'knew_it':
      termChanged = setTerm(
        profile,
        event.term,
        (p) => ({ state: 'known', seen: (p?.seen ?? 0) + 1 }),
        now
      )
      nudgeTopic(profile, event.topic, +0.05, 0, now)
      break
    case 'reverted': {
      const fast = ctx.msSinceShown !== null && ctx.msSinceShown <= 5000
      if (fast) {
        termChanged = setTerm(
          profile,
          event.term,
          (p) => {
            const seen = (p?.seen ?? 0) + 1
            const state: TermState =
              seen >= TERM_REVERTS_TO_KNOWN ? 'known' : (p?.state ?? 'learning')
            return { state, seen }
          },
          now
        )
      }
      break
    }
    case 'kept':
      termChanged = setTerm(
        profile,
        event.term,
        (p) => (p?.state === 'known' ? null : { state: 'learning', seen: (p?.seen ?? 0) + 1 }),
        now
      )
      nudgeTopic(profile, event.topic, -0.02, 0, now)
      break
    case 'explain_more':
      termChanged = setTerm(
        profile,
        event.term,
        (p) => ({ state: 'unknown', seen: (p?.seen ?? 0) + 1 }),
        now
      )
      nudgeTopic(profile, event.topic, -0.05, 1, now)
      break
    case 'reselected':
      termChanged = setTerm(
        profile,
        event.term,
        (p) => ({
          state: p?.state === 'unknown' ? 'unknown' : 'learning',
          seen: (p?.seen ?? 0) + 1
        }),
        now
      )
      break
    case 'copied_original': {
      // "Weak negative for that transform type on that site" (§8.3): nudge that site's θ up.
      const site = profile.perSite[event.site] ?? {}
      const base = site.threshold ?? profile.threshold
      profile.perSite[event.site] = { ...site, threshold: Math.min(THRESHOLD_MAX, base + 0.01) }
      break
    }
  }

  profile.threshold = Math.min(
    THRESHOLD_MAX,
    Math.max(
      THRESHOLD_MIN,
      adaptThreshold(profile.threshold, { kind: event.kind, msSinceShown: ctx.msSinceShown })
    )
  )
  if (termChanged) profile.version = current.version + 1
  return profile
}

/**
 * §8.3: familiarity drifts back toward 0.5 for topics not seen in 60 days.
 * Run at startup and daily. Returns the same object when nothing changed.
 */
export function decayTopics(current: ReaderProfile, now: number): ReaderProfile {
  let changed = false
  const topics: ReaderProfile['topics'] = {}
  for (const [key, t] of Object.entries(current.topics)) {
    const idle = now - t.updatedAt - TOPIC_DECAY_AFTER_MS
    if (idle <= 0 || t.familiarity === 0.5) {
      topics[key] = t
      continue
    }
    const periods = idle / (30 * 24 * 60 * 60 * 1000)
    const keep = Math.pow(1 - TOPIC_DECAY_RATE, periods)
    const familiarity = 0.5 + (t.familiarity - 0.5) * keep
    // Move updatedAt to the decay boundary so repeated runs only decay new idle time
    // (exponential decay composes: keep(a + b) = keep(a) · keep(b)).
    topics[key] = {
      ...t,
      familiarity,
      updatedAt: now - TOPIC_DECAY_AFTER_MS
    }
    changed = true
  }
  return changed ? { ...current, topics } : current
}
