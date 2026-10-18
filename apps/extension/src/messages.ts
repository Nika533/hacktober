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

export type BridgeState =
  'idle' | 'connecting' | 'connected' | 'not_running' | 'not_installed' | 'version_mismatch'

export interface BridgeStatus {
  state: BridgeState
  appVersion: string | null
}

export type ContentMessage =
  | { type: 'lens.settings.get' }
  | { type: 'lens.settings.patch'; patch: LensSettingsPatch }
  | { type: 'lens.profile.get' }
  | { type: 'lens.rewrite'; reqId: string; request: RewriteRequest }
  | { type: 'lens.assess'; reqId: string; ctx: LensContext }
  | { type: 'lens.cancel'; reqId: string }
  | { type: 'lens.feedback'; event: LensEvent }
  | { type: 'lens.explain'; ctx: LensContext }
  | { type: 'lens.status' }
  | { type: 'lens.pdf.native'; url: string }

export interface ReplyValues {
  'lens.settings.get': LensSettings
  'lens.settings.patch': LensSettings
  'lens.profile.get': ProfileSnapshot
  'lens.rewrite': RewriteOutcome
  'lens.assess': AssessResult
  'lens.cancel': null
  'lens.feedback': null
  'lens.explain': null
  'lens.status': BridgeStatus
  'lens.pdf.native': null
}

export type PushMessage =
  | { type: 'lens.settings.changed'; lens: LensSettings }
  | { type: 'lens.profile.changed'; profile: ProfileSnapshot }
  | { type: 'lens.status.changed'; status: BridgeStatus }

export type Reply<T = unknown> =
  { ok: true; value: T } | { ok: false; error: { code: BridgeErrorCode; message: string } }

const PAYLOAD: Record<PushMessage['type'], string> = {
  'lens.settings.changed': 'lens',
  'lens.profile.changed': 'profile',
  'lens.status.changed': 'status'
}

export function isPush(raw: unknown): raw is PushMessage {
  if (typeof raw !== 'object' || raw === null) return false
  const message = raw as Record<string, unknown>
  const key = PAYLOAD[message.type as PushMessage['type']] as string | undefined
  const payload = key ? message[key] : undefined
  return typeof payload === 'object' && payload !== null
}

export function isReply(raw: unknown): raw is Reply {
  return typeof raw === 'object' && raw !== null && typeof (raw as Reply).ok === 'boolean'
}
