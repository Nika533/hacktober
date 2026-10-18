import {
  BRIDGE_PROTOCOL_VERSION,
  LensBackendError,
  type AppToExt,
  type AssessResult,
  type Browser,
  type ExtToApp,
  type LensCallOptions,
  type LensContext,
  type LensEvent,
  type LensSettings,
  type LensSettingsPatch,
  type PageInfo,
  type PageMark,
  type PageSnapshot,
  type ProfileSnapshot,
  type RewriteOutcome,
  type RewriteRequest
} from '@hoot/core'
import { AppToExtSchema } from '@hoot/core/schemas'
import type { BridgeState, BridgeStatus } from '../messages'
import type { Upstream } from './upstream'

export type ClosedReason = 'not_running' | 'not_installed'

/** Thrown by a `Connect` that couldn't open its transport. */
export class TransportError extends Error {
  constructor(readonly reason: ClosedReason) {
    super(reason)
  }
}

export interface TransportHandlers {
  message(raw: unknown): void
  closed(reason: ClosedReason): void
}

export interface Transport {
  send(message: ExtToApp): void
  close(): void
}

export type Connect = (handlers: TransportHandlers) => Transport | Promise<Transport>

export type BridgeEvent =
  | { type: 'settings'; lens: LensSettings }
  | { type: 'profile'; profile: ProfileSnapshot }
  | { type: 'status'; status: BridgeStatus }
  /** The page link: the app wants the page in front (answer with `pageSnapshot`). */
  | { type: 'page.read'; reqId: string }
  /** The page link: highlight passages in a tab (empty clears). */
  | { type: 'page.marks'; tab: number; marks: PageMark[] }

export interface BridgeClient extends Upstream {
  /** Connects (once) and says hello; rejects with `LensBackendError` when the app can't be reached. */
  connect(): Promise<void>
  readonly connected: boolean
  status(): BridgeStatus
  getSettings(): Promise<LensSettings>
  patchSettings(patch: LensSettingsPatch): Promise<LensSettings>
  /** The page link: which tab is in front. Only while connected; never connects. */
  pageFocus(focused: boolean, page: PageInfo | null): Promise<void>
  /** The page link: the answer to the app's `page.read`. */
  pageSnapshot(reqId: string, snapshot: PageSnapshot | null): void
  /** The page link: a question from the popup; connects if needed. */
  pageAsk(text: string, voice: boolean, snapshot: PageSnapshot | null): Promise<void>
  subscribe(listener: (event: BridgeEvent) => void): () => void
  close(): void
}

export interface BridgeClientOptions {
  connect: Connect
  extVersion: string
  browser: Browser
  ids?: () => string
  helloTimeoutMs?: number
}

type Request = ExtToApp extends infer M ? (M extends ExtToApp ? Omit<M, 'reqId'> : never) : never

interface Pending {
  resolve(reply: AppToExt): void
  reject(error: Error): void
}

const unreachable = (reason: ClosedReason | 'version_mismatch'): LensBackendError =>
  reason === 'version_mismatch'
    ? new LensBackendError('version_mismatch', 'Hoot and the extension speak different versions')
    : new LensBackendError(
        'app_unavailable',
        reason === 'not_installed' ? 'Hoot isn’t installed' : 'Hoot isn’t running'
      )

/**
 * The extension's side of the bridge protocol (hoot-lens.md §10.2) over any
 * transport: native messaging to hoot-bridge in production, a WebSocket to
 * the fake protocol server in e2e builds. Connects on demand, answers each
 * request from its reply, cancels by reqId and fails everything in flight
 * when the transport closes; the next request reconnects.
 */
