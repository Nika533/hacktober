import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { join } from 'node:path'
import type { Unsubscribe } from '@hoot/core'
import type { Logger } from '../log'
import { HELPER_SCRIPT, HELPER_TYPES, HELPER_TYPES_ENV, encodeCommand } from './script'

/** One JSON line from the helper. */
export type Reply = Record<string, unknown>

/** The part of a child process the transport uses (faked in tests). */
export type HelperChild = Pick<
  ChildProcessWithoutNullStreams,
  'stdin' | 'stdout' | 'stderr' | 'kill' | 'on'
>

export interface Helper {
  /** One command; its reply, or null on failure, timeout, exit or dispose. Spawns the helper if needed. */
  call(cmd: string, args?: Record<string, unknown>, timeoutMs?: number): Promise<Reply | null>
  /** Unsolicited lines: `{ ready: true }` after every (re)start, and `{ event, ... }`. */
  listen(listener: (msg: Reply) => void): Unsubscribe
  running(): boolean
  /** Spawn now unless it's running (or given up on). */
  start(): void
  dispose(): void
}

export interface HelperOptions {
  log: Logger
  spawn?: () => HelperChild
  readyTimeoutMs?: number
  /** Crashes in a row before giving up for the session. */
  maxFailures?: number
  /** First restart delay; doubles with each crash in a row. */
  backoffMs?: number
  /** After a timeout, how long a silent helper gets before it's killed as hung. */
  hungMs?: number
}

export const DEFAULT_TIMEOUT_MS = 1500

