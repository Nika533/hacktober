import { randomBytes } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import net from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { FrameDecoder, encodeFrame, type Platform } from '@hoot/core'
import { CODE_LINK_PROTOCOL_VERSION, codeLinkPipePath, type CodeSnapshot } from '@hoot/core/code'
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { createCodeLinkServer, type CodeLinkServer, type CodePeer } from '../../src/main/code'

const platform = process.platform as Platform

const snapshot: CodeSnapshot = {
  workspace: 'demo',
  active: null,
  others: [],
  diagnostics: [],
  excluded: []
}

interface Client {
  socket: net.Socket
  frames: Array<Record<string, unknown>>
  send(message: unknown): void
  next(type: string): Promise<Record<string, unknown>>
  closed: Promise<void>
}

let dir: string
let pipePath: string
let tokenPath: string
let server: CodeLinkServer
let onChange: Mock<() => void>
let onApplied: Mock<(peer: CodePeer, editId: string) => void>
const clients: Client[] = []

function connect(): Promise<Client> {
  return new Promise((resolve, reject) => {
    const socket = net.connect(pipePath)
    const decoder = new FrameDecoder()
    const frames: Array<Record<string, unknown>> = []
    const waiters: Array<() => void> = []
    socket.on('data', (chunk) => {
      frames.push(...(decoder.push(chunk) as Array<Record<string, unknown>>))
      for (const w of waiters.splice(0)) w()
    })
    const closed = new Promise<void>((r) => socket.once('close', () => r()))
    const client: Client = {
      socket,
      frames,
      closed,
      send: (m) => socket.write(encodeFrame(m)),
      async next(type) {
        for (;;) {
          const i = frames.findIndex((f) => f['type'] === type)
          if (i >= 0) return frames.splice(i, 1)[0]!
          await new Promise<void>((r) => waiters.push(r))
        }
      }
    }
    clients.push(client)
    socket.once('connect', () => resolve(client))
    socket.once('error', reject)
  })
}

const token = (): string => readFileSync(tokenPath, 'utf8')

const hello = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  type: 'code.hello',
  protocol: CODE_LINK_PROTOCOL_VERSION,
  token: token(),
  extVersion: '0.1.0',
  window: { id: 'w1', name: 'demo' },
  focused: true,
  file: { path: 'src/a.ts', languageId: 'typescript' },
  ...over
})

async function connected(
  over: Record<string, unknown> = {}
): Promise<{ client: Client; peer: CodePeer }> {
  const client = await connect()
  client.send(hello(over))
  await client.next('code.welcome')
  await vi.waitFor(() => expect(server.peers()).toHaveLength(clients.length))
  return { client, peer: server.peers().at(-1)! }
}

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'hc-'))
  pipePath = codeLinkPipePath(platform, `t${randomBytes(3).toString('hex')}`, tmpdir())
  tokenPath = join(dir, 'code-token')
  onChange = vi.fn<() => void>()
  onApplied = vi.fn<(peer: CodePeer, editId: string) => void>()
  server = createCodeLinkServer({
    pipePath,
    tokenPath,
    platform,
    appVersion: '1.2.3',
    onChange,
    onApplied,
    timeouts: { helloMs: 300, snapshotMs: 200, actionMs: 200 }
  })
  await server.start()
})

afterEach(async () => {
  for (const c of clients.splice(0)) c.socket.destroy()
  await server.stop()
  rmSync(dir, { recursive: true, force: true })
})

