import { createHash, randomUUID } from 'node:crypto'
import {
  countWords,
  type LensContext,
  type LensEvent,
  type LensEventKind,
  type RewriteResult
} from '@hoot/core'

/** A span of a document, as character offsets. */
export interface OffsetRange {
  start: number
  end: number
}

/** One rendered Lens change. The document itself is never modified. */
export interface Mark extends OffsetRange {
  id: string
  /** Document URI */
  uri: string
  /** `urlHash(uri, salt)` */
  urlHash: string
  /** The exact characters the mark covers. */
  original: string
  result: RewriteResult
  ctx: LensContext
  auto: boolean
}

/** A `TextDocumentContentChangeEvent`, offsets relative to the text before the edit. */
export interface TextChange {
  rangeOffset: number
  rangeLength: number
  text: string
}

/**
 * Follow edits: a change inside or across a range drops it; changes before it
 * shift it; changes touching only its edges leave it alone.
 */
export function applyChanges<T extends OffsetRange>(
  ranges: readonly T[],
  changes: readonly TextChange[]
): { kept: T[]; dropped: T[] } {
  const kept: T[] = []
  const dropped: T[] = []
  for (const range of ranges) {
    let shift = 0
    let hit = false
    for (const c of changes) {
      const end = c.rangeOffset + c.rangeLength
      if (c.rangeOffset < range.end && end > range.start) hit = true
      else if (c.rangeLength === 0 && c.rangeOffset > range.start && c.rangeOffset < range.end) {
        hit = true
      } else if (end <= range.start) shift += c.text.length - c.rangeLength
    }
    if (hit) dropped.push(range)
    else kept.push(shift ? { ...range, start: range.start + shift, end: range.end + shift } : range)
  }
  return { kept, dropped }
}

export const overlaps = (a: OffsetRange, b: OffsetRange): boolean =>
  a.start < b.end && b.start < a.end

/** One line of at most `max` characters, for the inline decoration. */
export function truncate(text: string, max: number): string {
  const line = text.replace(/\s+/g, ' ').trim()
  return line.length <= max ? line : `${line.slice(0, max - 1).trimEnd()}…`
}

/** Salted, so the app's event log never sees file paths. */
export const urlHash = (uri: string, salt: string): string =>
  createHash('sha256').update(`${salt}|${uri}`).digest('hex')

/** The feedback event for a mark (hoot-lens.md §8.1); cacheKey links it to the rewrite. */
export function lensEvent(mark: Mark, kind: LensEventKind, now: number, latencyMs = 0): LensEvent {
  return {
    id: randomUUID(),
    ts: Math.floor(now),
    site: '',
    urlHash: mark.urlHash.slice(0, 128),
    kind,
    transform: mark.result.transform,
    mode: mark.result.action,
    term: mark.result.term,
    topic: (mark.ctx.headingPath[0] ?? mark.ctx.title).slice(0, 200) || null,
    lang: mark.ctx.lang,
    spanWords: countWords(mark.ctx.span),
    p: mark.ctx.p,
    difficulty: null,
    latencyMs: Math.max(0, latencyMs),
    cacheKey: mark.result.cacheKey
  }
}
