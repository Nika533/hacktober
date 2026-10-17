/** Subset of KeyboardEvent used by the hotkey recorder. */
export interface KeyEventLike {
  key: string
  ctrlKey: boolean
  altKey: boolean
  shiftKey: boolean
  metaKey: boolean
}

const KEY_MAP: Record<string, string> = {
  ' ': 'Space',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  Escape: 'Esc',
  Enter: 'Enter',
  Tab: 'Tab',
  Backspace: 'Backspace',
  Delete: 'Delete',
  Home: 'Home',
  End: 'End',
  PageUp: 'PageUp',
  PageDown: 'PageDown',
  '+': 'Plus'
}

/**
 * Convert a keydown into an Electron accelerator string, e.g.
 * "CommandOrControl+Shift+Space". Requires a real (non-modifier) key and
 * at least one modifier; returns null otherwise.
 */
export function toAccelerator(e: KeyEventLike): string | null {
  if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return null
  if (!e.ctrlKey && !e.altKey && !e.metaKey) return null
  const parts: string[] = []
  if (e.ctrlKey || e.metaKey) parts.push('CommandOrControl')
  if (e.altKey) parts.push('Alt')
  if (e.shiftKey) parts.push('Shift')
  const mapped = KEY_MAP[e.key] ?? (e.key.length === 1 ? e.key.toUpperCase() : e.key)
  parts.push(mapped)
  return parts.join('+')
}
