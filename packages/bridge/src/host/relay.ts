import type { Duplex, Readable, Writable } from 'node:stream'
import { allowedExtensionIds, encodeFrame, extensionOrigin, type BridgeAuth } from '@hoot/core'

/**
 * hoot-bridge: the process Chrome/Edge starts for the extension's native
 * messaging port. It is a thin relay (hoot-lens.md §10.1):
 *
 *   browser ⇄ stdin/stdout ⇄ hoot-bridge ⇄ named pipe ⇄ Hoot app
 *
 * Both sides use the same framing (4-byte LE length + JSON), so after the
 * first `bridge.auth` frame bytes are relayed unchanged. Nothing but frames
 * may ever be written to stdout.
 */

export interface HostIO {
  argv: readonly string[]
  stdin: Readable
  stdout: Writable
  /** Diagnostics only; Chrome shows stderr in its own log. */
  log(message: string): void
  readToken(): Promise<string | null>
  /** Open the pipe to the app; rejects when nothing is listening. */
  connect(): Promise<Duplex>
  /** Start Hoot hidden when it isn't running; resolves once spawned. */
  launchApp?(): Promise<void>
  sleep?(ms: number): Promise<void>
}

export const CONNECT_ATTEMPTS = 20
export const CONNECT_RETRY_MS = 400

/** The `chrome-extension://<id>/` origin Chrome passes as the first argument. */
export function callerOrigin(argv: readonly string[]): string | null {
  return argv.find((a) => a.startsWith('chrome-extension://')) ?? null
}

export function isAllowedOrigin(origin: string | null): boolean {
  return !!origin && allowedExtensionIds().some((id) => extensionOrigin(id) === origin)
}

function writeError(
  stdout: Writable,
  code: 'unauthorized' | 'app_unavailable',
  message: string
): void {
  stdout.write(encodeFrame({ type: 'error', reqId: null, code, message }))
}

async function connectWithRetry(io: HostIO): Promise<Duplex | null> {
  const sleep = io.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)))
  let launched = false
  for (let attempt = 0; attempt < CONNECT_ATTEMPTS; attempt++) {
    try {
      return await io.connect()
    } catch {
      if (!launched && io.launchApp) {
        launched = true
        io.log('Hoot is not running; starting it hidden')
        await io.launchApp().catch((e: unknown) => io.log(`could not start Hoot: ${String(e)}`))
      }
      if (!launched) return null
      await sleep(CONNECT_RETRY_MS)
    }
  }
  return null
}

/**
 * Run one browser connection to completion. Resolves with the exit code
 * when either side closes.
 */
export async function runHost(io: HostIO): Promise<number> {
  const origin = callerOrigin(io.argv)
  if (!isAllowedOrigin(origin)) {
    io.log(`refusing caller ${origin ?? '(none)'}`)
    writeError(io.stdout, 'unauthorized', 'unknown extension')
    return 1
  }

  const token = await io.readToken()
  const pipe = token ? await connectWithRetry(io) : null
  if (!token || !pipe) {
    io.log(token ? 'Hoot did not answer on the pipe' : 'no bridge token: Hoot has not started yet')
    writeError(io.stdout, 'app_unavailable', 'Hoot is not running')
    return 0
  }

  const auth: BridgeAuth = { type: 'bridge.auth', token, origin: origin ?? '' }
  pipe.write(encodeFrame(auth))

  return new Promise<number>((resolve) => {
    let done = false
    const finish = (code: number): void => {
      if (done) return
      done = true
      io.stdin.unpipe(pipe)
      pipe.unpipe(io.stdout)
      pipe.destroy()
      resolve(code)
    }
    io.stdin.pipe(pipe)
    pipe.pipe(io.stdout, { end: false })
    io.stdin.once('end', () => finish(0))
    io.stdin.once('close', () => finish(0))
    pipe.once('close', () => finish(0))
    pipe.once('error', (e: NodeJS.ErrnoException) => {
      // The app quitting resets the pipe; that's a normal end, not a failure.
      const closedByApp = e.code === 'ECONNRESET' || e.code === 'EPIPE'
      io.log(closedByApp ? 'Hoot closed the connection' : `pipe error: ${e.message}`)
      finish(closedByApp ? 0 : 1)
    })
  })
}
