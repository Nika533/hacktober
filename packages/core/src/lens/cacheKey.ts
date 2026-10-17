const FNV_OFFSET = 0xcbf29ce484222325n
const FNV_PRIME = 0x100000001b3n
const MASK = 0xffffffffffffffffn

/** 64-bit FNV-1a over UTF-16 code units, as 16 hex chars. Not cryptographic. */
export function fnv1a64(text: string): string {
  let h = FNV_OFFSET
  for (let i = 0; i < text.length; i++) {
    h ^= BigInt(text.charCodeAt(i))
    h = (h * FNV_PRIME) & MASK
  }
  return h.toString(16).padStart(16, '0')
}

const normalize = (s: string): string => s.replace(/\s+/g, ' ').trim()

/**
 * Rewrite cache key = hash(span + paragraph + transform + profileVersion)
 * (hoot-lens.md §7.2). `transform` is 'auto' when the model picks it.
 */
export function lensCacheKey(parts: {
  span: string
  paragraph: string
  transform: string
  profileVersion: number
}): string {
  return fnv1a64(
    [
      normalize(parts.span),
      normalize(parts.paragraph),
      parts.transform,
      String(parts.profileVersion)
    ].join('\u0000')
  )
}
