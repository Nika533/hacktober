import {
  ASSESS_SYSTEM_PROMPT,
  LENS_MODELS,
  LensBackendError,
  REWRITE_SYSTEM_PROMPT,
  STRONG_REWRITE_MIN_WORDS,
  applyGuardrails,
  buildAssessPrompt,
  buildProfileSummary,
  buildRewritePrompt,
  countWords,
  lensCacheKey,
  type AssessResult,
  type BridgeErrorCode,
  type LensContext,
  type LensSettings,
  type RewriteModelOutput,
  type RewriteOutcome,
  type RewriteRequest,
  type Transform
} from '@hoot/core'
import { AssessModelOutputSchema, RewriteModelOutputSchema } from '@hoot/core/schemas'
import { fakeAssess, fakeRewrite } from '@hoot/core/testing'
import { AiError, AiOutputError, isAbortError, type AiProvider } from '../ai'
import type { LensCache } from './cache'
import type { ProfileStore } from './profileStore'

export interface LensEngineDeps {
  /** Null when no Claude key is configured. */
  getProvider(): Promise<AiProvider | null>
  getLensSettings(): LensSettings
  profile: ProfileStore
  cache: LensCache
  /** HOOT_FAKE_LENS: deterministic answers from @hoot/core/testing */
  fake: boolean
  now(): number
}

// Generous: a slow answer is better than none (Gemini, before the move to
// Claude, took 5–7 s under load, #49). Nothing is retried after a timeout;
// the page shows its shimmer meanwhile.
const ASSESS_TIMEOUT_MS = 10_000
const REWRITE_TIMEOUT_MS = 15_000

const baseLang = (tag: string): string => tag.toLowerCase().split('-')[0] ?? tag

/** Transforms the engine will offer the model for this request. */
export function effectiveTransforms(req: RewriteRequest, lens: LensSettings): Transform[] {
  const reads = new Set([lens.languages.primary, ...lens.languages.comfortable].map(baseLang))
  const allowed = [...new Set(req.allowedTransforms)]
  return reads.has(baseLang(req.ctx.lang)) ? allowed.filter((t) => t !== 'translate') : allowed
}

/** Long simplify/unpack goes to the stronger model (hoot-lens.md §7.2). */
export function pickRewriteModel(allowed: readonly Transform[], span: string): string {
  const heavy = allowed.includes('simplify') || allowed.includes('unpack')
  return heavy && countWords(span) > STRONG_REWRITE_MIN_WORDS
    ? LENS_MODELS.rewriteStrong
    : LENS_MODELS.rewriteFast
}

function isSiteOff(lens: LensSettings, site: string): boolean {
  const rule = lens.sites[site]
  return rule === 'never' || rule === 'paused'
}

export function toBackendError(e: unknown): LensBackendError {
  if (e instanceof LensBackendError) return e
  if (e instanceof AiError) {
    const code: BridgeErrorCode = e.code === 'unknown' ? 'internal' : e.code
    return new LensBackendError(code, e.message)
  }
  return new LensBackendError('internal', e instanceof Error ? e.message : String(e))
}

interface Inflight {
  promise: Promise<RewriteOutcome>
  controller: AbortController
  waiters: number
}

const CANCELLED: RewriteOutcome = { kind: 'skipped', reason: 'cancelled' }

/**
 * The Lens brain (hoot-lens.md §7). Callers identify requests by `reqId` so
 * `cancel(reqId)` can stop them. Identical requests in flight share one
 * model call, which is aborted only when every waiter has cancelled.
 */
export class LensEngine {
  private controllers = new Map<string, AbortController>()
  private inflight = new Map<string, Inflight>()

  constructor(private deps: LensEngineDeps) {}

  cancel(reqId: string): void {
    this.controllers.get(reqId)?.abort()
  }

  async rewrite(reqId: string, req: RewriteRequest): Promise<RewriteOutcome> {
    const started = this.deps.now()
    const lens = this.deps.getLensSettings()
    if (!lens.enabled || isSiteOff(lens, req.ctx.site))
      return { kind: 'skipped', reason: 'lens_off' }
    const allowed = effectiveTransforms(req, lens)
    if (allowed.length === 0) return { kind: 'skipped', reason: 'model_skip' }

    const profile = this.deps.profile.get()
    const key = lensCacheKey({
      span: req.ctx.span,
      paragraph: req.ctx.paragraph,
      transform: `${[...allowed].sort().join(',')}|${req.risk}|${lens.highStakes}`,
      profileVersion: profile.version
    })
    const hit = this.deps.cache.getRewrite(key)
    if (hit) {
      return {
        kind: 'rewritten',
        result: { ...hit.result, cached: true, latencyMs: this.deps.now() - started }
      }
    }

    const outcome = await this.withRequest(reqId, (signal) =>
      this.join(key, signal, (shared) =>
        this.callRewrite({ ...req, allowedTransforms: allowed }, key, lens, shared)
      )
    )
    return outcome.kind === 'rewritten'
      ? { kind: 'rewritten', result: { ...outcome.result, latencyMs: this.deps.now() - started } }
      : outcome
  }

