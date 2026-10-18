import { describe, expect, it } from 'vitest'
import { createFlushRegistry, installQuitFlow, type FlushRegistry } from '../src/main/lifecycle'
import type { Logger } from '../src/main/log'

const silent: Logger = { info: () => {}, warn: () => {}, error: () => {} }

const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

const makeRegistry = (): { registry: FlushRegistry; ran: string[] } => {
  const ran: string[] = []
  return { registry: createFlushRegistry(silent), ran }
}

describe('FlushRegistry', () => {
  it('runs all flushers in parallel and reports no failures', async () => {
    const { registry, ran } = makeRegistry()
    registry.add('a', async () => {
      await delay(60)
      ran.push('a')
    })
    registry.add('b', async () => {
      await delay(60)
      ran.push('b')
    })
    const t0 = Date.now()
    const { failed } = await registry.runAll(500)
    expect(failed).toEqual([])
    expect(ran.sort()).toEqual(['a', 'b'])
    // Parallel: ~60ms total, not ~120ms serial.
    expect(Date.now() - t0).toBeLessThan(110)
  })

  it('a timeout lands in failed and does not throw', async () => {
    const { registry } = makeRegistry()
    registry.add('slow', () => delay(500))
    registry.add('fast', () => Promise.resolve())
    const { failed } = await registry.runAll(20)
    expect(failed).toEqual(['slow'])
  })

  it('a throwing flusher lands in failed, others still run', async () => {
    const { registry, ran } = makeRegistry()
    registry.add('bad', () => Promise.reject(new Error('boom')))
    registry.add('good', async () => {
      ran.push('good')
    })
    const { failed } = await registry.runAll(100)
    expect(failed).toEqual(['bad'])
    expect(ran).toEqual(['good'])
  })

  it('add returns an unsubscribe', async () => {
    const { registry, ran } = makeRegistry()
    const off = registry.add('x', async () => {
      ran.push('x')
    })
    off()
    await registry.runAll(10)
    expect(ran).toEqual([])
  })
})

describe('installQuitFlow', () => {
  class FakeApp {
    quitCalls = 0
    prevented = 0
    private beforeQuit: ((e: { preventDefault(): void }) => void) | null = null

    on(event: string, cb: (e: { preventDefault(): void }) => void): void {
      if (event === 'before-quit') this.beforeQuit = cb
    }

    quit(): void {
      this.quitCalls++
    }

    emitBeforeQuit(): void {
      this.beforeQuit?.({ preventDefault: () => this.prevented++ })
    }
  }

  it('vetoes the first quit, flushes, then quits exactly once more', async () => {
    const app = new FakeApp()
    const { registry, ran } = makeRegistry()
    registry.add('persist', async () => {
      await delay(5)
      ran.push('persist')
    })
    installQuitFlow(app as unknown as Electron.App, registry, silent)

    app.emitBeforeQuit()
    expect(app.quitCalls).toBe(0)
    expect(app.prevented).toBe(1)
    await delay(20)
    expect(ran).toEqual(['persist'])
    expect(app.quitCalls).toBe(1)
  })

  it('does not re-enter the veto on the post-flush quit', async () => {
    const app = new FakeApp()
    const { registry, ran } = makeRegistry()
    registry.add('persist', async () => {
      ran.push('persist')
    })
    installQuitFlow(app as unknown as Electron.App, registry, silent)

    app.emitBeforeQuit()
    await delay(10)
    // A real quit() re-fires before-quit; the guard must not veto or re-flush.
    app.emitBeforeQuit()
    expect(app.quitCalls).toBe(1)
    expect(app.prevented).toBe(1)
    expect(ran).toEqual(['persist'])
  })
})
