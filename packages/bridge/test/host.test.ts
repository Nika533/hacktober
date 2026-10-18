import { randomBytes } from 'node:crypto'
import net from 'node:net'
import { tmpdir } from 'node:os'
import { PassThrough, type Duplex } from 'node:stream'
import {
  DEV_EXTENSION_ID,
  FrameDecoder,
  NATIVE_HOST_NAME,
  bridgePipePath,
  encodeFrame,
  extensionOrigin,
  type Platform
} from '@hoot/core'
import { afterEach, describe, expect, it } from 'vitest'
import { callerOrigin, isAllowedOrigin, runHost, type HostIO } from '../src/host/relay'
import { nativeHostManifest, planRegistration } from '../src/register'

const ORIGIN = extensionOrigin(DEV_EXTENSION_ID)
const TOKEN = 'a'.repeat(64)

const servers: net.Server[] = []
afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => new Promise((r) => s.close(r))))
})

/** A fake app listening on a real pipe (named pipe on Windows, unix socket elsewhere). */
async function fakeApp(): Promise<{
  path: string
  received: Promise<unknown[]>
  socket: Promise<net.Socket>
}> {
  const path = bridgePipePath(
    process.platform as Platform,
    `test-${randomBytes(4).toString('hex')}`,
    tmpdir()
  )
  let resolveSocket!: (s: net.Socket) => void
  const socket = new Promise<net.Socket>((r) => (resolveSocket = r))
  const received = socket.then(
    (s) =>
      new Promise<unknown[]>((resolve) => {
        const dec = new FrameDecoder()
        const out: unknown[] = []
        s.on('data', (chunk) => out.push(...dec.push(chunk)))
        s.on('end', () => resolve(out))
        s.on('close', () => resolve(out))
      })
  )
  const server = net.createServer((s) => resolveSocket(s))
  servers.push(server)
  await new Promise<void>((r) => server.listen(path, r))
  return { path, received, socket }
}

function io(overrides: Partial<HostIO> & { connectPath?: string } = {}): {
  io: HostIO
  stdin: PassThrough
  stdout: PassThrough
  output(): unknown[]
  logs: string[]
} {
  const stdin = new PassThrough()
  const stdout = new PassThrough()
  const dec = new FrameDecoder()
  const frames: unknown[] = []
  stdout.on('data', (chunk: Buffer) => frames.push(...dec.push(chunk)))
  const logs: string[] = []
  const connectPath = overrides.connectPath
  return {
    stdin,
    stdout,
    logs,
    output: () => frames,
    io: {
      argv: [ORIGIN, '--parent-window=0'],
      stdin,
      stdout,
      log: (m) => logs.push(m),
      readToken: async () => TOKEN,
      sleep: async () => {},
      connect: () =>
        new Promise<Duplex>((resolve, reject) => {
          if (!connectPath) return reject(new Error('ENOENT'))
          const s = net.connect(connectPath)
          s.once('connect', () => resolve(s))
          s.once('error', reject)
        }),
      ...overrides
    }
  }
}

describe('origin checks', () => {
  it('reads the caller origin from argv and allows only our extension', () => {
    expect(callerOrigin(['--parent-window=1', ORIGIN])).toBe(ORIGIN)
    expect(isAllowedOrigin(ORIGIN)).toBe(true)
    expect(isAllowedOrigin('chrome-extension://abcdefghijklmnopabcdefghijklmnop/')).toBe(false)
    expect(isAllowedOrigin(null)).toBe(false)
  })
})

