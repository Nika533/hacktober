import { describe, expect, it } from 'vitest'
import { buildTrayTemplate, type TrayTemplateItem } from '../src/main/tray'

const base = {
  summonHotkey: 'CommandOrControl+Shift+Space',
  captureHotkey: 'CommandOrControl+Alt+Space',
  pinCount: 0,
  notesHidden: false
}

const item = (id: string): TrayTemplateItem | undefined =>
  buildTrayTemplate(base).find((i) => i.id === id)

describe('buildTrayTemplate', () => {
  it('pretty-prints the accelerators in the labels', () => {
    expect(item('summon')?.label).toBe('Show Hoot (Ctrl+Shift+Space)')
    expect(item('capture')?.label).toBe('Circle something (Ctrl+Alt+Space)')
  })

  it('shows "Hide pinned notes" when notes are visible', () => {
    const t = buildTrayTemplate({ ...base, pinCount: 3 })
    const notes = t.find((i) => i.id === 'toggleNotes')
    expect(notes?.label).toBe('Hide pinned notes')
    expect(notes?.enabled).toBe(true)
  })

  it('shows "Show pinned notes (N)" when hidden', () => {
    const t = buildTrayTemplate({ ...base, pinCount: 3, notesHidden: true })
    const notes = t.find((i) => i.id === 'toggleNotes')
    expect(notes?.label).toBe('Show pinned notes (3)')
    expect(notes?.enabled).toBe(true)
  })

  it('disables the notes item when there are no pins and none hidden', () => {
    expect(item('toggleNotes')?.enabled).toBe(false)
  })

  it('always carries Studio, Settings and Quit', () => {
    const t = buildTrayTemplate(base)
    expect(t.map((i) => i.id)).toEqual([
      'summon',
      'capture',
      'toggleNotes',
      undefined,
      'openStudio',
      'openSettings',
      undefined,
      'quit'
    ])
    expect(item('openStudio')?.label).toBe('Open Studio')
    expect(item('openSettings')?.label).toBe('Settings…')
    expect(item('quit')?.label).toBe('Quit')
  })
})
