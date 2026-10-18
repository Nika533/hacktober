import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createHelper,
  type HelperChild,
  type HelperOptions
} from '../../src/main/textAccess/helper'
import { HELPER_SCRIPT, HELPER_TYPES, encodeCommand } from '../../src/main/textAccess/script'

/** The helper transport (D-text access): JSON lines over a child's stdio. */

class FakeChild extends EventEmitter {
  readonly stdin = new PassThrough()
  readonly stdout = new PassThrough()
  readonly stderr = new PassThrough()
  readonly sent: Array<Record<string, unknown>> = []
  killed = false

  constructor() {
    super()
    this.stdin.setEncoding('utf8')
    this.stdin.on('data', (chunk: string) => {
      for (const line of chunk.split('\n')) if (line) this.sent.push(JSON.parse(line))
    })
  }

  line(msg: unknown): void {
    this.stdout.write(`${typeof msg === 'string' ? msg : JSON.stringify(msg)}\r\n`)
  }

  reply(id: unknown, extra: Record<string, unknown> = {}): void {
    this.line({ id, ok: true, ...extra })
  }

  kill(): boolean {
    this.killed = true
    this.emit('exit', 1)
    return true
  }
}

const flush = (): Promise<void> => new Promise((r) => setImmediate(r))

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type -- test fixture bag
function setup(opts: Partial<HelperOptions> = {}) {
  const children: FakeChild[] = []
  const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
  const helper = createHelper({
    log,
    spawn: () => {
      const c = new FakeChild()
      children.push(c)
      return c as unknown as HelperChild
    },
    ...opts
  })
  const last = (): FakeChild => children.at(-1)!
  return { helper, children, last, log }
}

