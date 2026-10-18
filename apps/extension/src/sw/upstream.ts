import { LensBackendError, type LensBackend } from '@hoot/core'

export type Upstream = Pick<
  LensBackend,
  'assess' | 'rewrite' | 'feedback' | 'explainMore' | 'getProfile'
>

const unavailable = (): Promise<never> =>
  Promise.reject(new LensBackendError('app_unavailable', 'Hoot isn’t running'))

export const unavailableUpstream: Upstream = {
  assess: unavailable,
  rewrite: unavailable,
  feedback: () => Promise.resolve(),
  explainMore: unavailable,
  getProfile: unavailable
}
