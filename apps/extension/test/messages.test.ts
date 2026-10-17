import { describe, expect, it } from 'vitest'
import { parseContentMessage, parsePush, parseSettings } from '../src/messages'

const context = {
  span: 'heteroscedasticity',
  paragraph: 'The model shows heteroscedasticity.',
  headingPath: ['Residuals'],
  title: 'Article',
  lang: 'en'
}

describe('parseContentMessage', () => {
  it('accepts well-formed messages', () => {
    expect(
      parseContentMessage({
        type: 'lens.rewrite',
        reqId: 'abc-1',
        request: { ...context, risk: 'normal' }
      })
    ).toMatchObject({ type: 'lens.rewrite', reqId: 'abc-1' })
    expect(
      parseContentMessage({ type: 'lens.site.pause', site: 'example.com', paused: true })
    ).toEqual({ type: 'lens.site.pause', site: 'example.com', paused: true })
    expect(parseContentMessage({ type: 'lens.settings.get', extra: 1 })).toEqual({
      type: 'lens.settings.get'
    })
  })

  it.each([
    ['unknown type', { type: 'lens.nope' }],
    ['missing reqId', { type: 'lens.rewrite', request: { ...context, risk: 'normal' } }],
    ['bad reqId', { type: 'lens.cancel', reqId: '../etc' }],
    [
      'span too long',
      { type: 'lens.assess', reqId: 'a', context: { ...context, span: 'x'.repeat(601) } }
    ],
    ['empty span', { type: 'lens.assess', reqId: 'a', context: { ...context, span: '' } }],
    ['bad risk', { type: 'lens.rewrite', reqId: 'a', request: { ...context, risk: 'medium' } }],
    [
      'bad transform',
      {
        type: 'lens.rewrite',
        reqId: 'a',
        request: { ...context, risk: 'high', allowedTransforms: ['rm'] }
      }
    ],
    [
      'headings not strings',
      { type: 'lens.assess', reqId: 'a', context: { ...context, headingPath: [1] } }
    ],
    ['site with path', { type: 'lens.site.get', site: 'example.com/x' }],
    ['paused not boolean', { type: 'lens.site.pause', site: 'example.com', paused: 'yes' }],
    ['feedback kind', { type: 'lens.feedback', event: { eventId: 'e', kind: 'liked' } }],
    ['array', []],
    ['null', null]
  ])('rejects %s', (_name, raw) => {
    expect(parseContentMessage(raw)).toBeNull()
  })

  it('validates feedback events', () => {
    const event = {
      eventId: 'e-1',
      kind: 'knew_it',
      transform: 'define',
      mode: 'ask',
      term: null,
      lang: 'en',
      spanWords: 1,
      latencyMs: 420
    }
    expect(parseContentMessage({ type: 'lens.feedback', event })).not.toBeNull()
    expect(
      parseContentMessage({ type: 'lens.feedback', event: { ...event, latencyMs: -1 } })
    ).toBeNull()
  })
})

describe('settings and pushes', () => {
  const settings = { enabled: true, mode: 'ask', copy: 'original', highStakes: 'gloss' }

  it('parses settings and settings pushes', () => {
    expect(parseSettings(settings)).toEqual(settings)
    expect(parseSettings({ ...settings, mode: 'loud' })).toBeNull()
    expect(parsePush({ type: 'lens.settings.changed', settings })).toEqual({
      type: 'lens.settings.changed',
      settings
    })
    expect(parsePush({ type: 'lens.settings.changed', settings: {} })).toBeNull()
  })
})
