import { randomBytes } from 'node:crypto'
import net from 'node:net'
import { tmpdir } from 'node:os'
import { FrameDecoder, encodeFrame, type Platform } from '@hoot/core'
import {
  CODE_LINK_PROTOCOL_VERSION,
  codeLinkPipePath,
  type CodeActionResult,
  type CodeSnapshot
} from '@hoot/core/code'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createCodeLink, type CodeLink, type CodeLinkHandlers } from '../../src/code/link'

const snapshot: CodeSnapshot = {
  workspace: 'w',
  active: null,
  others: [],
  diagnostics: [],
  excluded: []
}
const ok: CodeActionResult = { ok: true, message: null }

interface FakeApp {
  token: string
  frames: Array<Record<string, unknown>>
  sockets: Set<net.Socket>
  send(message: unknown): void
  next(type: string): Promise<Record<string, unknown>>
  close(): Promise<void>
}

const cleanups: Array<() => Promise<void> | void> = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

const newPipe = (): string =>
  codeLinkPipePath(process.platform as Platform, `ct${randomBytes(4).toString('hex')}`, tmpdir())

/** The app's code pipe in miniature: welcomes a good hello, records everything. */
async function fakeApp(path: string, opts: { refuse?: boolean } = {}): Promise<FakeApp> {
  const frames: Array<Record<string, unknown>> = []
  const waiters: Array<() => void> = []
  const sockets = new Set<net.Socket>()
  const token = randomBytes(32).toString('hex')
  const server = net.createServer((socket) => {
    sockets.add(socket)
    socket.on('close', () => sockets.delete(socket))
    const decoder = new FrameDecoder()
    socket.on('data', (chunk) => {
      for (const frame of decoder.push(chunk) as Array<Record<string, unknown>>) {
        frames.push(frame)
        if (frame['type'] === 'code.hello') {
          socket.write(
            encodeFrame(
              opts.refuse || frame['token'] !== token
                ? { type: 'code.error', reqId: null, code: 'unauthorized', message: 'bad token' }
                : {
                    type: 'code.welcome',
                    protocol: CODE_LINK_PROTOCOL_VERSION,
                    appVersion: '1.0.0'
                  }
            )
          )
        }
      }
      for (const w of waiters.splice(0)) w()
    })
  })
  await new Promise<void>((resolve) => server.listen(path, resolve))
  const app: FakeApp = {
    token,
    frames,
    sockets,
    send: (m) => {
      for (const s of sockets) s.write(encodeFrame(m))
    },
    async next(type) {
      for (;;) {
        const i = frames.findIndex((f) => f['type'] === type)
        if (i >= 0) return frames.splice(i, 1)[0]!
        await new Promise<void>((r) => waiters.push(r))
      }
    },
    close: () =>
      new Promise((resolve) => {
        for (const s of sockets) s.destroy()
        server.close(() => resolve())
      })
  }
  cleanups.push(() => app.close())
  return app
}

function handlers(over: Partial<CodeLinkHandlers> = {}): CodeLinkHandlers {
  return {
    snapshot: vi.fn(async () => snapshot),
    show: vi.fn(async () => ok),
    apply: vi.fn(async () => ({ ok: false, message: 'changed' })),
    reveal: vi.fn(async () => ok),
    clear: vi.fn(async () => {
      throw new Error('boom')
    }),
    ...over
  }
}

function link(
  path: string,
  token: () => string | null,
  h = handlers(),
  focused = { value: true }
): CodeLink {
  const l = createCodeLink({
    pipePath: path,
    readToken: async () => token(),
    extVersion: '0.1.0',
    window: { id: 'win-1', name: 'demo' },
    focus: () => ({ focused: focused.value, file: { path: 'a.ts', languageId: 'typescript' } }),
    handlers: h,
    backoff: { minMs: 20, maxMs: 40 },
    welcomeTimeoutMs: 500
  })
  cleanups.push(() => l.dispose())
  return l
}

describe('code link client', () => {
  it('says hello with the token, window and focus, and goes online on welcome', async () => {
    const path = newPipe()
    const app = await fakeApp(path)
    const l = link(path, () => app.token)
    await l.connect()
    expect(l.state).toBe('online')
    expect(await app.next('code.hello')).toEqual({
      type: 'code.hello',
      protocol: CODE_LINK_PROTOCOL_VERSION,
      token: app.token,
      extVersion: '0.1.0',
      window: { id: 'win-1', name: 'demo' },
      focused: true,
      file: { path: 'a.ts', languageId: 'typescript' }
    })
  })

  it('answers every request once, errors included', async () => {
    const path = newPipe()
    const app = await fakeApp(path)
    const h = handlers()
    await link(path, () => app.token, h).connect()

    app.send({ type: 'code.snapshot.get', reqId: 's1' })
    expect(await app.next('code.snapshot')).toEqual({
      type: 'code.snapshot',
      reqId: 's1',
      snapshot
    })

    const edit = {
      id: 'e1',
      path: 'a.ts',
      uri: 'file:///a.ts',
      range: { start: 1, end: 1 },
      label: 'x',
      replacement: 'b',
      expected: 'a'
    }
    app.send({ type: 'code.apply', reqId: 'a1', edit })
    expect(await app.next('code.done')).toEqual({
      type: 'code.done',
      reqId: 'a1',
      ok: false,
      message: 'changed'
    })
    expect(h.apply).toHaveBeenCalledWith(edit)

    app.send({ type: 'code.clear', reqId: 'c1' })
    expect(await app.next('code.done')).toEqual({
      type: 'code.done',
      reqId: 'c1',
      ok: false,
      message: 'boom'
    })

    app.send({ type: 'code.show', reqId: 'v1', marks: [], edits: [edit], reveal: true })
    expect(await app.next('code.done')).toMatchObject({ reqId: 'v1', ok: true })
    expect(h.show).toHaveBeenCalledWith([], [edit], true)
  })

  it('pushes focus changes (once each) and applied edits', async () => {
    const path = newPipe()
    const app = await fakeApp(path)
    const focused = { value: true }
    const l = link(path, () => app.token, handlers(), focused)
    await l.connect()
    l.focusChanged()
    focused.value = false
    l.focusChanged()
    l.focusChanged()
    l.applied('e7')
    expect(await app.next('code.focus')).toMatchObject({ focused: false })
    expect(await app.next('code.applied')).toEqual({ type: 'code.applied', editId: 'e7' })
    expect(app.frames.filter((f) => f['type'] === 'code.focus')).toHaveLength(0)
  })

  it('stays offline without a token or when refused, and reconnects when Hoot comes back', async () => {
    const path = newPipe()
    let token: string | null = null
    const l = link(path, () => token)
    await expect(l.connect()).rejects.toThrow()
    expect(l.state).toBe('offline')

    const refusing = await fakeApp(path, { refuse: true })
    token = refusing.token
    await expect(l.connect()).rejects.toThrow('bad token')
    await refusing.close()

    const app = await fakeApp(path)
    token = app.token
    await vi.waitFor(() => expect(l.state).toBe('online'), { timeout: 2000 })
    const seen: string[] = []
    l.onChange(() => seen.push(l.state))
    for (const s of app.sockets) s.destroy()
    await vi.waitFor(() => expect(seen).toContain('offline'))
    await vi.waitFor(() => expect(l.state).toBe('online'), { timeout: 2000 })
    expect(app.frames.filter((f) => f['type'] === 'code.hello').length).toBeGreaterThanOrEqual(2)
  })
})
