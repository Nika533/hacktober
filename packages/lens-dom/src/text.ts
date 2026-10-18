export function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

export function stripWrappingParens(text: string): string {
  const trimmed = text.trim()
  const match = /^\((.*)\)$/s.exec(trimmed)
  return match?.[1]?.trim() ?? trimmed
}
