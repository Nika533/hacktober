export type Transform = 'define' | 'expand' | 'simplify' | 'translate' | 'example' | 'unpack'

export type MarkAction = 'replace' | 'gloss'

export type LensMode = 'auto' | 'gloss' | 'ask' | 'off'

export type DomainRisk = 'normal' | 'high'

export interface LensContext {
  span: string
  paragraph: string
  headingPath: string[]
  title: string
  lang: string
  siteCategory?: string | null
  signals?: Record<string, number | boolean | string>
}

export interface RewriteRequest extends LensContext {
  allowedTransforms?: Transform[]
  risk: DomainRisk
}

export type RewriteResult =
  | {
      kind: 'rewritten'
      action: MarkAction
      transform: Transform
      text: string
      term: string | null
      confidence: number
      cacheKey: string
    }
  | { kind: 'skipped'; reason: string }

export interface AssessResult {
  difficulty: number
  reason: 'jargon' | 'acronym' | 'dense_sentence' | 'foreign_language' | 'notation' | 'none'
  term: string | null
}

export type LensEventKind =
  'shown' | 'kept' | 'reverted' | 'knew_it' | 'explain_more' | 'reselected' | 'copied_original'

export interface LensFeedback {
  eventId: string
  kind: LensEventKind
  transform: Transform
  mode: 'replace' | 'gloss' | 'ask'
  term: string | null
  lang: string
  spanWords: number
  latencyMs: number
}

export interface LensSettingsView {
  enabled: boolean
  mode: LensMode
  copy: 'original' | 'visible'
  highStakes: 'gloss' | 'replace'
}

export interface ProfileView {
  summary: string
  version: number
}

export interface ExplainRequest {
  span: string
  paragraph: string
  title: string
}

export interface LensBackend {
  assess(reqId: string, context: LensContext): Promise<AssessResult>
  rewrite(reqId: string, request: RewriteRequest): Promise<RewriteResult>
  cancel(reqId: string): void
  feedback(event: LensFeedback): void
  getProfile(): Promise<ProfileView>
  getSettings(): Promise<LensSettingsView>
  onSettings(listener: (settings: LensSettingsView) => void): () => void
  explainMore(request: ExplainRequest): void
}

export class LensError extends Error {
  readonly code: string

  constructor(code: string, message = code) {
    super(message)
    this.name = 'LensError'
    this.code = code
  }
}
