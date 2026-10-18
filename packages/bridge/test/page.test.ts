import { BRIDGE_PROTOCOL_VERSION, type AppToExt, type PageSnapshot } from '@hoot/core'
import { AppToExtSchema } from '@hoot/core/schemas'
import { createFakeLensBackend } from '@hoot/core/testing'
import { describe, expect, it, vi } from 'vitest'
import {
  createBridgeConnection,
  type BridgeConnection,
  type BridgePageHooks
} from '../src/connection'
import { createFakeBridgeApp } from '../src/testing/fakeServer'

const hello = {
  type: 'hello',
  reqId: 'h1',
  protocol: BRIDGE_PROTOCOL_VERSION,
  extVersion: '0.1.0',
  browser: 'edge'
}
const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0))

const snapshot: PageSnapshot = {
  tab: 4,
  url: 'https://example.com/',
  title: 'Example',
  site: 'example.com',
  lang: 'en',
  selection: '',
  visible: 'Hello',
  text: 'Hello world',
  headings: [],
  blocked: null
}

function setup(page?: BridgePageHooks): { conn: BridgeConnection; sent: AppToExt[] } {
  const sent: AppToExt[] = []
  const conn = createBridgeConnection({
    app: createFakeBridgeApp(createFakeLensBackend()),
    send: (m) => sent.push(m),
    page
  })
  conn.handle(hello)
  return { conn, sent }
}

describe('the page link on a bridge connection', () => {
  it('remembers the browser from hello', () => {
    expect(setup().conn.browser).toBe('edge')
  })

  it('passes focus and popup questions to the page hooks, acking each', async () => {
    const page = { focus: vi.fn(), ask: vi.fn(async () => undefined) }
    const { conn, sent } = setup(page)
    const info = { tab: 4, url: 'https://example.com/', title: 'Example' }
    conn.handle({ type: 'page.focus', reqId: 'f1', focused: true, page: info })
    conn.handle({ type: 'page.ask', reqId: 'q1', text: 'What is it?', voice: true, snapshot })
    await flush()
    expect(page.focus).toHaveBeenCalledWith(true, info)
    expect(page.ask).toHaveBeenCalledWith('What is it?', true, snapshot)
    expect(sent.filter((m) => m.type === 'ack').map((m) => (m as { reqId: string }).reqId)).toEqual(
      ['f1', 'q1']
    )
  })

  it('refuses page messages when the app has no page link', async () => {
    const { conn, sent } = setup()
    conn.handle({ type: 'page.focus', reqId: 'f1', focused: true, page: null })
    await flush()
    expect(sent.find((m) => 'reqId' in m && m.reqId === 'f1')).toMatchObject({
      type: 'error',
      code: 'bad_request'
    })
  })

  it('asks for the page and resolves with the extension’s snapshot', async () => {
    const { conn, sent } = setup()
    await flush()
    const reading = conn.readPage(1000)
    const ask = sent.at(-1)
    expect(ask).toMatchObject({ type: 'page.read' })
    expect(AppToExtSchema.safeParse(ask).success).toBe(true)
    conn.handle({ type: 'page.snapshot', reqId: (ask as { reqId: string }).reqId, snapshot })
    expect(await reading).toEqual(snapshot)
  })

  it('gives up on a page read after the timeout, or when the connection closes', async () => {
    vi.useFakeTimers()
    try {
      const { conn } = setup()
      const slow = conn.readPage(500)
      await vi.advanceTimersByTimeAsync(500)
      expect(await slow).toBeNull()
      const closing = conn.readPage(500)
      conn.close()
      expect(await closing).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it('pushes highlights', () => {
    const { conn, sent } = setup()
    conn.pushMarks(4, [{ quote: 'Hello world', label: '' }])
    expect(sent.at(-1)).toEqual({
      type: 'page.marks',
      tab: 4,
      marks: [{ quote: 'Hello world', label: '' }]
    })
  })
})
