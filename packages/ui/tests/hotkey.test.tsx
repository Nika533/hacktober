import { act } from 'react'
import { describe, expect, it, vi, type Mock } from 'vitest'
import {
  acceleratorFromEvent,
  acceleratorKeys,
  formatAccelerator,
  type RecorderKeyEvent
} from '../src/settings/accelerator'
import { HotkeyRecorder } from '../src/settings/HotkeyRecorder'
import { byName, click, render } from './render'

const ev = (key: string, code: string, mods: Partial<RecorderKeyEvent> = {}): RecorderKeyEvent => ({
  key,
  code,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  metaKey: false,
  ...mods
})

describe('acceleratorFromEvent', () => {
  it('builds Electron accelerators in Ctrl, Alt, Shift order', () => {
    expect(acceleratorFromEvent(ev(' ', 'Space', { ctrlKey: true, shiftKey: true }))).toBe(
      'CommandOrControl+Shift+Space'
    )
    expect(acceleratorFromEvent(ev('h', 'KeyH', { altKey: true, ctrlKey: true }))).toBe(
      'CommandOrControl+Alt+H'
    )
    expect(acceleratorFromEvent(ev('F9', 'F9', { altKey: true }))).toBe('Alt+F9')
    expect(acceleratorFromEvent(ev('ArrowUp', 'ArrowUp', { metaKey: true }))).toBe(
      'CommandOrControl+Up'
    )
  })

  it('uses the physical key, so Shift and AltGr do not change it', () => {
    expect(acceleratorFromEvent(ev('!', 'Digit1', { ctrlKey: true, shiftKey: true }))).toBe(
      'CommandOrControl+Shift+1'
    )
    // AltGr+Q on a German layout reports "@".
    expect(acceleratorFromEvent(ev('@', 'KeyQ', { ctrlKey: true, altKey: true }))).toBe(
      'CommandOrControl+Alt+Q'
    )
    expect(acceleratorFromEvent(ev('+', 'NumpadAdd', { ctrlKey: true }))).toBe(
      'CommandOrControl+Plus'
    )
  })

  it('needs a real key and Ctrl, Alt or Win', () => {
    expect(acceleratorFromEvent(ev('Control', 'ControlLeft', { ctrlKey: true }))).toBeNull()
    expect(acceleratorFromEvent(ev('a', 'KeyA'))).toBeNull()
    expect(acceleratorFromEvent(ev('A', 'KeyA', { shiftKey: true }))).toBeNull()
    expect(acceleratorFromEvent(ev('Dead', '', { ctrlKey: true }))).toBeNull()
  })
})

describe('accelerator display', () => {
  it('uses Windows key names', () => {
    expect(acceleratorKeys('CommandOrControl+Shift+Space')).toEqual(['Ctrl', 'Shift', 'Space'])
    expect(acceleratorKeys('Super+Plus')).toEqual(['Win', '+'])
    expect(formatAccelerator('CommandOrControl+Alt+num5')).toBe('Ctrl+Alt+Num 5')
    expect(acceleratorKeys('')).toEqual([])
  })
})

function key(
  el: Element,
  type: 'keydown' | 'keyup',
  k: string,
  code: string,
  mods: KeyboardEventInit = {}
): KeyboardEvent {
  const e = new KeyboardEvent(type, { key: k, code, bubbles: true, cancelable: true, ...mods })
  act(() => {
    el.dispatchEvent(e)
  })
  return e
}

