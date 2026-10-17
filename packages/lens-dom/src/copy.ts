import type { Transform } from './contract'
import type { MarkSpec } from './render/types'

export const TRANSFORM_LABEL: Record<Transform, string> = {
  define: 'Defined a term',
  expand: 'Expanded an acronym',
  simplify: 'Simplified a sentence',
  translate: 'Translated',
  example: 'Added an example',
  unpack: 'Put notation into words'
}

const VERB: Record<Transform, string> = {
  define: 'Defined',
  expand: 'Expanded',
  simplify: 'Simplified',
  translate: 'Translated',
  example: 'Explained',
  unpack: 'Unpacked'
}

export const COPY = {
  original: 'Original',
  restore: 'Restore',
  knewIt: 'I knew this',
  explainMore: 'Explain more',
  copyRewritten: 'Copy rewritten',
  highStakes: 'Reading aid — the original wording is what applies.',
  popoverLabel: 'Hoot Lens change'
} as const

export function describeMark(spec: MarkSpec, original: string): string {
  const options = 'Press Enter for options.'
  if (spec.action === 'gloss') return `Note added by Hoot. ${options}`
  return `${VERB[spec.transform]} by Hoot. Original: ${original.trim()}. ${options}`
}
