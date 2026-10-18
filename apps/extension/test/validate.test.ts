import { DEFAULT_LENS_SETTINGS } from '@hoot/core'
import { describe, expect, it } from 'vitest'
import { isPush, isReply } from '../src/messages'
import { parseContentMessage } from '../src/sw/validate'
import { CTX } from './context'

const request = { ctx: CTX, allowedTransforms: ['define'], risk: 'normal' }

describe('parseContentMessage (service worker boundary)', () => {
  it('accepts well-formed messages', () => {
    expect(parseContentMessage({ type: 'lens.rewrite', reqId: 'abc-1', request })).toMatchObject({
      type: 'lens.rewrite',
      reqId: 'abc-1'
    })
    expect(
      parseContentMessage({
        type: 'lens.settings.patch',
        patch: { sites: { 'example.com': null } }
      })
    ).toEqual({ type: 'lens.settings.patch', patch: { sites: { 'example.com': null } } })
    expect(parseContentMessage({ type: 'lens.settings.get' })).toEqual({
      type: 'lens.settings.get'
    })
  })

  it.each([
    ['unknown type', { type: 'lens.nope' }],
    ['missing reqId', { type: 'lens.rewrite', request }],
    ['bad reqId', { type: 'lens.cancel', reqId: '../etc' }],
    ['span too long', { type: 'lens.assess', reqId: 'a', ctx: { ...CTX, span: 'x'.repeat(601) } }],
    ['empty span', { type: 'lens.assess', reqId: 'a', ctx: { ...CTX, span: '' } }],
    ['bad risk', { type: 'lens.rewrite', reqId: 'a', request: { ...request, risk: 'medium' } }],
    [
      'bad transform',
      { type: 'lens.rewrite', reqId: 'a', request: { ...request, allowedTransforms: ['rm'] } }
    ],
    ['site with a path', { type: 'lens.explain', ctx: { ...CTX, site: 'example.com/x' } }],
    ['unknown patch key', { type: 'lens.settings.patch', patch: { evil: true } }],
    ['feedback without fields', { type: 'lens.feedback', event: { id: 'e', kind: 'shown' } }],
    ['array', []],
    ['null', null]
  ])('rejects %s', (_name, raw) => {
    expect(parseContentMessage(raw)).toBeNull()
  })
})

describe('content-side guards', () => {
  it('recognises pushes and replies', () => {
    expect(isPush({ type: 'lens.settings.changed', lens: DEFAULT_LENS_SETTINGS })).toBe(true)
    expect(isPush({ type: 'lens.profile.changed', profile: null })).toBe(false)
    expect(isPush({ type: 'other' })).toBe(false)
    expect(isReply({ ok: true, value: 1 })).toBe(true)
    expect(isReply({ value: 1 })).toBe(false)
  })
})
