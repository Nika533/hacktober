import { randomBytes } from 'node:crypto'
import net from 'node:net'
import { tmpdir } from 'node:os'
import { createBridgeConnection } from '@hoot/bridge'
import { createFakeBridgeApp } from '@hoot/bridge/testing'
import {
  DEFAULT_LENS_SETTINGS,
  FrameDecoder,
  LensBackendError,
  VSCODE_EXTENSION_ORIGIN,
  bridgePipePath,
  encodeFrame,
  type LensContext,
  type Platform
} from '@hoot/core'
import { createFakeLensBackend, type FakeLensBackend } from '@hoot/core/testing'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createHootClient, type HootClient } from '../src/client'

const ctx: LensContext = {
  span: 'API',
  paragraph: 'An API lets programs talk.',
  headingPath: ['notes.md'],
  title: 'notes.md',
  lang: 'en',
  site: '',
  siteCategory: 'general',
  surface: 'editor',
  signals: {
    sizeClass: 'term',
    copiedWithinMs: null,
    dwellMs: 0,
    reselectCount: 0,
    reread: 0,
    rarity: 0.8,
    knownTerm: false,
    topicFamiliarity: null,
    foreignLanguage: false,
    blocked: null
  },
  p: 1
}
const rewrite = { ctx, allowedTransforms: ['expand' as const], risk: 'normal' as const }

/** The app's pipe server in miniature: bridge.auth first, then the real protocol logic. */
interface FakeApp {
  token: string
  backend: FakeLensBackend
  /** The first frame of every connection. */
  auths: unknown[]
  sockets: Set<net.Socket>
  close(): Promise<void>
}

const cleanups: Array<() => Promise<void> | void> = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

const newPipe = (): string =>
  bridgePipePath(process.platform as Platform, `vt${randomBytes(4).toString('hex')}`, tmpdir())

async function fakeApp(path: string, opts: { delayMs?: number } = {}): Promise<FakeApp> {
  const backend = createFakeLensBackend({
    delayMs: opts.delayMs,
    settings: { ...DEFAULT_LENS_SETTINGS, enabled: true }
  })
  const app: FakeApp = {
    token: randomBytes(32).toString('hex'),
    backend,
    auths: [],
    sockets: new Set(),
    close: () =>
      new Promise((resolve) => {
        for (const s of app.sockets) s.destroy()
        server.close(() => resolve())
      })
  }
  const server = net.createServer((socket) => {
    app.sockets.add(socket)
    const decoder = new FrameDecoder()
    let conn: ReturnType<typeof createBridgeConnection> | null = null
    const unsubscribe = backend.onSettings((lens) => conn?.pushSettings(lens))
    socket.on('data', (chunk) => {
      for (const frame of decoder.push(chunk)) {
        if (conn) {
          conn.handle(frame)
          continue
        }
        app.auths.push(frame)
        const auth = frame as { type?: string; token?: string; origin?: string }
        if (
          auth.type !== 'bridge.auth' ||
          auth.token !== app.token ||
          auth.origin !== VSCODE_EXTENSION_ORIGIN
        ) {
          socket.end(
            encodeFrame({ type: 'error', reqId: null, code: 'unauthorized', message: 'bad token' })
          )
          return
        }
        conn = createBridgeConnection({
          app: createFakeBridgeApp(backend, '9.9.9'),
          send: (m) => socket.write(encodeFrame(m))
        })
      }
    })
    socket.on('close', () => {
      unsubscribe()
      conn?.close()
      app.sockets.delete(socket)
    })
    socket.on('error', () => {})
  })
  await new Promise<void>((resolve) => server.listen(path, resolve))
  cleanups.push(() => app.close())
  return app
}

function client(path: string, token: () => string | null): HootClient {
  const c = createHootClient({
    pipePath: path,
    readToken: async () => token(),
    extVersion: '0.1.0',
    backoff: { minMs: 20, maxMs: 80 },
    welcomeTimeoutMs: 1000
  })
  cleanups.push(() => c.dispose())
  return c
}

