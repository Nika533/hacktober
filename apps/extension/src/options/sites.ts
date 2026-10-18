import type { SiteRule } from '@hoot/core'
import { pageSite } from '../content/page'

/** What the user typed ("https://www.Example.com/a", "example.com") as a site key, or null. */
export function normalizeSite(input: string): string | null {
  const text = input.trim()
  if (!text) return null
  let url: URL
  try {
    url = new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(text) ? text : `https://${text}`)
  } catch {
    return null
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
  return pageSite(url) || null
}

export const siteLabel = (site: string): string => site || 'Local files'

export function sortedSites(sites: Record<string, SiteRule>): Array<[string, SiteRule]> {
  return Object.entries(sites).sort(([a], [b]) => a.localeCompare(b))
}
