import {
  applyProfilePatch,
  buildProfileSummary,
  createDefaultProfile,
  DEFAULT_SETTINGS,
  profileKey,
  type GlossaryEntry,
  type ProfileView,
  type ReaderProfile,
  type RecentChange
} from '@hoot/core'
import type { LensPagesApi } from '../lens/useLensPages'

const HOUR = 3_600_000
const DAY = 24 * HOUR

/** A reader a few weeks in: software-savvy, new to finance and law. */
export function sampleProfile(now = Date.now()): ReaderProfile {
  const term = (
    state: ReaderProfile['terms'][string]['state'],
    ago: number
  ): ReaderProfile['terms'][string] => ({
    state,
    seen: 2,
    updatedAt: now - ago
  })
  return {
    ...createDefaultProfile({ coldStart: false }),
    terms: {
      latency: term('known', 2 * HOUR),
      api: term('known', 3 * DAY),
      amortization: term('unknown', 5 * HOUR),
      'compound interest': term('learning', DAY),
      'force majeure': term('learning', 4 * DAY)
    },
    topics: {
      software: { familiarity: 0.8, depth: 0, updatedAt: now - HOUR },
      finance: { familiarity: 0.3, depth: 1, updatedAt: now - DAY },
      law: { familiarity: 0.2, depth: 0, updatedAt: now - 4 * DAY }
    }
  }
}

export function sampleChanges(now = Date.now()): RecentChange[] {
  return [
    {
      id: 'c1',
      ts: now - 20 * 60_000,
      site: 'investopedia.com',
      transform: 'define',
      action: 'replace',
      original: 'amortization',
      rewrite: 'paying off a loan in regular instalments',
      term: 'amortization'
    },
    {
      id: 'c2',
      ts: now - 3 * HOUR,
      site: 'gov.uk',
      transform: 'simplify',
      action: 'gloss',
      original:
        'Applicants must furnish documentary evidence of continuous residence for the qualifying period.',
      rewrite: 'You need papers that show you lived here the whole time.',
      term: null
    },
    {
      id: 'c3',
      ts: now - 2 * DAY,
      site: 'arxiv.org',
      transform: 'unpack',
      action: 'gloss',
      original: '∀ε>0 ∃δ>0',
      rewrite: 'However small a gap you pick, there is a small enough step that stays inside it.',
      term: null
    }
  ]
}

export function sampleGlossary(now = Date.now()): GlossaryEntry[] {
  return [
    {
      term: 'amortization',
      gloss: 'Paying off a loan in regular instalments that cover interest and part of the loan.',
      transform: 'define',
      site: 'investopedia.com',
      firstSeen: now - 5 * DAY,
      lastSeen: now - 20 * 60_000,
      state: 'unknown'
    },
    {
      term: 'force majeure',
      gloss: 'An event nobody could control, like a flood or war, that excuses a broken contract.',
      transform: 'define',
      site: 'nolo.com',
      firstSeen: now - 9 * DAY,
      lastSeen: now - 4 * DAY,
      state: 'learning'
    },
    {
      term: 'API',
      gloss: 'Application programming interface: the way one program asks another for something.',
      transform: 'expand',
      site: 'developer.mozilla.org',
      firstSeen: now - 30 * DAY,
      lastSeen: now - 3 * DAY,
      state: 'known'
    }
  ]
}

/** A stand-in for main's `lens:*` handlers, on core's own profile logic. */
export function createFakeLensPages(): LensPagesApi {
  let profile = sampleProfile()
  let changes = sampleChanges()
  let glossary = sampleGlossary()
  const view = (): ProfileView => ({
    profile,
    summary: buildProfileSummary(profile, DEFAULT_SETTINGS.lens.languages)
  })
  return {
    profile: async () => view(),
    patchProfile: async (patch) => {
      profile = applyProfilePatch(profile, patch, Date.now())
      glossary = glossary.map((g) => {
        const t = profile.terms[profileKey(g.term)]
        return t ? { ...g, state: t.state } : g
      })
      return view()
    },
    resetProfile: async () => {
      profile = createDefaultProfile({ coldStart: true })
      changes = []
      glossary = []
    },
    exportProfile: async () => 'C:\\Users\\you\\Documents\\hoot-reading-profile.json',
    recentChanges: async (limit) => changes.slice(0, limit),
    glossary: async () => glossary,
    onProfile: () => () => undefined
  }
}
