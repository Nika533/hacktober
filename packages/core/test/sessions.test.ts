import { afterEach, describe, expect, it } from 'vitest'
import { groupSessions } from '../src/chat/sessions'
import type { SessionMeta } from '../src/types/chat'

const DAY = 24 * 60 * 60 * 1000

function meta(id: string, updatedAt: number): SessionMeta {
  return { id, title: id, createdAt: updatedAt, updatedAt, messageCount: 0 }
}

// Noon on a Wednesday — boundaries don't touch a midnight edge case.
const NOW = new Date(2025, 5, 18, 12, 0, 0)
const today = new Date(2025, 5, 18).getTime()

describe('groupSessions', () => {
  it('groups by recency and drops empty groups', () => {
    const metas = [
      meta('a', NOW.getTime()), // today
      meta('b', today - 1000), // yesterday (just before midnight)
      meta('c', today - 3 * DAY), // previous 7 days
      meta('d', today - 30 * DAY) // older
    ]
    const groups = groupSessions(metas, NOW)
    expect(groups.map((g) => g.label)).toEqual(['Today', 'Yesterday', 'Previous 7 days', 'Older'])
    expect(groups[0].items.map((m) => m.id)).toEqual(['a'])
    expect(groups[1].items.map((m) => m.id)).toEqual(['b'])
    expect(groups[2].items.map((m) => m.id)).toEqual(['c'])
    expect(groups[3].items.map((m) => m.id)).toEqual(['d'])
  })

  it('boundary: exactly today 00:00 is Today, one ms earlier is Yesterday', () => {
    const g = groupSessions([meta('edge', today), meta('just-before', today - 1)], NOW)
    expect(g[0].label).toBe('Today')
    expect(g[0].items[0].id).toBe('edge')
    expect(g[1].label).toBe('Yesterday')
    expect(g[1].items[0].id).toBe('just-before')
  })

  it('boundary: exactly 6 days ago at midnight is Previous 7 days, one ms earlier is Older', () => {
    const weekAgo = today - 6 * DAY
    const g = groupSessions([meta('in', weekAgo), meta('out', weekAgo - 1)], NOW)
    expect(g[0].label).toBe('Previous 7 days')
    expect(g[0].items[0].id).toBe('in')
    expect(g[1].label).toBe('Older')
    expect(g[1].items[0].id).toBe('out')
  })

  it('preserves the input order within a group', () => {
    const g = groupSessions([meta('x', NOW.getTime()), meta('y', NOW.getTime() - 60_000)], NOW)
    expect(g).toHaveLength(1)
    expect(g[0].items.map((m) => m.id)).toEqual(['x', 'y'])
  })

  it('empty input → no groups', () => {
    expect(groupSessions([], NOW)).toEqual([])
  })
})

describe('groupSessions across a daylight-saving change', () => {
  const originalTz = process.env['TZ']
  afterEach(() => {
    if (originalTz === undefined) delete process.env['TZ']
    else process.env['TZ'] = originalTz
  })

  it('a 23-hour day: late the evening before yesterday is not Yesterday', () => {
    // New York sprang forward on Sunday 9 March 2025, so it lasted 23 hours.
    process.env['TZ'] = 'America/New_York'
    const now = new Date(2025, 2, 10, 12)
    const g = groupSessions([meta('sat-late', new Date(2025, 2, 8, 23, 30).getTime())], now)
    expect(g.map((x) => x.label)).toEqual(['Previous 7 days'])
  })

  it('a 25-hour day: just after midnight yesterday is Yesterday', () => {
    // New York fell back on Sunday 2 November 2025, so it lasted 25 hours.
    process.env['TZ'] = 'America/New_York'
    const now = new Date(2025, 10, 3, 12)
    const g = groupSessions([meta('sun-early', new Date(2025, 10, 2, 0, 30).getTime())], now)
    expect(g.map((x) => x.label)).toEqual(['Yesterday'])
  })
})
