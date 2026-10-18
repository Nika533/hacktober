import { DEFAULT_SETTINGS, type LensSettings } from '@hoot/core'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { HootUIProvider } from '../src/components/HootUIProvider'
import { coldStartPatches, type ColdStartSetup } from '../src/lens/coldStartSetup'
import { ReadingPane } from '../src/lens/ReadingPane'
import { byName, click, render, wait } from './render'

function setup(initial: Partial<LensSettings>): {
  container: HTMLElement
  onColdStart: ReturnType<typeof vi.fn>
} {
  const onColdStart = vi.fn<(s: ColdStartSetup) => Promise<void>>()
  function Host(): React.JSX.Element {
    const [lens, setLens] = useState<LensSettings>({ ...DEFAULT_SETTINGS.lens, ...initial })
    return (
      <ReadingPane
        lens={lens}
        onUpdate={() => undefined}
        onOpenView={() => undefined}
        onOpenLink={() => undefined}
        onColdStart={async (s) => {
          await onColdStart(s)
          setLens((l) => ({ ...l, coldStartDone: true }))
        }}
        onBack={() => undefined}
      />
    )
  }
  const { container } = render(
    <HootUIProvider>
      <Host />
    </HootUIProvider>
  )
  return { container, onColdStart }
}

const CONSENTED = { enabled: true, consentedAt: 1 }

describe('cold start', () => {
  it('is offered only after consent, and only until it is done', () => {
    expect(setup({}).container.textContent).not.toContain('Teach Hoot what you already know')
    expect(setup({ ...CONSENTED, coldStartDone: true }).container.textContent).not.toContain(
      'Teach Hoot what you already know'
    )
    expect(setup(CONSENTED).container.textContent).toContain('Teach Hoot what you already know')
  })

  it('collects topics and style, saves them, then goes away', async () => {
    const { container, onColdStart } = setup(CONSENTED)
    click(byName(container, 'button', 'Start'))
    click(byName(container, 'button', 'Software'))
    click(byName(container, 'button', 'Law'))
    click(byName(container, 'button', 'Law'))
    click(byName(container, 'button', 'Finance'))
    const shorter = [...container.querySelectorAll<HTMLInputElement>('.hoot-coldstart input')].find(
      (r) => r.closest('label')?.textContent?.trim() === 'Shorter'
    )
    click(shorter ?? null)
    click(byName(container, 'button', 'Done'))
    await wait(0)
    expect(onColdStart).toHaveBeenCalledWith({
      topics: ['software', 'finance'],
      style: { length: 'shorter', plainWords: true, analogies: false }
    })
    expect(container.querySelector('.hoot-coldstart')).toBeNull()
  })

  it('folds back up with Not now', () => {
    const { container, onColdStart } = setup(CONSENTED)
    click(byName(container, 'button', 'Start'))
    click(byName(container, 'button', 'Not now'))
    expect(byName(container, 'button', 'Start')).toBeTruthy()
    expect(onColdStart).not.toHaveBeenCalled()
  })

  it('turns a setup into a profile edit plus the settings flag', () => {
    expect(
      coldStartPatches({
        topics: ['software', 'law'],
        style: { length: 'same', plainWords: false, analogies: true }
      })
    ).toEqual({
      profile: {
        topics: { software: 0.85, law: 0.85 },
        style: { length: 'same', plainWords: false, analogies: true }
      },
      settings: { coldStartDone: true }
    })
  })
})
