import { VOICE_OFF, VOICE_PROBLEM_TEXT, type VoiceSlice } from '@hoot/core'
import { afterEach, describe, expect, it, vi, type Mock } from 'vitest'
import { Transcript } from '../src/chat/Transcript'
import { VoiceButton, VoiceStatus } from '../src/chat/Voice'
import { byName, cleanup, click, render } from './render'

afterEach(cleanup)

const controls = (): { start: Mock; finish: Mock; stop: Mock } => ({
  start: vi.fn(),
  finish: vi.fn(),
  stop: vi.fn()
})
const voice = (over: Partial<VoiceSlice>): VoiceSlice => ({ ...VOICE_OFF, ...over })

describe('VoiceButton', () => {
  it('starts a voice chat, says "done talking" while listening and cuts Hoot off while it speaks', () => {
    const c = controls()
    const { container, rerender } = render(<VoiceButton voice={VOICE_OFF} controls={c} />)
    click(byName(container, 'button', 'Talk to Hoot'))
    expect(c.start).toHaveBeenCalledTimes(1)

    rerender(<VoiceButton voice={voice({ phase: 'listening', level: 0.5 })} controls={c} />)
    const listening = byName(container, 'button', 'Done talking')
    expect(listening.getAttribute('aria-pressed')).toBe('true')
    expect(listening.style.getPropertyValue('--hoot-voice-level')).toBe('0.5')
    click(listening)
    expect(c.finish).toHaveBeenCalledTimes(1)

    rerender(<VoiceButton voice={voice({ phase: 'speaking' })} controls={c} />)
    click(byName(container, 'button', 'Talk now (Hoot stops speaking)'))
    expect(c.start).toHaveBeenCalledTimes(2)

    rerender(<VoiceButton voice={voice({ phase: 'starting' })} controls={c} />)
    click(byName(container, 'button', 'Starting voice… (press to cancel)'))
    expect(c.stop).toHaveBeenCalledTimes(1)
  })
})

describe('VoiceStatus', () => {
  it('shows nothing when voice is off and nothing went wrong', () => {
    const { container } = render(<VoiceStatus voice={VOICE_OFF} controls={controls()} />)
    expect(container.textContent).toBe('')
  })

  it('shows what Hoot heard, and End stops the voice chat', () => {
    const c = controls()
    const { container, rerender } = render(
      <VoiceStatus voice={voice({ phase: 'listening' })} controls={c} />
    )
    expect(container.querySelector('[role="status"]')?.textContent).toBe(
      'Listening… say what you need.'
    )
    rerender(
      <VoiceStatus voice={voice({ phase: 'listening', heard: 'what is this' })} controls={c} />
    )
    expect(container.textContent).toContain('“what is this”')
    click(byName(container, 'button', 'End voice chat'))
    expect(c.stop).toHaveBeenCalled()
  })

  it('explains a problem as an alert that can be dismissed', () => {
    const c = controls()
    const { container } = render(
      <VoiceStatus voice={voice({ problem: 'no_microphone' })} controls={c} />
    )
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      VOICE_PROBLEM_TEXT.no_microphone
    )
    click(byName(container, 'button', 'Dismiss'))
    expect(c.stop).toHaveBeenCalled()
  })
})

describe('Transcript read aloud', () => {
  it('offers Read aloud on finished messages', () => {
    const onSpeak = vi.fn()
    const { container } = render(
      <Transcript
        messages={[
          { id: 'u1', role: 'user', text: 'Hi', status: 'done' },
          { id: 'a1', role: 'assistant', text: 'Hello there.', status: 'done' }
        ]}
        onSpeak={onSpeak}
      />
    )
    const buttons = [...container.querySelectorAll('button')].filter(
      (b) => b.getAttribute('aria-label') === 'Read aloud'
    )
    click(buttons.at(-1) ?? null)
    expect(onSpeak).toHaveBeenCalledWith('a1')
  })
})
