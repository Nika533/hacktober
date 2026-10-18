import { z } from 'zod'
import { CHAT_MODEL_IDS, LEGACY_CHAT_MODELS } from '../models'
import {
  DEFAULT_SETTINGS,
  SETTINGS_SCHEMA_VERSION,
  type LensSettings,
  type Settings,
  type SettingsPatch
} from '../types/settings'
import { LangSchema, PointSchema, RectSchema, SiteSchema, TimestampSchema } from './common'

export const SiteRuleSchema = z.enum(['always', 'paused', 'never'])
export const LensModeSchema = z.enum(['auto', 'gloss', 'ask'])
const DomainRiskSchema = z.enum(['normal', 'high'])

const MAX_SITE_RULES = 2000

export const LensSettingsSchema = z.object({
  enabled: z.boolean(),
  consentedAt: TimestampSchema.nullable(),
  mode: LensModeSchema,
  sensitivity: z.number().min(-1).max(1),
  highStakes: z.enum(['gloss', 'allow-replace']),
  copyBehavior: z.enum(['original', 'visible']),
  languages: z.object({
    primary: LangSchema,
    comfortable: z.array(LangSchema).max(20)
  }),
  sites: z
    .record(SiteSchema, SiteRuleSchema)
    .refine((r) => Object.keys(r).length <= MAX_SITE_RULES, 'too many site rules'),
  riskOverrides: z
    .record(SiteSchema, DomainRiskSchema)
    .refine((r) => Object.keys(r).length <= MAX_SITE_RULES, 'too many overrides'),
  retentionDays: z.union([z.literal(30), z.literal(90), z.literal(365)]),
  coldStartDone: z.boolean()
})

const HotkeySchema = z.string().min(1).max(64)

export const SettingsSchema = z.object({
  schemaVersion: z.literal(SETTINGS_SCHEMA_VERSION),
  model: z.enum(CHAT_MODEL_IDS),
  summonHotkey: HotkeySchema,
  captureHotkey: HotkeySchema,
  launchAtLogin: z.boolean(),
  saveHistory: z.boolean(),
  restorePins: z.boolean(),
  clipboardHint: z.boolean(),
  translateTo: z.string().trim().min(1).max(40),
  collapseToDotAfterMs: z.number().int().min(0).max(600_000),
  pillAnchor: PointSchema.nullable(),
  studioBounds: RectSchema.nullable(),
  onboardingDone: z.boolean(),
  lens: LensSettingsSchema
})

export const LensSettingsPatchSchema = z.strictObject({
  enabled: LensSettingsSchema.shape.enabled.optional(),
  consentedAt: LensSettingsSchema.shape.consentedAt.optional(),
  mode: LensModeSchema.optional(),
  sensitivity: LensSettingsSchema.shape.sensitivity.optional(),
  highStakes: LensSettingsSchema.shape.highStakes.optional(),
  copyBehavior: LensSettingsSchema.shape.copyBehavior.optional(),
  languages: z
    .strictObject({
      primary: LangSchema.optional(),
      comfortable: z.array(LangSchema).max(20).optional()
    })
    .optional(),
  sites: z.record(SiteSchema, SiteRuleSchema.nullable()).optional(),
  riskOverrides: z.record(SiteSchema, DomainRiskSchema.nullable()).optional(),
  retentionDays: LensSettingsSchema.shape.retentionDays.optional(),
  coldStartDone: z.boolean().optional()
})

/** What renderers may send to `settings.update`; unknown keys are rejected. */
export const SettingsPatchSchema = z.strictObject({
  model: SettingsSchema.shape.model.optional(),
  summonHotkey: HotkeySchema.optional(),
  captureHotkey: HotkeySchema.optional(),
  launchAtLogin: z.boolean().optional(),
  saveHistory: z.boolean().optional(),
  restorePins: z.boolean().optional(),
  clipboardHint: z.boolean().optional(),
  translateTo: SettingsSchema.shape.translateTo.optional(),
  collapseToDotAfterMs: SettingsSchema.shape.collapseToDotAfterMs.optional(),
  lens: LensSettingsPatchSchema.optional()
})

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

/** Keep each valid field, replace each invalid one with its default. */
function salvage<T extends object>(
  raw: unknown,
  shape: Record<string, z.ZodType>,
  defaults: T,
  skip: readonly string[] = []
): T {
  const src = isRecord(raw) ? raw : {}
  const out: Record<string, unknown> = { ...(defaults as Record<string, unknown>) }
  for (const key of Object.keys(defaults)) {
    if (skip.includes(key)) continue
    const field = shape[key]
    if (!field) continue
    const parsed = field.safeParse(src[key])
    if (parsed.success) out[key] = parsed.data
  }
  return out as T
}

/**
 * Read settings.json of any version. Invalid fields fall back to their
 * defaults one by one, so one bad value never resets everything. A Gemini
 * model from before the move to Claude becomes the Claude model with the same
 * role; an older Claude model name falls back to the default model.
 */
export function migrateSettings(raw: unknown): Settings {
  if (isRecord(raw) && typeof raw.model === 'string' && raw.model in LEGACY_CHAT_MODELS) {
    raw = { ...raw, model: LEGACY_CHAT_MODELS[raw.model] }
  }
  const lens = salvage<LensSettings>(
    isRecord(raw) ? raw.lens : undefined,
    LensSettingsSchema.shape,
    DEFAULT_SETTINGS.lens
  )
  const settings = salvage<Settings>(raw, SettingsSchema.shape, DEFAULT_SETTINGS, [
    'schemaVersion',
    'lens'
  ])
  return { ...settings, schemaVersion: SETTINGS_SCHEMA_VERSION, lens }
}

/** Apply a validated patch without mutating `settings`. */
export function applySettingsPatch(settings: Settings, patch: SettingsPatch): Settings {
  const { lens: lensPatch, ...top } = patch
  const next: Settings = { ...settings, ...stripUndefined(top) }
  if (!lensPatch) return next

  const { sites, riskOverrides, languages, ...lensTop } = lensPatch
  const lens: LensSettings = { ...settings.lens, ...stripUndefined(lensTop) }
  if (languages) lens.languages = { ...settings.lens.languages, ...stripUndefined(languages) }
  if (sites) lens.sites = mergeRecord(settings.lens.sites, sites)
  if (riskOverrides) lens.riskOverrides = mergeRecord(settings.lens.riskOverrides, riskOverrides)
  next.lens = lens
  return next
}

/** Merge a keyed patch where null removes the key. */
function mergeRecord<V>(
  base: Record<string, V>,
  patch: Record<string, V | null>
): Record<string, V> {
  const merged = { ...base }
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) delete merged[key]
    else merged[key] = value
  }
  return merged
}

function stripUndefined<T extends object>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>
}
