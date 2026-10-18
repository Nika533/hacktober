import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import net from 'node:net'
import { tmpdir, userInfo } from 'node:os'
import {
  BRIDGE_PROTOCOL_VERSION,
  FrameDecoder,
  LensBackendError,
  VSCODE_EXTENSION_ORIGIN,
  bridgePipePath,
  bridgeTokenPath,
  encodeFrame,
  type AppToExt,
  type ExtToApp,
  type LensContext,
  type LensEvent,
  type LensSettings,
  type Platform,
  type ProfileSnapshot,
  type RewriteOutcome,
  type RewriteRequest
} from '@hoot/core'
import { AppToExtSchema } from '@hoot/core/schemas'

export type ClientState = 'offline' | 'connecting' | 'online'

export interface HootClientOptions {
  pipePath: string
  /** Called on every connect: the app writes a fresh token at each launch. */
  readToken(): Promise<string | null>
  extVersion: string
  origin?: string
  /** Reconnect delays: doubles from `minMs` after each failure, capped at `maxMs`. */
  backoff?: { minMs: number; maxMs: number }
  /** How long the app has to answer `hello`. */
  welcomeTimeoutMs?: number
  log?(message: string): void
}

export interface HootClient {
  readonly state: ClientState
  /** From `welcome` and `settings.changed`; null until the first welcome. */
  readonly lens: LensSettings | null
  /** From `welcome` and `profile.changed`. */
  readonly profile: ProfileSnapshot | null
  /** Why the last attempt or connection failed. */
  readonly lastError: LensBackendError | null
  /** Connect now, skipping any backoff wait. Resolves after `welcome`. */
  connect(): Promise<void>
  rewrite(req: RewriteRequest, signal?: AbortSignal): Promise<RewriteOutcome>
  /** Opens the Hoot chat and explains the selection. */
  explain(ctx: LensContext): Promise<void>
  /** Best effort: dropped while offline. */
  feedback(event: LensEvent): Promise<void>
  onChange(listener: () => void): () => void
  dispose(): void
}

type Request = ExtToApp extends infer M ? (M extends ExtToApp ? Omit<M, 'reqId'> : never) : never

interface Pending {
  resolve(reply: AppToExt): void
  reject(error: LensBackendError): void
}

const unavailable = (message = 'Hoot isn’t running'): LensBackendError =>
  new LensBackendError('app_unavailable', message)

/** The running app's pipe and token for this OS user. */
export function defaultEndpoint(): Pick<HootClientOptions, 'pipePath' | 'readToken'> {
  const platform = process.platform as Platform
  return {
    pipePath: bridgePipePath(platform, userInfo().username, tmpdir()),
    readToken: () =>
      readFile(bridgeTokenPath(platform, process.env), 'utf8').then(
        (token) => token.trim() || null,
        () => null
      )
  }
}

/**
 * The VS Code side of the bridge protocol (hoot-lens.md §10.2), straight on the
 * app's pipe: `bridge.auth` first, then `hello` → `welcome`. Every request gets
 * exactly one reply; aborting sends `cancel`. When the pipe closes, everything
 * in flight fails with `app_unavailable` and it reconnects with backoff.
 */
