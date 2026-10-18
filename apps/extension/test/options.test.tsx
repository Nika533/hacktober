import { DEFAULT_LENS_SETTINGS, LensBackendError, type LensSettings } from '@hoot/core'
import { createFakeLensBackend } from '@hoot/core/testing'
import { HootUIProvider } from '@hoot/ui'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { OptionsApp, type ConnectionSource, type SettingsSource } from '../src/options/App'
import type { BridgeStatus } from '../src/messages'
import { normalizeSite, sortedSites } from '../src/options/sites'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
for (const proto of [Element.prototype, HTMLElement.prototype]) {
  if (Object.hasOwn(proto, 'animate')) delete (proto as { animate?: unknown }).animate
}

const SETTINGS: LensSettings = {
  ...DEFAULT_LENS_SETTINGS,
  enabled: true,
  consentedAt: 1,
  mode: 'ask',
  sites: { 'b.test': 'paused', 'a.test': 'never' }
}

const roots: Root[] = []

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount())
  document.body.innerHTML = ''
})

async function mount(source: SettingsSource, connection?: ConnectionSource): Promise<HTMLElement> {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  roots.push(root)
  await act(async () =>
    root.render(
      <HootUIProvider>
        <OptionsApp source={source} connection={connection} />
      </HootUIProvider>
    )
  )
  return container
}

const settle = (): Promise<void> => act(() => new Promise<void>((r) => setTimeout(r, 0)))

function group(name: string): HTMLElement {
  const hit = [...document.querySelectorAll<HTMLElement>('[role="radiogroup"]')].find(
    (el) => document.getElementById(el.getAttribute('aria-labelledby') ?? '')?.textContent === name
  )
  if (!hit) throw new Error(`no radiogroup named "${name}"`)
  return hit
}

const checked = (name: string): string | undefined =>
  group(name).querySelector<HTMLInputElement>('input:checked')?.value

async function choose(name: string, value: string): Promise<void> {
  const input = group(name).querySelector<HTMLInputElement>(`input[value="${value}"]`)
  act(() => input?.click())
  await settle()
}

function button(name: string): HTMLButtonElement {
  const hit = [...document.querySelectorAll('button')].find(
    (el) => (el.getAttribute('aria-label') ?? el.textContent ?? '').trim() === name
  )
  if (!hit) throw new Error(`no button named "${name}"`)
  return hit
}

async function addSite(text: string): Promise<void> {
  const input = document.querySelector<HTMLInputElement>('input[placeholder="example.com"]')
  if (!input) throw new Error('no site field')
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, text)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  act(() => button('Add').click())
  await settle()
}

const siteNames = (): string[] =>
  [...document.querySelectorAll('.hoot-options__site-name')].map((el) => el.textContent ?? '')

describe('normalizeSite', () => {
  it('turns URLs and hostnames into the site key the content script uses', () => {
    expect(normalizeSite('  https://www.Example.com/a?b#c ')).toBe('example.com')
    expect(normalizeSite('news.example.co.uk')).toBe('example.co.uk')
    expect(normalizeSite('localhost:4510')).toBe('localhost')
    expect(normalizeSite('http://127.0.0.1:4510/article.html')).toBe('127.0.0.1')
  })

  it('rejects what can never match a page', () => {
    for (const bad of [
      '',
      '   ',
      'not a site',
      '*.example.com',
      'file:///C:/a.pdf',
      'ftp://x.test'
    ]) {
      expect(normalizeSite(bad), bad).toBeNull()
    }
  })

  it('sorts rules by site', () => {
    expect(sortedSites({ 'b.test': 'paused', 'a.test': 'never' })).toEqual([
      ['a.test', 'never'],
      ['b.test', 'paused']
    ])
  })
})

