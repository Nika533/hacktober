import type { DomainRisk, SiteCategory } from '../types/lens'

/**
 * Site classification for Lens (hoot-lens.md §7.5, §11). Local and cheap:
 * bundled domain lists plus keyword heuristics on the title and headings.
 * Medical, legal, financial, government and safety pages are high-stakes
 * and get gloss-only output. The deny list marks pages Lens never touches.
 */

/** Multi-label public suffixes we see often; not a full Public Suffix List. */
const MULTI_LABEL_SUFFIXES = new Set([
  'co.uk',
  'org.uk',
  'ac.uk',
  'gov.uk',
  'nhs.uk',
  'ltd.uk',
  'me.uk',
  'net.uk',
  'com.au',
  'net.au',
  'org.au',
  'edu.au',
  'gov.au',
  'co.nz',
  'org.nz',
  'govt.nz',
  'co.jp',
  'ne.jp',
  'or.jp',
  'ac.jp',
  'go.jp',
  'co.kr',
  'or.kr',
  'go.kr',
  'com.br',
  'gov.br',
  'org.br',
  'com.cn',
  'gov.cn',
  'edu.cn',
  'co.in',
  'gov.in',
  'nic.in',
  'ac.in',
  'com.mx',
  'gob.mx',
  'com.ar',
  'gob.ar',
  'com.tr',
  'gov.tr',
  'co.za',
  'gov.za',
  'com.sg',
  'gov.sg',
  'com.hk',
  'gov.hk',
  'co.il',
  'gov.il',
  'com.ge',
  'gov.ge',
  'org.ge',
  'edu.ge',
  'gouv.fr',
  'gv.at',
  'gc.ca',
  'europa.eu'
])

/** "news.bbc.co.uk" → "bbc.co.uk"; IPs and single labels are returned as is. */
export function registrableDomain(hostname: string): string {
  const host = hostname
    .toLowerCase()
    .replace(/\.$/, '')
    .replace(/^www\./, '')
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(':') || !host.includes('.')) return host
  const labels = host.split('.')
  const lastTwo = labels.slice(-2).join('.')
  const keep = MULTI_LABEL_SUFFIXES.has(lastTwo) ? 3 : 2
  return labels.slice(-keep).join('.')
}

const matchesDomain = (host: string, domains: readonly string[]): boolean =>
  domains.some((d) => host === d || host.endsWith(`.${d}`))

type HighStakes = Exclude<SiteCategory, 'general'>

const DOMAINS: Record<HighStakes, readonly string[]> = {
  medical: [
    'nih.gov',
    'cdc.gov',
    'fda.gov',
    'medlineplus.gov',
    'who.int',
    'nhs.uk',
    'mayoclinic.org',
    'clevelandclinic.org',
    'webmd.com',
    'healthline.com',
    'drugs.com',
    'medscape.com',
    'rxlist.com',
    'ema.europa.eu',
    'bmj.com',
    'thelancet.com',
    'nejm.org',
    'uptodate.com'
  ],
  legal: [
    'law.cornell.edu',
    'findlaw.com',
    'justia.com',
    'legislation.gov.uk',
    'eur-lex.europa.eu',
    'supremecourt.gov',
    'uscourts.gov',
    'courtlistener.com',
    'nolo.com',
    'lawinsider.com'
  ],
  financial: [
    'sec.gov',
    'irs.gov',
    'finra.org',
    'consumerfinance.gov',
    'federalreserve.gov',
    'hmrc.gov.uk',
    'fca.org.uk',
    'esma.europa.eu',
    'ecb.europa.eu'
  ],
  government: ['usa.gov', 'gov.uk', 'europa.eu', 'service-public.fr', 'bund.de'],
  safety: ['osha.gov', 'cpsc.gov', 'nhtsa.gov', 'hse.gov.uk', 'ready.gov', 'fema.gov']
}

/** Government suffixes: anything under these is government unless listed above. */
const GOVERNMENT_SUFFIXES =
  /(^|\.)(gov|mil)(\.[a-z]{2})?$|(^|\.)(gouv\.fr|gob\.[a-z]{2}|gv\.at|gc\.ca|govt\.nz|go\.jp|go\.kr|gov\.[a-z]{2})$/

