import type { ClipboardHint } from './types'

/**
 * Clipboard-suggestion logic (pure — unit-tested).
 * A fingerprint identifies "what's on the clipboard"; the chip only appears
 * when the fingerprint changed since the last check and the setting is on.
 */
export interface ClipboardFingerprint {
  kind: 'text' | 'image'
  hash: string
}

export interface ClipboardProbe {
  fp: ClipboardFingerprint
  hint: ClipboardHint
}

/** Tiny FNV-1a — deterministic, dependency-free, good enough for change detection. */
export function fnv1a(data: Uint8Array | string): string {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data
  let h = 0x811c9dc5
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i]
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(16)
}

export function textFingerprint(text: string): ClipboardFingerprint | null {
  if (!text || text.trim().length === 0) return null
  return { kind: 'text', hash: `t:${fnv1a(text)}` }
}

export function imageFingerprint(
  width: number,
  height: number,
  bitmap: Uint8Array
): ClipboardFingerprint | null {
  if (width <= 0 || height <= 0 || bitmap.length === 0) return null
  return { kind: 'image', hash: `i:${width}x${height}:${fnv1a(bitmap)}` }
}

/** Should the chip show for this probe? */
export function decideHint(
  last: ClipboardFingerprint | null,
  probe: ClipboardProbe | null,
  enabled: boolean
): boolean {
  if (!enabled || !probe) return false
  return probe.fp.hash !== last?.hash
}
