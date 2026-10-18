import type { SessionMeta } from '../types/chat'

export type SessionGroupLabel = 'Today' | 'Yesterday' | 'Previous 7 days' | 'Older'

export interface SessionGroup {
  label: SessionGroupLabel
  items: SessionMeta[]
}

/** Local midnight `daysAgo` calendar days before `d` (DST days are 23 or 25 hours). */
function startOfDay(d: Date, daysAgo = 0): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() - daysAgo).getTime()
}

/** Group sessions by recency of updatedAt, preserving their sort order. */
export function groupSessions(metas: SessionMeta[], now: Date): SessionGroup[] {
  const today = startOfDay(now)
  const yesterday = startOfDay(now, 1)
  const weekAgo = startOfDay(now, 6)
  const groups: Record<SessionGroupLabel, SessionMeta[]> = {
    Today: [],
    Yesterday: [],
    'Previous 7 days': [],
    Older: []
  }
  for (const m of metas) {
    if (m.updatedAt >= today) groups.Today.push(m)
    else if (m.updatedAt >= yesterday) groups.Yesterday.push(m)
    else if (m.updatedAt >= weekAgo) groups['Previous 7 days'].push(m)
    else groups.Older.push(m)
  }
  return (Object.keys(groups) as SessionGroupLabel[])
    .filter((label) => groups[label].length > 0)
    .map((label) => ({ label, items: groups[label] }))
}
