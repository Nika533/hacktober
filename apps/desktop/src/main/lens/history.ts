import {
  profileKey,
  type GlossaryEntry,
  type LensEvent,
  type RecentChange,
  type RetentionDays
} from '@hoot/core'
import type { CachedRewrite } from './cache'
import type { LensStorage } from './storage'

const RECENT_FILE = 'recent-changes.json'
const GLOSSARY_FILE = 'glossary.json'
const MAX_RECENT = 200
const DAY_MS = 24 * 60 * 60 * 1000

const asArray = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])

function isRecentChange(v: unknown): v is RecentChange {
  const r = v as Partial<RecentChange> | null
  return (
    typeof r?.id === 'string' &&
    typeof r.ts === 'number' &&
    typeof r.original === 'string' &&
    typeof r.rewrite === 'string'
  )
}

function isGlossaryEntry(v: unknown): v is GlossaryEntry {
  const g = v as Partial<GlossaryEntry> | null
  return (
    typeof g?.term === 'string' && typeof g.gloss === 'string' && typeof g.lastSeen === 'number'
  )
}

/** `events-2026-10.jsonl`: one file per month, so retention deletes whole files. */
export const eventsFileFor = (ts: number): string => {
  const d = new Date(ts)
  return `events-${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}.jsonl`
}

/**
 * The local record of what Lens did (hoot-lens.md §8.1, §8.6, §11):
 * - every feedback event, appended to a monthly JSONL log
 * - Recent changes: what was actually shown, with original and rewrite
 * - My glossary: define/expand rewrites the reader kept
 *
 * Nothing is recorded when the model merely answers: only `shown` (rendered
 * by lens-dom) creates a Recent change.
 */
export class LensHistory {
  private constructor(
    private storage: LensStorage,
    private recent: RecentChange[],
    private glossaryMap: Map<string, GlossaryEntry>
  ) {}

  static async load(storage: LensStorage): Promise<LensHistory> {
    const recent = asArray(await storage.readJson(RECENT_FILE)).filter(isRecentChange)
    const glossary = asArray(await storage.readJson(GLOSSARY_FILE)).filter(isGlossaryEntry)
    return new LensHistory(
      storage,
      recent.slice(0, MAX_RECENT),
      new Map(glossary.map((g) => [profileKey(g.term), g]))
    )
  }

  /**
   * Log an event and update Recent changes / the glossary.
   * `lookup` finds the rewrite an event refers to (by `cacheKey`).
   */
  async record(
    event: LensEvent,
    lookup: (cacheKey: string) => CachedRewrite | undefined
  ): Promise<void> {
    await this.storage.appendLine(eventsFileFor(event.ts), JSON.stringify(event))
    const rewrite = event.cacheKey ? lookup(event.cacheKey) : undefined
    if (!rewrite) return

    if (event.kind === 'shown' && !this.recent.some((r) => r.id === event.cacheKey)) {
      this.recent.unshift({
        id: rewrite.result.cacheKey,
        ts: event.ts,
        site: event.site,
        transform: rewrite.result.transform,
        action: rewrite.result.action,
        original: rewrite.original,
        rewrite: rewrite.result.text,
        term: rewrite.result.term
      })
      this.recent.length = Math.min(this.recent.length, MAX_RECENT)
      await this.storage.writeJson(RECENT_FILE, this.recent)
    }

    const { transform } = rewrite.result
    const term = event.term ?? rewrite.result.term
    if ((transform === 'define' || transform === 'expand') && term) {
      if (event.kind === 'kept') await this.upsertGlossary(term, rewrite, event)
      if (event.kind === 'knew_it') await this.markGlossary(term, 'known')
      if (event.kind === 'explain_more') await this.markGlossary(term, 'unknown')
    }
  }

  /** When the change with this cache key was shown, if it's still in Recent changes. */
  shownAt(cacheKey: string | undefined): number | undefined {
    return cacheKey ? this.recent.find((r) => r.id === cacheKey)?.ts : undefined
  }

  recentChanges(limit: number): RecentChange[] {
    return this.recent.slice(0, limit)
  }

  glossary(): GlossaryEntry[] {
    return [...this.glossaryMap.values()].sort((a, b) => b.lastSeen - a.lastSeen)
  }

  /** Delete event logs older than the retention window (whole months). */
  async prune(retentionDays: RetentionDays, now: number): Promise<void> {
    const keepFrom = eventsFileFor(now - retentionDays * DAY_MS)
    for (const name of await this.storage.list()) {
      if (/^events-\d{4}-\d{2}\.jsonl$/.test(name) && name < keepFrom) {
        await this.storage.remove(name)
      }
    }
    const cutoff = now - retentionDays * DAY_MS
    const before = this.recent.length
    this.recent = this.recent.filter((r) => r.ts >= cutoff)
    if (this.recent.length !== before) await this.storage.writeJson(RECENT_FILE, this.recent)
  }

  /** "Reset" in Studio: forget everything Lens recorded. */
  async clear(): Promise<void> {
    this.recent = []
    this.glossaryMap.clear()
    await this.storage.writeJson(RECENT_FILE, this.recent)
    await this.storage.writeJson(GLOSSARY_FILE, [])
    for (const name of await this.storage.list()) {
      if (name.startsWith('events-')) await this.storage.remove(name)
    }
  }

  private async upsertGlossary(
    term: string,
    rewrite: CachedRewrite,
    event: LensEvent
  ): Promise<void> {
    const key = profileKey(term)
    const existing = this.glossaryMap.get(key)
    this.glossaryMap.set(key, {
      term: existing?.term ?? term.trim(),
      gloss: rewrite.result.text,
      transform: rewrite.result.transform === 'expand' ? 'expand' : 'define',
      site: existing?.site ?? event.site,
      firstSeen: existing?.firstSeen ?? event.ts,
      lastSeen: event.ts,
      state: existing?.state === 'known' ? 'known' : 'learning'
    })
    await this.saveGlossary()
  }

  private async markGlossary(term: string, state: GlossaryEntry['state']): Promise<void> {
    const entry = this.glossaryMap.get(profileKey(term))
    if (!entry) return
    this.glossaryMap.set(profileKey(term), { ...entry, state })
    await this.saveGlossary()
  }

  private saveGlossary(): Promise<void> {
    return this.storage.writeJson(GLOSSARY_FILE, this.glossary())
  }
}
