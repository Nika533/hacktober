import type {
  AssessResult,
  ExplainRequest,
  LensContext,
  LensFeedback,
  ProfileView,
  RewriteRequest,
  RewriteResult
} from '@hoot/lens-dom'

export interface Upstream {
  readonly name: string
  rewrite(reqId: string, request: RewriteRequest, signal: AbortSignal): Promise<RewriteResult>
  assess(reqId: string, context: LensContext, signal: AbortSignal): Promise<AssessResult>
  feedback(event: LensFeedback): Promise<void>
  profile(): Promise<ProfileView>
  explain(request: ExplainRequest): Promise<void>
}

export class UpstreamError extends Error {
  readonly code: string

  constructor(code: string, message = code) {
    super(message)
    this.name = 'UpstreamError'
    this.code = code
  }
}

export const unavailableUpstream: Upstream = {
  name: 'unavailable',
  rewrite: () => Promise.reject(new UpstreamError('app-unavailable', 'Hoot isn’t running')),
  assess: () => Promise.reject(new UpstreamError('app-unavailable', 'Hoot isn’t running')),
  feedback: () => Promise.resolve(),
  profile: () => Promise.resolve({ summary: '', version: 0 }),
  explain: () => Promise.reject(new UpstreamError('app-unavailable', 'Hoot isn’t running'))
}
