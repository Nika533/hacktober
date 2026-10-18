import { PAGE_LIMITS } from '@hoot/core'
import {
  IdSchema,
  LensContextSchema,
  LensEventSchema,
  LensSettingsPatchSchema,
  RewriteRequestSchema
} from '@hoot/core/schemas'
import { z } from 'zod'
import type { ContentMessage } from '../messages'

export const ContentMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('lens.settings.get') }),
  z.object({ type: z.literal('lens.settings.patch'), patch: LensSettingsPatchSchema }),
  z.object({ type: z.literal('lens.profile.get') }),
  z.object({ type: z.literal('lens.rewrite'), reqId: IdSchema, request: RewriteRequestSchema }),
  z.object({ type: z.literal('lens.assess'), reqId: IdSchema, ctx: LensContextSchema }),
  z.object({ type: z.literal('lens.cancel'), reqId: IdSchema }),
  z.object({ type: z.literal('lens.feedback'), event: LensEventSchema }),
  z.object({ type: z.literal('lens.explain'), ctx: LensContextSchema }),
  z.object({ type: z.literal('lens.status') }),
  z.object({ type: z.literal('lens.pdf.native'), url: z.string().url().max(4096) }),
  z.object({
    type: z.literal('page.ask'),
    text: z.string().trim().min(1).max(PAGE_LIMITS.askChars),
    voice: z.boolean()
  }),
  z.object({ type: z.literal('page.current') })
])

export function parseContentMessage(raw: unknown): ContentMessage | null {
  const parsed = ContentMessageSchema.safeParse(raw)
  return parsed.success ? parsed.data : null
}
