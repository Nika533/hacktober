import { z } from 'zod'
import { LENS_EVENT_KINDS, LENS_LIMITS, SITE_CATEGORIES, TRANSFORMS } from '../types/lens'
import { IdSchema, LangSchema, SiteSchema, TimestampSchema, UnitSchema } from './common'
import { LensModeSchema } from './settings'

export const TransformSchema = z.enum(TRANSFORMS)
export const RenderActionSchema = z.enum(['replace', 'gloss'])
export const DomainRiskSchema = z.enum(['normal', 'high'])
export const SiteCategorySchema = z.enum(SITE_CATEGORIES)
export const TermStateSchema = z.enum(['known', 'learning', 'unknown'])
export const DifficultyReasonSchema = z.enum([
  'jargon',
  'acronym',
  'dense_sentence',
  'foreign_language',
  'notation',
  'none'
])
export const SkipReasonSchema = z.enum([
  'model_skip',
  'meaning_not_preserved',
  'low_confidence',
  'invalid_output',
  'lens_off',
  'cancelled'
])

export const LensSignalsSchema = z.object({
  sizeClass: z.enum(['term', 'phrase', 'sentence', 'passage', 'multi-paragraph']),
  copiedWithinMs: z.number().nonnegative().nullable(),
  dwellMs: z.number().nonnegative(),
  reselectCount: z.number().int().nonnegative(),
  reread: UnitSchema,
  rarity: UnitSchema,
  knownTerm: z.boolean(),
  topicFamiliarity: UnitSchema.nullable(),
  foreignLanguage: z.boolean(),
  blocked: z.enum(['editable', 'code', 'denied', 'paused', 'typing', 'fast-scroll']).nullable()
})

export const LensContextSchema = z.object({
  span: z.string().min(1).max(LENS_LIMITS.span),
  paragraph: z.string().max(LENS_LIMITS.paragraph),
  headingPath: z.array(z.string().max(LENS_LIMITS.heading)).max(LENS_LIMITS.headings),
  title: z.string().max(LENS_LIMITS.title),
  lang: LangSchema,
  site: SiteSchema,
  siteCategory: SiteCategorySchema,
  surface: z.enum(['html', 'pdf', 'reader']),
  signals: LensSignalsSchema,
  p: UnitSchema
})

export const RewriteRequestSchema = z.object({
  ctx: LensContextSchema,
  allowedTransforms: z.array(TransformSchema).min(1).max(TRANSFORMS.length),
  risk: DomainRiskSchema
})

export const AssessResultSchema = z.object({
  difficulty: UnitSchema,
  reason: DifficultyReasonSchema,
  term: z.string().max(200).nullable()
})

export const RewriteResultSchema = z.object({
  action: RenderActionSchema,
  transform: TransformSchema,
  text: z.string().min(1).max(2000),
  term: z.string().max(200).nullable(),
  confidence: UnitSchema,
  cacheKey: z.string().max(64),
  latencyMs: z.number().nonnegative(),
  cached: z.boolean()
})

export const RewriteOutcomeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('rewritten'), result: RewriteResultSchema }),
  z.object({ kind: z.literal('skipped'), reason: SkipReasonSchema })
])

export const LensEventSchema = z.object({
  id: IdSchema,
  ts: TimestampSchema,
  site: SiteSchema,
  urlHash: z.string().max(128),
  kind: z.enum(LENS_EVENT_KINDS),
  transform: TransformSchema,
  mode: z.enum(['replace', 'gloss', 'ask']),
  term: z.string().max(200).nullable(),
  topic: z.string().max(200).nullable(),
  lang: LangSchema,
  spanWords: z.number().int().nonnegative(),
  p: UnitSchema,
  difficulty: UnitSchema.nullable(),
  latencyMs: z.number().nonnegative()
})

const PerSiteSchema = z.record(
  SiteSchema,
  z.object({
    threshold: UnitSchema.optional(),
    mode: z.union([LensModeSchema, z.literal('off')]).optional()
  })
)

export const ReaderProfileSchema = z.object({
  version: z.number().int().nonnegative(),
  readingLevel: z.object({ estimate: z.number(), confidence: UnitSchema }),
  readingPaceWpm: z.number().nonnegative(),
  terms: z.record(
    z.string().max(200),
    z.object({
      state: TermStateSchema,
      seen: z.number().int().nonnegative(),
      updatedAt: TimestampSchema
    })
  ),
  topics: z.record(
    z.string().max(200),
    z.object({
      familiarity: UnitSchema,
      depth: z.number().int().nonnegative(),
      updatedAt: TimestampSchema
    })
  ),
  style: z.object({
    length: z.enum(['shorter', 'same']),
    analogies: z.boolean(),
    plainWords: z.boolean()
  }),
  threshold: UnitSchema,
  askFirstRemaining: z.number().int().nonnegative(),
  perSite: PerSiteSchema
})

export const ProfileSnapshotSchema = z.object({
  version: z.number().int().nonnegative(),
  threshold: UnitSchema,
  askFirstRemaining: z.number().int().nonnegative(),
  knownTerms: z.array(z.string().max(200)).max(2000),
  perSite: PerSiteSchema
})

export const ProfilePatchSchema = z.strictObject({
  terms: z.record(z.string().min(1).max(200), TermStateSchema.nullable()).optional(),
  topics: z.record(z.string().min(1).max(200), UnitSchema.nullable()).optional(),
  style: z
    .strictObject({
      length: z.enum(['shorter', 'same']).optional(),
      analogies: z.boolean().optional(),
      plainWords: z.boolean().optional()
    })
    .optional()
})

/** What the gray-zone model call must return (hoot-lens.md §7.3). */
export const AssessModelOutputSchema = z.object({
  difficulty: UnitSchema,
  reason: DifficultyReasonSchema,
  term: z.string().max(200).nullable()
})

/** What the rewrite model call must return (hoot-lens.md §7.3). */
export const RewriteModelOutputSchema = z.object({
  action: z.enum(['replace', 'gloss', 'skip']),
  transform: TransformSchema,
  text: z.string().max(2000),
  term: z.string().max(200).nullable(),
  meaning_preserved: z.boolean(),
  confidence: UnitSchema
})
