import type { RewriteRequest, RewriteResult, Transform } from '@hoot/lens-dom'
import { UpstreamError, type Upstream } from './upstream'

const GLOSSARY: Record<string, { transform: Transform; text: string }> = {
  heteroscedasticity: {
    transform: 'define',
    text: 'heteroscedasticity (when the spread of errors changes across values)'
  },
  ols: { transform: 'expand', text: 'ordinary least squares (OLS)' },
  blue: { transform: 'expand', text: 'BLUE (best linear unbiased estimator)' },
  hc3: { transform: 'expand', text: 'HC3 (a robust standard-error formula)' },
  vif: { transform: 'expand', text: 'VIF (variance inflation factor)' },
  multicollinearity: {
    transform: 'define',
    text: 'multicollinearity (predictors that move together)'
  }
}

export interface DevLog {
  push(kind: 'feedback' | 'explain', payload: unknown): Promise<void>
}

function rewriteFor(request: RewriteRequest): RewriteResult {
  const key = request.span.trim().toLowerCase()
  const known = GLOSSARY[key]
  const action = request.risk === 'high' ? 'gloss' : 'replace'
  const result = known ?? {
    transform: 'simplify' as const,
    text: `in plain words: ${request.span.trim()}`
  }
  return {
    kind: 'rewritten',
    action,
    transform: result.transform,
    text: action === 'gloss' ? result.text.replace(/^[^(]*\((.*)\)$/, '$1') : result.text,
    term: known ? key : null,
    confidence: 0.9,
    cacheKey: `dev:${key}`
  }
}

function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new UpstreamError('cancelled'))
      return
    }
    const timer = setTimeout(resolve, ms)
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer)
        reject(new UpstreamError('cancelled'))
      },
      { once: true }
    )
  })
}

export function createDevUpstream(log: DevLog, delayMs = 250): Upstream {
  return {
    name: 'dev-stub',
    async rewrite(_reqId, request, signal) {
      await wait(delayMs, signal)
      if (/\bskip\b/i.test(request.span)) return { kind: 'skipped', reason: 'dev-skip' }
      return rewriteFor(request)
    },
    async assess(_reqId, context, signal) {
      await wait(delayMs / 2, signal)
      const known = GLOSSARY[context.span.trim().toLowerCase()]
      return { difficulty: known ? 0.8 : 0.4, reason: known ? 'jargon' : 'none', term: null }
    },
    feedback: (event) => log.push('feedback', event),
    profile: async () => ({ summary: 'Dev profile', version: 1 }),
    explain: (request) => log.push('explain', request)
  }
}