/** Strong phrases classify on one hit; plain keywords need two. */
const KEYWORDS: Record<HighStakes, { strong: RegExp[]; weak: RegExp[] }> = {
  legal: {
    strong: [
      /terms (of|and) (service|use|conditions)/,
      /privacy (policy|notice)/,
      /end[- ]user license/,
      /\bindemnif/,
      /limitation of liability/,
      /arbitration agreement/,
      /\bstatute\b/
    ],
    weak: [
      /\bcontract\b/,
      /\bagreement\b/,
      /\bliabilit/,
      /\bwarrant/,
      /\bcourt\b/,
      /\blegal\b/,
      /\bclause\b/,
      /\bjurisdiction\b/
    ]
  },
  medical: {
    strong: [
      /side effects?/,
      /\bdosage\b/,
      /\bcontraindicat/,
      /\boverdose\b/,
      /drug interactions?/,
      /prescribing information/
    ],
    weak: [
      /\bsymptoms?\b/,
      /\bdiagnos/,
      /\btreatment\b/,
      /\bmedication\b/,
      /\bclinical\b/,
      /\bpatients?\b/,
      /\bdisease\b/,
      /\btherapy\b/
    ]
  },
  financial: {
    strong: [
      /\bprospectus\b/,
      /annual percentage rate/,
      /\btax return\b/,
      /loan agreement/,
      /fee schedule/,
      /\b10-k\b/
    ],
    weak: [
      /\btax(es)?\b/,
      /\bmortgage\b/,
      /\bloan\b/,
      /\binterest rate\b/,
      /\binvest(ment|ing)\b/,
      /\bsecurities\b/,
      /\bpension\b/,
      /\bcredit\b/
    ]
  },
  government: {
    strong: [/official (website|government)/, /\bvisa application\b/, /\bbenefits? eligibility\b/],
    weak: [/\bministry\b/, /\bdepartment of\b/, /\bregulation\b/, /\bfederal\b/, /\bgovernment\b/]
  },
  safety: {
    strong: [/safety data sheet/, /product recall/, /evacuation (order|route)/, /\bhazmat\b/],
    weak: [/\bhazard\b/, /\bwarning\b/, /\brecall\b/, /\bemergency\b/, /\bflammable\b/, /\btoxic\b/]
  }
}

export interface SiteClassification {
  category: SiteCategory
  risk: DomainRisk
  /** How it was decided, for logs and the popover's explanation */
  source: 'override' | 'domain' | 'keywords' | 'default'
}

export function classifySite(input: {
  hostname: string
  title: string
  headings: readonly string[]
  /** Settings → Reading → per-site override, keyed by registrable domain */
  overrides?: Readonly<Record<string, DomainRisk>>
}): SiteClassification {
  const host = input.hostname.toLowerCase().replace(/^www\./, '')
  const site = registrableDomain(host)
  const override = input.overrides?.[site]

  const byDomain = (Object.keys(DOMAINS) as HighStakes[]).find((c) =>
    matchesDomain(host, DOMAINS[c])
  )
  let category: SiteCategory =
    byDomain ?? (GOVERNMENT_SUFFIXES.test(host) ? 'government' : 'general')
  let source: SiteClassification['source'] = category === 'general' ? 'default' : 'domain'

  if (category === 'general') {
    const text = [input.title, ...input.headings].join(' \n ').toLowerCase()
    let best: { c: HighStakes; score: number } | null = null
    for (const c of Object.keys(KEYWORDS) as HighStakes[]) {
      const { strong, weak } = KEYWORDS[c]
      const score =
        strong.filter((re) => re.test(text)).length * 2 + weak.filter((re) => re.test(text)).length
      if (score >= 2 && (!best || score > best.score)) best = { c, score }
    }
    if (best) {
      category = best.c
      source = 'keywords'
    }
  }

  if (override) return { category, risk: override, source: 'override' }
  return { category, risk: category === 'general' ? 'normal' : 'high', source }
}

// ---------------------------------------------------------------- deny list

/**
 * Pages Lens never touches by default (hoot-lens.md §11): banking and
 * payments, health portals, email and chat web apps, password managers.
 * Matched against the full hostname. Pages with a password field and
 * private windows are excluded separately by the extension.
 */
export const DEFAULT_DENY_HOSTS: readonly string[] = [
  // email
  'mail.google.com',
  'outlook.live.com',
  'outlook.office.com',
  'outlook.office365.com',
  'mail.yahoo.com',
  'mail.proton.me',
  'app.fastmail.com',
  'mail.zoho.com',
  // chat
  'web.whatsapp.com',
  'web.telegram.org',
  'app.slack.com',
  'discord.com',
  'www.messenger.com',
  'messenger.com',
  'teams.microsoft.com',
  'teams.live.com',
  'chat.google.com',
  // password managers
  '1password.com',
  'bitwarden.com',
  'vault.bitwarden.com',
  'lastpass.com',
  'dashlane.com',
  'keepersecurity.com',
  // payments and banking
  'paypal.com',
  'checkout.stripe.com',
  'dashboard.stripe.com',
  'pay.google.com',
  'wise.com',
  'revolut.com',
  'chase.com',
  'bankofamerica.com',
  'wellsfargo.com',
  'citi.com',
  'capitalone.com',
  'hsbc.com',
  'barclays.co.uk',
  'santander.com',
  'bog.ge',
  'tbcbank.ge',
  // health portals
  'mychart.com',
  'patient.info',
  'myhealth.va.gov'
]

/** Hostname words that mark online banking or patient portals anywhere. */
const DENY_HOST_PATTERN = /(^|\.)(online-?banking|netbank|ebanking|ibank|mychart|patientportal)\./

export function isDeniedHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, '')
  return matchesDomain(host, DEFAULT_DENY_HOSTS) || DENY_HOST_PATTERN.test(`${host}.`)
}
