import { z } from 'zod'
import { IdSchema } from '../schemas/common'
import {
  AssessResultSchema,
  LensContextSchema,
  LensEventSchema,
  ProfileSnapshotSchema,
  RewriteRequestSchema,
  RewriteResultSchema,
  SkipReasonSchema
} from '../schemas/lens'
import { LensSettingsPatchSchema, LensSettingsSchema } from '../schemas/settings'

/**
 * Extension ⇄ app messages (hoot-lens.md §10.2). Every request carries a
 * `reqId` and gets exactly one reply: its matching response, `skipped`, or
 * `error`. `cancel` names the request to cancel and gets no reply of its own;
 * the cancelled request is answered with `skipped { reason: 'cancelled' }`.
 *
 * Additions to the spec table: `settings.patch` (quick toggles, Pause on this
 * site), `explain` (Explain more opens the Hoot card), `profile.changed`, and
 * `welcome` carrying the profile snapshot.
 */

export const BrowserSchema = z.enum(['chrome', 'edge', 'brave', 'arc', 'other'])

export const BridgeErrorCodeSchema = z.enum([
  'unauthorized',
  'version_mismatch',
  'bad_request',
  'lens_off',
  'cancelled',
  'no_key',
  'auth',
  'rate_limited',
  'busy',
  'blocked',
  'network',
  'internal',
  'app_unavailable'
])

const req = { reqId: IdSchema }

export const ExtToAppSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('hello'),
    ...req,
    protocol: z.number().int(),
    extVersion: z.string().max(32),
    browser: BrowserSchema
  }),
  z.object({ type: z.literal('assess'), ...req, ctx: LensContextSchema }),
  z.object({ type: z.literal('rewrite'), ...req, ...RewriteRequestSchema.shape }),
  z.object({ type: z.literal('cancel'), ...req }),
  z.object({ type: z.literal('feedback'), ...req, event: LensEventSchema }),
  z.object({ type: z.literal('explain'), ...req, ctx: LensContextSchema }),
  z.object({ type: z.literal('profile.get'), ...req }),
  z.object({ type: z.literal('settings.get'), ...req }),
  z.object({ type: z.literal('settings.patch'), ...req, patch: LensSettingsPatchSchema })
])

export const AppToExtSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('welcome'),
    ...req,
    protocol: z.number().int(),
    appVersion: z.string().max(32),
    lens: LensSettingsSchema,
    profile: ProfileSnapshotSchema
  }),
  z.object({ type: z.literal('assessed'), ...req, result: AssessResultSchema }),
  z.object({ type: z.literal('rewritten'), ...req, result: RewriteResultSchema }),
  z.object({ type: z.literal('skipped'), ...req, reason: SkipReasonSchema }),
  z.object({ type: z.literal('ack'), ...req }),
  z.object({ type: z.literal('profile'), ...req, profile: ProfileSnapshotSchema }),
  z.object({ type: z.literal('settings'), ...req, lens: LensSettingsSchema }),
  z.object({
    type: z.literal('error'),
    reqId: IdSchema.nullable(),
    code: BridgeErrorCodeSchema,
    message: z.string().max(500)
  }),
  // pushes: no reqId
  z.object({ type: z.literal('settings.changed'), lens: LensSettingsSchema }),
  z.object({ type: z.literal('profile.changed'), profile: ProfileSnapshotSchema })
])

/**
 * First frame hoot-bridge sends on the pipe, before relaying anything from
 * the browser. The token comes from `<userData>/hoot/bridge.token`; the
 * origin is the `chrome-extension://<id>/` the browser launched it with.
 */
export const BridgeAuthSchema = z.object({
  type: z.literal('bridge.auth'),
  token: z.string().min(32).max(128),
  origin: z.string().max(100)
})

export type Browser = z.infer<typeof BrowserSchema>
export type BridgeErrorCode = z.infer<typeof BridgeErrorCodeSchema>
export type ExtToApp = z.infer<typeof ExtToAppSchema>
export type AppToExt = z.infer<typeof AppToExtSchema>
export type BridgeAuth = z.infer<typeof BridgeAuthSchema>
export type ExtRequestType = ExtToApp['type']

/** Message of a given type, e.g. `ExtMessage<'rewrite'>`. */
export type ExtMessage<T extends ExtToApp['type']> = Extract<ExtToApp, { type: T }>
export type AppMessage<T extends AppToExt['type']> = Extract<AppToExt, { type: T }>
