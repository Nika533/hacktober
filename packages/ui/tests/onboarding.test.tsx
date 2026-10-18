import { DEFAULT_SETTINGS, type ApiKeyResult } from '@hoot/core'
import { act } from 'react'
import { describe, expect, it, vi, type Mock } from 'vitest'
import { HootUIProvider } from '../src/components/HootUIProvider'
import { OnboardingPane, type OnboardingPaneProps } from '../src/onboarding/OnboardingPane'
import { ONBOARDING_STEPS } from '../src/onboarding/steps'
import { ANTHROPIC_TERMS_URL } from '../src/lens/sites'
import { API_KEY_URL } from '../src/settings/ApiKeyField'
import { byName, click, render, wait } from './render'

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

/** The key step on its own, with the handlers a test wants to watch. */
function keyStep(over: Partial<OnboardingPaneProps> = {}): HTMLElement {
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
        onOpenLink={() => undefined}
        onStep={() => undefined}
        onFinish={() => undefined}
        {...over}
      />
    </HootUIProvider>
  )
  return current(container)
}

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
    expect(pips[1]?.textContent).toBe('Claude key, done')
    expect(ONBOARDING_STEPS).toEqual(['Welcome', 'Claude key', 'Shortcuts', 'Done'])
    expect(pips[3]?.getAttribute('aria-current')).toBeNull()
  })

  it('lets you skip the key, or continue once one is saved', () => {
    const { container, onStep, at } = setup(1)
    let step = current(container)
    expect(step.querySelector('h1')?.textContent).toBe('Connect Claude')
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

  it('asks for a Claude API key and links to the Anthropic Console', () => {
    const onOpenLink = vi.fn()
    const step = keyStep({ onOpenLink })
    expect(step.querySelector('.hoot-onb__lead')?.textContent).toBe(
      'Hoot answers with Claude, by Anthropic, using your own API key. Get one at console.anthropic.com.'
    )
    const input = step.querySelector('input')!
    expect(step.querySelector(`label[for="${input.id}"]`)?.textContent).toBe('Claude API key')
    expect(input.placeholder).toBe('sk-ant-…')
    expect(step.querySelector('.hoot-field__desc')?.textContent).toBe(
      'Hoot uses your own Claude API key (it starts with sk-ant-). It stays on this PC, encrypted.'
    )
    click(byName(step, 'button', 'Get a key'))
    expect(onOpenLink).toHaveBeenCalledWith(API_KEY_URL)
    expect(API_KEY_URL).toBe('https://console.anthropic.com/settings/keys')
    expect(step.textContent).not.toContain('free key')
  })

  it('says how Anthropic handles what Hoot sends, linking Anthropic’s terms', () => {
    const onOpenLink = vi.fn()
    const note = keyStep({ onOpenLink }).querySelector('.hoot-onb__note')!
    expect(note.textContent).toBe(
      'Anthropic doesn’t train its models on what Hoot sends with your API key, and deletes it ' +
        'within 30 days (longer only if it’s flagged under Anthropic’s Usage Policy). Anthropic’s terms'
    )
    const link = note.querySelector('a')!
    expect(link.textContent).toBe('Anthropic’s terms')
    expect(link.getAttribute('href')).toBe(ANTHROPIC_TERMS_URL)
    click(link)
    expect(onOpenLink).toHaveBeenCalledWith(ANTHROPIC_TERMS_URL)
  })

  it('checks the key with Anthropic and says why one didn’t save', async () => {
    const onSaveKey = vi.fn<(key: string) => Promise<ApiKeyResult>>(async () => ({
      ok: false,
      reason: 'rejected'
    }))
    const step = keyStep({ onSaveKey })
    const input = step.querySelector('input')!
    const form = step.querySelector('form')!
    const error = (): string | null | undefined =>
      step.querySelector('.hoot-field__error')?.textContent

    typeInto(input, '  sk-ant-api03-revoked  ')
    submit(form)
    await wait(0)
    expect(onSaveKey).toHaveBeenLastCalledWith('sk-ant-api03-revoked')
    expect(input.getAttribute('aria-invalid')).toBe('true')
    expect(error()).toBe(
      'Anthropic rejected this key. Check it was copied in full, or create a new one.'
    )

    typeInto(input, 'AIza-not-a-claude-key')
    submit(form)
    await wait(0)
    expect(error()).toBe(
      'Anthropic rejected this key. Claude API keys start with sk-ant-, so check you copied the right one, in full.'
    )

    onSaveKey.mockResolvedValueOnce({ ok: false, reason: 'unreachable' })
    typeInto(input, 'sk-ant-api03-offline')
    submit(form)
    await wait(0)
    expect(error()).toBe(
      'Hoot couldn’t reach Anthropic to check the key. Check your connection, then try again.'
    )
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
    expect(step.textContent).toContain('can’t answer until you add a Claude API key')
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
