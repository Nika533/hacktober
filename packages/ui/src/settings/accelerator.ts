import { toAccelerator, type KeyEventLike } from '@hoot/core'

/**
 * Keyboard event → Electron accelerator for the hotkey recorder, built on
 * core's `toAccelerator`. Before handing the event over, letters, digits,
 * numpad digits and punctuation are taken from `code` (the physical key),
 * so Shift+1 records "Shift+1" rather than "Shift+!", and AltGr layouts
 * (German AltGr+Q = "@") record the key that was pressed. Keys Electron
 * can't register ("Dead", "Unidentified", lone modifiers) give null.
 */

export type RecorderKeyEvent = KeyEventLike & { code?: string }

const MODIFIER_KEYS = new Set(['Control', 'Shift', 'Alt', 'Meta', 'AltGraph', 'OS'])

/** Named keys Electron accepts as the main key (core maps arrows, Space, Esc…). */
const NAMED = new Set([
  ' ',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'Escape',
  'Enter',
  'Tab',
  'Backspace',
  'Delete',
  'Insert',
  'Home',
  'End',
  'PageUp',
  'PageDown',
  '+'
])

const PUNCTUATION: Record<string, string> = {
  Space: ' ',
  Minus: '-',
  Equal: '=',
  BracketLeft: '[',
  BracketRight: ']',
  Backslash: '\\',
  Semicolon: ';',
  Quote: "'",
  Comma: ',',
  Period: '.',
  Slash: '/',
  Backquote: '`',
  NumpadAdd: '+'
}

const F_KEY = /^F([1-9]|1\d|2[0-4])$/

/** The key core should see: the physical key when `code` identifies one. */
function physicalKey(e: RecorderKeyEvent): string | null {
  const code = e.code ?? ''
  const letter = /^Key([A-Z])$/.exec(code)?.[1]
  if (letter) return letter.toLowerCase()
  const digit = /^Digit(\d)$/.exec(code)?.[1]
  if (digit) return digit
  const pad = /^Numpad(\d)$/.exec(code)?.[1]
  if (pad) return `num${pad}`
  if (F_KEY.test(code)) return code
  const punct = PUNCTUATION[code]
  if (punct) return punct
  if (NAMED.has(e.key) || F_KEY.test(e.key)) return e.key
  return e.key.length === 1 ? e.key : null
}

export function isModifierKey(key: string): boolean {
  return MODIFIER_KEYS.has(key)
}

/** The accelerator for a keydown, or null when it isn't a usable shortcut. */
export function acceleratorFromEvent(e: RecorderKeyEvent): string | null {
  if (isModifierKey(e.key)) return null
  const key = physicalKey(e)
  return key === null ? null : toAccelerator({ ...e, key })
}

/** Held modifiers as display names, for the live "Ctrl+Shift+…" preview. */
export function heldModifiers(
  e: Pick<KeyEventLike, 'ctrlKey' | 'altKey' | 'shiftKey' | 'metaKey'>
): string[] {
  const out: string[] = []
  if (e.ctrlKey || e.metaKey) out.push('Ctrl')
  if (e.altKey) out.push('Alt')
  if (e.shiftKey) out.push('Shift')
  return out
}

const DISPLAY: Record<string, string> = {
  CommandOrControl: 'Ctrl',
  CmdOrCtrl: 'Ctrl',
  Control: 'Ctrl',
  Command: 'Ctrl',
  Super: 'Win',
  Meta: 'Win',
  Option: 'Alt',
  Plus: '+',
  Esc: 'Esc'
}

/** 'CommandOrControl+Shift+Space' → ['Ctrl', 'Shift', 'Space'] (Windows names). */
export function acceleratorKeys(accelerator: string): string[] {
  if (!accelerator) return []
  return accelerator
    .split('+')
    .filter(Boolean)
    .map((k) => DISPLAY[k] ?? (/^num(\d)$/.test(k) ? `Num ${k.slice(3)}` : k))
}

/** Spoken/written form: 'Ctrl+Shift+Space'. */
export function formatAccelerator(accelerator: string): string {
  return acceleratorKeys(accelerator).join('+')
}
