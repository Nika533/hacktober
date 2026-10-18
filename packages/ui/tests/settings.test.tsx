import { DEFAULT_SETTINGS, type ApiKeyResult, type Settings, type SettingsPatch } from '@hoot/core'
import { act } from 'react'
import { describe, expect, it, vi, type Mock } from 'vitest'
import { HootUIProvider } from '../src/components/HootUIProvider'
import { API_KEY_URL, ApiKeyField } from '../src/settings/ApiKeyField'
import { SettingsPane } from '../src/settings/SettingsPane'
import { byName, click, render, wait } from './render'

function typeInto(el: HTMLInputElement, value: string): void {
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, value)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

function submit(form: HTMLFormElement): void {
  act(() => {
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  })
}

describe('ApiKeyField', () => {
  const setup = (onSave: (key: string) => Promise<ApiKeyResult>, hasKey = false) => {
    const onOpenLink = vi.fn<(url: string) => void>()
    const onSaved = vi.fn<() => void>()
    const r = render(
      <ApiKeyField
        hasKey={hasKey}
        keyStorage="os-encrypted"
        onSave={onSave}
        onOpenLink={onOpenLink}
        onSaved={onSaved}
      />
    )
    const input = r.container.querySelector<HTMLInputElement>('input')!
    const form = r.container.querySelector('form')!
    return { ...r, input, form, onOpenLink, onSaved }
  }

  it('checks and saves a trimmed key, then confirms', async () => {
    const onSave = vi.fn(async () => ({ ok: true }))
    const { input, form, container, onSaved } = setup(onSave)
    expect(byName<HTMLButtonElement>(container, 'button', 'Check and save').disabled).toBe(true)
    typeInto(input, '  AIza-key  ')
    submit(form)
    await wait(0)
    expect(onSave).toHaveBeenCalledWith('AIza-key')
    expect(onSaved).toHaveBeenCalled()
    expect(input.value).toBe('')
    expect(container.textContent).toContain('Key saved')
  })

  it('explains a rejected or unreachable key inline', async () => {
    const { input, form, container } = setup(async () => ({ ok: false, reason: 'rejected' }))
    typeInto(input, 'bad')
    submit(form)
    await wait(0)
    expect(input.getAttribute('aria-invalid')).toBe('true')
    expect(container.textContent).toContain('Google rejected this key')

    const failing = setup(() => Promise.reject(new Error('offline')))
    typeInto(failing.input, 'k')
    submit(failing.form)
    await wait(0)
    expect(failing.container.textContent).toContain('couldn’t reach Google')
  })

  it('shows and hides the key, links to AI Studio, and describes the saved state', () => {
    const { input, container, onOpenLink } = setup(async () => ({ ok: true }), true)
    expect(input.type).toBe('password')
    click(byName(container, 'button', 'Show'))
    expect(input.type).toBe('text')
    click(byName(container, 'button', 'Get a free key'))
    expect(onOpenLink).toHaveBeenCalledWith(API_KEY_URL)
    expect(container.textContent).toContain('A key is saved, encrypted on this PC')
  })
})

