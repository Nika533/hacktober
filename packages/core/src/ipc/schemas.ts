import { z } from 'zod'
import { OverlayCommitSchema, SendPayloadSchema } from '../schemas/chat'
import { IdSchema, PointSchema, RectSchema } from '../schemas/common'
import {
  LensContextSchema,
  LensEventSchema,
  ProfilePatchSchema,
  RewriteRequestSchema
} from '../schemas/lens'
import { SettingsPatchSchema } from '../schemas/settings'
import { ANYWHERE_ACTIONS } from '../types/anywhere'
import { SLICE_NAMES } from '../types/state'
import type { InvokeChannel, SendChannel } from './routes'

const none = z.tuple([])
const SliceNameSchema = z.enum(SLICE_NAMES)
const CaptureModeSchema = z.enum(['lasso', 'rect', 'full'])
const StudioViewSchema = z.enum([
  'chat',
  'settings',
  'onboarding',
  'reading',
  'profile',
  'glossary'
])

/** Argument tuples main accepts on each invoke channel. */
export const INVOKE_ARGS = {
  'state:subscribe': z.tuple([z.array(SliceNameSchema).min(1).max(SLICE_NAMES.length)]),
  'chat:send': z.tuple([SendPayloadSchema]),
  'chat:stop': none,
  'chat:regenerate': none,
  'chat:new': none,
  'sessions:open': z.tuple([IdSchema]),
  'sessions:rename': z.tuple([IdSchema, z.string().trim().min(1).max(200)]),
  'sessions:delete': z.tuple([IdSchema]),
  'sessions:undoDelete': z.tuple([IdSchema]),
  'sessions:clearAll': none,
  'sessions:search': z.tuple([z.string().max(200)]),
  'attachments:open': z.tuple([IdSchema]),
  'attachments:remove': z.tuple([IdSchema]),
  'clipboard:writeText': z.tuple([z.string().max(1_000_000)]),
  'clipboard:arm': none,
  'clipboard:dismiss': none,
  'buddy:dismissGreeting': none,
  'capture:start': z.tuple([CaptureModeSchema.optional()]),
  'capture:getInit': none,
  'capture:commit': z.tuple([OverlayCommitSchema]),
  'capture:cancel': none,
  'capture:click': z.tuple([PointSchema]),
  'capture:minimize': none,
  'pins:create': z.tuple([IdSchema]),
  'pins:createFromText': z.tuple([z.string().min(1).max(100_000)]),
  'pins:close': none,
  'pins:openInHoot': none,
  'settings:update': z.tuple([SettingsPatchSchema]),
  'settings:setApiKey': z.tuple([z.string().trim().min(1).max(256)]),
  'settings:validateApiKey': z.tuple([z.string().trim().min(1).max(256)]),
  'settings:clearApiKey': none,
  'settings:resetAnchor': none,
  'settings:suspendHotkeys': z.tuple([z.boolean()]),
  'windows:openStudio': z.tuple([StudioViewSchema.optional()]),
  'windows:lockStudio': none,
  'windows:openReader': none,
  'onboarding:setStep': z.tuple([z.number().int().min(0).max(20)]),
  'onboarding:finish': none,
  'reader:pickFile': none,
  'reader:current': none,
  'lens:assess': z.tuple([IdSchema, LensContextSchema]),
  'lens:rewrite': z.tuple([IdSchema, RewriteRequestSchema]),
  'lens:cancel': z.tuple([IdSchema]),
  'lens:feedback': z.tuple([LensEventSchema]),
  'lens:explain': z.tuple([LensContextSchema]),
  'lens:profile': none,
  'lens:snapshot': none,
  'lens:patchProfile': z.tuple([ProfilePatchSchema]),
  'lens:resetProfile': none,
  'lens:exportProfile': none,
  'lens:recentChanges': z.tuple([z.number().int().min(1).max(500)]),
  'lens:glossary': none,
  'anywhere:current': none,
  'anywhere:act': z.tuple([z.enum(ANYWHERE_ACTIONS)]),
  'anywhere:close': none,
  'code:apply': z.tuple([IdSchema, z.number().int().min(0).max(100)]),
  'code:reveal': z.tuple([IdSchema, z.number().int().min(0).max(100)]),
  'code:tagStates': z.tuple([IdSchema]),
  'voice:start': none,
  'voice:finish': none,
  'voice:stop': none,
  'voice:speak': z.tuple([IdSchema]),
  'app:openExternal': z.tuple([z.url({ protocol: /^https?$/ }).max(2048)])
} satisfies Record<InvokeChannel, z.ZodType>

/** Argument tuples main accepts on each fire-and-forget channel. */
export const SEND_ARGS = {
  'buddy:requestMode': z.tuple([z.enum(['dot', 'pill', 'card', 'hidden'])]),
  'buddy:transitionDone': z.tuple([z.number().int().nonnegative()]),
  'buddy:setIgnoreMouse': z.tuple([z.boolean()]),
  'buddy:hitRegions': z.tuple([z.array(RectSchema).max(64)]),
  'buddy:dragStart': none,
  'buddy:dragMove': none,
  'buddy:dragEnd': z.tuple([z.object({ vx: z.number(), vy: z.number() })]),
  'buddy:setCursorTracking': z.tuple([z.boolean()]),
  'pins:resize': z.tuple([z.number().min(0).max(10_000)]),
  'anywhere:resize': z.tuple([z.number().min(0).max(10_000)])
} satisfies Record<SendChannel, z.ZodType>

export type InvokeArgs<C extends InvokeChannel> = z.output<(typeof INVOKE_ARGS)[C]>
export type SendArgs<C extends SendChannel> = z.output<(typeof SEND_ARGS)[C]>

export class IpcValidationError extends Error {
  constructor(
    readonly channel: string,
    readonly issues: string
  ) {
    super(`invalid arguments for ${channel}: ${issues}`)
    this.name = 'IpcValidationError'
  }
}

function parse(schema: z.ZodType, channel: string, args: unknown[]): unknown {
  const result = schema.safeParse(args)
  if (result.success) return result.data
  const issues = result.error.issues
    .slice(0, 5)
    .map((i) => `${i.path.join('.') || '(args)'}: ${i.message}`)
    .join('; ')
  throw new IpcValidationError(channel, issues)
}

/** Validate an invoke call's arguments; throws IpcValidationError. */
export function parseInvokeArgs<C extends InvokeChannel>(
  channel: C,
  args: unknown[]
): InvokeArgs<C> {
  return parse(INVOKE_ARGS[channel], channel, args) as InvokeArgs<C>
}

/** Validate a send call's arguments; throws IpcValidationError. */
export function parseSendArgs<C extends SendChannel>(channel: C, args: unknown[]): SendArgs<C> {
  return parse(SEND_ARGS[channel], channel, args) as SendArgs<C>
}