  async assess(reqId: string, ctx: LensContext): Promise<AssessResult> {
    const lens = this.deps.getLensSettings()
    if (!lens.enabled || isSiteOff(lens, ctx.site)) throw new LensBackendError('lens_off')
    const profile = this.deps.profile.get()
    const key = lensCacheKey({
      span: ctx.span,
      paragraph: ctx.paragraph,
      transform: 'assess',
      profileVersion: profile.version
    })
    const hit = this.deps.cache.getAssess(key)
    if (hit) return hit
    if (this.deps.fake) return fakeAssess(ctx)

    const provider = await this.requireProvider()
    const result = await this.withRequest(reqId, async (signal) => {
      try {
        return await provider.generateJson({
          model: LENS_MODELS.assess,
          system: ASSESS_SYSTEM_PROMPT,
          prompt: buildAssessPrompt(ctx, buildProfileSummary(profile, lens.languages, ctx)),
          schema: AssessModelOutputSchema,
          thinking: 'minimal',
          timeoutMs: ASSESS_TIMEOUT_MS,
          retries: 0,
          signal
        })
      } catch (e) {
        if (signal.aborted || isAbortError(e)) throw new LensBackendError('cancelled')
        if (e instanceof AiOutputError) throw new LensBackendError('internal', e.message)
        throw toBackendError(e)
      }
    })
    this.deps.cache.setAssess(key, result)
    return result
  }

  private async requireProvider(): Promise<AiProvider> {
    const provider = await this.deps.getProvider()
    if (!provider) throw new LensBackendError('no_key', 'No Claude API key')
    return provider
  }

  /** Register a cancellable request for its whole lifetime. */
  private async withRequest<T>(
    reqId: string,
    run: (signal: AbortSignal) => Promise<T>
  ): Promise<T> {
    this.controllers.get(reqId)?.abort()
    const controller = new AbortController()
    this.controllers.set(reqId, controller)
    try {
      return await run(controller.signal)
    } finally {
      if (this.controllers.get(reqId) === controller) this.controllers.delete(reqId)
    }
  }

  /** Share one model call between identical requests in flight. */
  private join(
    key: string,
    signal: AbortSignal,
    start: (shared: AbortSignal) => Promise<RewriteOutcome>
  ): Promise<RewriteOutcome> {
    let entry = this.inflight.get(key)
    if (!entry) {
      const controller = new AbortController()
      const created: Inflight = {
        controller,
        waiters: 0,
        promise: start(controller.signal).finally(() => {
          if (this.inflight.get(key) === created) this.inflight.delete(key)
        })
      }
      this.inflight.set(key, created)
      entry = created
    }
    const shared = entry
    shared.waiters++
    return new Promise<RewriteOutcome>((resolve, reject) => {
      let done = false
      const leave = (): void => {
        if (done) return
        done = true
        shared.waiters--
        signal.removeEventListener('abort', onAbort)
      }
      const onAbort = (): void => {
        leave()
        if (shared.waiters === 0) shared.controller.abort()
        resolve(CANCELLED)
      }
      if (signal.aborted) return onAbort()
      signal.addEventListener('abort', onAbort, { once: true })
      shared.promise.then(
        (v) => {
          if (done) return
          leave()
          resolve(v)
        },
        (e: unknown) => {
          if (done) return
          leave()
          reject(e)
        }
      )
    })
  }

  private async callRewrite(
    req: RewriteRequest,
    key: string,
    lens: LensSettings,
    signal: AbortSignal
  ): Promise<RewriteOutcome> {
    const { ctx } = req
    const profile = this.deps.profile.get()
    const started = this.deps.now()

    let outcome: RewriteOutcome
    if (this.deps.fake) {
      outcome = fakeRewrite(req, profile.version)
    } else {
      const provider = await this.requireProvider()
      const prompt = buildRewritePrompt(req, buildProfileSummary(profile, lens.languages, ctx))
      const ask = (model: string): Promise<RewriteModelOutput> =>
        provider.generateJson({
          model,
          system: REWRITE_SYSTEM_PROMPT,
          prompt,
          schema: RewriteModelOutputSchema,
          thinking: 'minimal',
          timeoutMs: REWRITE_TIMEOUT_MS,
          retries: 1,
          signal
        })
      const model = pickRewriteModel(req.allowedTransforms, ctx.span)
      let output
      try {
        try {
          output = await ask(model)
        } catch (e) {
          // The strong model has the smaller quota (a free key gets few Flash
          // requests a day); a fast-model rewrite beats none.
          const limited = e instanceof AiError && e.code === 'rate_limited'
          if (!limited || model === LENS_MODELS.rewriteFast) throw e
          output = await ask(LENS_MODELS.rewriteFast)
        }
      } catch (e) {
        if (signal.aborted || isAbortError(e)) return CANCELLED
        if (e instanceof AiOutputError) return { kind: 'skipped', reason: 'invalid_output' }
        throw toBackendError(e)
      }
      const verdict = applyGuardrails({
        output,
        span: ctx.span,
        allowedTransforms: req.allowedTransforms,
        risk: req.risk,
        highStakes: lens.highStakes
      })
      if (verdict.kind === 'skip') return { kind: 'skipped', reason: verdict.reason }
      outcome = {
        kind: 'rewritten',
        result: {
          action: verdict.action,
          transform: verdict.transform,
          text: verdict.text,
          term: verdict.term,
          confidence: verdict.confidence,
          cacheKey: key,
          latencyMs: 0,
          cached: false
        }
      }
    }

    if (outcome.kind === 'rewritten') {
      const result = { ...outcome.result, cacheKey: key, latencyMs: this.deps.now() - started }
      this.deps.cache.setRewrite(key, {
        result,
        original: ctx.span,
        site: ctx.site,
        ts: this.deps.now()
      })
      return { kind: 'rewritten', result }
    }
    return outcome
  }
}
