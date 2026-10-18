import {
  BRIDGE_PROTOCOL_VERSION,
  DEFAULT_LENS_SETTINGS,
  LensBackendError,
  type AppToExt,
  type LensContext
} from '@hoot/core'
import { AppToExtSchema } from '@hoot/core/schemas'
import { createFakeLensBackend } from '@hoot/core/testing'
import { describe, expect, it, vi } from 'vitest'
import { createBridgeConnection, type BridgeApp, type BridgeConnection } from '../src/connection'
import { createFakeBridgeApp } from '../src/testing/fakeServer'

const ctx = (span = 'API'): LensContext => ({
  span,
  paragraph: `An ${span} lets programs talk.`,
  headingPath: [],
  title: 'Intro',
  lang: 'en',
  site: 'example.com',
  siteCategory: 'general',
  surface: 'html',
  signals: {
    sizeClass: 'term',
    copiedWithinMs: null,
    dwellMs: 1500,
    reselectCount: 0,
    reread: 0,
    rarity: 0.5,
    knownTerm: false,
    topicFamiliarity: null,
    foreignLanguage: false,
    blocked: null
  },
  p: 0.9
})

const hello = {
  type: 'hello',
  reqId: 'h1',
  protocol: BRIDGE_PROTOCOL_VERSION,
  extVersion: '0.1.0',
  browser: 'chrome'
}
const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0))

function setup(app: BridgeApp = createFakeBridgeApp(createFakeLensBackend())): {
  conn: BridgeConnection
  sent: AppToExt[]
} {
  const sent: AppToExt[] = []
  const conn = createBridgeConnection({ app, send: (m) => sent.push(m) })
  return { conn, sent }
}

