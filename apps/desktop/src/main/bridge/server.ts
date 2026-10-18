import { randomBytes, timingSafeEqual } from 'node:crypto'
import { promises as fs } from 'node:fs'
import net from 'node:net'
import { dirname } from 'node:path'
import {
  FrameDecoder,
  FrameError,
  allowedBridgeOrigins,
  bridgeTokenPath,
  encodeFrame,
  type AppToExt,
  type BridgeEnv,
  type BridgeStatus,
  type LensSettings,
  type LensSettingsPatch,
  type Platform
} from '@hoot/core'
import { BridgeAuthSchema } from '@hoot/core/schemas'
import { createBridgeConnection, type BridgeApp, type BridgeConnection } from '@hoot/bridge'
import { WebSocketServer } from 'ws'
import type { LensService } from '../lens'
import type { PageService } from '../page'

export interface BridgeServerDeps {
  lens: LensService
  appVersion: string
  platform: Platform
  env: BridgeEnv
  /** From bridgePipePath(); injectable for tests. */
  pipePath: string
  getLensSettings(): LensSettings
  /**
   * Apply a patch from the extension (quick toggles, Pause on this site):
   * persist it and update the settings slice. The server pushes the result
   * to every connected extension itself.
   */
  patchLensSettings(patch: LensSettingsPatch): Promise<LensSettings>
  /** HOOT_DEV_BRIDGE=1: also accept the protocol on a local WebSocket. */
  devWebSocket?: { port: number; pairingCode: string } | null
  /** The page link: every connection is offered to it (VS Code's simply never speaks it). */
  pages?: Pick<PageService, 'connect'>

  /** → the `lens` state slice */
  onStatus?(status: { bridge: BridgeStatus; clients: number; lastError: string | null }): void
  log?(message: string): void
}

export interface BridgeServer {
  /** Write the token and listen. Rejects with AnotherInstanceError on EADDRINUSE. */
  start(): Promise<void>
  /** Close every client and the listeners, and remove the token. */
  stop(): Promise<void>
  /** Lens settings changed in Studio: tell every extension. */
  pushSettings(lens: LensSettings): void
  readonly clients: number
}

export class AnotherInstanceError extends Error {
  constructor(path: string) {
    super(`another Hoot is already listening on ${path}`)
    this.name = 'AnotherInstanceError'
  }
}

const AUTH_TIMEOUT_MS = 5000

function sameToken(a: string, b: string): boolean {
  const x = Buffer.from(a)
  const y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}

async function writeToken(path: string, token: string): Promise<void> {
  await fs.mkdir(dirname(path), { recursive: true, mode: 0o700 })
  const tmp = `${path}.tmp-${process.pid}`
  await fs.writeFile(tmp, token, { mode: 0o600 })
  await fs.rename(tmp, path)
}

/** A leftover unix socket from a crashed run refuses connections; a live one accepts. */
function isLive(path: string): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = net.connect(path)
    probe.once('connect', () => {
      probe.destroy()
      resolve(true)
    })
    probe.once('error', () => resolve(false))
  })
}

/**
 * The app side of the extension bridge (hoot-lens.md §10, C-20). hoot-bridge
 * and the VS Code extension connect on the named pipe and must open with
 * `bridge.auth` (token + an `allowedBridgeOrigins()` origin); after that each
 * connection speaks the protocol through `createBridgeConnection`. Nothing
 * binds until `start()`.
 */
