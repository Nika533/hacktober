import { promises as fs } from 'node:fs'
import {
  applyLensEvent,
  buildExplainMore,
  buildProfileSummary,
  decayTopics,
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

  const view = (): ProfileView => ({
    profile: profile.get(),
    summary: buildProfileSummary(profile.get(), deps.getLensSettings().languages)
  })

  return {
    assess: (reqId, ctx) => engine.assess(reqId, ctx),
    rewrite: (reqId, req) => engine.rewrite(reqId, req),
    cancel: (reqId) => engine.cancel(reqId),
    async feedback(event) {
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
    profileView: view,
    snapshot: () => profile.snapshot(),
    async patchProfile(patch) {
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
