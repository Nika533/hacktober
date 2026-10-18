import { registrableDomain, type SiteRule } from '@hoot/core'

/** What the user typed ("https://www.Example.com/a", "news.example.co.uk") as a site key, or null. */
export function siteFromInput(input: string): string | null {
  const text = input.trim()
  if (!text) return null
  let url: URL
  try {
    url = new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(text) ? text : `https://${text}`)
  } catch {
    return null
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
  const site = registrableDomain(url.hostname)
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(site) ? site : null
}

export const siteLabel = (site: string): string => site || 'Local files'

export function sortedSites(sites: Record<string, SiteRule>): Array<[string, SiteRule]> {
  return Object.entries(sites).sort(([a], [b]) => a.localeCompare(b))
}

/** Languages offered by default; anything else the profile holds is listed too. */
export const COMMON_LANGUAGES = [
  'en',
  'ka',
  'es',
  'fr',
  'de',
  'it',
  'pt',
  'nl',
  'pl',
  'uk',
  'ru',
  'tr',
  'ar',
  'hi',
  'zh',
  'ja',
  'ko'
] as const

let names: Intl.DisplayNames | null | undefined

/** "ka" → "Georgian" (falls back to the tag). */
export function languageName(tag: string): string {
  if (names === undefined) {
    try {
      names = new Intl.DisplayNames(['en'], { type: 'language' })
    } catch {
      names = null
    }
  }
  try {
    return names?.of(tag) ?? tag
  } catch {
    return tag
  }
}

/** Anthropic's API terms, linked from the consent and onboarding copy (opened through `app.openExternal`). */
export const ANTHROPIC_TERMS_URL = 'https://www.anthropic.com/legal/commercial-terms'