describe('HotkeyRecorder', () => {
  interface Setup extends ReturnType<typeof render> {
    field: HTMLButtonElement
    live: Element
    onChange: Mock<(acc: string) => void>
    onRecordingChange: Mock<(on: boolean) => void>
  }
  const setup = (props: Partial<Parameters<typeof HotkeyRecorder>[0]> = {}): Setup => {
    const onChange = vi.fn<(acc: string) => void>()
    const onRecordingChange = vi.fn<(on: boolean) => void>()
    const r = render(
      <HotkeyRecorder
        label="Summon Hoot"
        value="CommandOrControl+Shift+Space"
        onChange={onChange}
        onRecordingChange={onRecordingChange}
        {...props}
      />
    )
    const field = r.container.querySelector<HTMLButtonElement>('.hoot-hotkey__field')!
    const live = r.container.querySelector('[aria-live="polite"]')!
    return { ...r, field, live, onChange, onRecordingChange }
  }

  it('names itself with the label and the current shortcut', () => {
    const { field } = setup()
    const name = field
      .getAttribute('aria-labelledby')!
      .split(' ')
      .map((id) => document.getElementById(id)?.textContent)
      .join(' ')
    expect(name).toBe('Summon Hoot Ctrl+Shift+Space')
    expect([...field.querySelectorAll('.hoot-kbd__key')].map((k) => k.textContent)).toEqual([
      'Ctrl',
      'Shift',
      'Space'
    ])
  })

  it('records a new shortcut, previews modifiers and announces the result', () => {
    const { field, live, onChange, onRecordingChange } = setup()
    click(field)
    expect(field.dataset.recording).toBe('true')
    expect(onRecordingChange).toHaveBeenLastCalledWith(true)
    expect(live.textContent).toContain('Recording')

    key(field, 'keydown', 'Control', 'ControlLeft', { ctrlKey: true })
    key(field, 'keydown', 'Alt', 'AltLeft', { ctrlKey: true, altKey: true })
    expect(field.textContent).toContain('Ctrl')
    expect(field.textContent).toContain('Alt')

    const e = key(field, 'keydown', 'h', 'KeyH', { ctrlKey: true, altKey: true })
    expect(e.defaultPrevented).toBe(true)
    expect(onChange).toHaveBeenCalledWith('CommandOrControl+Alt+H')
    expect(field.dataset.recording).toBeUndefined()
    expect(onRecordingChange).toHaveBeenLastCalledWith(false)
    expect(live.textContent).toBe('Summon Hoot shortcut set to Ctrl+Alt+H')
  })

  it('keeps recording and explains when a key has no modifier', () => {
    const { container, field, live, onChange } = setup()
    click(field)
    key(field, 'keydown', 'a', 'KeyA')
    expect(onChange).not.toHaveBeenCalled()
    expect(field.dataset.recording).toBe('true')
    expect(container.querySelector('.hoot-hotkey__error')?.textContent).toContain(
      'Hold Ctrl or Alt'
    )
    expect(live.textContent).toContain('Hold Ctrl or Alt')
  })

  it('rejects combinations the host refuses', () => {
    const { container, field, onChange } = setup({
      validate: (acc) =>
        acc === 'CommandOrControl+Alt+Space' ? 'Already used for Circle anything.' : null
    })
    click(field)
    key(field, 'keydown', ' ', 'Space', { ctrlKey: true, altKey: true })
    expect(onChange).not.toHaveBeenCalled()
    expect(container.querySelector('.hoot-hotkey__error')?.textContent).toBe(
      'Already used for Circle anything.'
    )
    const err = container.querySelector('.hoot-hotkey__error')!
    expect(field.getAttribute('aria-describedby')).toContain(err.id)
  })

  it('cancels on Escape and lets Tab move focus (no keyboard trap)', () => {
    const { field, live, onChange, onRecordingChange } = setup()
    click(field)
    const esc = key(field, 'keydown', 'Escape', 'Escape')
    expect(esc.defaultPrevented).toBe(true)
    expect(field.dataset.recording).toBeUndefined()
    expect(live.textContent).toBe('Shortcut unchanged: Ctrl+Shift+Space')

    click(field)
    const tab = key(field, 'keydown', 'Tab', 'Tab')
    expect(tab.defaultPrevented).toBe(false)
    expect(field.dataset.recording).toBeUndefined()
    expect(onRecordingChange).toHaveBeenLastCalledWith(false)
    expect(onChange).not.toHaveBeenCalled()
  })

  it('offers Reset only when the value differs from the default', () => {
    const { container, onChange, rerender } = setup({
      defaultValue: 'CommandOrControl+Shift+Space'
    })
    expect(byName(container, 'button', 'Reset').dataset.hidden).toBe('true')
    rerender(
      <HotkeyRecorder
        label="Summon Hoot"
        value="CommandOrControl+Alt+H"
        defaultValue="CommandOrControl+Shift+Space"
        onChange={onChange}
      />
    )
    const reset = byName(container, 'button', 'Reset')
    expect(reset.dataset.hidden).toBeUndefined()
    click(reset)
    expect(onChange).toHaveBeenCalledWith('CommandOrControl+Shift+Space')
  })

  it('shows a saved-shortcut error from the host when not recording', () => {
    const { container, field } = setup({ error: 'Another app already uses Ctrl+Shift+Space.' })
    expect(container.querySelector('.hoot-hotkey__error')?.textContent).toContain('Another app')
    click(field)
    expect(container.querySelector('.hoot-hotkey__error')).toBeNull()
  })
})
