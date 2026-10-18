import { DEFAULT_CHAT_MODEL, type ChatModelId } from '../models'
import type { Point, Rect } from './app'
import type { DomainRisk, LensMode, SiteRule } from './lens'

export const SETTINGS_SCHEMA_VERSION = 2

export type RetentionDays = 30 | 90 | 365

export interface LensSettings {
  /** Off until the user consents in Studio (hoot-lens.md §11). */
  enabled: boolean
  consentedAt: number | null
  mode: LensMode
  /** -1 = fewer changes … 1 = more changes; shifts the user threshold. */
  sensitivity: number
  highStakes: 'gloss' | 'allow-replace'
  copyBehavior: 'original' | 'visible'
  /** BCP 47 tags; translation is skipped for these. */
  languages: { primary: string; comfortable: string[] }
  /** Keyed by registrable domain. */
  sites: Record<string, SiteRule>
  /** Per-site override of the high-stakes classification (hoot-lens.md §7.5). */
  riskOverrides: Record<string, DomainRisk>
  retentionDays: RetentionDays
  coldStartDone: boolean
}

export interface Settings {
  schemaVersion: typeof SETTINGS_SCHEMA_VERSION
  model: ChatModelId
  summonHotkey: string
  captureHotkey: string
  /** Lens anywhere: explain the text selected in any app. */
  lensHotkey: string
  launchAtLogin: boolean
  saveHistory: boolean
  restorePins: boolean
  clipboardHint: boolean
  translateTo: string
  collapseToDotAfterMs: number
  /** Voice chats: Hoot reads its answers aloud (off: it only listens). */
  voiceReplies: boolean
  /** Speaking speed, VOICE_RATES.min … max (0 is Windows' normal speed). */
  voiceRate: number
  /** Managed by main (window placement); not renderer-editable. */
  pillAnchor: Point | null
  studioBounds: Rect | null
  onboardingDone: boolean
  lens: LensSettings
}

export const DEFAULT_LENS_SETTINGS: LensSettings = {
  enabled: false,
  consentedAt: null,
  mode: 'auto',
  sensitivity: 0,
  highStakes: 'gloss',
  copyBehavior: 'original',
  languages: { primary: 'en', comfortable: [] },
  sites: {},
  riskOverrides: {},
  retentionDays: 90,
  coldStartDone: false
}

export const DEFAULT_SETTINGS: Settings = {
  schemaVersion: SETTINGS_SCHEMA_VERSION,
  model: DEFAULT_CHAT_MODEL,
  summonHotkey: 'CommandOrControl+Shift+Space',
  captureHotkey: 'CommandOrControl+Alt+Space',
  lensHotkey: 'CommandOrControl+Alt+L',
  launchAtLogin: false,
  saveHistory: true,
  restorePins: true,
  clipboardHint: true,
  translateTo: 'English',
  collapseToDotAfterMs: 5000,
  voiceReplies: true,
  voiceRate: 1,
  pillAnchor: null,
  studioBounds: null,
  onboardingDone: false,
  lens: DEFAULT_LENS_SETTINGS
}

/** Lens settings a renderer or the extension may change; `null` deletes a site rule. */
export type LensSettingsPatch = Partial<
  Omit<LensSettings, 'sites' | 'riskOverrides' | 'languages'>
> & {
  sites?: Record<string, SiteRule | null>
  riskOverrides?: Record<string, DomainRisk | null>
  languages?: Partial<LensSettings['languages']>
}

/** Settings a renderer may change through `settings.update`. */
export type SettingsPatch = Partial<
  Pick<
    Settings,
    | 'model'
    | 'summonHotkey'
    | 'captureHotkey'
    | 'lensHotkey'
    | 'launchAtLogin'
    | 'saveHistory'
    | 'restorePins'
    | 'clipboardHint'
    | 'translateTo'
    | 'collapseToDotAfterMs'
    | 'voiceReplies'
    | 'voiceRate'
  >
> & { lens?: LensSettingsPatch }
