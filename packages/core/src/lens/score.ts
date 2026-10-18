import type { LensSettings } from '../types/settings'
import type { LensEventKind, LensSignals, ProfileSnapshot, SelectionSize } from '../types/lens'
import { THRESHOLD_MAX, THRESHOLD_MIN } from './profile'

/**
 * Local confusion scoring (hoot-lens.md §6.2). Runs in the content script,
 * so most selections never leave the page. Pure and deterministic.
 */

/** Hand-set starting weights, from the §6.1 table; refit once there's data. */
export const SCORE_WEIGHTS = {
  bias: -2.6,
  size: {
    term: 0.4,
    phrase: 0.3,
    sentence: 0.2,
    passage: -0.6,
    'multi-paragraph': -5
  } satisfies Record<SelectionSize, number>,
  /** s3, dwell normalised 0 at ≤0.8 s → 1 at ≥3 s */
  dwell: 2.4,
  /** s6 */
  rarity: 2.2,
  /** s8, applied to (1 − familiarity); unknown topic counts as 0.5 */
  unfamiliarTopic: 0.8,
  /** s4, saturates at 2 repeats */
  reselect: 1.8,
  /** s5 */
  reread: 1.2,
  /** s9 */
  foreign: 3,
  /** s7 */
  knownTerm: -3,
  /** s2, a copy within 2.5 s */
  copied: -5
} as const

export const COPY_WINDOW_MS = 2500
/** The gray zone is [θ − 0.15, θ). */
export const GRAY_ZONE = 0.15
/** Gray-zone assess results at or above this rewrite. */
export const GRAY_ZONE_MIN_DIFFICULTY = 0.6
/** Settings → Sensitivity (−1 … 1) moves θ by up to this much. */
export const SENSITIVITY_RANGE = 0.1

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v))
const sigmoid = (z: number): number => 1 / (1 + Math.exp(-z))

export function dwellFeature(dwellMs: number): number {
  return clamp((dwellMs - 800) / 2200, 0, 1)
}

/** p = sigmoid(w · x + b). Blocked selections (s10) score 0. */
export function confusionScore(s: LensSignals): number {
  if (s.blocked) return 0
  const w = SCORE_WEIGHTS
  const copied = s.copiedWithinMs !== null && s.copiedWithinMs <= COPY_WINDOW_MS
  const z =
    w.bias +
    w.size[s.sizeClass] +
    w.dwell * dwellFeature(s.dwellMs) +
    w.rarity * clamp(s.rarity, 0, 1) +
    w.unfamiliarTopic * (1 - (s.topicFamiliarity ?? 0.5)) +
    w.reselect * (Math.min(s.reselectCount, 2) / 2) +
    w.reread * clamp(s.reread, 0, 1) +
    (s.foreignLanguage ? w.foreign : 0) +
    (s.knownTerm ? w.knownTerm : 0) +
    (copied ? w.copied : 0)
  return sigmoid(z)
}

/** θ for this site: per-site learned θ (or the user's), shifted by Sensitivity. */
export function effectiveThreshold(
  profile: Pick<ProfileSnapshot, 'threshold' | 'perSite'>,
  lens: Pick<LensSettings, 'sensitivity'>,
  site: string
): number {
  const base = profile.perSite[site]?.threshold ?? profile.threshold
  return clamp(base - SENSITIVITY_RANGE * lens.sensitivity, THRESHOLD_MIN, THRESHOLD_MAX)
}

/** §6.2 adaptive threshold: fast reverts raise θ, kept changes lower it. */
export function adaptThreshold(
  threshold: number,
  event: { kind: LensEventKind; msSinceShown: number | null }
): number {
  const fast = event.msSinceShown !== null && event.msSinceShown <= 5000
  if ((event.kind === 'reverted' || event.kind === 'knew_it') && fast) {
    return Math.min(THRESHOLD_MAX, threshold + 0.03)
  }
  if (event.kind === 'kept') return Math.max(THRESHOLD_MIN, threshold - 0.01)
  return threshold
}

// ------------------------------------------------------------- rate limits

export const RATE_LIMITS = {
  perMinute: 3,
  perPage: 12,
  /** Reverts in a row before the page switches to Ask-first */
  revertsToAskFirst: 2
} as const

/**
 * Per-page limits (§6.2): at most 3 automatic changes a minute and 12 in
 * total; two reverts in a row switch the page to Ask-first. One instance
 * per page load; lens-dom owns it.
 */
export class PageRateLimiter {
  private changes: number[] = []
  private consecutiveReverts = 0

  canChange(now: number): boolean {
    if (this.changes.length >= RATE_LIMITS.perPage) return false
    return this.changes.filter((t) => now - t < 60_000).length < RATE_LIMITS.perMinute
  }

  recordChange(now: number): void {
    this.changes.push(now)
  }

  recordRevert(): void {
    this.consecutiveReverts++
  }

  recordKept(): void {
    this.consecutiveReverts = 0
  }

  get askFirst(): boolean {
    return this.consecutiveReverts >= RATE_LIMITS.revertsToAskFirst
  }

  get total(): number {
    return this.changes.length
  }
}

// ---------------------------------------------------------------- decision

export type LensDecision =
  /** Rewrite now */
  | { action: 'rewrite'; p: number; threshold: number }
  /** Gray zone: assess first, rewrite if difficulty ≥ GRAY_ZONE_MIN_DIFFICULTY */
  | { action: 'assess'; p: number; threshold: number }
  /** Show the "Make this clearer?" chip; nothing is sent until it's clicked */
  | { action: 'ask'; p: number; threshold: number; why: AskReason }
  | { action: 'none'; p: number; threshold: number; why: NoneReason }

export type AskReason = 'mode' | 'cold_start' | 'page_reverts' | 'site_mode'
export type NoneReason = 'off' | 'blocked' | 'site_off' | 'below_threshold' | 'rate_limited'

export interface DecisionInput {
  signals: LensSignals
  site: string
  lens: Pick<LensSettings, 'enabled' | 'mode' | 'sensitivity' | 'sites'>
  profile: Pick<ProfileSnapshot, 'threshold' | 'perSite' | 'askFirstRemaining'>
  page: Pick<PageRateLimiter, 'canChange' | 'askFirst'>
  now: number
}

/**
 * What to do with one selection. Ask-first never sends anything on its
 * own; in Auto, text leaves the page only at or above the gray zone
 * (hoot-lens.md §11: "only when Lens decides to help").
 */
export function decide(input: DecisionInput): LensDecision {
  const { signals, site, lens, profile, page, now } = input
  const threshold = effectiveThreshold(profile, lens, site)
  const p = confusionScore(signals)
  const none = (why: NoneReason): LensDecision => ({ action: 'none', p, threshold, why })

  if (!lens.enabled) return none('off')
  if (signals.blocked) return none('blocked')
  const rule = lens.sites[site]
  const siteMode = profile.perSite[site]?.mode
  if (rule === 'never' || rule === 'paused' || siteMode === 'off') return none('site_off')
  if (p < threshold - GRAY_ZONE) return none('below_threshold')

  const ask = (why: AskReason): LensDecision => ({ action: 'ask', p, threshold, why })
  if (lens.mode === 'ask') return ask('mode')
  if (siteMode === 'ask') return ask('site_mode')
  if (page.askFirst) return ask('page_reverts')
  if (profile.askFirstRemaining > 0 && rule !== 'always') return ask('cold_start')
  if (!page.canChange(now)) return none('rate_limited')
  return p >= threshold ? { action: 'rewrite', p, threshold } : { action: 'assess', p, threshold }
}
