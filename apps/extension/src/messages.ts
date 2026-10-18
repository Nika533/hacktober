import type {
  AssessResult,
  BridgeErrorCode,
  LensContext,
  LensEvent,
  LensSettings,
  LensSettingsPatch,
  ProfileSnapshot,
  RewriteOutcome,
  RewriteRequest
} from '@hoot/core'

export type ContentMessage =
  | { type: 'lens.settings.get' }
  | { type: 'lens.settings.patch'; patch: LensSettingsPatch }
  | { type: 'lens.profile.get' }
  | { type: 'lens.rewrite'; reqId: string; request: RewriteRequest }
  | { type: 'lens.assess'; reqId: string; ctx: LensContext }
  | { type: 'lens.cancel'; reqId: string }
  | { type: 'lens.feedback'; event: LensEvent }
  | { type: 'lens.explain'; ctx: LensContext }

export interface ReplyValues {
  'lens.settings.get': LensSettings
  'lens.settings.patch': LensSettings
  'lens.profile.get': ProfileSnapshot
  'lens.rewrite': RewriteOutcome
  'lens.assess': AssessResult
  'lens.cancel': null
  'lens.feedback': null
  'lens.explain': null
}

export type PushMessage =
  | { type: 'lens.settings.changed'; lens: LensSettings }
  | { type: 'lens.profile.changed'; profile: ProfileSnapshot }

export type Reply<T = unknown> =
  { ok: true; value: T } | { ok: false; error: { code: BridgeErrorCode; message: string } }

const PUSH_TYPES = new Set<PushMessage['type']>(['lens.settings.changed', 'lens.profile.changed'])

export function isPush(raw: unknown): raw is PushMessage {
  if (typeof raw !== 'object' || raw === null) return false
  const message = raw as { type?: unknown; lens?: unknown; profile?: unknown }
  if (!PUSH_TYPES.has(message.type as PushMessage['type'])) return false
  const payload = message.type === 'lens.settings.changed' ? message.lens : message.profile
  return typeof payload === 'object' && payload !== null
}

export function isReply(raw: unknown): raw is Reply {
  return typeof raw === 'object' && raw !== null && typeof (raw as Reply).ok === 'boolean'
}
