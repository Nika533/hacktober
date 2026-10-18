import { randomBytes } from 'node:crypto'
import type { AddressInfo } from 'node:net'
import type { LensSettings, ProfileSnapshot } from '@hoot/core'
import { createFakeLensBackend, type FakeLensBackend } from '@hoot/core/testing'
import { WebSocketServer, type WebSocket } from 'ws'
import { createBridgeConnection, type BridgeApp, type BridgeConnection } from '../connection'

/** A BridgeApp backed by the deterministic fakes (see packages/core/CONTRACTS.md). */
export function createFakeBridgeApp(
  backend: FakeLensBackend,
  appVersion = '0.0.0-fake'
): BridgeApp {
  const controllers = new Map<string, AbortController>()
  const withSignal = async <T>(reqId: string, run: (s: AbortSignal) => Promise<T>): Promise<T> => {
    const controller = new AbortController()
    controllers.set(reqId, controller)
    try {
      return await run(controller.signal)
    } finally {
      controllers.delete(reqId)
    }
  }
  return {
    appVersion,
    assess: (reqId, ctx) => withSignal(reqId, (signal) => backend.assess(ctx, { signal })),
    rewrite: (reqId, req) => withSignal(reqId, (signal) => backend.rewrite(req, { signal })),
    cancel: (reqId) => controllers.get(reqId)?.abort(),
    feedback: (event) => backend.feedback(event),
    explain: (ctx) => backend.explainMore(ctx),
    snapshot: () => backend.getProfile(),
    getLensSettings: () => backend.getSettings(),
    patchLensSettings: (patch) => backend.patchSettings(patch)
  }
}

export interface FakeLensServerOptions {
  /** Default 0: any free port on 127.0.0.1 */
  port?: number
  /** Required in the `?code=` query; default: random. Pass '' to disable. */
  pairingCode?: string
  /** Simulated model latency per call */
  delayMs?: number
  settings?: LensSettings
  profile?: ProfileSnapshot
}

export interface FakeLensServer {
  /** e.g. ws://127.0.0.1:52011/?code=… (what the extension's dev transport connects to) */
  url: string
  port: number
  pairingCode: string
  /** Assert on feedback events, explained contexts, or push settings/profile */
  backend: FakeLensBackend
  connections(): number
  close(): Promise<void>
}

/**
 * The bridge protocol over a local WebSocket, answered by the fakes. For the
 * extension's e2e tests (D2-22) and for running the extension without the
 * desktop app. One JSON message per WebSocket text frame (no length
 * prefix: WebSocket frames already delimit messages).
 */
export async function createFakeLensServer(
  opts: FakeLensServerOptions = {}
): Promise<FakeLensServer> {
  const pairingCode = opts.pairingCode ?? randomBytes(16).toString('hex')
  const backend = createFakeLensBackend({
    delayMs: opts.delayMs,
    settings: opts.settings,
    profile: opts.profile
  })
  const app = createFakeBridgeApp(backend)
  const live = new Map<WebSocket, BridgeConnection>()

  const wss = new WebSocketServer({ host: '127.0.0.1', port: opts.port ?? 0 })
  await new Promise<void>((resolve, reject) => {
    wss.once('listening', resolve)
    wss.once('error', reject)
  })

  wss.on('connection', (socket, request) => {
    const code = new URL(request.url ?? '/', 'ws://127.0.0.1').searchParams.get('code') ?? ''
    if (pairingCode && code !== pairingCode) {
      socket.close(4401, 'bad pairing code')
      return
    }
    const conn = createBridgeConnection({
      app,
      send: (message) => socket.send(JSON.stringify(message))
    })
    live.set(socket, conn)
    socket.on('message', (data, isBinary) => {
      if (isBinary) return
      let parsed: unknown
      try {
        parsed = JSON.parse(String(data))
      } catch {
        socket.send(
          JSON.stringify({ type: 'error', reqId: null, code: 'bad_request', message: 'not JSON' })
        )
        return
      }
      conn.handle(parsed)
    })
    socket.on('close', () => {
      conn.close()
      live.delete(socket)
    })
  })

  // Settings changed by any client (or the test) reach every client.
  backend.onSettings((lens) => {
    for (const conn of live.values()) conn.pushSettings(lens)
  })
  backend.onProfile((profile) => {
    for (const conn of live.values()) conn.pushProfile(profile)
  })

  const port = (wss.address() as AddressInfo).port
  return {
    url: `ws://127.0.0.1:${port}/${pairingCode ? `?code=${pairingCode}` : ''}`,
    port,
    pairingCode,
    backend,
    connections: () => live.size,
    close: () =>
      new Promise<void>((resolve) => {
        for (const socket of live.keys()) socket.terminate()
        wss.close(() => resolve())
      })
  }
}
