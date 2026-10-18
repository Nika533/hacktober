import { DEFAULT_SETTINGS, type LensSettings, type LensSettingsPatch } from '@hoot/core'
import { LensSettingsSchema, applySettingsPatch } from '@hoot/core/schemas'

export const SETTINGS_KEY = 'lens.settings'

export interface StorageArea {
  get(key: string): Promise<Record<string, unknown>>
  set(items: Record<string, unknown>): Promise<void>
}

export interface SettingsStore {
  get(): Promise<LensSettings>
  patch(patch: LensSettingsPatch): Promise<LensSettings>
}

export function createSettingsStore(area: StorageArea, defaults: LensSettings): SettingsStore {
  async function get(): Promise<LensSettings> {
    const stored = await area.get(SETTINGS_KEY)
    const parsed = LensSettingsSchema.safeParse(stored[SETTINGS_KEY])
    return parsed.success ? parsed.data : defaults
  }

  return {
    get,
    async patch(patch) {
      const current = await get()
      const next = applySettingsPatch({ ...DEFAULT_SETTINGS, lens: current }, { lens: patch }).lens
      await area.set({ [SETTINGS_KEY]: next })
      return next
    }
  }
}