describe('textAccess helper transport', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('spawns lazily, writes one JSON line per call and matches replies by id', async () => {
    const t = setup()
    expect(t.children).toHaveLength(0)
    expect(t.helper.running()).toBe(false)
    const a = t.helper.call('foreground')
    const b = t.helper.call('textInRect', { x: 1, y: 2, w: 3, h: 4 })
    expect(t.children).toHaveLength(1)
    expect(t.helper.running()).toBe(true)
    await flush()
    expect(t.last().sent).toEqual([
      { id: 1, cmd: 'foreground' },
      { id: 2, cmd: 'textInRect', x: 1, y: 2, w: 3, h: 4 }
    ])
    t.last().line({ ready: true })
    t.last().line('WARNING: not json')
    t.last().reply(2, { items: [] })
    t.last().reply(1, { process: 'notepad', title: 'x' })
    expect(await b).toEqual({ id: 2, ok: true, items: [] })
    expect(await a).toMatchObject({ process: 'notepad' })
  })

  it('reassembles lines split across chunks, multi-byte text included', async () => {
    const t = setup()
    const call = t.helper.call('selection')
    await flush()
    const bytes = Buffer.from(`${JSON.stringify({ id: 1, ok: true, text: 'héllo — 日本' })}\n`)
    t.last().stdout.write(bytes.subarray(0, 25))
    t.last().stdout.write(bytes.subarray(25))
    expect(await call).toMatchObject({ text: 'héllo — 日本' })
  })

  it('a failed command resolves null and is logged; the loop goes on', async () => {
    const t = setup()
    const call = t.helper.call('nope')
    await flush()
    t.last().line({ id: 1, ok: false, error: 'unknown command nope' })
    expect(await call).toBeNull()
    expect(t.log.warn).toHaveBeenCalledWith(expect.stringContaining('unknown command nope'))
  })

  it('times out to null (the clock starts once the helper is ready) and ignores the late reply', async () => {
    const t = setup()
    const call = t.helper.call('selection', {}, 1500)
    await vi.advanceTimersByTimeAsync(5000)
    t.last().line({ ready: true })
    await flush()
    let settled = false
    void call.then(() => (settled = true))
    await vi.advanceTimersByTimeAsync(1400)
    expect(settled).toBe(false)
    await vi.advanceTimersByTimeAsync(200)
    expect(await call).toBeNull()
    t.last().reply(1, { text: 'late' })
    await flush()
    expect(t.log.warn).toHaveBeenCalledWith(expect.stringContaining('selection timed out'))
  })

  it('kills a helper that stays silent after a timeout, and respawns on the next call', async () => {
    const t = setup({ hungMs: 3000 })
    const call = t.helper.call('textInRect', {}, 1000)
    t.last().line({ ready: true })
    await flush()
    await vi.advanceTimersByTimeAsync(1000)
    expect(await call).toBeNull()
    await vi.advanceTimersByTimeAsync(3000)
    expect(t.children[0]!.killed).toBe(true)
    expect(t.helper.running()).toBe(false)
    void t.helper.call('foreground')
    expect(t.children).toHaveLength(2)
  })

  it('event lines go to listeners and never resolve a pending call', async () => {
    const t = setup()
    const seen: unknown[] = []
    t.helper.listen((m) => seen.push(m))
    const call = t.helper.call('selection')
    await flush()
    t.last().line({ ready: true })
    t.last().line({ event: 'click', x: 10, y: 20 })
    await flush()
    expect(seen).toEqual([{ ready: true }, { event: 'click', x: 10, y: 20 }])
    let settled = false
    void call.then(() => (settled = true))
    await flush()
    expect(settled).toBe(false)
    t.last().reply(1, { text: 'a' })
    expect(await call).toMatchObject({ text: 'a' })
  })

  it('an exit fails what is pending and restarts after a backoff', async () => {
    const t = setup({ backoffMs: 1000 })
    const call = t.helper.call('selection')
    t.last().line({ ready: true })
    await flush()
    t.last().emit('exit', 1)
    expect(await call).toBeNull()
    expect(t.helper.running()).toBe(false)
    await vi.advanceTimersByTimeAsync(999)
    expect(t.children).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(t.children).toHaveLength(2)
    expect(t.helper.running()).toBe(true)
  })

  it('gives up after repeated crashes: logged once, no more spawns', async () => {
    const t = setup({ maxFailures: 3, backoffMs: 10 })
    t.helper.start()
    for (let i = 0; i < 3; i++) {
      t.last().stderr.write('Add-Type : Cannot add type.\r\n')
      t.last().emit('exit', 1)
      await vi.advanceTimersByTimeAsync(1000)
    }
    expect(t.children).toHaveLength(3)
    expect(await t.helper.call('foreground')).toBeNull()
    t.helper.start()
    expect(t.children).toHaveLength(3)
    const unavailable = t.log.warn.mock.calls.filter(([m]) => String(m).includes('unavailable'))
    expect(unavailable).toHaveLength(1)
    expect(t.log.warn).toHaveBeenCalledWith(expect.stringContaining('Cannot add type'))
  })

  it('a helper that never says ready is killed and counted as a crash', async () => {
    const t = setup({ readyTimeoutMs: 5000, backoffMs: 100 })
    const call = t.helper.call('foreground')
    await vi.advanceTimersByTimeAsync(5000)
    expect(await call).toBeNull()
    expect(t.children[0]!.killed).toBe(true)
    await vi.advanceTimersByTimeAsync(100)
    expect(t.children).toHaveLength(2)
  })

  it('dispose kills the helper, resolves pending calls and never respawns', async () => {
    const t = setup()
    const call = t.helper.call('selection')
    t.helper.dispose()
    expect(await call).toBeNull()
    expect(t.children[0]!.killed).toBe(true)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(await t.helper.call('foreground')).toBeNull()
    expect(t.children).toHaveLength(1)
  })
})

describe('textAccess helper script', () => {
  it('fits the command line with room to spare and never needs a file on disk', () => {
    expect(encodeCommand(HELPER_SCRIPT).length).toBeLessThan(20_000)
    expect(HELPER_SCRIPT).toContain('$env:HOOT_TEXT_ACCESS_TYPES')
    expect(HELPER_TYPES).toContain('public static class HT')
    expect(Buffer.from(encodeCommand('ab'), 'base64')).toEqual(Buffer.from('ab', 'utf16le'))
  })
})
