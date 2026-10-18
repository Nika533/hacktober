import { registrableDomain } from '@hoot/core'

const SITE_PATTERN = /^([a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*)?$/

/** The page's full hostname, or '' for files and hosts a site rule can't name. */
export function pageHost(location: Pick<Location, 'protocol' | 'hostname'>, origin = ''): string {
  if (location.protocol === 'file:') return ''
  const hostname = location.protocol === 'about:' ? hostnameOf(origin) : location.hostname
  const host = hostname.toLowerCase().replace(/\.$/, '')
  return SITE_PATTERN.test(host) && host.length <= 253 ? host : ''
}

/** The key for site rules and events: the registrable domain ("news.bbc.co.uk" → "bbc.co.uk"). */
export function pageSite(location: Pick<Location, 'protocol' | 'hostname'>, origin = ''): string {
  const host = pageHost(location, origin)
  return host && registrableDomain(host)
}

function hostnameOf(origin: string): string {
  try {
    return new URL(origin).hostname
  } catch {
    return ''
  }
}

/** about:blank and srcdoc frames inherit their parent's origin; their URL doesn't show it. */
export function pageOrigin(
  location: Pick<Location, 'protocol' | 'origin'>,
  inherited: string
): string {
  return location.protocol === 'about:' ? inherited : location.origin
}

export function fnv1a64(text: string): string {
  let hash = 0xcbf29ce484222325n
  for (const byte of new TextEncoder().encode(text)) {
    hash ^= BigInt(byte)
    hash = (hash * 0x100000001b3n) & 0xffffffffffffffffn
  }
  return hash.toString(16).padStart(16, '0')
}

const SALT_KEY = 'lens.salt'

/** The per-install salt for `urlHash`, created on first use. */
export async function installSalt(): Promise<string> {
  const existing = (await chrome.storage.local.get(SALT_KEY))[SALT_KEY]
  if (typeof existing === 'string' && existing) return existing
  const fresh = Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) =>
    byte.toString(16).padStart(2, '0')
  ).join('')
  await chrome.storage.local.set({ [SALT_KEY]: fresh })
  return fresh
}

export function urlHash(location: Pick<Location, 'origin' | 'pathname'>, salt: string): string {
  return fnv1a64(`${salt}|${location.origin}${location.pathname}`)
}
