import { describe, expect, it, vi } from 'vitest'
import type { Helper, Reply } from '../../src/main/textAccess/helper'
import type { SpeechEvent } from '../../src/main/voice'
import { createWindowsSpeechEngine } from '../../src/main/voice'
import { VOICE_SCRIPT, VOICE_TYPES } from '../../src/main/voice/script'
import { toSpeechEvent } from '../../src/main/voice/windows'

const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type -- test fixture bag
function fakeHelper(replies: Record<string, Reply | null> = {}) {
  const listeners = new Set<(msg: Reply) => void>()
  const calls: Array<{ cmd: string; args?: Record<string, unknown> }> = []
  let running = true
  const helper: Helper = {
    call: vi.fn(async (cmd: string, args?: Record<string, unknown>) => {
      calls.push({ cmd, args })
      return cmd in replies ? replies[cmd]! : { ok: true }
    }),
    listen: (l) => {
      listeners.add(l)
      return () => void listeners.delete(l)
    },
    running: () => running,
    start: vi.fn(),
    dispose: vi.fn(() => {
      running = false
    })
  }
  const line = (msg: Reply): void => {
    for (const l of [...listeners]) l(msg)
  }
  return { helper, calls, line, stop: () => (running = false) }
}

describe('windows speech engine', () => {
  it('maps the helper’s lines to engine events (levels 0–100 → 0–1)', () => {
    expect(toSpeechEvent({ event: 'partial', text: 'hi', peak: 40 })).toEqual({
      type: 'partial',
      text: 'hi',
      peak: 0.4
    })
    expect(toSpeechEvent({ event: 'final', text: 'hi', confidence: 0.8, peak: 50 })).toEqual({
      type: 'final',
      text: 'hi',
      confidence: 0.8,
      peak: 0.5
    })
    expect(toSpeechEvent({ event: 'level', value: 250 })).toEqual({ type: 'level', value: 1 })
    expect(toSpeechEvent({ event: 'stopped', error: 'gone' })).toEqual({
      type: 'stopped',
      error: 'gone'
    })
    expect(toSpeechEvent({ event: 'click' })).toBeNull()
  })

  it('reports why listening can’t start', async () => {
    const mic = fakeHelper({ listen: { ok: true, problem: 'no_microphone' } })
    expect(await createWindowsSpeechEngine({ log, helper: mic.helper }).listen()).toBe(
      'no_microphone'
    )
    const odd = fakeHelper({ listen: { ok: true, problem: 'Something broke' } })
    expect(await createWindowsSpeechEngine({ log, helper: odd.helper }).listen()).toBe('failed')
    const gone = fakeHelper({ listen: null })
    gone.stop()
    expect(await createWindowsSpeechEngine({ log, helper: gone.helper }).listen()).toBe(
      'unavailable'
    )
    const ok = fakeHelper({ listen: { ok: true, problem: '' } })
    expect(await createWindowsSpeechEngine({ log, helper: ok.helper }).listen()).toBeNull()
  })

  it('resolves a speak when its utterance is spoken, false when cut off', async () => {
    const h = fakeHelper()
    const engine = createWindowsSpeechEngine({ log, helper: h.helper })
    const first = engine.speak('One.', 1)
    const second = engine.speak('Two.', 1)
    await Promise.resolve()
    const ids = h.calls.filter((c) => c.cmd === 'speak').map((c) => c.args?.['utterance'])
    expect(ids).toHaveLength(2)
    h.line({ event: 'spoken', utterance: ids[0] })
    h.line({ event: 'spoken', utterance: ids[1], cancelled: true })
    expect(await first).toBe(true)
    expect(await second).toBe(false)
  })

  it('passes events on, and says listening stopped when the helper restarts', async () => {
    const h = fakeHelper({ listen: { ok: true, problem: '' } })
    const engine = createWindowsSpeechEngine({ log, helper: h.helper })
    const events: SpeechEvent[] = []
    engine.on((e) => events.push(e))
    await engine.listen()
    h.line({ event: 'partial', text: 'hel', peak: 30 })
    const pending = engine.speak('Hi.', 0)
    h.line({ ready: true })
    expect(events).toEqual([
      { type: 'partial', text: 'hel', peak: 0.3 },
      { type: 'stopped', error: 'the speech helper restarted' }
    ])
    expect(await pending).toBe(false)
  })
})

describe('voice helper script', () => {
  it('follows the helper script rules (C# 5, no template-literal hazards)', () => {
    for (const source of [VOICE_SCRIPT, VOICE_TYPES]) {
      expect(source).not.toMatch(/\$\{|`/)
    }
    expect(VOICE_TYPES).not.toMatch(/\?\.|\$"/)
    expect(VOICE_SCRIPT).toContain('[HV]::Line(\'{"ready":true}\')')
    for (const cmd of ['listen', 'stop', 'speak', 'hush', 'ping']) {
      expect(VOICE_SCRIPT).toContain(`'${cmd}'{`)
    }
  })
})
