import { z } from 'zod'
import { AI_ERROR_CODES, type AiErrorCode } from '../types/chat'
import { IdSchema, PointSchema, RectSchema, TimestampSchema } from './common'

export const AiErrorCodeSchema = z.enum(AI_ERROR_CODES)

export const QuickActionIdSchema = z.enum(['explain', 'extract', 'translate', 'summarize', 'fix'])

export const AttachmentSchema = z.object({
  id: IdSchema,
  kind: z.enum(['capture', 'clipboard-image']),
  thumbDataUrl: z.string().startsWith('data:image/'),
  width: z.number().int().nonnegative(),
  height: z.number().int().nonnegative(),
  createdAt: TimestampSchema
})

export const MessageSchema = z.object({
  id: IdSchema,
  role: z.enum(['user', 'assistant']),
  text: z.string(),
  sentText: z.string().optional(),
  attachmentIds: z.array(IdSchema),
  createdAt: TimestampSchema,
  status: z.enum(['streaming', 'done', 'stopped', 'error']),
  error: AiErrorCodeSchema.optional()
})

export const SessionSchema = z.object({
  id: IdSchema,
  title: z.string().max(200),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
  messages: z.array(MessageSchema),
  attachments: z.record(IdSchema, AttachmentSchema)
})

export const SessionMetaSchema = z.object({
  id: IdSchema,
  title: z.string().max(200),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
  messageCount: z.number().int().nonnegative()
})

export const PinSchema = z.object({
  id: IdSchema,
  text: z.string().max(100_000),
  sessionId: IdSchema.nullable(),
  messageId: IdSchema.nullable(),
  bounds: RectSchema,
  createdAt: TimestampSchema
})

export const SendPayloadSchema = z
  .strictObject({
    text: z.string().max(20_000).optional(),
    quickAction: QuickActionIdSchema.optional()
  })
  .refine((p) => (p.text?.trim().length ?? 0) > 0 || p.quickAction !== undefined, {
    message: 'send needs text or a quick action'
  })

export const OverlayCommitSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('lasso'), points: z.array(PointSchema).min(3).max(20_000) }),
  z.object({ kind: z.literal('rect'), rect: RectSchema }),
  z.object({ kind: z.literal('full') })
])

const LEGACY_ERROR_CODES: Record<string, AiErrorCode> = {
  '401': 'auth',
  '429': 'rate_limited',
  '529': 'busy',
  'no-key': 'no_key'
}

/** Map an error code saved by the legacy app (or anything unknown) to an AiErrorCode. */
export function migrateMessageError(code: unknown): AiErrorCode | undefined {
  if (code === undefined || code === null) return undefined
  if (typeof code !== 'string') return 'unknown'
  const legacy = LEGACY_ERROR_CODES[code]
  if (legacy) return legacy
  return AiErrorCodeSchema.safeParse(code).success ? (code as AiErrorCode) : 'unknown'
}
