import { DEFAULT_SETTINGS, type LensSettings, type LensSettingsPatch } from '@hoot/core'
import { LensSettingsSchema, applySettingsPatch, migrateSettings } from '@hoot/core/schemas'

export const SETTINGS_KEY = 'lens.settings'

export interface StorageArea {
  get(key: string): Promise<Record<string, unknown>>
  set(items: Record<string, unknown>): Promise<void>
}

export interface SettingsStore {
  get(): Promise<LensSettings>
  patch(patch: LensSettingsPatch): Promise<LensSettings>
  /** Take the app's settings as they are. */
  replace(lens: LensSettings): Promise<void>
}

/** Runs each piece of work after the previous one has finished, failed or not. */
export function createSerial(): <T>(work: () => Promise<T>) => Promise<T> {
  let queue: Promise<unknown> = Promise.resolve()
  return (work) => {
    const run = queue.then(work)
    queue = run.catch(() => undefined)
    return run
  }
}

export function createSettingsStore(area: StorageArea, defaults: LensSettings): SettingsStore {
  async function get(): Promise<LensSettings> {
    const stored = (await area.get(SETTINGS_KEY))[SETTINGS_KEY]
    if (stored === undefined) return defaults
    const parsed = LensSettingsSchema.safeParse(stored)
    return parsed.success ? parsed.data : migrateSettings({ lens: stored }).lens
  }

  const serial = createSerial()

  return {
    get,
    patch: (patch) =>
      serial(async () => {
        const current = await get()
        const next = applySettingsPatch(
          { ...DEFAULT_SETTINGS, lens: current },
          { lens: patch }
        ).lens
        await area.set({ [SETTINGS_KEY]: next })
        return next
      }),
    replace: (lens) => serial(() => area.set({ [SETTINGS_KEY]: lens }))
  }
}
