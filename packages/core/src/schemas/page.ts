import { z } from 'zod'
import { PAGE_LIMITS } from '../page/types'

export const PageInfoSchema = z.object({
  tab: z.number().int().min(0),
  url: z.string().max(PAGE_LIMITS.urlChars),
  title: z.string().max(PAGE_LIMITS.titleChars)
})

export const PageSnapshotSchema = PageInfoSchema.extend({
  site: z.string().max(PAGE_LIMITS.siteChars),
  lang: z.string().max(PAGE_LIMITS.langChars),
  selection: z.string().max(PAGE_LIMITS.selectionChars),
  visible: z.string().max(PAGE_LIMITS.visibleChars),
  text: z.string().max(PAGE_LIMITS.textChars),
  headings: z.array(z.string().max(PAGE_LIMITS.headingChars)).max(PAGE_LIMITS.headings),
  blocked: z.enum(['private', 'never', 'unreadable']).nullable()
})

export const PageMarkSchema = z.object({
  quote: z.string().min(1).max(PAGE_LIMITS.quoteChars),
  label: z.string().max(PAGE_LIMITS.labelChars)
})