describe('options page', () => {
  it('shows the current settings and saves the mode', async () => {
    const backend = createFakeLensBackend({ settings: SETTINGS })
    await mount(backend)
    expect(document.querySelector<HTMLInputElement>('[role="switch"]')?.checked).toBe(true)
    expect(checked('Mode')).toBe('ask')
    expect(siteNames()).toEqual(['a.test', 'b.test'])
    expect(checked('Lens on b.test')).toBe('paused')

    await choose('Mode', 'gloss')
    expect(checked('Mode')).toBe('gloss')
    expect((await backend.getSettings()).mode).toBe('gloss')
  })

  it('only lets the user turn Lens on after consenting in Studio', async () => {
    await mount(
      createFakeLensBackend({ settings: { ...SETTINGS, enabled: false, consentedAt: null } })
    )
    const toggle = document.querySelector<HTMLInputElement>('[role="switch"]')
    expect(toggle?.disabled).toBe(true)
    expect(document.body.textContent).toContain('Turn Lens on in Hoot Studio first')
  })

  it('adds a site from a pasted URL and rejects nonsense', async () => {
    const backend = createFakeLensBackend({ settings: SETTINGS })
    const patch = vi.spyOn(backend, 'patchSettings')
    await mount(backend)

    await addSite('not a site')
    expect(document.body.textContent).toContain('Enter a site like example.com.')
    expect(patch).not.toHaveBeenCalled()

    await choose('Rule for the new site', 'always')
    await addSite('https://www.Wikipedia.org/wiki/Owl')
    expect(patch).toHaveBeenCalledWith({ sites: { 'wikipedia.org': 'always' } })
    expect(siteNames()).toEqual(['a.test', 'b.test', 'wikipedia.org'])
    expect(document.body.textContent).not.toContain('Enter a site like')
  })

  it('changes a rule, removes a site and undoes the removal', async () => {
    const backend = createFakeLensBackend({ settings: SETTINGS })
    await mount(backend)

    await choose('Lens on b.test', 'always')
    expect((await backend.getSettings()).sites['b.test']).toBe('always')

    act(() => button('Remove a.test').click())
    await settle()
    expect(siteNames()).toEqual(['b.test'])
    expect(document.activeElement).toBe(button('Remove b.test'))
    expect((await backend.getSettings()).sites).toEqual({ 'b.test': 'always' })

    act(() => button('Undo').click())
    await settle()
    expect(siteNames()).toEqual(['a.test', 'b.test'])
  })

  it('follows changes made elsewhere, such as Alt+H on a page', async () => {
    const backend = createFakeLensBackend({ settings: SETTINGS })
    await mount(backend)
    act(() => backend.emitSettings({ ...SETTINGS, sites: { 'c.test': 'paused' } }))
    expect(siteNames()).toEqual(['c.test'])
    act(() => backend.emitSettings({ ...SETTINGS, sites: {} }))
    expect(document.body.textContent).toContain('No site rules yet.')
  })

  it('rolls back and says so when a change can’t be saved', async () => {
    const backend = createFakeLensBackend({ settings: SETTINGS })
    vi.spyOn(backend, 'patchSettings').mockRejectedValue(new LensBackendError('internal', 'x'))
    await mount(backend)
    await choose('Mode', 'auto')
    expect(document.body.textContent).toContain('Couldn’t save that change.')
    expect(checked('Mode')).toBe('ask')
  })

  it('shows the connection to the Hoot app and follows its changes', async () => {
    const listeners = new Set<(status: BridgeStatus) => void>()
    const connection: ConnectionSource = {
      status: vi.fn(async (): Promise<BridgeStatus> => ({
        state: 'not_running',
        appVersion: null
      })),
      onStatus: (cb) => {
        listeners.add(cb)
        return () => listeners.delete(cb)
      }
    }
    await mount(createFakeLensBackend({ settings: SETTINGS }), connection)
    await settle()
    const status = (): string => document.querySelector('[role="status"]')?.textContent ?? ''
    expect(status()).toBe('Hoot isn’t running.')
    expect(document.body.textContent).toContain('Open Hoot on this computer.')

    act(() => button('Try again').click())
    await settle()
    expect(connection.status).toHaveBeenCalledTimes(2)

    act(() => {
      for (const cb of listeners) cb({ state: 'connected', appVersion: '1.2.3' })
    })
    expect(status()).toBe('Connected to Hoot 1.2.3')
    expect(document.body.textContent).not.toContain('Try again')
  })

  it('offers a retry when the settings can’t be loaded', async () => {
    const backend = createFakeLensBackend({ settings: SETTINGS })
    const get = vi
      .spyOn(backend, 'getSettings')
      .mockRejectedValueOnce(new LensBackendError('network', 'asleep'))
    await mount(backend)
    expect(document.querySelector('[role="alert"]')?.textContent).toContain(
      'Couldn’t load your Lens settings.'
    )
    act(() => button('Try again').click())
    await settle()
    expect(get).toHaveBeenCalledTimes(2)
    expect(checked('Mode')).toBe('ask')
  })
})
