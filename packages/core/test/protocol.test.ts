import { describe, expect, it } from 'vitest'
import { AppToExtSchema, BridgeAuthSchema, ExtToAppSchema } from '../src/protocol/bridge'
import { bridgePipePath, extensionOrigin, DEV_EXTENSION_ID } from '../src/protocol/constants'
import { fakeRewrite, FAKE_PROFILE_SNAPSHOT } from '../src/testing/fakeLens'
import { DEFAULT_LENS_SETTINGS } from '../src/types/settings'
import { sampleContext } from './fixtures'

describe('bridge messages', () => {
  it('accepts every extension request type', () => {
    const ctx = sampleContext()
    const event = {
      id: 'e1',
      ts: 1,
      site: 'example.com',
      urlHash: 'abc',
      kind: 'shown',
      transform: 'define',
      mode: 'replace',
      term: 'x',
      topic: null,
      lang: 'en',
      spanWords: 1,
      p: 0.8,
      difficulty: null,
      latencyMs: 300
    }
    const messages = [
      { type: 'hello', reqId: 'r0', protocol: 1, extVersion: '0.1.0', browser: 'chrome' },
      { type: 'assess', reqId: 'r1', ctx },
      { type: 'rewrite', reqId: 'r2', ctx, allowedTransforms: ['define'], risk: 'normal' },
      { type: 'cancel', reqId: 'r2' },
      { type: 'feedback', reqId: 'r3', event },
      { type: 'explain', reqId: 'r4', ctx },
      { type: 'profile.get', reqId: 'r5' },
      { type: 'settings.get', reqId: 'r6' },
      { type: 'settings.patch', reqId: 'r7', patch: { sites: { 'example.com': 'paused' } } }
    ]
    for (const m of messages) {
      const r = ExtToAppSchema.safeParse(m)
      expect(r.success, `${m.type}: ${r.error?.message}`).toBe(true)
    }
  })

  it('rejects requests without a valid reqId, unknown types and oversized spans', () => {
    const ctx = sampleContext()
    expect(ExtToAppSchema.safeParse({ type: 'assess', ctx }).success).toBe(false)
    expect(ExtToAppSchema.safeParse({ type: 'assess', reqId: '../x', ctx }).success).toBe(false)
    expect(ExtToAppSchema.safeParse({ type: 'shutdown', reqId: 'r1' }).success).toBe(false)
    const long = { ...ctx, span: 'x'.repeat(601) }
    expect(ExtToAppSchema.safeParse({ type: 'assess', reqId: 'r1', ctx: long }).success).toBe(false)
  })

  it('accepts app replies and pushes, including what the fake engine produces', () => {
    const outcome = fakeRewrite({
      ctx: sampleContext(),
      allowedTransforms: ['define'],
      risk: 'normal'
    })
    if (outcome.kind !== 'rewritten') throw new Error('expected a rewrite')
    const messages = [
      {
        type: 'welcome',
        reqId: 'r0',
        protocol: 1,
        appVersion: '1.0.0',
        lens: DEFAULT_LENS_SETTINGS,
        profile: FAKE_PROFILE_SNAPSHOT
      },
      { type: 'rewritten', reqId: 'r2', result: outcome.result },
      { type: 'skipped', reqId: 'r2', reason: 'cancelled' },
      { type: 'error', reqId: null, code: 'unauthorized', message: 'bad token' },
      { type: 'settings.changed', lens: DEFAULT_LENS_SETTINGS },
      { type: 'profile.changed', profile: FAKE_PROFILE_SNAPSHOT }
    ]
    for (const m of messages) {
      const r = AppToExtSchema.safeParse(m)
      expect(r.success, `${m.type}: ${r.error?.message}`).toBe(true)
    }
  })

  it('validates the bridge.auth frame', () => {
    const ok = { type: 'bridge.auth', token: 'a'.repeat(64), origin: extensionOrigin('x') }
    expect(BridgeAuthSchema.safeParse(ok).success).toBe(true)
    expect(BridgeAuthSchema.safeParse({ ...ok, token: 'short' }).success).toBe(false)
  })
})

describe('constants', () => {
  it('derives per-user pipe paths', () => {
    expect(bridgePipePath('win32', 'Ada Lovelace', 'C:\\Temp')).toBe(
      '\\\\.\\pipe\\hoot-lens-Ada_Lovelace'
    )
    expect(bridgePipePath('darwin', 'ada', '/tmp/')).toBe('/tmp/hoot-lens-ada.sock')
    expect(bridgePipePath('linux', '', '/run/user/1')).toBe('/run/user/1/hoot-lens-user.sock')
  })

  it('pins a well-formed dev extension id', () => {
    expect(DEV_EXTENSION_ID).toMatch(/^[a-p]{32}$/)
  })
})
