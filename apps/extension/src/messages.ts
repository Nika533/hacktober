import type {
  ExplainRequest,
  LensContext,
  LensEventKind,
  LensFeedback,
  LensSettingsView,
  RewriteRequest,
  Transform
} from '@hoot/lens-dom'

export type ContentMessage =
  | { type: 'lens.settings.get' }
  | { type: 'lens.rewrite'; reqId: string; request: RewriteRequest }
  | { type: 'lens.assess'; reqId: string; context: LensContext }
  | { type: 'lens.cancel'; reqId: string }
  | { type: 'lens.feedback'; event: LensFeedback }
  | { type: 'lens.profile.get' }
  | { type: 'lens.explain'; request: ExplainRequest }
  | { type: 'lens.site.get'; site: string }
  | { type: 'lens.site.pause'; site: string; paused: boolean }

export type PushMessage = { type: 'lens.settings.changed'; settings: LensSettingsView }

export type Reply<T = unknown> =
  { ok: true; value: T } | { ok: false; error: { code: string; message: string } }

const TRANSFORMS = new Set<Transform>([
  'define',
  'expand',
  'simplify',
  'translate',
  'example',
  'unpack'
])
const EVENT_KINDS = new Set<LensEventKind>([
  'shown',
  'kept',
  'reverted',
  'knew_it',
  'explain_more',
  'reselected',
  'copied_original'
])
const MODES = new Set(['auto', 'gloss', 'ask', 'off'])

type Json = Record<string, unknown>

const isObject = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const text = (value: unknown, max: number, min = 0): value is string =>
  typeof value === 'string' && value.length >= min && value.length <= max

const id = (value: unknown): value is string => text(value, 64, 1) && /^[\w.-]+$/.test(value)

const site = (value: unknown): value is string =>
  text(value, 253, 1) && /^[a-z0-9.-]+$/i.test(value)

const count = (value: unknown, max: number): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= max

function context(value: unknown): value is LensContext {
  if (!isObject(value)) return false
  return (
    text(value.span, 600, 1) &&
    text(value.paragraph, 1502) &&
    Array.isArray(value.headingPath) &&
    value.headingPath.length <= 12 &&
    value.headingPath.every((heading) => text(heading, 120)) &&
    text(value.title, 200) &&
    text(value.lang, 35) &&
    (value.siteCategory === undefined ||
      value.siteCategory === null ||
      text(value.siteCategory, 40))
  )
}

function rewriteRequest(value: unknown): value is RewriteRequest {
  if (!isObject(value) || !context(value)) return false
  if (value.risk !== 'normal' && value.risk !== 'high') return false
  const allowed = value.allowedTransforms
  return (
    allowed === undefined ||
    (Array.isArray(allowed) && allowed.every((item) => TRANSFORMS.has(item as Transform)))
  )
}

function feedback(value: unknown): value is LensFeedback {
  if (!isObject(value)) return false
  return (
    id(value.eventId) &&
    EVENT_KINDS.has(value.kind as LensEventKind) &&
    TRANSFORMS.has(value.transform as Transform) &&
    (value.mode === 'replace' || value.mode === 'gloss' || value.mode === 'ask') &&
    (value.term === null || text(value.term, 120)) &&
    text(value.lang, 35) &&
    count(value.spanWords, 1000) &&
    count(value.latencyMs, 600_000)
  )
}

function explain(value: unknown): value is ExplainRequest {
  return (
    isObject(value) &&
    text(value.span, 600, 1) &&
    text(value.paragraph, 1502) &&
    text(value.title, 200)
  )
}

export function parseContentMessage(raw: unknown): ContentMessage | null {
  if (!isObject(raw) || typeof raw.type !== 'string') return null
  switch (raw.type) {
    case 'lens.settings.get':
    case 'lens.profile.get':
      return { type: raw.type }
    case 'lens.rewrite':
      return id(raw.reqId) && rewriteRequest(raw.request)
        ? { type: raw.type, reqId: raw.reqId, request: raw.request }
        : null
    case 'lens.assess':
      return id(raw.reqId) && context(raw.context)
        ? { type: raw.type, reqId: raw.reqId, context: raw.context }
        : null
    case 'lens.cancel':
      return id(raw.reqId) ? { type: raw.type, reqId: raw.reqId } : null
    case 'lens.feedback':
      return feedback(raw.event) ? { type: raw.type, event: raw.event } : null
    case 'lens.explain':
      return explain(raw.request) ? { type: raw.type, request: raw.request } : null
    case 'lens.site.get':
      return site(raw.site) ? { type: raw.type, site: raw.site } : null
    case 'lens.site.pause':
      return site(raw.site) && typeof raw.paused === 'boolean'
        ? { type: raw.type, site: raw.site, paused: raw.paused }
        : null
    default:
      return null
  }
}

export function parseSettings(raw: unknown): LensSettingsView | null {
  if (!isObject(raw)) return null
  if (typeof raw.enabled !== 'boolean' || !MODES.has(raw.mode as string)) return null
  if (raw.copy !== 'original' && raw.copy !== 'visible') return null
  if (raw.highStakes !== 'gloss' && raw.highStakes !== 'replace') return null
  return raw as unknown as LensSettingsView
}

export function parsePush(raw: unknown): PushMessage | null {
  if (!isObject(raw) || raw.type !== 'lens.settings.changed') return null
  const settings = parseSettings(raw.settings)
  return settings ? { type: raw.type, settings } : null
}