describe('createBridgeConnection', () => {
  it('requires hello first and answers it with welcome', async () => {
    const { conn, sent } = setup()
    conn.handle({ type: 'profile.get', reqId: 'p1' })
    conn.handle(hello)
    await flush()
    expect(sent.map((m) => m.type)).toEqual(['error', 'welcome'])
    expect(sent[0]).toMatchObject({ reqId: 'p1', code: 'unauthorized' })
    expect(conn.ready).toBe(true)
    for (const m of sent) expect(AppToExtSchema.safeParse(m).success).toBe(true)
  })

  it('rejects a protocol version mismatch', async () => {
    const { conn, sent } = setup()
    conn.handle({ ...hello, protocol: BRIDGE_PROTOCOL_VERSION + 1 })
    await flush()
    expect(sent).toMatchObject([{ type: 'error', code: 'version_mismatch', reqId: 'h1' }])
    expect(conn.ready).toBe(false)
  })

  it('answers each request type exactly once', async () => {
    const { conn, sent } = setup()
    conn.handle(hello)
    conn.handle({ type: 'assess', reqId: 'a1', ctx: ctx() })
    conn.handle({
      type: 'rewrite',
      reqId: 'r1',
      ctx: ctx(),
      allowedTransforms: ['expand'],
      risk: 'normal'
    })
    conn.handle({
      type: 'rewrite',
      reqId: 'r2',
      ctx: ctx('SKIP'),
      allowedTransforms: ['define'],
      risk: 'normal'
    })
    conn.handle({ type: 'explain', reqId: 'x1', ctx: ctx() })
    conn.handle({ type: 'settings.get', reqId: 's1' })
    conn.handle({ type: 'settings.patch', reqId: 's2', patch: { mode: 'ask' } })
    await new Promise((r) => setTimeout(r, 10))
    const byId = Object.fromEntries(sent.map((m) => ['reqId' in m ? m.reqId : m.type, m]))
    expect(byId['a1']).toMatchObject({ type: 'assessed', result: { reason: 'acronym' } })
    expect(byId['r1']).toMatchObject({ type: 'rewritten', result: { transform: 'expand' } })
    expect(byId['r2']).toMatchObject({ type: 'skipped', reason: 'model_skip' })
    expect(byId['x1']).toMatchObject({ type: 'ack' })
    expect(byId['s2']).toMatchObject({ type: 'settings', lens: { mode: 'ask' } })
    expect(sent).toHaveLength(7)
    for (const m of sent) expect(AppToExtSchema.safeParse(m).success).toBe(true)
  })

  it('cancels a pending request: it answers skipped, cancel gets no reply', async () => {
    const { conn, sent } = setup(createFakeBridgeApp(createFakeLensBackend({ delayMs: 30 })))
    conn.handle(hello)
    conn.handle({
      type: 'rewrite',
      reqId: 'r1',
      ctx: ctx(),
      allowedTransforms: ['define'],
      risk: 'normal'
    })
    conn.handle({ type: 'cancel', reqId: 'r1' })
    conn.handle({ type: 'cancel', reqId: 'never-sent' })
    await new Promise((r) => setTimeout(r, 50))
    expect(sent.filter((m) => m.type !== 'welcome')).toEqual([
      { type: 'skipped', reqId: 'r1', reason: 'cancelled' }
    ])
  })

  it('turns a cancelled assess into skipped as well', async () => {
    const app = createFakeBridgeApp(createFakeLensBackend())
    app.assess = async () => {
      throw new LensBackendError('cancelled')
    }
    const { conn, sent } = setup(app)
    conn.handle(hello)
    conn.handle({ type: 'assess', reqId: 'a1', ctx: ctx() })
    await flush()
    expect(sent.find((m) => 'reqId' in m && m.reqId === 'a1')).toEqual({
      type: 'skipped',
      reqId: 'a1',
      reason: 'cancelled'
    })
  })

  it('reports backend failures with their code, and unknown ones as internal', async () => {
    const app = createFakeBridgeApp(createFakeLensBackend())
    const onError = vi.fn()
    app.explain = async () => {
      throw new Error('boom')
    }
    const sent: AppToExt[] = []
    const conn = createBridgeConnection({ app, send: (m) => sent.push(m), onError })
    conn.handle(hello)
    conn.handle({ type: 'assess', reqId: 'a1', ctx: ctx('ERROR') })
    conn.handle({ type: 'explain', reqId: 'x1', ctx: ctx() })
    await new Promise((r) => setTimeout(r, 5))
    expect(sent.find((m) => 'reqId' in m && m.reqId === 'a1')).toMatchObject({
      type: 'error',
      code: 'busy'
    })
    expect(sent.find((m) => 'reqId' in m && m.reqId === 'x1')).toMatchObject({
      type: 'error',
      code: 'internal'
    })
    expect(onError).toHaveBeenCalledOnce()
  })

  it('rejects malformed frames and duplicate reqIds', async () => {
    const { conn, sent } = setup(createFakeBridgeApp(createFakeLensBackend({ delayMs: 20 })))
    conn.handle(hello)
    conn.handle({ type: 'assess', reqId: 'a1', ctx: { span: '' } })
    conn.handle('nonsense')
    conn.handle({
      type: 'rewrite',
      reqId: 'r1',
      ctx: ctx(),
      allowedTransforms: ['define'],
      risk: 'normal'
    })
    conn.handle({
      type: 'rewrite',
      reqId: 'r1',
      ctx: ctx(),
      allowedTransforms: ['define'],
      risk: 'normal'
    })
    await new Promise((r) => setTimeout(r, 40))
    const errors = sent.filter((m) => m.type === 'error')
    expect(errors).toMatchObject([
      { reqId: 'a1', code: 'bad_request' },
      { reqId: null, code: 'bad_request' },
      { reqId: 'r1', code: 'bad_request', message: 'duplicate reqId' }
    ])
    expect(sent.filter((m) => m.type === 'rewritten')).toHaveLength(1)
  })

  it('pushes settings and profile only after hello, and goes quiet after close', async () => {
    const backend = createFakeLensBackend({ delayMs: 20 })
    const { conn, sent } = setup(createFakeBridgeApp(backend))
    conn.pushSettings(DEFAULT_LENS_SETTINGS)
    expect(sent).toEqual([])
    conn.handle(hello)
    await flush()
    conn.pushProfile(await backend.getProfile())
    expect(sent.at(-1)?.type).toBe('profile.changed')

    conn.handle({
      type: 'rewrite',
      reqId: 'r1',
      ctx: ctx(),
      allowedTransforms: ['define'],
      risk: 'normal'
    })
    const count = sent.length
    conn.close()
    conn.pushSettings(DEFAULT_LENS_SETTINGS)
    await new Promise((r) => setTimeout(r, 40))
    expect(sent).toHaveLength(count)
  })
})
