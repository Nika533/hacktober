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
  note: 'Hoot added',
  restore: 'Restore',
  removeNote: 'Remove note',
  knewIt: 'I knew this',
  explainMore: 'Explain more',
  copyRewritten: 'Copy rewritten',
  copied: 'Copied',
  highStakes: 'Reading aid — the original wording is what applies.',
  popoverLabel: 'Hoot Lens change',
  pillLabel: 'Hoot Lens',
  undoAll: 'Undo all',
  pause: 'Pause on this site',
  resume: 'Resume',
  paused: 'Lens is paused on this site',
  ask: 'Make this clearer?',
  thinking: 'Hoot is making this clearer…',
  skipped: 'Hoot left this as it is.',
  unavailable: 'Hoot isn’t available right now.',
  restored: 'Restored the original.',
  restoredAll: 'Restored everything on this page.'
} as const

export function changedCount(count: number): string {
  return count === 1 ? 'Hoot changed 1 thing' : `Hoot changed ${count} things`
}

export function describeMark(spec: MarkSpec, original: string): string {
  const options = 'Press Enter for options.'
  if (spec.action === 'gloss') return `Note added by Hoot. ${options}`
  return `${VERB[spec.transform]} by Hoot. Original: ${original.trim()}. ${options}`
}

export function announceChange(spec: MarkSpec): string {
  return spec.action === 'gloss'
    ? 'Hoot added a note.'
    : `${TRANSFORM_LABEL[spec.transform]}. Press Alt+Z to undo.`
}
