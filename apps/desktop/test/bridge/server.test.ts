import { randomBytes } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import net from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough, type Duplex } from 'node:stream'
import {
  BRIDGE_PROTOCOL_VERSION,
  DEFAULT_LENS_SETTINGS,
  DEV_EXTENSION_ID,
  FrameDecoder,
  bridgePipePath,
  bridgeTokenPath,
  encodeFrame,
  extensionOrigin,
  DEFAULT_SETTINGS,
  type AppToExt,
  type LensSettings,
  type Platform
} from '@hoot/core'
import { applySettingsPatch } from '@hoot/core/schemas'
import { runHost } from '@hoot/bridge'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AnotherInstanceError, createBridgeServer, type BridgeServer } from '../../src/main/bridge'
import { createLensService, createMemoryLensStorage, type LensService } from '../../src/main/lens'

const platform = process.platform as Platform
const ORIGIN = extensionOrigin(DEV_EXTENSION_ID)
const hello = {
  type: 'hello',
  reqId: 'h1',
  protocol: BRIDGE_PROTOCOL_VERSION,
  extVersion: '0.1.0',
  browser: 'chrome'
}
const ctx = {
  span: 'API',
  paragraph: 'An API lets programs talk.',
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
}

let dir: string
let lensSettings: LensSettings
let lens: LensService
let server: BridgeServer
let pipePath: string
let statuses: string[]

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'hb-'))
  lensSettings = { ...DEFAULT_LENS_SETTINGS, enabled: true }
  lens = await createLensService({
    storage: createMemoryLensStorage(),
    getLensSettings: () => lensSettings,
    getProvider: async () => null,
    fake: true
  })
  pipePath = bridgePipePath(platform, `t${randomBytes(3).toString('hex')}`, tmpdir())
  statuses = []
  server = createBridgeServer({
    lens,
    appVersion: '1.2.3',
    platform,
    env: { HOOT_BRIDGE_DIR: dir },
    pipePath,
    getLensSettings: () => lensSettings,
    patchLensSettings: async (patch) => {
      lensSettings = applySettingsPatch(
        { ...DEFAULT_SETTINGS, lens: lensSettings },
        { lens: patch }
      ).lens
      return lensSettings
    },
    onStatus: (s) => statuses.push(`${s.bridge}:${s.clients}`)
  })
  await server.start()
})

afterEach(async () => {
  await server.stop()
  rmSync(dir, { recursive: true, force: true })
})

const token = (): string =>
  readFileSync(bridgeTokenPath(platform, { HOOT_BRIDGE_DIR: dir }), 'utf8')

/** A raw pipe client that speaks frames. */
async function client(): Promise<{
  send(m: object): void
  next(type?: AppToExt['type']): Promise<AppToExt>
  closed: Promise<void>
}> {
  const socket = net.connect(pipePath)
  await new Promise<void>((r) => socket.once('connect', () => r()))
  const dec = new FrameDecoder()
  const queue: AppToExt[] = []
  const waiters: (() => void)[] = []
  socket.on('data', (d) => {
    queue.push(...(dec.push(d) as AppToExt[]))
    waiters.splice(0).forEach((w) => w())
  })
  const closed = new Promise<void>((r) => socket.once('close', () => r()))
  return {
    send: (m) => socket.write(encodeFrame(m)),
    closed,
    async next(type) {
      for (;;) {
        const i = queue.findIndex((m) => !type || m.type === type)
        if (i >= 0) return queue.splice(i, 1)[0] as AppToExt
        await new Promise<void>((r) => waiters.push(r))
      }
    }
  }
}

