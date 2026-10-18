import { lensCacheKey } from '../lens/cacheKey'
import { MAX_REPLACE_WORDS, countWords } from '../lens/transforms'
import { LensBackendError, type LensBackend, type Unsubscribe } from '../protocol/backend'
import { applySettingsPatch } from '../schemas/settings'
import type {
  AssessResult,
  LensContext,
  LensEvent,
  ProfileSnapshot,
  RewriteOutcome,
  RewriteRequest,
  Transform
} from '../types/lens'
import { DEFAULT_SETTINGS, type LensSettings } from '../types/settings'

/**
 * Deterministic stand-ins for the Lens engine (`HOOT_FAKE_LENS=1`, unit and
 * e2e tests). Rules, so tests can aim at each path:
 * - a span containing "SKIP" is skipped by the "model"
 * - "ERROR" makes the call fail with code `busy`
 * - an all-caps 2–6 letter span is expanded; one word is defined;
 *   a foreign-language span is translated; anything else is simplified
 * - high risk, or spans over MAX_REPLACE_WORDS words, are glossed
 */

const ACRONYM = /^[A-Z]{2,6}$/

export function fakeAssess(ctx: LensContext): AssessResult {
  if (ctx.span.includes('ERROR')) throw new LensBackendError('busy', 'fake busy')
  const span = ctx.span.trim()
  if (ACRONYM.test(span)) return { difficulty: 0.8, reason: 'acronym', term: span }
  if (ctx.signals.foreignLanguage)
    return { difficulty: 0.9, reason: 'foreign_language', term: null }
  if (countWords(span) === 1) return { difficulty: 0.7, reason: 'jargon', term: span }
  return { difficulty: 0.65, reason: 'dense_sentence', term: null }
}

function pickTransform(ctx: LensContext, allowed: Transform[]): Transform {
  const span = ctx.span.trim()
  const wanted: Transform = ACRONYM.test(span)
    ? 'expand'
    : ctx.signals.foreignLanguage
      ? 'translate'
      : countWords(span) === 1
        ? 'define'
        : 'simplify'
  return allowed.includes(wanted) ? wanted : (allowed[0] ?? 'simplify')
}

function fakeText(transform: Transform, span: string): string {
  switch (transform) {
    case 'define':
      return `${span} (a fake definition)`
    case 'expand':
      return `${span} (Fake Expanded Form)`
    case 'translate':
      return `[translated] ${span}`
    case 'example':
      return `For example: a fake example of ${span}.`
    case 'unpack':
      return `In words: ${span}`
    case 'simplify':
      // Keeps the whole span, so fake replacements never drop a number or a "not".
      return `In short: ${span}`
  }
}

export function fakeRewrite(req: RewriteRequest, profileVersion = 0): RewriteOutcome {
  const { ctx, allowedTransforms, risk } = req
  const span = ctx.span.trim()
  if (span.includes('ERROR')) throw new LensBackendError('busy', 'fake busy')
  if (span.includes('SKIP')) return { kind: 'skipped', reason: 'model_skip' }
  const transform = pickTransform(ctx, allowedTransforms)
  const action = risk === 'high' || countWords(span) > MAX_REPLACE_WORDS ? 'gloss' : 'replace'
  return {
    kind: 'rewritten',
    result: {
      action,
      transform,
      text: fakeText(transform, span),
      term: transform === 'define' || transform === 'expand' ? span : null,
      confidence: 0.9,
      cacheKey: lensCacheKey({ span, paragraph: ctx.paragraph, transform, profileVersion }),
      latencyMs: 0,
      cached: false
    }
  }
}

export const FAKE_PROFILE_SNAPSHOT: ProfileSnapshot = {
  version: 1,
  threshold: 0.75,
  askFirstRemaining: 0,
  knownTerms: ['API'],
  perSite: {}
}

export interface FakeLensBackend extends LensBackend {
  /** Every feedback event received, in order */
  readonly events: LensEvent[]
  /** Every "Explain more" request, in order */
  readonly explained: LensContext[]
  /** Push a settings change as if the app had changed it */
  emitSettings(lens: LensSettings): void
  emitProfile(profile: ProfileSnapshot): void
}

export function createFakeLensBackend(
  opts: { delayMs?: number; settings?: LensSettings; profile?: ProfileSnapshot } = {}
): FakeLensBackend {
  const delayMs = opts.delayMs ?? 0
  let settings: LensSettings = opts.settings ?? { ...DEFAULT_SETTINGS.lens, enabled: true }
  let profile: ProfileSnapshot = opts.profile ?? FAKE_PROFILE_SNAPSHOT
  const settingsListeners = new Set<(lens: LensSettings) => void>()
  const profileListeners = new Set<(p: ProfileSnapshot) => void>()
  const events: LensEvent[] = []
  const explained: LensContext[] = []

  const wait = (signal?: AbortSignal): Promise<boolean> =>
    new Promise((resolve) => {
      if (signal?.aborted) return resolve(false)
      const timer = setTimeout(() => {
        signal?.removeEventListener('abort', onAbort)
        resolve(true)
      }, delayMs)
      const onAbort = (): void => {
        clearTimeout(timer)
        resolve(false)
      }
      signal?.addEventListener('abort', onAbort, { once: true })
    })

  const subscribe = <T>(set: Set<(v: T) => void>, cb: (v: T) => void): Unsubscribe => {
    set.add(cb)
    return () => set.delete(cb)
  }

  return {
    events,
    explained,
    async assess(ctx, o) {
      if (!(await wait(o?.signal))) throw new LensBackendError('cancelled')
      return fakeAssess(ctx)
    },
    async rewrite(req, o) {
      if (!settings.enabled) return { kind: 'skipped', reason: 'lens_off' }
      if (!(await wait(o?.signal))) return { kind: 'skipped', reason: 'cancelled' }
      return fakeRewrite(req, profile.version)
    },
    async feedback(event) {
      events.push(event)
    },
    async explainMore(ctx) {
      explained.push(ctx)
    },
    async getProfile() {
      return profile
    },
    async getSettings() {
      return settings
    },
    async patchSettings(patch) {
      settings = applySettingsPatch({ ...DEFAULT_SETTINGS, lens: settings }, { lens: patch }).lens
      for (const cb of settingsListeners) cb(settings)
      return settings
    },
    onSettings: (cb) => subscribe(settingsListeners, cb),
    onProfile: (cb) => subscribe(profileListeners, cb),
    emitSettings(lens) {
      settings = lens
      for (const cb of settingsListeners) cb(lens)
    },
    emitProfile(p) {
      profile = p
      for (const cb of profileListeners) cb(p)
    }
  }
}