describe('SettingsPane', () => {
  type Handlers = {
    onUpdate: Mock<(p: SettingsPatch) => void>
    onClearChats: Mock<() => Promise<void>>
    onRecordingChange: Mock<(on: boolean) => void>
  }
  const setup = (
    over: Partial<Settings> = {},
    errors = {}
  ): ReturnType<typeof render> & Handlers => {
    const h: Handlers = {
      onUpdate: vi.fn(),
      onClearChats: vi.fn(async () => undefined),
      onRecordingChange: vi.fn()
    }
    const r = render(
      <HootUIProvider>
        <SettingsPane
          settings={{ ...DEFAULT_SETTINGS, ...over }}
          hasApiKey
          keyStorage="os-encrypted"
          hotkeyErrors={errors}
          version="1.0.0"
          onSaveKey={async () => ({ ok: true })}
          onClearKey={async () => undefined}
          onResetAnchor={async () => undefined}
          onOpenLink={() => undefined}
          onBack={() => undefined}
          {...h}
        />
      </HootUIProvider>
    )
    return { ...r, ...h }
  }

  it('saves the model and warns that Argon needs a paid tier', () => {
    const { container, onUpdate, rerender } = setup()
    const argon = [...container.querySelectorAll<HTMLInputElement>('input[type="radio"]')].find(
      (r) => r.value === 'gemini-4-argon'
    )!
    expect(argon.closest('label')?.textContent).toContain('paid tier')
    click(argon)
    expect(onUpdate).toHaveBeenCalledWith({ model: 'gemini-4-argon' })
    rerender(
      <HootUIProvider>
        <SettingsPane
          settings={{ ...DEFAULT_SETTINGS, model: 'gemini-4-argon' }}
          hasApiKey
          keyStorage="os-encrypted"
          onUpdate={onUpdate}
          onSaveKey={async () => ({ ok: true })}
          onClearKey={async () => undefined}
          onClearChats={async () => undefined}
          onResetAnchor={async () => undefined}
          onOpenLink={() => undefined}
          onBack={() => undefined}
        />
      </HootUIProvider>
    )
    expect(container.textContent).toContain('Argon needs a paid-tier Gemini key')
  })

  it('saves behaviour toggles, the collapse delay and the translate language', () => {
    const { container, onUpdate } = setup()
    const sw = [...container.querySelectorAll<HTMLInputElement>('input[role="switch"]')]
    click(sw[0]!) // Launch at login
    expect(onUpdate).toHaveBeenCalledWith({ launchAtLogin: true })
    const never = [...container.querySelectorAll<HTMLInputElement>('input[type="radio"]')].find(
      (r) => r.value === '0'
    )!
    click(never)
    expect(onUpdate).toHaveBeenCalledWith({ collapseToDotAfterMs: 0 })
    const translate = [...container.querySelectorAll<HTMLInputElement>('input[type="text"]')].find(
      (i) => i.value === 'English'
    )!
    typeInto(translate, ' Georgian ')
    act(() => {
      translate.dispatchEvent(new FocusEvent('focusout', { bubbles: true }))
    })
    expect(onUpdate).toHaveBeenCalledWith({ translateTo: 'Georgian' })
  })

  it('clears chats only after the destructive confirm', async () => {
    const { container, onClearChats } = setup()
    click(byName(container, 'button', 'Clear all chats…'))
    const dialog = document.querySelector('dialog[open]')!
    expect(dialog.textContent).toContain('can’t be undone')
    expect(onClearChats).not.toHaveBeenCalled()
    click(byName(dialog, 'button', 'Clear all chats'))
    await wait(0)
    expect(onClearChats).toHaveBeenCalledTimes(1)
  })

  it('shows per-shortcut errors and pauses shortcuts while recording', () => {
    const { container, onRecordingChange } = setup(
      {},
      { captureHotkey: 'Another app already uses Ctrl+Alt+Space.' }
    )
    const rows = [...container.querySelectorAll('.hoot-hotkey')]
    expect(rows[1]?.textContent).toContain('Another app already uses')
    expect(rows[0]?.querySelector('.hoot-hotkey__error')).toBeNull()
    click(rows[0]!.querySelector('.hoot-hotkey__field'))
    expect(onRecordingChange).toHaveBeenLastCalledWith(true)
  })

  it('refuses giving both shortcuts the same keys', () => {
    const { container, onUpdate } = setup()
    const field = container.querySelector<HTMLButtonElement>('.hoot-hotkey__field')!
    click(field)
    act(() => {
      field.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: ' ',
          code: 'Space',
          ctrlKey: true,
          altKey: true,
          bubbles: true,
          cancelable: true
        })
      )
    })
    expect(onUpdate).not.toHaveBeenCalled()
    expect(container.textContent).toContain('Ctrl+Alt+Space already starts Circle anything.')
  })
})
