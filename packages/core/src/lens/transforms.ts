import type { RenderAction, Transform } from '../types/lens'

export interface TransformRule {
  /** Popover footer, e.g. "Defined a term" */
  label: string
  /** Default rendering before risk and length rules apply */
  defaultAction: RenderAction
  /** Hard cap on the output, in words (gloss-type outputs) */
  maxWords?: number
  /** Output length / input length cap (rewrite-type outputs) */
  maxLengthRatio?: number
}

/** hoot-lens.md §7.1 */
export const TRANSFORM_RULES: Record<Transform, TransformRule> = {
  define: { label: 'Defined a term', defaultAction: 'replace', maxWords: 15 },
  expand: { label: 'Expanded an acronym', defaultAction: 'replace', maxWords: 12 },
  simplify: { label: 'Simplified a sentence', defaultAction: 'replace', maxLengthRatio: 1.5 },
  translate: { label: 'Translated', defaultAction: 'replace' },
  example: { label: 'Added an example', defaultAction: 'gloss', maxWords: 40 },
  unpack: { label: 'Put notation into words', defaultAction: 'gloss', maxWords: 60 }
}

/** Spans longer than this many words are glossed rather than replaced. */
export const MAX_REPLACE_WORDS = 40

export function countWords(text: string): number {
  const trimmed = text.trim()
  return trimmed ? trimmed.split(/\s+/).length : 0
}
