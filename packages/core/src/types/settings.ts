import { DEFAULT_CHAT_MODEL, type ChatModelId } from '../models'
import type { Point, Rect } from './app'
import type { LensMode, SiteRule } from './lens'

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
  retentionDays: RetentionDays
  coldStartDone: boolean
}

export interface Settings {
  schemaVersion: typeof SETTINGS_SCHEMA_VERSION
  model: ChatModelId
  summonHotkey: string
  captureHotkey: string
  launchAtLogin: boolean
  saveHistory: boolean
  restorePins: boolean
  clipboardHint: boolean
  translateTo: string
  collapseToDotAfterMs: number
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
  retentionDays: 90,
  coldStartDone: false
}

export const DEFAULT_SETTINGS: Settings = {
  schemaVersion: SETTINGS_SCHEMA_VERSION,
  model: DEFAULT_CHAT_MODEL,
  summonHotkey: 'CommandOrControl+Shift+Space',
  captureHotkey: 'CommandOrControl+Alt+Space',
  launchAtLogin: false,
  saveHistory: true,
  restorePins: true,
  clipboardHint: true,
  translateTo: 'English',
  collapseToDotAfterMs: 5000,
  pillAnchor: null,
  studioBounds: null,
  onboardingDone: false,
  lens: DEFAULT_LENS_SETTINGS
}

/** Lens settings a renderer or the extension may change; `null` deletes a site rule. */
export type LensSettingsPatch = Partial<Omit<LensSettings, 'sites' | 'languages'>> & {
  sites?: Record<string, SiteRule | null>
  languages?: Partial<LensSettings['languages']>
}

/** Settings a renderer may change through `settings.update`. */
export type SettingsPatch = Partial<
  Pick<
    Settings,
    | 'model'
    | 'summonHotkey'
    | 'captureHotkey'
    | 'launchAtLogin'
    | 'saveHistory'
    | 'restorePins'
    | 'clipboardHint'
    | 'translateTo'
    | 'collapseToDotAfterMs'
  >
> & { lens?: LensSettingsPatch }
