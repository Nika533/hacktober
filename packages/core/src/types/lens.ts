/** Hoot Lens vocabulary (hoot-lens.md §6-§8, §10.2). */

export const TRANSFORMS = [
  'define',
  'expand',
  'simplify',
  'translate',
  'example',
  'unpack'
] as const
export type Transform = (typeof TRANSFORMS)[number]

/** How a rewrite is rendered on the page. */
export type RenderAction = 'replace' | 'gloss'

/** User-facing Lens mode (Settings → Reading). */
export type LensMode = 'auto' | 'gloss' | 'ask'

/** Per-site user rule. */
export type SiteRule = 'always' | 'paused' | 'never'

export type DomainRisk = 'normal' | 'high'

export const SITE_CATEGORIES = [
  'general',
  'medical',
  'legal',
  'financial',
  'government',
  'safety'
] as const
export type SiteCategory = (typeof SITE_CATEGORIES)[number]

export type LensSurface = 'html' | 'pdf' | 'reader'

export type SelectionSize = 'term' | 'phrase' | 'sentence' | 'passage' | 'multi-paragraph'

/** Why Lens must never act on this selection (signal s10). */
export type LensBlockReason = 'editable' | 'code' | 'denied' | 'paused' | 'typing' | 'fast-scroll'

/** Raw per-selection signals s1..s10 (hoot-lens.md §6.1). */
export interface LensSignals {
  /** s1 */
  sizeClass: SelectionSize
  /** s2: ms between selection and a copy, null when no copy happened */
  copiedWithinMs: number | null
  /** s3 */
  dwellMs: number
  /** s4: earlier selections of the same span/term this session */
  reselectCount: number
  /** s5: 0..1, re-reading / slow reading of this paragraph */
  reread: number
  /** s6: 0..1, word rarity / jargon / acronym / notation score */
  rarity: number
  /** s7 */
  knownTerm: boolean
  /** s8: 0..1, null when the page topic is unknown */
  topicFamiliarity: number | null
  /** s9 */
  foreignLanguage: boolean
  /** s10 */
  blocked: LensBlockReason | null
}

/** Character limits for what leaves the page (hoot-lens.md §6.3). */
export const LENS_LIMITS = {
  span: 600,
  paragraph: 1500,
  headings: 3,
  heading: 200,
  title: 300
} as const

/** Everything the app learns about one candidate span. Nothing else is sent. */
export interface LensContext {
  span: string
  paragraph: string
  /** Nearest h1..h3 chain, outermost first */
  headingPath: string[]
  title: string
  /** BCP 47 language tag of the span */
  lang: string
  /** Registrable domain (e.g. "example.com"); "" for local files */
  site: string
  siteCategory: SiteCategory
  surface: LensSurface
  signals: LensSignals
  /** Local confusion score from the in-page scorer, 0..1 */
  p: number
}

export type DifficultyReason =
  'jargon' | 'acronym' | 'dense_sentence' | 'foreign_language' | 'notation' | 'none'

export interface AssessResult {
  difficulty: number
  reason: DifficultyReason
  term: string | null
}

export interface RewriteRequest {
  ctx: LensContext
  allowedTransforms: Transform[]
  risk: DomainRisk
}

export interface RewriteResult {
  action: RenderAction
  transform: Transform
  /** Replacement text (replace) or annotation (gloss) */
  text: string
  term: string | null
  confidence: number
  cacheKey: string
  latencyMs: number
  cached: boolean
}

export type SkipReason =
  | 'model_skip'
  | 'meaning_not_preserved'
  | 'low_confidence'
  | 'invalid_output'
  | 'lens_off'
  | 'cancelled'

export type RewriteOutcome =
  { kind: 'rewritten'; result: RewriteResult } | { kind: 'skipped'; reason: SkipReason }

export const LENS_EVENT_KINDS = [
  'shown',
  'kept',
  'reverted',
  'knew_it',
  'explain_more',
  'reselected',
  'copied_original'
] as const
export type LensEventKind = (typeof LENS_EVENT_KINDS)[number]

/** One row of the local, append-only event log (hoot-lens.md §8.1). */
export interface LensEvent {
  id: string
  ts: number
  site: string
  /** Salted hash; raw URLs are never stored */
  urlHash: string
  kind: LensEventKind
  transform: Transform
  mode: RenderAction | 'ask'
  term: string | null
  topic: string | null
  lang: string
  spanWords: number
  p: number
  difficulty: number | null
  latencyMs: number
}

export type TermState = 'known' | 'learning' | 'unknown'

export interface ReaderProfile {
  version: number
  readingLevel: { estimate: number; confidence: number }
  readingPaceWpm: number
  terms: Record<string, { state: TermState; seen: number; updatedAt: number }>
  /** familiarity 0..1; depth = how much detail "Explain more" asked for */
  topics: Record<string, { familiarity: number; depth: number; updatedAt: number }>
  style: { length: 'shorter' | 'same'; analogies: boolean; plainWords: boolean }
  /** θu */
  threshold: number
  /** Cold start: triggers left before Auto mode may act without asking */
  askFirstRemaining: number
  perSite: Record<string, { threshold?: number; mode?: LensMode | 'off' }>
}

/** The part of the profile in-page code needs, pushed over the bridge. */
export interface ProfileSnapshot {
  version: number
  threshold: number
  askFirstRemaining: number
  knownTerms: string[]
  perSite: ReaderProfile['perSite']
}

/** Studio's view of the profile, with the summary the prompts use. */
export interface ProfileView {
  profile: ReaderProfile
  summary: string
}

/** Edits from "What Hoot knows about me"; null removes an entry. */
export interface ProfilePatch {
  terms?: Record<string, TermState | null>
  topics?: Record<string, number | null>
  style?: Partial<ReaderProfile['style']>
}

/** Studio → Recent changes: kept separately from the event log, bounded. */
export interface RecentChange {
  id: string
  ts: number
  site: string
  transform: Transform
  action: RenderAction
  original: string
  rewrite: string
  term: string | null
}

export interface GlossaryEntry {
  term: string
  gloss: string
  transform: 'define' | 'expand'
  site: string
  firstSeen: number
  lastSeen: number
  state: TermState
}

export type BridgeStatus = 'stopped' | 'listening' | 'connected'
