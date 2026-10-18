import { DEFAULT_SETTINGS, type LensSettings, type LensSettingsPatch } from '@hoot/core'
import { applySettingsPatch } from '@hoot/core/schemas'
import { act, useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { HootUIProvider } from '../src/components/HootUIProvider'
import { ReadingPane } from '../src/lens/ReadingPane'
import { ANTHROPIC_TERMS_URL, languageName, siteFromInput } from '../src/lens/sites'
import { byName, click, render } from './render'

function typeInto(el: HTMLInputElement, value: string): void {
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, value)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

/** Picks an option of the Segmented control labelled `group`. */
const pick = (root: ParentNode, group: string, option: string): void => {
  const radio = [...root.querySelectorAll<HTMLInputElement>('input[type="radio"]')].find((r) => {
    const labelId = r.closest('[role="radiogroup"]')?.getAttribute('aria-labelledby')
    const name = labelId ? document.getElementById(labelId)?.textContent : null
    return name === group && r.closest('label')?.textContent?.trim() === option
  })
  click(radio ?? null)
}

/** The pane on local state, recording every patch it sends. */
function setup(initial: Partial<LensSettings> = {}): {
  container: HTMLElement
  patches: LensSettingsPatch[]
  onOpenView: ReturnType<typeof vi.fn>
  onOpenLink: ReturnType<typeof vi.fn>
} {
  const patches: LensSettingsPatch[] = []
  const onOpenView = vi.fn()
  const onOpenLink = vi.fn()
  function Host(): React.JSX.Element {
    const [lens, setLens] = useState<LensSettings>({ ...DEFAULT_SETTINGS.lens, ...initial })
    return (
      <ReadingPane
        lens={lens}
        now={() => 1_700_000_000_000}
        onUpdate={(p) => {
          patches.push(p)
          setLens((l) => applySettingsPatch({ ...DEFAULT_SETTINGS, lens: l }, { lens: p }).lens)
        }}
        onOpenView={onOpenView}
        onOpenLink={onOpenLink}
        onBack={() => undefined}
      />
    )
  }
  const { container } = render(
    <HootUIProvider>
      <Host />
    </HootUIProvider>
  )
  return { container, patches, onOpenView, onOpenLink }
}

describe('siteFromInput', () => {
  it('turns what people paste into a registrable domain', () => {
    expect(siteFromInput('example.com')).toBe('example.com')
    expect(siteFromInput('https://www.Example.com/a?b')).toBe('example.com')
    expect(siteFromInput('news.bbc.co.uk')).toBe('bbc.co.uk')
    expect(siteFromInput('  ')).toBeNull()
    expect(siteFromInput('localhost')).toBeNull()
    expect(siteFromInput('ftp://example.com')).toBeNull()
    expect(siteFromInput('not a site')).toBeNull()
  })

  it('names languages in English', () => {
    expect(languageName('ka')).toBe('Georgian')
  })
})

describe('ReadingPane', () => {
  it('keeps Lens off until the user turns it on after reading what is sent', () => {
    const { container, patches } = setup()
    expect(container.querySelector('[role="switch"]')).toBeNull()
    expect(container.textContent).toContain('Sent to Anthropic (Claude)')
    click(byName(container, 'button', 'Turn on Hoot Lens'))
    expect(patches).toEqual([{ enabled: true, consentedAt: 1_700_000_000_000 }])
    const sw = container.querySelector<HTMLInputElement>('[role="switch"]')
    expect(sw?.checked).toBe(true)
    click(sw)
    expect(patches.at(-1)).toEqual({ enabled: false })
  })

  it('says the profile summary is sent and how Anthropic uses it, linking the terms', () => {
    const { container, onOpenLink } = setup()
    const terms = container.querySelector('.hoot-reading__terms')!
    expect(terms.textContent).toContain('a short summary of your reading profile')
    expect(terms.textContent).toContain(
      'In Auto mode, also to check whether a selection needs help'
    )
    expect(terms.textContent).toContain('How Anthropic uses it')
    expect(terms.textContent).toContain(
      'Anthropic doesn’t train its models on what Hoot sends with your API key, and deletes it ' +
        'within 30 days (longer only if it’s flagged under Anthropic’s Usage Policy).'
    )
    const link = terms.querySelector('a')
    expect(link?.textContent).toBe('Anthropic’s terms')
    click(link)
    expect(onOpenLink).toHaveBeenCalledWith(ANTHROPIC_TERMS_URL)
  })

  it('saves mode, high-stakes, copy behaviour and retention as they change', () => {
    const { container, patches } = setup()
    pick(container, 'Mode', 'Ask first')
    expect(patches.at(-1)).toEqual({ mode: 'ask' })
    expect(container.textContent).toContain('changes nothing until you click it')
    pick(container, 'Medical, legal and money pages', 'Allow rewrites')
    expect(patches.at(-1)).toEqual({ highStakes: 'allow-replace' })
    pick(container, 'When you copy changed text', 'Copy what I see')
    expect(patches.at(-1)).toEqual({ copyBehavior: 'visible' })
    pick(container, 'Keep reading history for', '365 days')
    expect(patches.at(-1)).toEqual({ retentionDays: 365 })
  })

  it('adds a site from a pasted URL and rejects nonsense', () => {
    const { container, patches } = setup()
    const input = container.querySelector<HTMLInputElement>('input[placeholder="example.com"]')!
    const form = input.closest('form')!
    typeInto(input, 'no site here')
    act(() => form.requestSubmit())
    expect(container.textContent).toContain('Enter a site like example.com.')
    typeInto(input, 'https://www.nytimes.com/section')
    act(() => form.requestSubmit())
    expect(patches.at(-1)).toEqual({ sites: { 'nytimes.com': 'never' } })
    expect(byName(container, 'button', 'Remove nytimes.com')).toBeTruthy()
  })

  it('removes a site with Undo', () => {
    const { container, patches } = setup({ sites: { 'example.com': 'paused' } })
    click(byName(container, 'button', 'Remove example.com'))
    expect(patches.at(-1)).toEqual({ sites: { 'example.com': null } })
    expect(container.textContent).toContain('No site rules yet')
    click(byName(document.body, 'button', 'Undo'))
    expect(patches.at(-1)).toEqual({ sites: { 'example.com': 'paused' } })
  })

  it('toggles comfortable languages and keeps the main one out of them', () => {
    const { container, patches } = setup({ languages: { primary: 'en', comfortable: ['ka'] } })
    click(byName(container, 'button', 'Spanish'))
    expect(patches.at(-1)).toEqual({ languages: { comfortable: ['ka', 'es'] } })
    const select = container.querySelector('select')!
    act(() => {
      select.value = 'ka'
      select.dispatchEvent(new Event('change', { bubbles: true }))
    })
    expect(patches.at(-1)).toEqual({ languages: { primary: 'ka', comfortable: ['es'] } })
    expect(() => byName(container, 'button', 'Georgian')).toThrow()
  })

  it('links to the profile and glossary pages', () => {
    const { container, onOpenView } = setup()
    click(container.querySelector('.hoot-reading__link'))
    expect(onOpenView).toHaveBeenLastCalledWith('profile')
    click(container.querySelectorAll('.hoot-reading__link')[1] ?? null)
    expect(onOpenView).toHaveBeenLastCalledWith('glossary')
  })
})