export function createHootClient(opts: HootClientOptions): HootClient {
  const log = opts.log ?? (() => {})
  const { minMs, maxMs } = opts.backoff ?? { minMs: 2000, maxMs: 30_000 }
  const welcomeTimeoutMs = opts.welcomeTimeoutMs ?? 5000
  const listeners = new Set<() => void>()
  const pending = new Map<string, Pending>()
  let state: ClientState = 'offline'
  let socket: net.Socket | null = null
  let lens: LensSettings | null = null
  let profile: ProfileSnapshot | null = null
  let lastError: LensBackendError | null = null
  let connecting: Promise<void> | null = null
  let retry: ReturnType<typeof setTimeout> | null = null
  let failures = 0
  let disposed = false

  const emit = (): void => {
    for (const listener of listeners) listener()
  }

  const schedule = (): void => {
    if (disposed || retry) return
    const delay = Math.min(maxMs, minMs * 2 ** failures++)
    log(`reconnecting in ${delay} ms`)
    retry = setTimeout(() => {
      retry = null
      connect().catch(() => {})
    }, delay)
  }

  const fail = (error: LensBackendError): void => {
    lastError = error
    state = 'offline'
    emit()
    schedule()
  }

  const drop = (s: net.Socket, error: LensBackendError): void => {
    if (socket !== s) return
    socket = null
    s.destroy()
    for (const entry of pending.values()) entry.reject(error)
    pending.clear()
    log(`disconnected: ${error.message}`)
    fail(error)
  }

  const onFrame = (s: net.Socket, raw: unknown): void => {
    const parsed = AppToExtSchema.safeParse(raw)
    if (!parsed.success) {
      log(`ignored an invalid frame: ${parsed.error.issues[0]?.message ?? 'unknown'}`)
      return
    }
    const message = parsed.data
    if (message.type === 'settings.changed') {
      lens = message.lens
      emit()
      return
    }
    if (message.type === 'profile.changed') {
      profile = message.profile
      emit()
      return
    }
    if (message.type === 'error' && message.reqId === null) {
      drop(s, new LensBackendError(message.code, message.message))
      return
    }
    // The page link is for browser extensions; VS Code never says it has a page.
    if (message.type === 'page.read' || message.type === 'page.marks') return
    const entry = pending.get(message.reqId as string)
    if (!entry) return
    pending.delete(message.reqId as string)
    if (message.type === 'error') entry.reject(new LensBackendError(message.code, message.message))
    else entry.resolve(message)
  }

  const request = (s: net.Socket, body: Request, signal?: AbortSignal): Promise<AppToExt> =>
    new Promise((resolve, reject) => {
      const reqId = randomUUID()
      const cancel = (): void => {
        if (pending.has(reqId) && socket === s) s.write(encodeFrame({ type: 'cancel', reqId }))
      }
      const done = (): void => signal?.removeEventListener('abort', cancel)
      pending.set(reqId, {
        resolve: (reply) => {
          done()
          resolve(reply)
        },
        reject: (error) => {
          done()
          reject(error)
        }
      })
      signal?.addEventListener('abort', cancel, { once: true })
      s.write(encodeFrame({ ...body, reqId }))
    })

  const open = async (): Promise<void> => {
    const token = await opts.readToken()
    if (!token) throw unavailable()
    const s = await new Promise<net.Socket>((resolve, reject) => {
      const c = net.connect(opts.pipePath)
      const refused = (): void => reject(unavailable())
      c.once('error', refused)
      c.once('connect', () => {
        c.off('error', refused)
        resolve(c)
      })
    })
    if (disposed) {
      s.destroy()
      throw unavailable('disposed')
    }
    socket = s
    const decoder = new FrameDecoder()
    s.on('data', (chunk: Buffer) => {
      let frames: unknown[]
      try {
        frames = decoder.push(chunk)
      } catch (e) {
        drop(s, unavailable(e instanceof Error ? e.message : 'bad frame'))
        return
      }
      for (const frame of frames) onFrame(s, frame)
    })
    s.on('close', () => drop(s, unavailable('Hoot closed the connection')))
    s.on('error', (e) => drop(s, unavailable(e.message)))
    const timer = setTimeout(() => drop(s, unavailable('Hoot didn’t answer')), welcomeTimeoutMs)
    // One write for auth + hello: a refused client then reads the app's error
    // frame instead of failing its second write with EPIPE.
    s.cork()
    s.write(
      encodeFrame({ type: 'bridge.auth', token, origin: opts.origin ?? VSCODE_EXTENSION_ORIGIN })
    )
    const welcome = request(s, {
      type: 'hello',
      protocol: BRIDGE_PROTOCOL_VERSION,
      extVersion: opts.extVersion.slice(0, 32),
      browser: 'other'
    })
    s.uncork()
    try {
      const reply = await welcome
      if (reply.type !== 'welcome') throw new LensBackendError('internal', `got ${reply.type}`)
      lens = reply.lens
      profile = reply.profile
    } finally {
      clearTimeout(timer)
    }
  }

  const connect = (): Promise<void> => {
    if (disposed) return Promise.reject(unavailable('disposed'))
    if (state === 'online') return Promise.resolve()
    if (connecting) return connecting
    if (retry) clearTimeout(retry)
    retry = null
    state = 'connecting'
    emit()
    const attempt = open().then(
      () => {
        connecting = null
        failures = 0
        lastError = null
        state = 'online'
        log(`connected to ${opts.pipePath}`)
        emit()
      },
      (e: unknown) => {
        connecting = null
        const error = e instanceof LensBackendError ? e : unavailable(String(e))
        if (socket) drop(socket, error)
        else if (state !== 'offline' || lastError !== error) fail(error)
        throw error
      }
    )
    connecting = attempt
    return attempt
  }

  const ask = async (body: Request, signal?: AbortSignal): Promise<AppToExt | null> => {
    await connect()
    if (signal?.aborted) return null
    if (!socket) throw lastError ?? unavailable()
    return request(socket, body, signal)
  }

  return {
    get state() {
      return state
    },
    get lens() {
      return lens
    },
    get profile() {
      return profile
    },
    get lastError() {
      return lastError
    },
    connect,
    async rewrite(req, signal) {
      const reply = await ask({ type: 'rewrite', ...req }, signal)
      if (!reply) return { kind: 'skipped', reason: 'cancelled' }
      if (reply.type === 'skipped') return { kind: 'skipped', reason: reply.reason }
      if (reply.type === 'rewritten') return { kind: 'rewritten', result: reply.result }
      throw new LensBackendError('internal', `got ${reply.type}`)
    },
    async explain(ctx) {
      await ask({ type: 'explain', ctx })
    },
    async feedback(event) {
      if (state === 'online' && socket) await request(socket, { type: 'feedback', event })
    },
    onChange(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    dispose() {
      disposed = true
      if (retry) clearTimeout(retry)
      retry = null
      if (socket) drop(socket, unavailable('disposed'))
      listeners.clear()
    }
  }
}
