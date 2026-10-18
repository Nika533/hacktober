import net from 'node:net'
import { FrameDecoder, encodeFrame } from '@hoot/core'
import {
  CODE_LINK_PROTOCOL_VERSION,
  type CodeActionResult,
  type CodeEdit,
  type CodeExtToApp,
  type CodeFocusFile,
  type CodeMark,
  type CodeSnapshot,
  type CodeWindowInfo
} from '@hoot/core/code'
import { CodeAppToExtSchema, type CodeAppToExt } from '@hoot/core/code/schemas'

export type CodeLinkState = 'offline' | 'connecting' | 'online'

/** What the app can ask this window to do. */
export interface CodeLinkHandlers {
  snapshot(): Promise<CodeSnapshot | null>
  show(marks: CodeMark[], edits: CodeEdit[], reveal: boolean): Promise<CodeActionResult>
  apply(edit: CodeEdit): Promise<CodeActionResult>
  reveal(mark: CodeMark): Promise<CodeActionResult>
  clear(): Promise<CodeActionResult>
}

export interface CodeLinkOptions {
  pipePath: string
  /** Read on every connect: the app writes a fresh token at each launch. */
  readToken(): Promise<string | null>
  extVersion: string
  window: CodeWindowInfo
  /** Where focus is now (sent with hello and on every `focusChanged`). */
  focus(): { focused: boolean; file: CodeFocusFile | null }
  handlers: CodeLinkHandlers
  /** Reconnect delays: doubles from `minMs` after each failure, capped at `maxMs`. */
  backoff?: { minMs: number; maxMs: number }
  welcomeTimeoutMs?: number
  log?(message: string): void
}

export interface CodeLink {
  readonly state: CodeLinkState
  /** Connect now, skipping any backoff wait. Resolves after `code.welcome`. */
  connect(): Promise<void>
  /** Tell the app where focus is now; dropped while offline (hello carries it). */
  focusChanged(): void
  /** The user applied one of Hoot's edits right in VS Code. */
  applied(editId: string): void
  onChange(listener: () => void): () => void
  dispose(): void
}

const errorText = (e: unknown): string => (e instanceof Error ? e.message : String(e)).slice(0, 500)

/**
 * This window's end of the code link: the app's code pipe, `code.hello` with
 * the per-launch token, then answering the app's requests (one reply per
 * `reqId`). It reconnects with backoff while Hoot isn't running.
 */
