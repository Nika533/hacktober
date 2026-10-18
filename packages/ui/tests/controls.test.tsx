import { act } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { Button } from '../src/components/Button'
import { IconButton } from '../src/components/IconButton'
import { Kbd } from '../src/components/Kbd'
import { Owl } from '../src/components/Owl'
import { OWL_MOODS } from '../src/components/owlMood'
import { Segmented } from '../src/components/Segmented'
import { Slider } from '../src/components/Slider'
import { Switch } from '../src/components/Switch'
import { TextField } from '../src/components/TextField'
import { click, key, render, wait } from './render'

describe('Button', () => {
  it('defaults to type=button and blocks clicks while busy', () => {
    const onClick = vi.fn()
    const { container, rerender } = render(<Button onClick={onClick}>Check key</Button>)
    const btn = container.querySelector('button')!
    expect(btn.type).toBe('button')
    click(btn)
    expect(onClick).toHaveBeenCalledTimes(1)

    rerender(
      <Button onClick={onClick} busy>
        Check key
      </Button>
    )
    expect(btn.getAttribute('aria-busy')).toBe('true')
    click(btn)
    expect(onClick).toHaveBeenCalledTimes(1)
  })
})

describe('IconButton', () => {
  it('names the button and shows its tooltip on keyboard focus, Esc hides it', () => {
    const { container } = render(
      <IconButton label="Open in Studio" shortcut="Ctrl+L">
        <svg />
      </IconButton>
    )
    const btn = container.querySelector('button')!
    expect(btn.getAttribute('aria-label')).toBe('Open in Studio')
    act(() => btn.focus())
    const tip = document.querySelector('.hoot-tooltip')
    expect(tip?.textContent).toContain('Open in Studio')
    expect([...tip!.querySelectorAll('.hoot-kbd__key')].map((k) => k.textContent)).toEqual([
      'Ctrl',
      'L'
    ])
    // It repeats the accessible name, so it stays out of the a11y tree.
    expect(tip?.getAttribute('aria-hidden')).toBe('true')
    key(document, 'Escape')
    expect(document.querySelector('.hoot-tooltip')).toBeNull()
  })

  it('follows the trigger on scroll instead of vanishing (Tab scrolls focus into view)', async () => {
    const { container } = render(
      <IconButton label="Pin as note">
        <svg />
      </IconButton>
    )
    const btn = container.querySelector('button')!
    act(() => btn.focus())
    act(() => {
      window.dispatchEvent(new Event('scroll'))
    })
    await wait(50)
    expect(document.querySelector('.hoot-tooltip')).not.toBeNull()

    // Once the trigger is off screen the tip goes away.
    btn.getBoundingClientRect = () => new DOMRect(0, -200, 32, 32)
    act(() => {
      window.dispatchEvent(new Event('scroll'))
    })
    await wait(50)
    expect(document.querySelector('.hoot-tooltip')).toBeNull()
  })

  it('opens on hover after the delay and closes on press', async () => {
    vi.useFakeTimers()
    try {
      const { container } = render(
        <IconButton label="Copy answer">
          <svg />
        </IconButton>
      )
      const btn = container.querySelector('button')!
      act(() => {
        btn.dispatchEvent(new PointerEvent('pointerover', { bubbles: true, pointerType: 'mouse' }))
        btn.dispatchEvent(new PointerEvent('pointerenter', { pointerType: 'mouse' }))
      })
      expect(document.querySelector('.hoot-tooltip')).toBeNull()
      act(() => vi.advanceTimersByTime(600))
      expect(document.querySelector('.hoot-tooltip')).not.toBeNull()
      act(() => {
        btn.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'mouse' }))
      })
      expect(document.querySelector('.hoot-tooltip')).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('Segmented', () => {
  const options = [
    { value: 'flash-lite', label: 'Flash-Lite' },
    { value: 'flash', label: 'Flash' },
    { value: 'argon', label: 'Argon', hint: 'paid tier' }
  ] as const

  it('is a labelled radiogroup of native radios', () => {
    const onChange = vi.fn()
    const { container } = render(
      <Segmented label="Model" value="flash" options={options} onChange={onChange} />
    )
    const group = container.querySelector('[role="radiogroup"]')!
    const labelId = group.getAttribute('aria-labelledby')!
    expect(document.getElementById(labelId)?.textContent).toBe('Model')
    const radios = [...group.querySelectorAll<HTMLInputElement>('input[type="radio"]')]
    expect(radios.map((r) => r.checked)).toEqual([false, true, false])
    expect(new Set(radios.map((r) => r.name)).size).toBe(1)
    expect(group.textContent).toContain('paid tier')

    click(radios[2]!)
    expect(onChange).toHaveBeenCalledWith('argon')
  })

  it('disables single options and the whole group', () => {
    const { container, rerender } = render(
      <Segmented
        label="Retention"
        value="30"
        options={[
          { value: '30', label: '30 days' },
          { value: '365', label: '365 days', disabled: true }
        ]}
        onChange={() => undefined}
      />
    )
    const radios = (): HTMLInputElement[] => [...container.querySelectorAll('input')]
    expect(radios().map((r) => r.disabled)).toEqual([false, true])
    rerender(
      <Segmented
        label="Retention"
        value="30"
        disabled
        options={[{ value: '30', label: '30 days' }]}
        onChange={() => undefined}
      />
    )
    expect(radios().every((r) => r.disabled)).toBe(true)
  })
})

describe('Switch', () => {
  it('exposes role=switch, its description, and reports the next state', () => {
    const onChange = vi.fn()
    const { container } = render(
      <Switch
        label="Save chat history"
        description="Chats stay on this PC."
        checked={false}
        onChange={onChange}
      />
    )
    const input = container.querySelector<HTMLInputElement>('input[role="switch"]')!
    expect(input.checked).toBe(false)
    const desc = document.getElementById(input.getAttribute('aria-describedby')!)
    expect(desc?.textContent).toBe('Chats stay on this PC.')
    click(input)
    expect(onChange).toHaveBeenCalledWith(true)
  })
})

describe('TextField', () => {
  it('links label, description and error to the input', () => {
    const { container } = render(
      <TextField
        label="Gemini API key"
        description="Stored encrypted."
        error="Google rejected this key."
        defaultValue="x"
      />
    )
    const input = container.querySelector('input')!
    const label = container.querySelector('label')!
    expect(label.htmlFor).toBe(input.id)
    expect(input.getAttribute('aria-invalid')).toBe('true')
    const described = input
      .getAttribute('aria-describedby')!
      .split(' ')
      .map((id) => document.getElementById(id)?.textContent)
    expect(described).toEqual(['Stored encrypted.', 'Google rejected this key.'])
  })

  it('passes input props through and is valid without an error', () => {
    const { container } = render(
      <TextField label="Search" hideLabel placeholder="Search chats" type="search" />
    )
    const input = container.querySelector('input')!
    expect(input.type).toBe('search')
    expect(input.placeholder).toBe('Search chats')
    expect(input.hasAttribute('aria-invalid')).toBe(false)
    expect(container.querySelector('label')!.className).toBe('hoot-visually-hidden')
  })
})

describe('Slider', () => {
  it('speaks the formatted value and reports numbers', () => {
    const onChange = vi.fn()
    const { container } = render(
      <Slider
        label="Shrink to a dot after"
        value={5}
        min={0}
        max={20}
        onChange={onChange}
        formatValue={(v) => `${v} s`}
      />
    )
    const input = container.querySelector<HTMLInputElement>('input[type="range"]')!
    expect(input.getAttribute('aria-valuetext')).toBe('5 s')
    expect(input.style.getPropertyValue('--hoot-slider-fill')).toBe('25%')
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
      setter.call(input, '12')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(onChange).toHaveBeenCalledWith(12)
  })
})

describe('Kbd', () => {
  it('gives each key its own cap', () => {
    const { container } = render(<Kbd keys="Ctrl+Shift+Space" />)
    const caps = [...container.querySelectorAll('.hoot-kbd__key')].map((k) => k.textContent)
    expect(caps).toEqual(['Ctrl', 'Shift', 'Space'])
  })

  it('handles a literal plus key', () => {
    const { container } = render(<Kbd keys="Ctrl++" />)
    const caps = [...container.querySelectorAll('.hoot-kbd__key')].map((k) => k.textContent)
    expect(caps).toEqual(['Ctrl', 'Plus'])
  })
})

describe('Owl', () => {
  it('renders every mood, decorative unless labelled', () => {
    for (const mood of OWL_MOODS) {
      const { container } = render(<Owl mood={mood} />)
      const svg = container.querySelector('svg')!
      expect(svg.dataset.mood).toBe(mood)
      expect(svg.getAttribute('aria-hidden')).toBe('true')
    }
    const { container } = render(<Owl mood="idle" label="Hoot" />)
    const svg = container.querySelector('svg')!
    expect(svg.getAttribute('role')).toBe('img')
    expect(svg.getAttribute('aria-label')).toBe('Hoot')
  })

  it('keeps gradient ids unique across instances', () => {
    const { container } = render(
      <>
        <Owl mood="idle" />
        <Owl mood="idle" />
      </>
    )
    const ids = [...container.querySelectorAll('linearGradient')].map((g) => g.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})
