import type { ProfilePatch } from '@hoot/core'
import { act, useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { HootUIProvider } from '../src/components/HootUIProvider'
import { createFakeLensPages, sampleGlossary } from '../src/gallery/fakeLensPages'
import { GlossaryPane } from '../src/lens/GlossaryPane'
import { ProfilePane } from '../src/lens/ProfilePane'
import { timeAgo, useLensPages, type LensPagesApi } from '../src/lens/useLensPages'
import { byName, click, render, wait } from './render'

function typeInto(el: HTMLInputElement, value: string): void {
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, value)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

const pick = (root: ParentNode, group: string, option: string): void => {
  const radio = [...root.querySelectorAll<HTMLInputElement>('input[type="radio"]')].find((r) => {
    const labelId = r.closest('[role="radiogroup"]')?.getAttribute('aria-labelledby')
    const name = labelId ? document.getElementById(labelId)?.textContent : null
    return name === group && r.closest('label')?.textContent?.trim() === option
  })
  click(radio ?? null)
}

function Profile({ api }: { api: LensPagesApi }): React.JSX.Element {
  const d = useLensPages(api, true)
  return (
    <ProfilePane
      profile={d.profile}
      changes={d.changes}
      failed={d.failed}
      onRetry={d.reload}
      onPatch={d.patch}
      onExport={api.exportProfile}
      onReset={d.reset}
      onBack={() => undefined}
    />
  )
}

async function mountProfile(): Promise<{
  container: HTMLElement
  api: LensPagesApi
  patches: ProfilePatch[]
}> {
  const api = createFakeLensPages()
  const patches: ProfilePatch[] = []
  const patch = api.patchProfile
  api.patchProfile = (p) => {
    patches.push(p)
    return patch(p)
  }
  const { container } = render(
    <HootUIProvider>
      <Profile api={api} />
    </HootUIProvider>
  )
  await wait(0)
  return { container, api, patches }
}

describe('timeAgo', () => {
  it('reads like a person', () => {
    const now = 1_700_000_000_000
    expect(timeAgo(now - 10_000, now)).toBe('just now')
    expect(timeAgo(now - 5 * 60_000, now)).toBe('5 minutes ago')
    expect(timeAgo(now - 3 * 3_600_000, now)).toBe('3 hours ago')
    expect(timeAgo(now - 86_400_000, now)).toBe('yesterday')
  })
})

describe('ProfilePane', () => {
  it('shows the summary Hoot sends and the recent changes with their originals', async () => {
    const { container } = await mountProfile()
    expect(container.querySelector('pre')?.textContent).toContain('Finds hard: amortization')
    const changes = container.querySelector('[aria-label="Recent changes"]')
    expect(changes?.children).toHaveLength(3)
    expect(changes?.textContent).toContain('Original: amortization')
    expect(changes?.textContent).toContain('Defined a term')
  })

  it('edits style, then the summary follows', async () => {
    const { container, patches } = await mountProfile()
    pick(container, 'Rewrites', 'Shorter')
    await wait(0)
    expect(patches.at(-1)).toEqual({ style: { length: 'shorter' } })
    expect(container.querySelector('pre')?.textContent).toContain('shorter rewrites')
  })

  it('adds a known word, changes a word’s state, and forgets one with Undo', async () => {
    const { container, patches } = await mountProfile()
    const input = container.querySelector<HTMLInputElement>('input[placeholder="e.g. latency"]')!
    typeInto(input, '  kubernetes ')
    act(() => input.form!.requestSubmit())
    await wait(0)
    expect(patches.at(-1)).toEqual({ terms: { kubernetes: 'known' } })

    pick(container, 'How well you know “amortization”', 'Known')
    await wait(0)
    expect(patches.at(-1)).toEqual({ terms: { amortization: 'known' } })

    click(byName(container, 'button', 'Forget “latency”'))
    await wait(0)
    expect(patches.at(-1)).toEqual({ terms: { latency: null } })
    click(byName(document.body, 'button', 'Undo'))
    await wait(0)
    expect(patches.at(-1)).toEqual({ terms: { latency: 'known' } })
  })

  it('filters words by state', async () => {
    const { container } = await mountProfile()
    pick(container, 'Show', 'Learning 2')
    const words = container.querySelector('[aria-label="Words"]')
    expect(
      [...(words?.querySelectorAll('.hoot-profile__name') ?? [])].map((n) => n.textContent)
    ).toEqual(['compound interest', 'force majeure'])
  })

  it('exports with the saved path, and resets only after a confirm', async () => {
    const { container, api } = await mountProfile()
    click(byName(container, 'button', 'Export…'))
    await wait(0)
    expect(document.body.textContent).toContain('Saved to C:\\Users\\you\\Documents')

    const reset = vi.spyOn(api, 'resetProfile')
    click(byName(container, 'button', 'Reset…'))
    await wait(0)
    click(byName(document.body, 'button', 'Cancel'))
    await wait(0)
    expect(reset).not.toHaveBeenCalled()
    click(byName(container, 'button', 'Reset…'))
    await wait(0)
    click(byName(document.body, 'button', 'Reset'))
    await wait(10)
    expect(reset).toHaveBeenCalledOnce()
    expect(container.textContent).toContain('No words yet.')
  })

  it('offers a retry when main doesn’t answer', async () => {
    const api = createFakeLensPages()
    let fail = true
    const profile = api.profile
    api.profile = () => (fail ? Promise.reject(new Error('down')) : profile())
    const { container } = render(
      <HootUIProvider>
        <Profile api={api} />
      </HootUIProvider>
    )
    await wait(0)
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('couldn’t load')
    fail = false
    click(byName(container, 'button', 'Try again'))
    await wait(0)
    expect(container.querySelector('pre')).not.toBeNull()
  })
})

describe('useLensPages', () => {
  it('reloads when the profile changes in main', async () => {
    const api = createFakeLensPages()
    let push: (() => void) | undefined
    api.onProfile = (cb) => {
      push = () =>
        cb({ version: 2, threshold: 0.7, askFirstRemaining: 0, knownTerms: [], perSite: {} })
      return () => (push = undefined)
    }
    const glossary = vi.spyOn(api, 'glossary')
    render(<Probe api={api} />)
    await wait(0)
    expect(glossary).toHaveBeenCalledTimes(1)
    act(() => push?.())
    await wait(0)
    expect(glossary).toHaveBeenCalledTimes(2)
  })

  function Probe({ api }: { api: LensPagesApi }): null {
    useLensPages(api, true)
    return null
  }
})

describe('GlossaryPane', () => {
  function Glossary({
    onPin,
    onMarkKnown
  }: {
    onPin: (text: string) => Promise<void>
    onMarkKnown: (term: string) => Promise<void>
  }): React.JSX.Element {
    const [entries] = useState(sampleGlossary)
    return (
      <HootUIProvider>
        <GlossaryPane
          entries={entries}
          onPin={onPin}
          onMarkKnown={onMarkKnown}
          onBack={() => undefined}
        />
      </HootUIProvider>
    )
  }

  it('searches terms and glosses', () => {
    const { container } = render(<Glossary onPin={vi.fn()} onMarkKnown={vi.fn()} />)
    expect(container.querySelectorAll('.hoot-glossary__entry')).toHaveLength(3)
    typeInto(container.querySelector<HTMLInputElement>('input[type="search"]')!, 'contract')
    expect(container.querySelectorAll('.hoot-glossary__entry')).toHaveLength(1)
    expect(container.textContent).toContain('1 of 3 terms')
  })

  it('pins an entry as a note and marks one known', async () => {
    const onPin = vi.fn(() => Promise.resolve())
    const onMarkKnown = vi.fn(() => Promise.resolve())
    const { container } = render(<Glossary onPin={onPin} onMarkKnown={onMarkKnown} />)
    const first = container.querySelector('.hoot-glossary__entry')!
    click(byName(first, 'button', 'Pin as note'))
    await wait(0)
    expect(onPin).toHaveBeenCalledWith(
      'amortization\nPaying off a loan in regular instalments that cover interest and part of the loan.'
    )
    expect(document.body.textContent).toContain('Pinned “amortization” as a note')
    click(byName(first, 'button', 'I know this now'))
    expect(onMarkKnown).toHaveBeenCalledWith('amortization')
    // Known entries don't offer it again.
    const known = [...container.querySelectorAll('.hoot-glossary__entry')].at(-1)!
    expect(() => byName(known, 'button', 'I know this now')).toThrow()
  })

  it('explains an empty glossary', () => {
    const { container } = render(
      <HootUIProvider>
        <GlossaryPane entries={[]} onPin={vi.fn()} onMarkKnown={vi.fn()} onBack={() => undefined} />
      </HootUIProvider>
    )
    expect(container.textContent).toContain('Your glossary is empty')
  })
})