export function createCodeLink(opts: CodeLinkOptions): CodeLink {
  const log = opts.log ?? (() => {})
  const { minMs, maxMs } = opts.backoff ?? { minMs: 2000, maxMs: 30_000 }
  const welcomeTimeoutMs = opts.welcomeTimeoutMs ?? 5000
  const listeners = new Set<() => void>()
  let state: CodeLinkState = 'offline'
  let socket: net.Socket | null = null
  let connecting: Promise<void> | null = null
  let retry: ReturnType<typeof setTimeout> | null = null
  let failures = 0
  let disposed = false
  let lastFocus = ''

  const emit = (): void => {
    for (const listener of [...listeners]) listener()
  }

  const setState = (next: CodeLinkState): void => {
    if (state === next) return
    state = next
    emit()
  }

  const schedule = (): void => {
    if (disposed || retry) return
    const delay = Math.min(maxMs, minMs * 2 ** failures++)
    retry = setTimeout(() => {
      retry = null
      connect().catch(() => {})
    }, delay)
  }

  const drop = (s: net.Socket, why: string): void => {
    if (socket !== s) return
    socket = null
    s.destroy()
    log(`code link: disconnected (${why})`)
    setState('offline')
    schedule()
  }

  const write = (s: net.Socket, message: CodeExtToApp): void => {
    if (!s.destroyed) s.write(encodeFrame(message))
  }

  const act = (s: net.Socket, reqId: string, work: () => Promise<CodeActionResult>): void => {
    void work()
      .catch((e: unknown): CodeActionResult => ({ ok: false, message: errorText(e) }))
      .then((r) => write(s, { type: 'code.done', reqId, ok: r.ok, message: r.message }))
  }

  const onRequest = (s: net.Socket, msg: CodeAppToExt): void => {
    const h = opts.handlers
    switch (msg.type) {
      case 'code.snapshot.get':
        void h
          .snapshot()
          .catch((e: unknown) => {
            log(`code link: snapshot failed: ${errorText(e)}`)
            return null
          })
          .then((snapshot) => {
            try {
              write(s, { type: 'code.snapshot', reqId: msg.reqId, snapshot })
            } catch (e) {
              // Too big for a frame: say so rather than leave the app waiting.
              log(`code link: snapshot not sent: ${errorText(e)}`)
              write(s, { type: 'code.snapshot', reqId: msg.reqId, snapshot: null })
            }
          })
        return
      case 'code.show':
        return act(s, msg.reqId, () => h.show(msg.marks, msg.edits, msg.reveal))
      case 'code.apply':
        return act(s, msg.reqId, () => h.apply(msg.edit))
      case 'code.reveal':
        return act(s, msg.reqId, () => h.reveal(msg.mark))
      case 'code.clear':
        return act(s, msg.reqId, () => h.clear())
      default:
        return
    }
  }

  const open = async (): Promise<void> => {
    const token = await opts.readToken()
    if (!token) throw new Error('Hoot isn’t running')
    const s = await new Promise<net.Socket>((resolve, reject) => {
      const c = net.connect(opts.pipePath)
      const refused = (e: Error): void => reject(e)
      c.once('error', refused)
      c.once('connect', () => {
        c.off('error', refused)
        resolve(c)
      })
    })
    if (disposed) {
      s.destroy()
      throw new Error('disposed')
    }
    socket = s
    const decoder = new FrameDecoder()
    let welcomed: (error: Error | null) => void = () => {}
    const welcome = new Promise<void>((resolve, reject) => {
      welcomed = (error) => (error ? reject(error) : resolve())
    })
    const timer = setTimeout(() => welcomed(new Error('Hoot didn’t answer')), welcomeTimeoutMs)
    s.on('data', (chunk: Buffer) => {
      let frames: unknown[]
      try {
        frames = decoder.push(chunk)
      } catch (e) {
        drop(s, errorText(e))
        return
      }
      for (const raw of frames) {
        const parsed = CodeAppToExtSchema.safeParse(raw)
        if (!parsed.success) {
          log(`code link: ignored a bad frame: ${parsed.error.issues[0]?.message ?? '?'}`)
          continue
        }
        const msg = parsed.data
        if (msg.type === 'code.welcome') welcomed(null)
        else if (msg.type === 'code.error') {
          welcomed(new Error(msg.message))
          drop(s, msg.message)
        } else onRequest(s, msg)
      }
    })
    s.on('close', () => {
      welcomed(new Error('Hoot closed the connection'))
      drop(s, 'closed')
    })
    s.on('error', (e) => drop(s, e.message))
    const { focused, file } = opts.focus()
    lastFocus = JSON.stringify({ focused, file })
    write(s, {
      type: 'code.hello',
      protocol: CODE_LINK_PROTOCOL_VERSION,
      token,
      extVersion: opts.extVersion.slice(0, 32),
      window: opts.window,
      focused,
      file
    })
    try {
      await welcome
    } finally {
      clearTimeout(timer)
    }
  }

  const pushFocus = (): void => {
    if (state !== 'online' || !socket) return
    const { focused, file } = opts.focus()
    const key = JSON.stringify({ focused, file })
    if (key === lastFocus) return
    lastFocus = key
    write(socket, { type: 'code.focus', focused, file })
  }

  const connect = (): Promise<void> => {
    if (disposed) return Promise.reject(new Error('disposed'))
    if (state === 'online') return Promise.resolve()
    if (connecting) return connecting
    if (retry) clearTimeout(retry)
    retry = null
    setState('connecting')
    connecting = open().then(
      () => {
        connecting = null
        failures = 0
        log(`code link: connected to ${opts.pipePath}`)
        setState('online')
        // Focus may have moved while hello was on its way.
        pushFocus()
      },
      (e: unknown) => {
        connecting = null
        if (socket) drop(socket, errorText(e))
        else {
          setState('offline')
          schedule()
        }
        throw e
      }
    )
    return connecting
  }

  return {
    get state() {
      return state
    },
    connect,
    focusChanged: pushFocus,
    applied(editId) {
      if (state === 'online' && socket) write(socket, { type: 'code.applied', editId })
    },
    onChange(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    dispose() {
      disposed = true
      if (retry) clearTimeout(retry)
      retry = null
      if (socket) drop(socket, 'disposed')
      listeners.clear()
    }
  }
}
