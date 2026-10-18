import { promises as fs } from 'node:fs'
import {
  applyLensEvent,
  buildExplainMore,
  buildProfileSummary,
  COLD_START_THRESHOLD,
  decayTopics,
  DEFAULT_THRESHOLD,
  THRESHOLD_MAX,
  THRESHOLD_MIN,
  type AssessResult,
  type ExplainMoreMessage,
  type GlossaryEntry,
  type LensContext,
  type LensEvent,
  type LensSettings,
  type ProfilePatch,
  type ProfileSnapshot,
  type ProfileView,
  type RecentChange,
  type RewriteOutcome,
  type RewriteRequest,
  type Unsubscribe
} from '@hoot/core'
import type { AiProvider } from '../ai'
import { LensCache } from './cache'
import { LensEngine } from './engine'
import { LensHistory } from './history'
import { ProfileStore } from './profileStore'
import type { LensStorage } from './storage'

export interface LensServiceDeps {
  storage: LensStorage
  getLensSettings(): LensSettings
  /** Null when no Gemini key is configured. */
  getProvider(): Promise<AiProvider | null>
  /** HOOT_FAKE_LENS=1 */
  fake?: boolean
  now?(): number
  /**
   * "Explain more" (D1-23): open the Hoot card and send `message` right away
   * (`text` shown, `sentText` sent).
   */
  onExplain?(message: ExplainMoreMessage, ctx: LensContext): void
  /** Save dialog for "Export"; resolves with a path, or null when cancelled. */
  chooseExportPath?(defaultName: string): Promise<string | null>
  /** Persistence failures that can't be returned to a caller. */
  onError?(e: unknown): void
}

/**
 * Everything the app does for Lens, behind one object. Used by the IPC
 * handlers (Studio, Reader) and the bridge (extension). Constructed by
 * d1's AppContext after `app.whenReady()`.
 */
export interface LensService {
  assess(reqId: string, ctx: LensContext): Promise<AssessResult>
  rewrite(reqId: string, req: RewriteRequest): Promise<RewriteOutcome>
  cancel(reqId: string): void
  feedback(event: LensEvent): Promise<void>
  explain(ctx: LensContext): Promise<void>
  profileView(): ProfileView
  snapshot(): ProfileSnapshot
  patchProfile(patch: ProfilePatch): Promise<ProfileView>
  /** Forget the profile, Recent changes, the glossary, events and cache. */
  resetProfile(): Promise<void>
  exportProfile(): Promise<string | null>
  recentChanges(limit: number): RecentChange[]
  glossary(): GlossaryEntry[]
  onProfile(cb: (snapshot: ProfileSnapshot) => void): Unsubscribe
  /** Write pending state; call before quit. */
  flush(): Promise<void>
}

export async function createLensService(deps: LensServiceDeps): Promise<LensService> {
  const now = deps.now ?? Date.now
  const onError = deps.onError ?? ((e: unknown) => console.error('[lens]', e))
  const coldStart = (): boolean => !deps.getLensSettings().coldStartDone

  const [cache, profile, history] = await Promise.all([
    LensCache.load(deps.storage, now, onError),
    ProfileStore.load(deps.storage, { coldStart: coldStart() }),
    LensHistory.load(deps.storage)
  ])
  await history.prune(deps.getLensSettings().retentionDays, now()).catch(onError)
  // Topics not seen for 60 days drift back toward 0.5 (hoot-lens.md §8.3).
  const decayed = decayTopics(profile.get(), now())
  if (decayed !== profile.get()) await profile.replace(decayed).catch(onError)

  const engine = new LensEngine({
    getProvider: deps.getProvider,
    getLensSettings: deps.getLensSettings,
    profile,
    cache,
    fake: deps.fake ?? false,
    now
  })

  // Finishing the cold-start setup (Studio → Reading, hoot-lens.md §8.4)
  // relaxes Lens at once: the cold-start premium comes off the threshold
  // (what feedback taught it stays) and the remaining Ask-first triggers go.
  // Checked on every call, since the setting arrives through settings, not
  // here; a profile still in cold start at launch is finished too (#59).
  let coldStartDoneSeen = deps.getLensSettings().coldStartDone
  const syncColdStart = (): void => {
    const done = deps.getLensSettings().coldStartDone
    const flipped = done && !coldStartDoneSeen
    coldStartDoneSeen = done
    const current = profile.get()
    if (!flipped && !(done && current.askFirstRemaining > 0)) return
    const premium = COLD_START_THRESHOLD - DEFAULT_THRESHOLD
    // replace() swaps the profile synchronously, then saves and notifies.
    void profile
      .replace({
        ...current,
        threshold: Math.min(THRESHOLD_MAX, Math.max(THRESHOLD_MIN, current.threshold - premium)),
        askFirstRemaining: 0,
        version: current.version + 1
      })
      .catch(onError)
  }
  syncColdStart()

  const view = (): ProfileView => ({
    profile: profile.get(),
    summary: buildProfileSummary(profile.get(), deps.getLensSettings().languages)
  })

  return {
    assess: (reqId, ctx) => {
      syncColdStart()
      return engine.assess(reqId, ctx)
    },
    rewrite: (reqId, req) => {
      syncColdStart()
      return engine.rewrite(reqId, req)
    },
    cancel: (reqId) => engine.cancel(reqId),
    async feedback(event) {
      syncColdStart()
      // Measured from the change's `shown` event, before this event is recorded.
      const shownAt = event.kind === 'shown' ? undefined : history.shownAt(event.cacheKey)
      await history.record(event, (key) => cache.getRewrite(key))
      const current = profile.get()
      const next = applyLensEvent(current, event, {
        msSinceShown: shownAt === undefined ? null : Math.max(0, event.ts - shownAt),
        now: now()
      })
      if (JSON.stringify(next) !== JSON.stringify(current)) await profile.replace(next)
    },
    async explain(ctx) {
      const summary = buildProfileSummary(profile.get(), deps.getLensSettings().languages, ctx)
      deps.onExplain?.(buildExplainMore(ctx, summary), ctx)
    },
    profileView: () => {
      syncColdStart()
      return view()
    },
    snapshot: () => {
      syncColdStart()
      return profile.snapshot()
    },
    async patchProfile(patch) {
      syncColdStart()
      await profile.patch(patch, now())
      return view()
    },
    async resetProfile() {
      await profile.reset({ coldStart: coldStart() })
      cache.clear()
      await history.clear()
    },
    async exportProfile() {
      const path = await deps.chooseExportPath?.('hoot-reading-profile.json')
      if (!path) return null
      const data = {
        exportedAt: new Date(now()).toISOString(),
        profile: profile.get(),
        glossary: history.glossary(),
        languages: deps.getLensSettings().languages
      }
      await fs.writeFile(path, JSON.stringify(data, null, 2), 'utf8')
      return path
    },
    recentChanges: (limit) => history.recentChanges(limit),
    glossary: () => history.glossary(),
    onProfile: (cb) => profile.onChange(cb),
    flush: () => cache.flush()
  }
}