const POWERSHELL = process.env['SystemRoot']
  ? join(process.env['SystemRoot'], 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
  : 'powershell.exe'

const spawnPowerShell = (): HelperChild =>
  spawn(
    POWERSHELL,
    [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-EncodedCommand',
      encodeCommand(HELPER_SCRIPT)
    ],
    { windowsHide: true, stdio: 'pipe', env: { ...process.env, [HELPER_TYPES_ENV]: HELPER_TYPES } }
  )

const isRecord = (v: unknown): v is Reply =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

type Timer = ReturnType<typeof setTimeout>

interface Pending {
  cmd: string
  timeoutMs: number
  resolve(reply: Reply | null): void
  timer?: Timer
}

/**
 * The persistent helper process and its JSON-lines protocol: lazy spawn,
 * id-matched replies, per-call timeouts, restart with backoff after a crash
 * (and a cap, so a broken environment stops respawning), kill when hung.
 */
export function createHelper(opts: HelperOptions): Helper {
  const {
    log,
    spawn: spawnChild = spawnPowerShell,
    readyTimeoutMs = 15_000,
    maxFailures = 4,
    backoffMs = 1_000,
    hungMs = 3_000
  } = opts
  const pending = new Map<number, Pending>()
  const listeners = new Set<(msg: Reply) => void>()
  let child: HelperChild | null = null
  let ready = false
  let nextId = 1
  let failures = 0
  let disposed = false
  let broken = false
  let readyTimer: Timer | undefined
  let restartTimer: Timer | undefined
  let hungTimer: Timer | undefined

  const later = (ms: number, fn: () => void): Timer => {
    const t = setTimeout(fn, ms)
    t.unref?.()
    return t
  }

  const settle = (id: number, reply: Reply | null): void => {
    const p = pending.get(id)
    if (!p) return
    pending.delete(id)
    clearTimeout(p.timer)
    p.resolve(reply)
  }

  const arm = (id: number, p: Pending): void => {
    p.timer = later(p.timeoutMs, () => {
      log.warn(`textAccess: ${p.cmd} timed out after ${p.timeoutMs} ms`)
      settle(id, null)
      const proc = child
      hungTimer ??= later(hungMs, () => {
        hungTimer = undefined
        if (!proc || child !== proc) return
        log.warn('textAccess: helper hung, killing it')
        gone(proc, false)
        proc.kill()
      })
    })
  }

  const countFailure = (): void => {
    failures += 1
    if (failures >= maxFailures) {
      broken = true
      log.warn('textAccess: UI Automation helper unavailable; text reads return null this session')
      return
    }
    restartTimer = later(backoffMs * 2 ** (failures - 1), () => {
      restartTimer = undefined
      launch()
    })
  }

  /** The process ended (or was given up on): fail what's pending, maybe restart. */
  function gone(proc: HelperChild, crashed: boolean): void {
    if (child !== proc) return
    child = null
    ready = false
    clearTimeout(readyTimer)
    clearTimeout(hungTimer)
    hungTimer = undefined
    for (const id of [...pending.keys()]) settle(id, null)
    if (crashed && !disposed) countFailure()
  }

  const onLine = (line: string, started: number): void => {
    let msg: unknown
    try {
      msg = JSON.parse(line)
    } catch {
      return
    }
    if (!isRecord(msg)) return
    if (msg['ready'] === true) {
      ready = true
      clearTimeout(readyTimer)
      log.info(`textAccess: helper ready in ${Date.now() - started} ms`)
      for (const [id, p] of pending) arm(id, p)
    }
    if (typeof msg['id'] !== 'number') {
      for (const listener of [...listeners]) {
        try {
          listener(msg)
        } catch (e) {
          log.warn(`textAccess: helper listener threw: ${String(e)}`)
        }
      }
      return
    }
    clearTimeout(hungTimer)
    hungTimer = undefined
    const p = pending.get(msg['id'])
    if (!p) return
    if (msg['ok'] === true) {
      failures = 0
      settle(msg['id'], msg)
    } else {
      log.warn(`textAccess: ${p.cmd} failed: ${String(msg['error'])}`)
      settle(msg['id'], null)
    }
  }

  function launch(): HelperChild | null {
    if (child || disposed || broken) return child
    clearTimeout(restartTimer)
    restartTimer = undefined
    const started = Date.now()
    let proc: HelperChild
    try {
      proc = spawnChild()
    } catch (e) {
      log.warn(`textAccess: helper spawn failed: ${String(e)}`)
      countFailure()
      return null
    }
    child = proc
    ready = false
    let buf = ''
    let errLines = 0
    proc.stdin.on('error', () => undefined)
    proc.stdout.setEncoding('utf8')
    proc.stdout.on('data', (chunk: string) => {
      buf += chunk
      for (let nl = buf.indexOf('\n'); nl >= 0; nl = buf.indexOf('\n')) {
        const line = buf.slice(0, nl).trim()
        buf = buf.slice(nl + 1)
        if (line && child === proc) onLine(line, started)
      }
    })
    proc.stderr.setEncoding('utf8')
    proc.stderr.on('data', (chunk: string) => {
      for (const l of chunk.split(/\r?\n/)) {
        if (l.trim() && errLines++ < 5) log.warn(`textAccess helper: ${l.trim()}`)
      }
    })
    proc.on('error', (e) => {
      if (child === proc) log.warn(`textAccess: helper error: ${e.message}`)
      gone(proc, true)
    })
    proc.on('exit', (code) => {
      if (child === proc && !disposed) log.warn(`textAccess: helper exited (${code})`)
      gone(proc, true)
    })
    readyTimer = later(readyTimeoutMs, () => {
      log.warn(`textAccess: helper not ready after ${readyTimeoutMs} ms`)
      gone(proc, true)
      proc.kill()
    })
    return proc
  }

  return {
    call(cmd, args = {}, timeoutMs = DEFAULT_TIMEOUT_MS) {
      const proc = launch()
      if (!proc) return Promise.resolve(null)
      const id = nextId++
      return new Promise((resolve) => {
        const p: Pending = { cmd, timeoutMs, resolve }
        pending.set(id, p)
        if (ready) arm(id, p)
        proc.stdin.write(`${JSON.stringify({ ...args, id, cmd })}\n`)
      })
    },
    listen(listener) {
      listeners.add(listener)
      return () => void listeners.delete(listener)
    },
    running: () => child !== null,
    start() {
      launch()
    },
    dispose() {
      if (disposed) return
      disposed = true
      clearTimeout(restartTimer)
      listeners.clear()
      const proc = child
      if (!proc) return
      gone(proc, false)
      proc.kill()
    }
  }
}
