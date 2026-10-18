import {
  LensBackendError,
  type LensSettings,
  type LensSettingsPatch,
  type ProfileSnapshot
} from '@hoot/core'
import { LensSettingsPatchSchema, ProfileSnapshotSchema } from '@hoot/core/schemas'
import type { BridgeStatus } from '../messages'
import type { BridgeClient } from './bridge'
import type { SettingsStore, StorageArea } from './settings'

export const UNSYNCED_KEY = 'lens.settings.unsynced'
export const PROFILE_KEY = 'lens.profile'
export const RETRY_KEY = 'lens.bridge.retryAt'
export const RETRY_MS = 5 * 60_000

export interface LensSync {
  /** Reads come from the local cache; patches go to the app when it's connected. */
  settings: Pick<SettingsStore, 'get' | 'patch'>
  profile(): Promise<ProfileSnapshot>
  /** Connect in the background, unless a recent attempt failed. */
  warm(): void
  status(connect: boolean): Promise<BridgeStatus>
}

export interface LensSyncOptions {
  bridge: BridgeClient
  store: SettingsStore
  /** Persistent: the settings cache and patches made while the app was away */
  local: StorageArea
  /** Per browser session: the profile snapshot and the reconnect back-off */
  session: StorageArea
  onProfile?(profile: ProfileSnapshot): void
  now?: () => number
}

export function mergePatches(a: LensSettingsPatch, b: LensSettingsPatch): LensSettingsPatch {
  const merged: LensSettingsPatch = { ...a, ...b }
  if (a.sites || b.sites) merged.sites = { ...a.sites, ...b.sites }
  if (a.riskOverrides || b.riskOverrides) {
    merged.riskOverrides = { ...a.riskOverrides, ...b.riskOverrides }
  }
  if (a.languages || b.languages) merged.languages = { ...a.languages, ...b.languages }
  return merged
}

/**
 * Keeps the extension's copy of the app's Lens settings and profile. The app
 * owns both; the service worker caches settings so pages load without
 * waking the app, and queues changes made while the app is away until the
 * next `welcome`.
 */
export function createLensSync(options: LensSyncOptions): LensSync {
  const { bridge, store, local, session } = options
  const now = options.now ?? (() => Date.now())
  let warming = false

  const unsynced = async (): Promise<LensSettingsPatch | null> => {
    const parsed = LensSettingsPatchSchema.safeParse((await local.get(UNSYNCED_KEY))[UNSYNCED_KEY])
    return parsed.success ? parsed.data : null
  }

  const adopt = async (lens: LensSettings): Promise<void> => {
    const queued = await unsynced()
    if (queued) {
      await local.set({ [UNSYNCED_KEY]: null })
      try {
        await store.replace(await bridge.patchSettings(queued))
        return
      } catch {
        await local.set({ [UNSYNCED_KEY]: queued })
      }
    }
    await store.replace(lens)
  }

  bridge.subscribe((event) => {
    if (event.type === 'settings') void adopt(event.lens)
    else if (event.type === 'profile') {
      void session
        .set({ [PROFILE_KEY]: event.profile })
        .then(() => options.onProfile?.(event.profile))
    }
  })

  return {
    settings: {
      get: () => store.get(),
      async patch(patch) {
        if (bridge.connected) {
          try {
            const lens = await bridge.patchSettings(patch)
            await store.replace(lens)
            return lens
          } catch (error) {
            if (!(error instanceof LensBackendError) || error.code !== 'app_unavailable')
              throw error
          }
        }
        const lens = await store.patch(patch)
        const queued = await unsynced()
        await local.set({ [UNSYNCED_KEY]: queued ? mergePatches(queued, patch) : patch })
        return lens
      }
    },
    async profile() {
      const parsed = ProfileSnapshotSchema.safeParse((await session.get(PROFILE_KEY))[PROFILE_KEY])
      if (parsed.success) return parsed.data
      throw new LensBackendError('app_unavailable', 'no profile from Hoot yet')
    },
    warm() {
      if (bridge.connected || warming) return
      warming = true
      void (async () => {
        try {
          const retryAt = (await session.get(RETRY_KEY))[RETRY_KEY]
          if (typeof retryAt === 'number' && now() < retryAt) return
          await bridge.connect()
        } catch {
          await session.set({ [RETRY_KEY]: now() + RETRY_MS })
        } finally {
          warming = false
        }
      })()
    },
    async status(connect) {
      if (connect && !bridge.connected) {
        try {
          await bridge.connect()
          await session.set({ [RETRY_KEY]: 0 })
        } catch {
          await session.set({ [RETRY_KEY]: now() + RETRY_MS })
        }
      }
      return bridge.status()
    }
  }
}
