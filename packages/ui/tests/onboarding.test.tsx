import { DEFAULT_SETTINGS } from '@hoot/core'
import { describe, expect, it, vi, type Mock } from 'vitest'
import { HootUIProvider } from '../src/components/HootUIProvider'
import { OnboardingPane } from '../src/onboarding/OnboardingPane'
import { GEMINI_TERMS_URL } from '../src/lens/sites'
import { byName, click, render } from './render'

type Handlers = {
  onStep: Mock<(n: number) => void>
  onFinish: Mock<() => void>
}

function setup(
  step: number,
  hasApiKey = false
): ReturnType<typeof render> & Handlers & { at: (step: number, hasKey?: boolean) => void } {
  const h: Handlers = { onStep: vi.fn(), onFinish: vi.fn() }
  const ui = (s: number, key: boolean): React.JSX.Element => (
    <HootUIProvider>
      <OnboardingPane
        step={s}
        summonHotkey={DEFAULT_SETTINGS.summonHotkey}
        captureHotkey={DEFAULT_SETTINGS.captureHotkey}
        hasApiKey={key}
        keyStorage="os-encrypted"
        onUpdate={() => undefined}
        onSaveKey={async () => ({ ok: true })}
        onOpenLink={() => undefined}
        {...h}
      />
    </HootUIProvider>
  )
  const r = render(ui(step, hasApiKey))
  return { ...r, ...h, at: (s, key = hasApiKey) => r.rerender(ui(s, key)) }
}

const current = (root: ParentNode): HTMLElement =>
  [...root.querySelectorAll<HTMLElement>('[data-step]')].at(-1)!

describe('OnboardingPane', () => {
  it('welcomes with the real shortcuts and starts the flow', () => {
    const { container, onStep } = setup(0)
    const step = current(container)
    expect(step.querySelector('h1')?.textContent).toBe('Hi, I’m Hoot')
    expect(step.textContent).toContain('Summon me from any app')
    expect(step.querySelectorAll('.hoot-onb__feature .hoot-kbd')).toHaveLength(2)
    expect(step.querySelector('.hoot-onb__footer')?.textContent).not.toContain('Back')
    click(byName(step, 'button', 'Get started'))
    expect(onStep).toHaveBeenCalledWith(1)
  })

  it('marks progress for assistive tech', () => {
    const { container } = setup(2)
    const pips = [...container.querySelectorAll('.hoot-onb__progress > li')]
    expect(pips).toHaveLength(4)
    expect(pips[2]?.getAttribute('aria-current')).toBe('step')
    expect(pips[0]?.textContent).toBe('Welcome, done')
    expect(pips[3]?.getAttribute('aria-current')).toBeNull()
  })

  it('lets you skip the key, or continue once one is saved', () => {
    const { container, onStep, at } = setup(1)
    let step = current(container)
    expect(document.activeElement).toBe(step.querySelector('input'))
    click(byName(step, 'button', 'Skip for now'))
    expect(onStep).toHaveBeenLastCalledWith(2)
    click(byName(step, 'button', 'Back'))
    expect(onStep).toHaveBeenLastCalledWith(0)

    at(1, true)
    step = current(container)
    expect(step.textContent).not.toContain('Skip for now')
    click(byName(step, 'button', 'Continue'))
    expect(onStep).toHaveBeenLastCalledWith(2)
  })

  it('says keys are 18+ and how a free key differs, linking the Gemini terms', () => {
    const onOpenLink = vi.fn()
    const { container } = render(
      <HootUIProvider>
        <OnboardingPane
          step={1}
          summonHotkey={DEFAULT_SETTINGS.summonHotkey}
          captureHotkey={DEFAULT_SETTINGS.captureHotkey}
          hasApiKey={false}
          keyStorage="os-encrypted"
          onUpdate={() => undefined}
          onSaveKey={async () => ({ ok: true })}
          onOpenLink={onOpenLink}
          onStep={() => undefined}
          onFinish={() => undefined}
        />
      </HootUIProvider>
    )
    const note = current(container).querySelector('.hoot-onb__note')!
    expect(note.textContent).toContain('for people 18 and over')
    expect(note.textContent).toContain('With a free key')
    click(note.querySelector('a'))
    expect(onOpenLink).toHaveBeenCalledWith(GEMINI_TERMS_URL)
  })

  it('moves focus to the new step’s heading', () => {
    const { container, at } = setup(0)
    at(2)
    const step = current(container)
    expect(step.dataset.step).toBe('2')
    expect(document.activeElement).toBe(step.querySelector('h1'))
    expect(step.querySelectorAll('.hoot-hotkey')).toHaveLength(2)
  })

  it('finishes, and reminds about the key only when there is none', () => {
    const { container, onFinish, at } = setup(3)
    let step = current(container)
    expect(step.textContent).toContain('can’t answer until you add a Gemini key')
    click(byName(step, 'button', 'Start using Hoot'))
    expect(onFinish).toHaveBeenCalledTimes(1)
    at(3, true)
    step = current(container)
    expect(step.textContent).not.toContain('can’t answer')
  })

  it('shows the live extension status on the last step only when main serves it', () => {
    const { container } = setup(3)
    expect(current(container).querySelector('.hoot-extstatus')).toBeNull()
    const withLens = render(
      <HootUIProvider>
        <OnboardingPane
          step={3}
          summonHotkey={DEFAULT_SETTINGS.summonHotkey}
          captureHotkey={DEFAULT_SETTINGS.captureHotkey}
          hasApiKey
          keyStorage="os-encrypted"
          lens={{ bridge: 'connected', clients: 1 }}
          onStep={() => undefined}
          onFinish={() => undefined}
          onUpdate={() => undefined}
          onSaveKey={async () => ({ ok: true })}
          onOpenLink={() => undefined}
        />
      </HootUIProvider>
    )
    expect(current(withLens.container).textContent).toContain('Hoot Lens is connected')
  })

  it('clamps an out-of-range step from main', () => {
    const { container } = setup(9)
    expect(current(container).querySelector('h1')?.textContent).toBe('You’re all set')
  })
})
