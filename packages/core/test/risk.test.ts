import { describe, expect, it } from 'vitest'
import { classifySite, isDeniedHost, registrableDomain } from '../src/lens/risk'
import { applySettingsPatch, SettingsPatchSchema } from '../src/schemas/settings'
import { DEFAULT_SETTINGS } from '../src/types/settings'

describe('registrableDomain', () => {
  it.each([
    ['www.example.com', 'example.com'],
    ['news.bbc.co.uk', 'bbc.co.uk'],
    ['a.b.example.com.au', 'example.com.au'],
    ['EXAMPLE.org.', 'example.org'],
    ['localhost', 'localhost'],
    ['192.168.1.20', '192.168.1.20'],
    ['www.gov.uk', 'www.gov.uk'.replace(/^www\./, '')],
    ['my.tbcbank.com.ge', 'tbcbank.com.ge']
  ])('%s → %s', (host, site) => {
    expect(registrableDomain(host)).toBe(site)
  })
})

describe('classifySite', () => {
  const classify = (hostname: string, title = '', headings: string[] = []): string => {
    const c = classifySite({ hostname, title, headings })
    return `${c.category}/${c.risk}/${c.source}`
  }

  it('uses the bundled domain lists', () => {
    expect(classify('www.mayoclinic.org')).toBe('medical/high/domain')
    expect(classify('medlineplus.gov')).toBe('medical/high/domain')
    expect(classify('www.law.cornell.edu')).toBe('legal/high/domain')
    expect(classify('www.irs.gov')).toBe('financial/high/domain')
    expect(classify('www.osha.gov')).toBe('safety/high/domain')
  })

  it('treats government suffixes as government', () => {
    expect(classify('www.whitehouse.gov')).toBe('government/high/domain')
    expect(classify('service.gov.uk')).toBe('government/high/domain')
    expect(classify('www.impots.gouv.fr')).toBe('government/high/domain')
    expect(classify('www.sat.gob.mx')).toBe('government/high/domain')
  })

  it('falls back to keywords in the title and headings', () => {
    expect(classify('example.com', 'Terms of Service', ['Limitation of liability'])).toBe(
      'legal/high/keywords'
    )
    expect(classify('example.com', 'Ibuprofen: dosage and side effects')).toBe(
      'medical/high/keywords'
    )
    expect(classify('blog.example.com', 'Mortgage and loan basics')).toBe('financial/high/keywords')
  })

  it('needs one strong phrase or two weak words', () => {
    expect(classify('example.com', 'A legal thriller')).toBe('general/normal/default')
    expect(classify('example.com', 'Warning: spoilers ahead')).toBe('general/normal/default')
    expect(classify('example.com', 'Getting started with React')).toBe('general/normal/default')
  })

  it('lets the user override per site', () => {
    const c = classifySite({
      hostname: 'www.mayoclinic.org',
      title: '',
      headings: [],
      overrides: { 'mayoclinic.org': 'normal' }
    })
    expect(c).toEqual({ category: 'medical', risk: 'normal', source: 'override' })
    expect(
      classifySite({
        hostname: 'blog.dev',
        title: '',
        headings: [],
        overrides: { 'blog.dev': 'high' }
      }).risk
    ).toBe('high')
  })
})

describe('isDeniedHost', () => {
  it.each([
    ['mail.google.com', true],
    ['docs.google.com', false],
    ['www.paypal.com', true],
    ['web.whatsapp.com', true],
    ['vault.bitwarden.com', true],
    ['onlinebanking.mybank.com', true],
    ['mychart.hospital.org', true],
    ['en.wikipedia.org', false],
    ['tbcbank.ge', true]
  ])('%s → %s', (host, denied) => {
    expect(isDeniedHost(host)).toBe(denied)
  })
})

describe('riskOverrides in settings', () => {
  it('patches like site rules (null removes)', () => {
    const r = SettingsPatchSchema.safeParse({
      lens: { riskOverrides: { 'a.com': 'high', 'b.com': null } }
    })
    expect(r.success).toBe(true)
    const base = {
      ...DEFAULT_SETTINGS,
      lens: { ...DEFAULT_SETTINGS.lens, riskOverrides: { 'b.com': 'normal' as const } }
    }
    const next = applySettingsPatch(base, {
      lens: { riskOverrides: { 'a.com': 'high', 'b.com': null } }
    })
    expect(next.lens.riskOverrides).toEqual({ 'a.com': 'high' })
  })
})