export function createBridgeServer(deps: BridgeServerDeps): BridgeServer {
  const log = deps.log ?? (() => {})
  const tokenPath = bridgeTokenPath(deps.platform, deps.env)
  const conns = new Set<BridgeConnection>()
  const pageLinks = new Map<BridgeConnection, { disconnect(): void }>()
  const sockets = new Set<{ destroy(): void }>()
  let token = ''
  let pipe: net.Server | null = null
  let wss: WebSocketServer | null = null
  let lastError: string | null = null
  let unsubscribeProfile: (() => void) | null = null

  const status = (): void =>
    deps.onStatus?.({
      bridge: !pipe ? 'stopped' : conns.size > 0 ? 'connected' : 'listening',
      clients: conns.size,
      lastError
    })

  const app: BridgeApp = {
    appVersion: deps.appVersion,
    assess: (reqId, ctx) => deps.lens.assess(reqId, ctx),
    rewrite: (reqId, req) => deps.lens.rewrite(reqId, req),
    cancel: (reqId) => deps.lens.cancel(reqId),
    feedback: (event) => deps.lens.feedback(event),
    explain: (ctx) => deps.lens.explain(ctx),
    snapshot: () => deps.lens.snapshot(),
    getLensSettings: () => deps.getLensSettings(),
    async patchLensSettings(patch) {
      const lens = await deps.patchLensSettings(patch)
      for (const c of conns) c.pushSettings(lens)
      return lens
    }
  }

  const attach = (send: (m: AppToExt) => void): BridgeConnection => {
    let link: ReturnType<PageService['connect']> | null = null
    const conn = createBridgeConnection({
      app,
      send,
      onError: (e) => {
        lastError = e instanceof Error ? e.message : String(e)
        log(`bridge: ${lastError}`)
      },
      page: deps.pages && {
        focus: (focused, page) => link?.hooks.focus(focused, page),
        ask: async (text, voice, snapshot) => link?.hooks.ask(text, voice, snapshot)
      }
    })
    link =
      deps.pages?.connect({
        browser: () => conn.browser,
        read: (ms) => conn.readPage(ms),
        mark: (tab, marks) => conn.pushMarks(tab, marks)
      }) ?? null
    if (link) pageLinks.set(conn, link)
    conns.add(conn)
    status()
    return conn
  }

  const detach = (conn: BridgeConnection | null): void => {
    if (!conn) return
    conn.close()
    conns.delete(conn)
    pageLinks.get(conn)?.disconnect()
    pageLinks.delete(conn)
    status()
  }

  /** One hoot-bridge process on the pipe. */
  const onPipeClient = (socket: net.Socket): void => {
    sockets.add(socket)
    const decoder = new FrameDecoder()
    let conn: BridgeConnection | null = null
    const refuse = (message: string): void => {
      log(`bridge: refused pipe client (${message})`)
      socket.end(encodeFrame({ type: 'error', reqId: null, code: 'unauthorized', message }))
      socket.destroy()
    }
    const authTimer = setTimeout(() => refuse('no bridge.auth'), AUTH_TIMEOUT_MS)

    socket.on('data', (chunk) => {
      let frames: unknown[]
      try {
        frames = decoder.push(chunk)
      } catch (e) {
        refuse(e instanceof FrameError ? e.message : 'bad frame')
        return
      }
      for (const frame of frames) {
        if (conn) {
          conn.handle(frame)
          continue
        }
        const auth = BridgeAuthSchema.safeParse(frame)
        const originOk = auth.success && allowedBridgeOrigins().includes(auth.data.origin)
        if (!auth.success || !sameToken(auth.data.token, token) || !originOk) {
          clearTimeout(authTimer)
          refuse(
            !auth.success ? 'expected bridge.auth' : !originOk ? 'unknown extension' : 'bad token'
          )
          return
        }
        clearTimeout(authTimer)
        conn = attach((m) => {
          if (!socket.destroyed) socket.write(encodeFrame(m))
        })
      }
    })
    socket.on('close', () => {
      clearTimeout(authTimer)
      sockets.delete(socket)
      detach(conn)
    })
    socket.on('error', () => socket.destroy())
  }

  const listen = (server: net.Server, path: string): Promise<void> =>
    new Promise((resolve, reject) => {
      server.once('error', reject)
      server.listen(path, () => {
        server.off('error', reject)
        resolve()
      })
    })

  return {
    get clients() {
      return conns.size
    },

    async start() {
      if (pipe) return
      token = randomBytes(32).toString('hex')
      const server = net.createServer(onPipeClient)
      try {
        await listen(server, deps.pipePath)
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'EADDRINUSE') throw e
        if (deps.platform === 'win32' || (await isLive(deps.pipePath))) {
          throw new AnotherInstanceError(deps.pipePath)
        }
        log(`bridge: removing stale socket ${deps.pipePath}`)
        await fs.rm(deps.pipePath, { force: true })
        await listen(server, deps.pipePath)
      }
      if (deps.platform !== 'win32') await fs.chmod(deps.pipePath, 0o600).catch(() => {})
      pipe = server
      await writeToken(tokenPath, token)

      if (deps.devWebSocket) {
        const { port, pairingCode } = deps.devWebSocket
        wss = new WebSocketServer({ host: '127.0.0.1', port })
        wss.on('connection', (ws, req) => {
          const code = new URL(req.url ?? '/', 'ws://127.0.0.1').searchParams.get('code') ?? ''
          if (!pairingCode || !sameToken(code, pairingCode)) {
            ws.close(4401, 'bad pairing code')
            return
          }
          sockets.add({ destroy: () => ws.terminate() })
          const conn = attach((m) => ws.send(JSON.stringify(m)))
          ws.on('message', (data, isBinary) => {
            if (isBinary) return
            try {
              conn.handle(JSON.parse(String(data)))
            } catch {
              ws.send(
                JSON.stringify({
                  type: 'error',
                  reqId: null,
                  code: 'bad_request',
                  message: 'not JSON'
                })
              )
            }
          })
          ws.on('close', () => detach(conn))
        })
        log(`bridge: dev WebSocket on ws://127.0.0.1:${port}/?code=…`)
      }

      unsubscribeProfile = deps.lens.onProfile((snap) => {
        for (const c of conns) c.pushProfile(snap)
      })
      lastError = null
      status()
      log(`bridge: listening on ${deps.pipePath}`)
    },

    async stop() {
      unsubscribeProfile?.()
      unsubscribeProfile = null
      for (const c of conns) c.close()
      conns.clear()
      for (const l of pageLinks.values()) l.disconnect()
      pageLinks.clear()
      for (const s of sockets) s.destroy()
      sockets.clear()
      const closing: Promise<void>[] = []
      if (pipe) closing.push(new Promise((r) => pipe?.close(() => r())))
      if (wss) closing.push(new Promise((r) => wss?.close(() => r())))
      await Promise.all(closing)
      pipe = null
      wss = null
      await fs.rm(tokenPath, { force: true })
      status()
    },

    pushSettings(lens) {
      // Settings that change the profile (the cold start) apply first, so the
      // profile push follows the settings push.
      deps.lens.settingsChanged()
      for (const c of conns) c.pushSettings(lens)
    }
  }
}
