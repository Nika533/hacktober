const count = new Intl.NumberFormat()

export function clipboardChipLabel(kind: 'text' | 'image', chars = 0): string {
  if (kind === 'image') return 'Use copied image'
  return `Use copied text (${count.format(chars)} ${chars === 1 ? 'character' : 'characters'})`
}
