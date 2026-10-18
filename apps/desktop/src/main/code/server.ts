import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { promises as fs } from 'node:fs'
import net from 'node:net'
import { dirname } from 'node:path'
import { FrameDecoder, encodeFrame, type Platform } from '@hoot/core'
import {
  CODE_LINK_PROTOCOL_VERSION,
  type CodeActionResult,
  type CodeAppToExt,
  type CodeEdit,
  type CodeFocusFile,
  type CodeMark,
  type CodeSnapshot,
  type CodeWindowInfo
} from '@hoot/core/code'
import { CodeExtToAppSchema, type CodeExtToApp } from '@hoot/core/code/schemas'

/** One connected VS Code window. */
export interface CodePeer {
  readonly window: CodeWindowInfo
  readonly focused: boolean
  /** When this window last gained or lost focus (ms since epoch). */
  readonly focusAt: number
  readonly file: CodeFocusFile | null
  /** What the window shows right now; null when it couldn't say in time. */
  snapshot(): Promise<CodeSnapshot | null>
  /** Replace Hoot's highlights and proposed edits in this window. */
  show(marks: CodeMark[], edits: CodeEdit[], reveal: boolean): Promise<CodeActionResult>
  apply(edit: CodeEdit): Promise<CodeActionResult>
  reveal(mark: CodeMark): Promise<CodeActionResult>
  clear(): Promise<CodeActionResult>
}

export interface CodeLinkServerDeps {
  pipePath: string
  tokenPath: string
  platform: Platform
  appVersion: string
  log?(message: string): void
  now?(): number
  /** Peers came, went, or changed focus. */
  onChange?(): void
  /** The user applied one of Hoot's edits from VS Code itself. */
  onApplied?(peer: CodePeer, editId: string): void
  timeouts?: Partial<typeof TIMEOUTS>
}

export interface CodeLinkServer {
  /** Write the token and listen. Rejects with CodeLinkBusyError when another Hoot owns the pipe. */
  start(): Promise<void>
  /** Drop every window, stop listening, remove the token. */
  stop(): Promise<void>
  peers(): readonly CodePeer[]
}

export class CodeLinkBusyError extends Error {
  constructor(path: string) {
    super(`another Hoot is already listening on ${path}`)
    this.name = 'CodeLinkBusyError'
  }
}

export const TIMEOUTS = {
  /** A window must say `code.hello` this soon after connecting. */
  helloMs: 5000,
  /** Reading the editor is quick; the chat waits for it before sending. */
  snapshotMs: 1500,
  /** Opening a file and applying an edit can take a moment. */
  actionMs: 10_000
}

const unavailable = (message: string): CodeActionResult => ({ ok: false, message })

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

type Reply = Extract<CodeExtToApp, { reqId: string }>
type Ask = CodeAppToExt extends infer M
  ? M extends { reqId: string }
    ? Omit<M, 'reqId'>
    : never
  : never

/**
 * The app side of the code link: VS Code windows connect on their own pipe,
 * open with `code.hello` (the per-launch token, readable only by this OS
 * user), and then answer what the app asks. Every request has a timeout, so
 * a stuck window never holds up a chat.
 */