describe('hoot client', () => {
  it('authenticates first, then says hello and keeps the welcome', async () => {
    const path = newPipe()
    const app = await fakeApp(path)
    const c = client(path, () => app.token)
    const changes = vi.fn()
    c.onChange(changes)
    await c.connect()
    expect(app.auths).toEqual([
      { type: 'bridge.auth', token: app.token, origin: VSCODE_EXTENSION_ORIGIN }
    ])
    expect(c.state).toBe('online')
    expect(c.lens?.enabled).toBe(true)
    expect(c.profile?.knownTerms).toEqual(['API'])
    expect(changes).toHaveBeenCalled()
  })

  it('rewrites, explains, sends feedback and follows pushes', async () => {
    const path = newPipe()
    const app = await fakeApp(path)
    const c = client(path, () => app.token)
    const outcome = await c.rewrite(rewrite)
    expect(outcome).toMatchObject({
      kind: 'rewritten',
      result: { transform: 'expand', text: 'API (Fake Expanded Form)' }
    })
    expect(await c.rewrite({ ...rewrite, ctx: { ...ctx, span: 'SKIP this' } })).toEqual({
      kind: 'skipped',
      reason: 'model_skip'
    })
    await expect(c.rewrite({ ...rewrite, ctx: { ...ctx, span: 'ERROR' } })).rejects.toMatchObject({
      code: 'busy'
    })

    await c.explain(ctx)
    expect(app.backend.explained).toEqual([ctx])

    if (outcome.kind !== 'rewritten') throw new Error('expected a rewrite')
    await c.feedback({
      id: 'e1',
      ts: 1,
      site: '',
      urlHash: 'h',
      kind: 'shown',
      transform: 'expand',
      mode: 'replace',
      term: 'API',
      topic: 'notes.md',
      lang: 'en',
      spanWords: 1,
      p: 1,
      difficulty: null,
      latencyMs: 5,
      cacheKey: outcome.result.cacheKey
    })
    expect(app.backend.events.map((e) => e.kind)).toEqual(['shown'])

    app.backend.emitSettings({ ...DEFAULT_LENS_SETTINGS, enabled: false })
    await vi.waitFor(() => expect(c.lens?.enabled).toBe(false))
  })

  it('cancels a request when its signal aborts', async () => {
    const path = newPipe()
    const app = await fakeApp(path, { delayMs: 5000 })
    const c = client(path, () => app.token)
    await c.connect()
    const controller = new AbortController()
    const pending = c.rewrite(rewrite, controller.signal)
    setTimeout(() => controller.abort(), 20)
    expect(await pending).toEqual({ kind: 'skipped', reason: 'cancelled' })
  })

  it('reports offline while nothing listens and connects once the app starts', async () => {
    const path = newPipe()
    let token: string | null = null
    const c = client(path, () => token)
    await expect(c.connect()).rejects.toMatchObject({ code: 'app_unavailable' })
    expect(c.state).toBe('offline')
    await expect(c.rewrite(rewrite)).rejects.toBeInstanceOf(LensBackendError)

    const app = await fakeApp(path)
    token = app.token
    await vi.waitFor(() => expect(c.state).toBe('online'), { timeout: 2000 })
  })

  it('surfaces a refused auth and re-reads the token on the next attempt', async () => {
    const path = newPipe()
    const app = await fakeApp(path)
    let token = 'f'.repeat(64)
    const c = client(path, () => token)
    await expect(c.connect()).rejects.toMatchObject({ code: 'unauthorized' })
    expect(c.lastError?.code).toBe('unauthorized')
    token = app.token
    await vi.waitFor(() => expect(c.state).toBe('online'), { timeout: 2000 })
  })

  it('fails in-flight requests when the pipe closes, then reconnects', async () => {
    const path = newPipe()
    const app = await fakeApp(path, { delayMs: 5000 })
    const c = client(path, () => app.token)
    await c.connect()
    const pending = c.rewrite(rewrite)
    await vi.waitFor(() => expect(app.sockets.size).toBe(1))
    for (const s of app.sockets) s.destroy()
    await expect(pending).rejects.toMatchObject({ code: 'app_unavailable' })
    expect(['offline', 'connecting']).toContain(c.state)
    await vi.waitFor(() => expect(c.state).toBe('online'), { timeout: 2000 })
    expect(app.auths).toHaveLength(2)
  })
})