describe('runHost', () => {
  it('refuses other extensions with an unauthorized frame', async () => {
    const t = io({ argv: ['chrome-extension://evil/'] })
    expect(await runHost(t.io)).toBe(1)
    expect(t.output()).toMatchObject([{ type: 'error', code: 'unauthorized', reqId: null }])
  })

  it('reports app_unavailable when there is no token or nothing listens', async () => {
    const noToken = io({ readToken: async () => null })
    expect(await runHost(noToken.io)).toBe(0)
    expect(noToken.output()).toMatchObject([{ type: 'error', code: 'app_unavailable' }])

    const nobody = io()
    expect(await runHost(nobody.io)).toBe(0)
    expect(nobody.output()).toMatchObject([{ type: 'error', code: 'app_unavailable' }])
  })

  it('starts Hoot once and retries until it listens', async () => {
    const app = await fakeApp()
    let attempts = 0
    let launched = 0
    const t = io({
      connectPath: app.path,
      launchApp: async () => {
        launched++
      }
    })
    const realConnect = t.io.connect
    t.io.connect = () =>
      ++attempts < 3 ? Promise.reject(new Error('ECONNREFUSED')) : realConnect()
    const done = runHost(t.io)
    await app.socket
    t.stdin.end()
    expect(await done).toBe(0)
    expect(launched).toBe(1)
    expect(attempts).toBe(3)
  })

  it('authenticates first, then relays frames both ways unchanged', async () => {
    const app = await fakeApp()
    const t = io({ connectPath: app.path })
    const done = runHost(t.io)

    const appSide = await app.socket
    const hello = {
      type: 'hello',
      reqId: 'h1',
      protocol: 1,
      extVersion: '0.1.0',
      browser: 'chrome'
    }
    // Split one frame across writes to check byte-level relaying.
    const frame = encodeFrame(hello)
    t.stdin.write(frame.subarray(0, 3))
    t.stdin.write(frame.subarray(3))
    appSide.write(encodeFrame({ type: 'welcome', reqId: 'h1' }))

    await new Promise((r) => setTimeout(r, 50))
    expect(t.output()).toEqual([{ type: 'welcome', reqId: 'h1' }])
    t.stdin.end()
    expect(await done).toBe(0)
    expect(await app.received).toEqual([
      { type: 'bridge.auth', token: TOKEN, origin: ORIGIN },
      hello
    ])
  })

  it('exits when the app closes the pipe', async () => {
    const app = await fakeApp()
    const t = io({ connectPath: app.path })
    const done = runHost(t.io)
    ;(await app.socket).destroy()
    expect(await done).toBe(0)
  })
})

describe('registration', () => {
  it('builds the manifest for our extension only', () => {
    expect(nativeHostManifest('/x/launcher.sh')).toEqual({
      name: NATIVE_HOST_NAME,
      description: expect.any(String),
      path: '/x/launcher.sh',
      type: 'stdio',
      allowed_origins: [ORIGIN]
    })
  })

  it('plans HKCU keys plus one manifest on Windows', () => {
    const plan = planRegistration({
      platform: 'win32',
      home: 'C:\\Users\\a',
      localAppData: 'C:\\Users\\a\\AppData\\Local',
      launcherPath: 'C:\\Hoot\\resources\\hoot-bridge.cmd'
    })
    expect(plan.files).toEqual(['C:\\Users\\a\\AppData\\Local\\Hoot\\bridge\\com.hoot.lens.json'])
    expect(plan.registryKeys).toContain(
      'HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\com.hoot.lens'
    )
    expect(plan.registryKeys).toContain(
      'HKCU\\Software\\Microsoft\\Edge\\NativeMessagingHosts\\com.hoot.lens'
    )
  })

  it('plans per-browser manifest files on macOS and Linux', () => {
    const mac = planRegistration({ platform: 'darwin', home: '/Users/a', launcherPath: '/l' })
    expect(mac.files).toContain(
      '/Users/a/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.hoot.lens.json'
    )
    expect(mac.registryKeys).toEqual([])
    const linux = planRegistration({ platform: 'linux', home: '/home/a', launcherPath: '/l' })
    expect(linux.files).toContain(
      '/home/a/.config/microsoft-edge/NativeMessagingHosts/com.hoot.lens.json'
    )
  })
})
