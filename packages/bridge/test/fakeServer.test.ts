import { BRIDGE_PROTOCOL_VERSION, type AppToExt } from '@hoot/core'
import { afterEach, describe, expect, it } from 'vitest'
import { createFakeLensServer, type FakeLensServer } from '../src/testing/fakeServer'

let server: FakeLensServer | null = null
afterEach(async () => {
  await server?.close()
  server = null
})

/** A minimal client using Node's built-in WebSocket. */
async function connect(url: string): Promise<{
  ws: WebSocket
  next(type?: AppToExt['type']): Promise<AppToExt>
  send(m: object): void
}> {
  const ws = new WebSocket(url)
  const queue: AppToExt[] = []
  const waiters: (() => void)[] = []
  ws.addEventListener('message', (e) => {
    queue.push(JSON.parse(String(e.data)) as AppToExt)
    waiters.splice(0).forEach((w) => w())
  })
  await new Promise<void>((resolve, reject) => {
    ws.addEventListener('open', () => resolve())
    ws.addEventListener('error', () => reject(new Error('connect failed')))
  })
  return {
    ws,
    send: (m) => ws.send(JSON.stringify(m)),
    async next(type) {
      for (;;) {
        const i = queue.findIndex((m) => !type || m.type === type)
        if (i >= 0) return queue.splice(i, 1)[0] as AppToExt
        await new Promise<void>((r) => waiters.push(r))
      }
    }
  }
}

const hello = {
  type: 'hello',
  reqId: 'h1',
  protocol: BRIDGE_PROTOCOL_VERSION,
  extVersion: '0.1.0',
  browser: 'chrome'
}

describe('createFakeLensServer', () => {
  it('speaks the bridge protocol over WebSocket', async () => {
    server = await createFakeLensServer()
    expect(server.url).toMatch(/^ws:\/\/127\.0\.0\.1:\d+\/\?code=[0-9a-f]{32}$/)
    const client = await connect(server.url)
    client.send(hello)
    expect(await client.next()).toMatchObject({
      type: 'welcome',
      protocol: BRIDGE_PROTOCOL_VERSION
    })

    client.send({
      type: 'rewrite',
      reqId: 'r1',
      ctx: {
        span: 'NASA',
        paragraph: 'NASA launched it.',
        headingPath: [],
        title: 't',
        lang: 'en',
        site: 'example.com',
        siteCategory: 'general',
        surface: 'html',
        signals: {
          sizeClass: 'term',
          copiedWithinMs: null,
          dwellMs: 1300,
          reselectCount: 0,
          reread: 0,
          rarity: 0.7,
          knownTerm: false,
          topicFamiliarity: null,
          foreignLanguage: false,
          blocked: null
        },
        p: 0.8
      },
      allowedTransforms: ['expand'],
      risk: 'normal'
    })
    expect(await client.next('rewritten')).toMatchObject({
      reqId: 'r1',
      result: { text: 'NASA (Fake Expanded Form)' }
    })
    client.ws.close()
  })

  it('refuses a wrong pairing code', async () => {
    server = await createFakeLensServer({ pairingCode: 'secret' })
    const ws = new WebSocket(server.url.replace('secret', 'wrong'))
    const code = await new Promise<number>((resolve) =>
      ws.addEventListener('close', (e) => resolve(e.code))
    )
    expect(code).toBe(4401)
  })

  it('pushes settings changes from one client to every client', async () => {
    server = await createFakeLensServer({ pairingCode: '' })
    const a = await connect(server.url)
    const b = await connect(server.url)
    a.send(hello)
    b.send({ ...hello, reqId: 'h2' })
    await a.next('welcome')
    await b.next('welcome')
    expect(server.connections()).toBe(2)

    a.send({ type: 'settings.patch', reqId: 's1', patch: { sites: { 'example.com': 'paused' } } })
    expect(await a.next('settings')).toMatchObject({ lens: { sites: { 'example.com': 'paused' } } })
    expect(await b.next('settings.changed')).toMatchObject({
      lens: { sites: { 'example.com': 'paused' } }
    })
    a.ws.close()
    b.ws.close()
  })
})