export function createBridgeClient(options: BridgeClientOptions): BridgeClient {
  const pending = new Map<string, Pending>()
  const listeners = new Set<(event: BridgeEvent) => void>()
  const helloTimeoutMs = options.helloTimeoutMs ?? 15_000
  let seq = 0
  const ids = options.ids ?? (() => `b${Date.now().toString(36)}${(++seq).toString(36)}`)
  let transport: Transport | null = null
  let generation = 0
  let hello: Promise<void> | null = null
  let status: BridgeStatus = { state: 'idle', appVersion: null }
  let settings: LensSettings | null = null

  const emit = (event: BridgeEvent): void => {
    for (const listener of listeners) listener(event)
  }

  const setStatus = (state: BridgeState, appVersion: string | null = null): void => {
    status = { state, appVersion }
    emit({ type: 'status', status })
  }

  const drop = (state: ClosedReason | 'version_mismatch'): void => {
    generation += 1
    const closing = transport
    transport = null
    hello = null
    closing?.close()
    const error = unreachable(state)
    for (const entry of pending.values()) entry.reject(error)
    pending.clear()
    setStatus(state)
  }

  const onMessage = (raw: unknown): void => {
    const parsed = AppToExtSchema.safeParse(raw)
    if (!parsed.success) return
    const message = parsed.data
    if (message.type === 'settings.changed') {
      settings = message.lens
      emit({ type: 'settings', lens: message.lens })
      return
    }
    if (message.type === 'profile.changed') {
      emit({ type: 'profile', profile: message.profile })
      return
    }
    if (message.type === 'page.read') {
      emit({ type: 'page.read', reqId: message.reqId })
      return
    }
    if (message.type === 'page.marks') {
      emit({ type: 'page.marks', tab: message.tab, marks: message.marks })
      return
    }
    if (message.type === 'error' && message.reqId === null) {
      drop(message.code === 'version_mismatch' ? 'version_mismatch' : 'not_running')
      return
    }
    const entry = pending.get(message.reqId as string)
    if (!entry) return
    pending.delete(message.reqId as string)
    if (message.type === 'error') entry.reject(new LensBackendError(message.code, message.message))
    else entry.resolve(message)
  }

  const send = (request: Request, signal?: AbortSignal): Promise<AppToExt> =>
    new Promise<AppToExt>((resolve, reject) => {
      const target = transport
      if (!target) {
        reject(unreachable('not_running'))
        return
      }
      const reqId = ids()
      const cancel = (): void => {
        if (pending.has(reqId)) target.send({ type: 'cancel', reqId })
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
      target.send({ ...request, reqId } as ExtToApp)
      if (signal?.aborted) cancel()
    })

  const sayHello = async (): Promise<void> => {
    setStatus('connecting')
    const mine = ++generation
    try {
      transport = await options.connect({
        message: (raw) => {
          if (mine === generation) onMessage(raw)
        },
        closed: (reason) => {
          if (mine === generation) drop(reason)
        }
      })
    } catch (error) {
      const reason = error instanceof TransportError ? error.reason : 'not_installed'
      if (mine === generation) drop(reason)
      throw unreachable(reason)
    }
    let timer: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        if (mine === generation) drop('not_running')
        reject(unreachable('not_running'))
      }, helloTimeoutMs)
    })
    try {
      const reply = await Promise.race([
        send({
          type: 'hello',
          protocol: BRIDGE_PROTOCOL_VERSION,
          extVersion: options.extVersion,
          browser: options.browser
        }),
        timeout
      ])
      if (reply.type !== 'welcome') throw new LensBackendError('internal', 'no welcome')
      settings = reply.lens
      setStatus('connected', reply.appVersion)
      emit({ type: 'settings', lens: reply.lens })
      emit({ type: 'profile', profile: reply.profile })
    } catch (error) {
      if (mine === generation) {
        const mismatch = error instanceof LensBackendError && error.code === 'version_mismatch'
        drop(mismatch ? 'version_mismatch' : 'not_running')
      }
      throw error
    } finally {
      clearTimeout(timer)
    }
  }

  const connect = (): Promise<void> => {
    if (transport && status.state === 'connected') return Promise.resolve()
    if (!hello) {
      const attempt = sayHello()
      hello = attempt
      attempt.catch(() => {
        if (hello === attempt) hello = null
      })
    }
    return hello
  }

  const ask = async (request: Request, signal?: AbortSignal): Promise<AppToExt> => {
    await connect()
    return send(request, signal)
  }

  const expect = <T extends AppToExt['type']>(
    reply: AppToExt,
    type: T
  ): Extract<AppToExt, { type: T }> => {
    if (reply.type === 'skipped' && reply.reason === 'cancelled') {
      throw new LensBackendError('cancelled', 'cancelled')
    }
    if (reply.type !== type) throw new LensBackendError('internal', `expected ${type}`)
    return reply as Extract<AppToExt, { type: T }>
  }

  return {
    connect,
    get connected() {
      return transport !== null && status.state === 'connected'
    },
    status: () => status,
    async assess(ctx: LensContext, opts?: LensCallOptions): Promise<AssessResult> {
      return expect(await ask({ type: 'assess', ctx }, opts?.signal), 'assessed').result
    },
    async rewrite(request: RewriteRequest, opts?: LensCallOptions): Promise<RewriteOutcome> {
      const reply = await ask({ type: 'rewrite', ...request }, opts?.signal)
      if (reply.type === 'skipped') return { kind: 'skipped', reason: reply.reason }
      return { kind: 'rewritten', result: expect(reply, 'rewritten').result }
    },
    async feedback(event: LensEvent): Promise<void> {
      if (!transport) return
      expect(await send({ type: 'feedback', event }), 'ack')
    },
    async explainMore(ctx: LensContext): Promise<void> {
      expect(await ask({ type: 'explain', ctx }), 'ack')
    },
    async getProfile(): Promise<ProfileSnapshot> {
      return expect(await ask({ type: 'profile.get' }), 'profile').profile
    },
    async getSettings(): Promise<LensSettings> {
      await connect()
      if (settings) return settings
      return expect(await send({ type: 'settings.get' }), 'settings').lens
    },
    async patchSettings(patch: LensSettingsPatch): Promise<LensSettings> {
      const reply = expect(await ask({ type: 'settings.patch', patch }), 'settings')
      settings = reply.lens
      return reply.lens
    },
    async pageFocus(focused: boolean, page: PageInfo | null): Promise<void> {
      if (!transport || status.state !== 'connected') return
      // An app without the page link refuses this; that's fine.
      await send({ type: 'page.focus', focused, page }).catch(() => undefined)
    },
    pageSnapshot(reqId: string, snapshot: PageSnapshot | null): void {
      transport?.send({ type: 'page.snapshot', reqId, snapshot })
    },
    async pageAsk(text: string, voice: boolean, snapshot: PageSnapshot | null): Promise<void> {
      expect(await ask({ type: 'page.ask', text, voice, snapshot }), 'ack')
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    close: () => {
      if (transport) drop('not_running')
    }
  }
}