describe('code link server', () => {
  it('writes a fresh token and welcomes a window that knows it', async () => {
    expect(token()).toMatch(/^[0-9a-f]{64}$/)
    const client = await connect()
    client.send(hello())
    expect(await client.next('code.welcome')).toEqual({
      type: 'code.welcome',
      protocol: CODE_LINK_PROTOCOL_VERSION,
      appVersion: '1.2.3'
    })
    await vi.waitFor(() => expect(server.peers()).toHaveLength(1))
    const peer = server.peers()[0]!
    expect(peer.window).toEqual({ id: 'w1', name: 'demo' })
    expect(peer.focused).toBe(true)
    expect(peer.file).toEqual({ path: 'src/a.ts', languageId: 'typescript' })
    expect(onChange).toHaveBeenCalled()
  })

  it('refuses a bad token, a wrong protocol, another first frame, or silence', async () => {
    for (const first of [
      hello({ token: 'f'.repeat(64) }),
      hello({ protocol: 99 }),
      { type: 'code.focus', focused: true, file: null }
    ]) {
      const client = await connect()
      client.send(first)
      expect(await client.next('code.error')).toMatchObject({ reqId: null })
      await client.closed
    }
    const silent = await connect()
    expect(await silent.next('code.error')).toMatchObject({ code: 'unauthorized' })
    await silent.closed
    expect(server.peers()).toHaveLength(0)
  })

  it('asks for a snapshot and resolves with the answer, or null on timeout', async () => {
    const { client, peer } = await connected()
    const pending = peer.snapshot()
    const ask = await client.next('code.snapshot.get')
    client.send({ type: 'code.snapshot', reqId: ask['reqId'], snapshot })
    expect(await pending).toEqual(snapshot)

    const late = peer.snapshot()
    await client.next('code.snapshot.get')
    expect(await late).toBeNull()
  })

  it('sends show, apply, reveal and clear, and reports what VS Code says', async () => {
    const { client, peer } = await connected()
    const mark = {
      id: 'm1',
      path: 'src/a.ts',
      uri: null,
      range: { start: 2, end: 2 },
      label: 'here'
    }
    const edit = { ...mark, id: 'e1', uri: 'file:///a.ts', replacement: 'x', expected: 'y' }

    const shown = peer.show([mark], [edit], true)
    const show = await client.next('code.show')
    expect(show).toMatchObject({ marks: [mark], edits: [edit], reveal: true })
    client.send({ type: 'code.done', reqId: show['reqId'], ok: true, message: null })
    expect(await shown).toEqual({ ok: true, message: null })

    const applying = peer.apply(edit)
    const apply = await client.next('code.apply')
    client.send({ type: 'code.done', reqId: apply['reqId'], ok: false, message: 'changed' })
    expect(await applying).toEqual({ ok: false, message: 'changed' })

    const revealing = peer.reveal(mark)
    expect(await client.next('code.reveal')).toMatchObject({ mark })
    expect(await revealing).toMatchObject({ ok: false })

    const clearing = peer.clear()
    const clear = await client.next('code.clear')
    client.send({ type: 'code.done', reqId: clear['reqId'], ok: true, message: null })
    expect(await clearing).toEqual({ ok: true, message: null })
  })

  it('tracks focus and applied edits pushed by the window', async () => {
    const { client, peer } = await connected({ focused: false })
    const before = peer.focusAt
    await new Promise((r) => setTimeout(r, 5))
    client.send({ type: 'code.focus', focused: true, file: { path: 'b.py', languageId: 'python' } })
    await vi.waitFor(() => expect(peer.focused).toBe(true))
    expect(peer.focusAt).toBeGreaterThan(before)
    expect(peer.file).toEqual({ path: 'b.py', languageId: 'python' })
    client.send({ type: 'code.applied', editId: 'e9' })
    await vi.waitFor(() => expect(onApplied).toHaveBeenCalledWith(peer, 'e9'))
  })

  it('forgets a window that goes away and fails what it was asked', async () => {
    const { client, peer } = await connected()
    const pending = peer.snapshot()
    await client.next('code.snapshot.get')
    client.socket.destroy()
    expect(await pending).toBeNull()
    await vi.waitFor(() => expect(server.peers()).toHaveLength(0))
  })

  it('removes the token on stop', async () => {
    await connected()
    await server.stop()
    expect(existsSync(tokenPath)).toBe(false)
    expect(server.peers()).toHaveLength(0)
  })
})
