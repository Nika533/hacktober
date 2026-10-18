import type { AssessResult, RewriteResult } from '@hoot/core'
import { RewriteResultSchema } from '@hoot/core/schemas'
import type { LensStorage } from './storage'

export interface CachedRewrite {
  result: RewriteResult
  /** The selection that was rewritten (for Recent changes) */
  original: string
  site: string
  ts: number
}

interface CacheFile {
  version: 1
  rewrites: [string, CachedRewrite][]
}

const FILE = 'cache.json'
const MAX_REWRITES = 500
const MAX_ASSESS = 500
const TTL_MS = 30 * 24 * 60 * 60 * 1000
const SAVE_DELAY_MS = 2000

/**
 * Rewrite cache (hoot-lens.md §7.2): an LRU in memory, persisted to
 * `lens/cache.json`. Keys come from `lensCacheKey`, which includes the
 * profile version, so editing the profile retires old entries naturally.
 * Assess results are cached in memory only.
 */
export class LensCache {
  private rewrites = new Map<string, CachedRewrite>()
  private assess = new Map<string, AssessResult>()
  private saveTimer: ReturnType<typeof setTimeout> | null = null
  private saving: Promise<void> = Promise.resolve()

  private constructor(
    private storage: LensStorage,
    private onError: (e: unknown) => void
  ) {}

  static async load(
    storage: LensStorage,
    now: () => number,
    onError: (e: unknown) => void
  ): Promise<LensCache> {
    const cache = new LensCache(storage, onError)
    const raw = (await storage.readJson(FILE)) as CacheFile | null
    if (raw?.version === 1 && Array.isArray(raw.rewrites)) {
      const cutoff = now() - TTL_MS
      for (const [key, entry] of raw.rewrites) {
        const valid =
          typeof key === 'string' &&
          typeof entry?.original === 'string' &&
          typeof entry.site === 'string' &&
          typeof entry.ts === 'number' &&
          RewriteResultSchema.safeParse(entry.result).success
        if (valid && entry.ts >= cutoff) {
          cache.rewrites.set(key, entry)
        }
      }
    }
    return cache
  }

  getRewrite(key: string): CachedRewrite | undefined {
    const hit = this.rewrites.get(key)
    if (!hit) return undefined
    this.rewrites.delete(key)
    this.rewrites.set(key, hit)
    return hit
  }

  setRewrite(key: string, entry: CachedRewrite): void {
    this.rewrites.delete(key)
    this.rewrites.set(key, entry)
    while (this.rewrites.size > MAX_REWRITES) {
      const oldest = this.rewrites.keys().next().value
      if (oldest === undefined) break
      this.rewrites.delete(oldest)
    }
    this.scheduleSave()
  }

  getAssess(key: string): AssessResult | undefined {
    return this.assess.get(key)
  }

  setAssess(key: string, result: AssessResult): void {
    this.assess.set(key, result)
    if (this.assess.size > MAX_ASSESS) {
      const oldest = this.assess.keys().next().value
      if (oldest !== undefined) this.assess.delete(oldest)
    }
  }

  clear(): void {
    this.rewrites.clear()
    this.assess.clear()
    this.scheduleSave()
  }

  private scheduleSave(): void {
    if (this.saveTimer) return
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null
      void this.flush()
    }, SAVE_DELAY_MS)
  }

  /** Write now (also called on quit). */
  flush(): Promise<void> {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer)
      this.saveTimer = null
    }
    const data: CacheFile = { version: 1, rewrites: [...this.rewrites.entries()] }
    this.saving = this.saving.then(() => this.storage.writeJson(FILE, data)).catch(this.onError)
    return this.saving
  }
}
