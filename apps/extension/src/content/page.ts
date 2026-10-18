const SITE_PATTERN = /^([a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*)?$/

export function pageSite(location: Pick<Location, 'protocol' | 'hostname'>): string {
  if (location.protocol === 'file:') return ''
  const host = location.hostname.toLowerCase().replace(/^www\./, '')
  return SITE_PATTERN.test(host) && host.length <= 253 ? host : ''
}

export function fnv1a64(text: string): string {
  let hash = 0xcbf29ce484222325n
  for (const byte of new TextEncoder().encode(text)) {
    hash ^= BigInt(byte)
    hash = (hash * 0x100000001b3n) & 0xffffffffffffffffn
  }
  return hash.toString(16).padStart(16, '0')
}

export function urlHash(location: Pick<Location, 'origin' | 'pathname'>, salt: string): string {
  return fnv1a64(`${salt}|${location.origin}${location.pathname}`)
}