export function createCodeLinkServer(deps: CodeLinkServerDeps): CodeLinkServer {
  const log = deps.log ?? (() => {})
  const now = deps.now ?? Date.now
  const timeouts = { ...TIMEOUTS, ...deps.timeouts }
  const peers = new Map<net.Socket, CodePeer>()
  /** Every connection, said hello or not, so stop() can close them all. */
  const sockets = new Set<net.Socket>()
  let token = ''
  let server: net.Server | null = null

  const changed = (): void => deps.onChange?.()

  const onClient = (socket: net.Socket): void => {
    sockets.add(socket)
    const decoder = new FrameDecoder()
    const pending = new Map<string, (reply: Reply | null) => void>()
    let peer: CodePeer | null = null
    let focused = false
    let focusAt = now()
    let file: CodeFocusFile | null = null

    const send = (message: CodeAppToExt): void => {
      if (!socket.destroyed) socket.write(encodeFrame(message))
    }
    const refuse = (
      code: 'unauthorized' | 'version_mismatch' | 'bad_request',
      why: string
    ): void => {
      log(`code link: refused a window (${why})`)
      if (!socket.destroyed) {
        socket.end(encodeFrame({ type: 'code.error', reqId: null, code, message: why }))
      }
      socket.destroy()
    }
    const helloTimer = setTimeout(() => refuse('unauthorized', 'no code.hello'), timeouts.helloMs)

    const ask = (body: Ask, ms: number): Promise<Reply | null> =>
      new Promise((resolve) => {
        if (socket.destroyed) return resolve(null)
        const reqId = randomUUID()
        const timer = setTimeout(() => {
          pending.delete(reqId)
          resolve(null)
        }, ms)
        pending.set(reqId, (reply) => {
          clearTimeout(timer)
          pending.delete(reqId)
          resolve(reply)
        })
        try {
          send({ ...body, reqId } as CodeAppToExt)
        } catch (e) {
          pending.get(reqId)?.(null)
          log(`code link: send failed: ${String(e)}`)
        }
      })

    const act = async (body: Ask): Promise<CodeActionResult> => {
      const reply = await ask(body, timeouts.actionMs)
      if (!reply) return unavailable('VS Code didn’t answer. Is the window still open?')
      return reply.type === 'code.done'
        ? { ok: reply.ok, message: reply.message }
        : unavailable('VS Code answered something else.')
    }

    const welcome = (hello: Extract<CodeExtToApp, { type: 'code.hello' }>): void => {
      focused = hello.focused
      file = hello.file
      const window = hello.window
      peer = {
        window,
        get focused() {
          return focused
        },
        get focusAt() {
          return focusAt
        },
        get file() {
          return file
        },
        async snapshot() {
          const reply = await ask({ type: 'code.snapshot.get' }, timeouts.snapshotMs)
          return reply?.type === 'code.snapshot' ? reply.snapshot : null
        },
        show: (marks, edits, reveal) => act({ type: 'code.show', marks, edits, reveal }),
        apply: (edit) => act({ type: 'code.apply', edit }),
        reveal: (mark) => act({ type: 'code.reveal', mark }),
        clear: () => act({ type: 'code.clear' })
      }
      peers.set(socket, peer)
      send({
        type: 'code.welcome',
        protocol: CODE_LINK_PROTOCOL_VERSION,
        appVersion: deps.appVersion.slice(0, 32)
      })
      log(`code link: ${window.name || 'a VS Code window'} connected`)
      changed()
    }

    const onFrame = (raw: unknown): void => {
      const parsed = CodeExtToAppSchema.safeParse(raw)
      if (!parsed.success) {
        if (!peer) refuse('bad_request', 'expected code.hello')
        else log(`code link: ignored a bad frame: ${parsed.error.issues[0]?.message ?? '?'}`)
        return
      }
      const msg = parsed.data
      if (!peer) {
        clearTimeout(helloTimer)
        if (msg.type !== 'code.hello') return refuse('bad_request', 'expected code.hello')
        if (!token || !sameToken(msg.token, token)) return refuse('unauthorized', 'bad token')
        if (msg.protocol !== CODE_LINK_PROTOCOL_VERSION) {
          return refuse(
            'version_mismatch',
            `app speaks code link ${CODE_LINK_PROTOCOL_VERSION}, extension ${msg.protocol}`
          )
        }
        return welcome(msg)
      }
      switch (msg.type) {
        case 'code.hello':
          return
        case 'code.focus':
          if (focused !== msg.focused) focusAt = now()
          focused = msg.focused
          file = msg.file
          return changed()
        case 'code.applied':
          return deps.onApplied?.(peer, msg.editId)
        default:
          pending.get(msg.reqId)?.(msg)
      }
    }

    socket.on('data', (chunk: Buffer) => {
      let frames: unknown[]
      try {
        frames = decoder.push(chunk)
      } catch (e) {
        refuse('bad_request', e instanceof Error ? e.message : 'bad frame')
        return
      }
      for (const frame of frames) onFrame(frame)
    })
    socket.on('close', () => {
      clearTimeout(helloTimer)
      sockets.delete(socket)
      for (const resolve of [...pending.values()]) resolve(null)
      if (peers.delete(socket)) {
        log(`code link: ${peer?.window.name || 'a VS Code window'} disconnected`)
        changed()
      }
    })
    socket.on('error', () => socket.destroy())
  }

  const listen = (s: net.Server, path: string): Promise<void> =>
    new Promise((resolve, reject) => {
      s.once('error', reject)
      s.listen(path, () => {
        s.off('error', reject)
        resolve()
      })
    })

  return {
    async start() {
      if (server) return
      token = randomBytes(32).toString('hex')
      const s = net.createServer(onClient)
      try {
        await listen(s, deps.pipePath)
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'EADDRINUSE') throw e
        if (deps.platform === 'win32') throw new CodeLinkBusyError(deps.pipePath)
        // A unix socket left by a crashed run refuses connections; a live one accepts.
        const live = await new Promise<boolean>((resolve) => {
          const probe = net.connect(deps.pipePath)
          probe.once('connect', () => {
            probe.destroy()
            resolve(true)
          })
          probe.once('error', () => resolve(false))
        })
        if (live) throw new CodeLinkBusyError(deps.pipePath)
        await fs.rm(deps.pipePath, { force: true })
        await listen(s, deps.pipePath)
      }
      if (deps.platform !== 'win32') await fs.chmod(deps.pipePath, 0o600).catch(() => {})
      server = s
      await writeToken(deps.tokenPath, token)
      log(`code link: listening on ${deps.pipePath}`)
    },

    async stop() {
      const s = server
      server = null
      for (const socket of sockets) socket.destroy()
      sockets.clear()
      peers.clear()
      if (s) await new Promise<void>((resolve) => s.close(() => resolve()))
      await fs.rm(deps.tokenPath, { force: true })
      token = ''
    },

    peers: () => [...peers.values()]
  }
}
