import {
  applyProfilePatch,
  createDefaultProfile,
  profileSnapshot,
  type ProfilePatch,
  type ProfileSnapshot,
  type ReaderProfile,
  type Unsubscribe
} from '@hoot/core'
import { ReaderProfileSchema } from '@hoot/core/schemas'
import type { LensStorage } from './storage'

const FILE = 'profile.json'

/**
 * The reader profile (hoot-lens.md §8.2), persisted to `lens/profile.json`.
 * Every change bumps `version` and notifies listeners, which push
 * `profile.changed` to the extension and `lens:profileChanged` to windows.
 * Update rules from feedback events arrive in C-30.
 */
export class ProfileStore {
  private listeners = new Set<(snapshot: ProfileSnapshot) => void>()
  private writing: Promise<void> = Promise.resolve()

  private constructor(
    private storage: LensStorage,
    private profile: ReaderProfile
  ) {}

  /** A missing or invalid file starts a fresh profile (cold start unless set up). */
  static async load(storage: LensStorage, opts: { coldStart: boolean }): Promise<ProfileStore> {
    const parsed = ReaderProfileSchema.safeParse(await storage.readJson(FILE))
    if (parsed.success) return new ProfileStore(storage, parsed.data)
    const store = new ProfileStore(storage, createDefaultProfile(opts))
    await store.save()
    return store
  }

  get(): ReaderProfile {
    return this.profile
  }

  snapshot(): ProfileSnapshot {
    return profileSnapshot(this.profile)
  }

  onChange(cb: (snapshot: ProfileSnapshot) => void): Unsubscribe {
    this.listeners.add(cb)
    return () => this.listeners.delete(cb)
  }

  async patch(patch: ProfilePatch, now: number): Promise<ReaderProfile> {
    return this.replace(applyProfilePatch(this.profile, patch, now))
  }

  /** Back to defaults; the version keeps counting up so caches stay correct. */
  async reset(opts: { coldStart: boolean }): Promise<ReaderProfile> {
    return this.replace({ ...createDefaultProfile(opts), version: this.profile.version + 1 })
  }

  /** Apply any change (C-30 update rules use this). */
  async replace(next: ReaderProfile): Promise<ReaderProfile> {
    this.profile = next
    await this.save()
    const snapshot = this.snapshot()
    for (const cb of this.listeners) cb(snapshot)
    return next
  }

  /**
   * Writes run one at a time, each with the profile as it is then, so two
   * quick changes can never leave the older one on disk.
   */
  private save(): Promise<void> {
    const write = this.writing.then(() => this.storage.writeJson(FILE, this.profile))
    this.writing = write.catch(() => undefined)
    return write
  }
}
