import type {
  AssessResult,
  BridgeErrorCode,
  LensContext,
  LensEvent,
  LensSettings,
  LensSettingsPatch,
  PageBlocked,
  PageInfo,
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
  /** The popup: ask Hoot about the page in front (typed, or spoken with `voice`). */
  | { type: 'page.ask'; text: string; voice: boolean }
  /** The popup: the page it would ask about, and whether Hoot may read it. */
  | { type: 'page.current' }

/**
 * The tab the popup asks about; `blocked` says why Hoot won't read it ('off':
 * the page link is turned off on the options page).
 */
export interface CurrentPage extends PageInfo {
  blocked: PageBlocked | 'off' | null
}

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
  'page.ask': null
  'page.current': CurrentPage | null
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