describe('bridge server', () => {
  it('writes a fresh token on start and removes it on stop', async () => {
    expect(token()).toMatch(/^[0-9a-f]{64}$/)
    await server.stop()
    expect(existsSync(bridgeTokenPath(platform, { HOOT_BRIDGE_DIR: dir }))).toBe(false)
    expect(statuses.at(-1)).toBe('stopped:0')
    await server.start()
  })

  it('serves the protocol after bridge.auth', async () => {
    const c = await client()
    c.send({ type: 'bridge.auth', token: token(), origin: ORIGIN })
    c.send(hello)
    expect(await c.next()).toMatchObject({ type: 'welcome', appVersion: '1.2.3' })
    expect(server.clients).toBe(1)
    expect(statuses).toContain('connected:1')

    c.send({ type: 'rewrite', reqId: 'r1', ctx, allowedTransforms: ['expand'], risk: 'normal' })
    expect(await c.next('rewritten')).toMatchObject({
      result: { text: 'API (Fake Expanded Form)' }
    })
  })

  it.each([
    ['a wrong token', { type: 'bridge.auth', token: 'f'.repeat(64), origin: ORIGIN }],
    ['an unknown extension', { type: 'bridge.auth', token: '', origin: 'chrome-extension://x/' }],
    ['no auth frame', hello]
  ])('refuses %s', async (_label, first) => {
    const c = await client()
    const frame =
      first.type === 'bridge.auth' && !('token' in first && first.token)
        ? { ...first, token: token() }
        : first
    c.send(frame)
    expect(await c.next()).toMatchObject({ type: 'error', code: 'unauthorized' })
    await c.closed
    expect(server.clients).toBe(0)
  })

  it('pushes profile changes and extension settings patches to every client', async () => {
    const a = await client()
    const b = await client()
    for (const c of [a, b]) {
      c.send({ type: 'bridge.auth', token: token(), origin: ORIGIN })
      c.send(hello)
      await c.next('welcome')
    }
    await lens.patchProfile({ terms: { kubernetes: 'known' } })
    expect(await a.next('profile.changed')).toMatchObject({
      profile: { knownTerms: ['kubernetes'] }
    })
    expect(await b.next('profile.changed')).toMatchObject({
      profile: { knownTerms: ['kubernetes'] }
    })

    a.send({ type: 'settings.patch', reqId: 's1', patch: { sites: { 'example.com': 'paused' } } })
    expect(await a.next('settings')).toMatchObject({ lens: { sites: { 'example.com': 'paused' } } })
    expect(await b.next('settings.changed')).toMatchObject({
      lens: { sites: { 'example.com': 'paused' } }
    })
    expect(lensSettings.sites['example.com']).toBe('paused')
  })

  it('refuses to start twice on the same pipe', async () => {
    const second = createBridgeServer({
      lens,
      appVersion: 'x',
      platform,
      env: { HOOT_BRIDGE_DIR: dir },
      pipePath,
      getLensSettings: () => lensSettings,
      patchLensSettings: async () => lensSettings
    })
    await expect(second.start()).rejects.toBeInstanceOf(AnotherInstanceError)
  })

  it.skipIf(platform === 'win32')('recovers from a stale unix socket left by a crash', async () => {
    await server.stop()
    writeFileSync(pipePath, '')
    await server.start()
    const c = await client()
    c.send({ type: 'bridge.auth', token: token(), origin: ORIGIN })
    c.send(hello)
    expect((await c.next()).type).toBe('welcome')
  })

  it('works end to end through the real hoot-bridge relay', async () => {
    const stdin = new PassThrough()
    const stdout = new PassThrough()
    const dec = new FrameDecoder()
    const out: AppToExt[] = []
    stdout.on('data', (d) => out.push(...(dec.push(d) as AppToExt[])))
    const done = runHost({
      argv: [ORIGIN],
      stdin,
      stdout,
      log: () => {},
      readToken: async () => token(),
      connect: () =>
        new Promise<Duplex>((resolve, reject) => {
          const s = net.connect(pipePath)
          s.once('connect', () => resolve(s))
          s.once('error', reject)
        })
    })
    stdin.write(encodeFrame(hello))
    stdin.write(encodeFrame({ type: 'assess', reqId: 'a1', ctx }))
    for (let i = 0; i < 50 && out.length < 2; i++) await new Promise((r) => setTimeout(r, 20))
    expect(out.map((m) => m.type).sort()).toEqual(['assessed', 'welcome'])
    stdin.end()
    expect(await done).toBe(0)
  })
})
