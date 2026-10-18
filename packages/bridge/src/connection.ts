import {
  BRIDGE_PROTOCOL_VERSION,
  LensBackendError,
  type AppToExt,
  type AssessResult,
  type BridgeErrorCode,
  type Browser,
  type ExtToApp,
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
import { ExtToAppSchema } from '@hoot/core/schemas'

/**
 * What one bridge connection needs from the app. The real app passes its
 * LensService plus settings accessors (C-20); tests and the dev fake server
 * pass `createFakeBridgeApp()`.
 */
export interface BridgeApp {
  appVersion: string
  assess(reqId: string, ctx: LensContext): Promise<AssessResult>
  rewrite(reqId: string, req: RewriteRequest): Promise<RewriteOutcome>
  cancel(reqId: string): void
  feedback(event: LensEvent): Promise<void>
  explain(ctx: LensContext): Promise<void>
  snapshot(): Promise<ProfileSnapshot> | ProfileSnapshot
  getLensSettings(): Promise<LensSettings> | LensSettings
  /** Apply a patch from the extension; the server pushes the result to every connection. */
  patchLensSettings(patch: LensSettingsPatch): Promise<LensSettings>
}

export interface BridgeConnection {
  /** One decoded frame (already JSON-parsed) from the extension. */
  handle(raw: unknown): void
  pushSettings(lens: LensSettings): void
  pushProfile(profile: ProfileSnapshot): void
  /** The page link: the page in the extension's front tab, or null when it doesn't say in time. */
  readPage(timeoutMs: number): Promise<PageSnapshot | null>
  /** The page link: highlight passages in a tab (an empty list clears them). */
  pushMarks(tab: number, marks: PageMark[]): void
  /** The peer went away: cancel everything in flight and stop sending. */
  close(): void
  readonly ready: boolean
  /** The browser `hello` named; null before it. */
  readonly browser: Browser | null
}

/** The page link's messages from one extension (the app's page service). */
export interface BridgePageHooks {
  /** Which tab is in front, and whether the browser has focus. */
  focus(focused: boolean, page: PageInfo | null): void
  /** The user asked from the extension's popup (typed or spoken). */
  ask(text: string, voice: boolean, snapshot: PageSnapshot | null): Promise<void>
}

export interface BridgeConnectionOptions {
  app: BridgeApp
  send(message: AppToExt): void
  onError?(e: unknown): void
  /** Without it, page messages are refused (`bad_request`). */
  page?: BridgePageHooks
}

function codeOf(e: unknown): BridgeErrorCode {
  return e instanceof LensBackendError ? e.code : 'internal'
}

function messageOf(e: unknown): string {
  return (e instanceof Error ? e.message : String(e)).slice(0, 500)
}

/** Best-effort reqId from a frame that failed validation, so the error can be matched. */
function reqIdOf(raw: unknown): string | null {
  const id = (raw as { reqId?: unknown } | null)?.reqId
  return typeof id === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(id) ? id : null
}

/**
 * Protocol logic for one extension connection (hoot-lens.md §10.2), independent
 * of the transport (native messaging pipe or dev WebSocket):
 * - the first message must be `hello` with a matching protocol version;
 * - every request is validated and answered exactly once;
 * - `cancel { reqId }` cancels a pending request, which then answers
 *   `skipped { reason: 'cancelled' }`; cancel itself gets no reply;
 * - after `close()` nothing more is sent.
 */
export function createBridgeConnection(opts: BridgeConnectionOptions): BridgeConnection {
  const { app } = opts
  const onError = opts.onError ?? (() => {})
  const pending = new Set<string>()
  /** The app's own `page.read` requests, by reqId. */
  const reads = new Map<string, (snapshot: PageSnapshot | null) => void>()
  let readSeq = 0
  let ready = false
  let closed = false
  let browser: Browser | null = null

  const send = (message: AppToExt): void => {
    if (closed) return
    try {
      opts.send(message)
    } catch (e) {
      onError(e)
    }
  }
  const fail = (reqId: string | null, code: BridgeErrorCode, message: string): void =>
    send({ type: 'error', reqId, code, message })

  /** Run a request and send exactly one reply. */
  const answer = (reqId: string, work: () => Promise<AppToExt>): void => {
    pending.add(reqId)
    void work()
      .catch((e: unknown): AppToExt => {
        if (codeOf(e) === 'cancelled') return { type: 'skipped', reqId, reason: 'cancelled' }
        if (codeOf(e) === 'internal') onError(e)
        return { type: 'error', reqId, code: codeOf(e), message: messageOf(e) }
      })
      .then((reply) => {
        if (!pending.delete(reqId)) return
        send(reply)
      })
  }

  const dispatch = (msg: ExtToApp): void => {
    switch (msg.type) {
      case 'hello':
        if (msg.protocol !== BRIDGE_PROTOCOL_VERSION) {
          fail(
            msg.reqId,
            'version_mismatch',
            `app speaks protocol ${BRIDGE_PROTOCOL_VERSION}, extension ${msg.protocol}`
          )
          return
        }
        ready = true
        browser = msg.browser
        answer(msg.reqId, async () => ({
          type: 'welcome',
          reqId: msg.reqId,
          protocol: BRIDGE_PROTOCOL_VERSION,
          appVersion: app.appVersion,
          lens: await app.getLensSettings(),
          profile: await app.snapshot()
        }))
        return
      case 'assess':
        answer(msg.reqId, async () => ({
          type: 'assessed',
          reqId: msg.reqId,
          result: await app.assess(msg.reqId, msg.ctx)
        }))
        return
      case 'rewrite':
        answer(msg.reqId, async () => {
          const outcome = await app.rewrite(msg.reqId, {
            ctx: msg.ctx,
            allowedTransforms: msg.allowedTransforms,
            risk: msg.risk
          })
          return outcome.kind === 'rewritten'
            ? { type: 'rewritten', reqId: msg.reqId, result: outcome.result }
            : { type: 'skipped', reqId: msg.reqId, reason: outcome.reason }
        })
        return
      case 'cancel':
        if (pending.has(msg.reqId)) app.cancel(msg.reqId)
        return
      case 'feedback':
        answer(msg.reqId, async () => {
          await app.feedback(msg.event)
          return { type: 'ack', reqId: msg.reqId }
        })
        return
      case 'explain':
        answer(msg.reqId, async () => {
          await app.explain(msg.ctx)
          return { type: 'ack', reqId: msg.reqId }
        })
        return
      case 'profile.get':
        answer(msg.reqId, async () => ({
          type: 'profile',
          reqId: msg.reqId,
          profile: await app.snapshot()
        }))
        return
      case 'settings.get':
        answer(msg.reqId, async () => ({
          type: 'settings',
          reqId: msg.reqId,
          lens: await app.getLensSettings()
        }))
        return
      case 'settings.patch':
        answer(msg.reqId, async () => ({
          type: 'settings',
          reqId: msg.reqId,
          lens: await app.patchLensSettings(msg.patch)
        }))
        return
      case 'page.snapshot': {
        const resolve = reads.get(msg.reqId)
        reads.delete(msg.reqId)
        resolve?.(msg.snapshot)
        return
      }
      case 'page.focus':
      case 'page.ask': {
        const page = opts.page
        if (!page) {
          fail(msg.reqId, 'bad_request', 'this app has no page link')
          return
        }
        answer(msg.reqId, async () => {
          if (msg.type === 'page.focus') page.focus(msg.focused, msg.page)
          else await page.ask(msg.text, msg.voice, msg.snapshot)
          return { type: 'ack', reqId: msg.reqId }
        })
        return
      }
    }
  }

  return {
    get ready() {
      return ready
    },
    handle(raw) {
      if (closed) return
      const parsed = ExtToAppSchema.safeParse(raw)
      if (!parsed.success) {
        const issue = parsed.error.issues[0]
        fail(
          reqIdOf(raw),
          'bad_request',
          `${issue?.path.join('.') || 'message'}: ${issue?.message}`
        )
        return
      }
      const msg = parsed.data
      if (!ready && msg.type !== 'hello') {
        fail(msg.reqId, 'unauthorized', 'send hello first')
        return
      }
      if (msg.type !== 'cancel' && msg.type !== 'page.snapshot' && pending.has(msg.reqId)) {
        fail(msg.reqId, 'bad_request', 'duplicate reqId')
        return
      }
      dispatch(msg)
    },
    pushSettings(lens) {
      if (ready) send({ type: 'settings.changed', lens })
    },
    pushProfile(profile) {
      if (ready) send({ type: 'profile.changed', profile })
    },
    readPage(timeoutMs) {
      if (!ready || closed) return Promise.resolve(null)
      const reqId = `page-${(++readSeq).toString(36)}`
      return new Promise((resolve) => {
        const timer = setTimeout(() => settle(null), timeoutMs)
        function settle(snapshot: PageSnapshot | null): void {
          clearTimeout(timer)
          reads.delete(reqId)
          resolve(snapshot)
        }
        reads.set(reqId, settle)
        send({ type: 'page.read', reqId })
      })
    },
    pushMarks(tab, marks) {
      if (ready) send({ type: 'page.marks', tab, marks })
    },
    close() {
      if (closed) return
      closed = true
      for (const reqId of pending) app.cancel(reqId)
      pending.clear()
      for (const settle of [...reads.values()]) settle(null)
    },
    get browser() {
      return browser
    }
  }
}
