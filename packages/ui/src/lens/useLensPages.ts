import type { GlossaryEntry, HootApi, ProfilePatch, ProfileView, RecentChange } from '@hoot/core'
import { useCallback, useEffect, useState } from 'react'

export type LensPagesApi = Pick<
  HootApi['lens'],
  | 'profile'
  | 'patchProfile'
  | 'resetProfile'
  | 'exportProfile'
  | 'recentChanges'
  | 'glossary'
  | 'onProfile'
>

/** How many Recent changes Studio lists. */
export const RECENT_CHANGES_LIMIT = 50

export interface LensPages {
  /** Null while loading. */
  profile: ProfileView | null
  changes: RecentChange[] | null
  glossary: GlossaryEntry[] | null
  /** Main didn't answer. */
  failed: boolean
  reload: () => void
  patch: (patch: ProfilePatch) => Promise<void>
  reset: () => Promise<void>
}

/**
 * The data behind "What Hoot knows about you" and "My glossary", fetched
 * from main while either page is open and refreshed whenever the profile
 * changes (learning from the page, or an edit here).
 */
export function useLensPages(api: LensPagesApi | undefined, active: boolean): LensPages {
  const [profile, setProfile] = useState<ProfileView | null>(null)
  const [changes, setChanges] = useState<RecentChange[] | null>(null)
  const [glossary, setGlossary] = useState<GlossaryEntry[] | null>(null)
  const [failed, setFailed] = useState(false)

  const load = useCallback((): Promise<void> => {
    if (!api) return Promise.resolve()
    return Promise.all([api.profile(), api.recentChanges(RECENT_CHANGES_LIMIT), api.glossary()])
      .then(([p, c, g]) => {
        setProfile(p)
        setChanges(c)
        setGlossary(g)
        setFailed(false)
      })
      .catch(() => setFailed(true))
  }, [api])

  useEffect(() => {
    if (!active || !api) return
    void load()
    return api.onProfile(() => void load())
  }, [active, api, load])

  const patch = useCallback(
    async (p: ProfilePatch): Promise<void> => {
      if (!api) return
      setProfile(await api.patchProfile(p))
      if (p.terms) setGlossary(await api.glossary())
    },
    [api]
  )

  const reset = useCallback(async (): Promise<void> => {
    if (!api) return
    await api.resetProfile()
    await load()
  }, [api, load])

  return { profile, changes, glossary, failed, reload: () => void load(), patch, reset }
}

/** What a glossary pin says: the term on its own line, then the gloss. */
export const glossaryPinText = (e: Pick<GlossaryEntry, 'term' | 'gloss'>): string =>
  `${e.term}\n${e.gloss}`

/** "just now", "5 minutes ago", "3 days ago". */
export function timeAgo(ts: number, now = Date.now()): string {
  const s = Math.round((now - ts) / 1000)
  if (s < 45) return 'just now'
  const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' })
  const steps: [Intl.RelativeTimeFormatUnit, number][] = [
    ['minute', 60],
    ['hour', 3600],
    ['day', 86_400],
    ['week', 604_800],
    ['month', 2_592_000],
    ['year', 31_536_000]
  ]
  let unit: Intl.RelativeTimeFormatUnit = 'minute'
  let size = 60
  for (const [u, n] of steps) if (s >= n * 0.9) [unit, size] = [u, n]
  return rtf.format(-Math.max(1, Math.round(s / size)), unit)
}
