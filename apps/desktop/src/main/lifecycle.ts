import type { Unsubscribe } from '@hoot/core'
import type { Logger } from './log'

export interface FlushRegistry {
  add(name: string, fn: () => Promise<void>): Unsubscribe
  /**
   * Runs all flushers in parallel, each capped by `timeoutMs` (default
   * 2000 ms). Errors are collected into `failed`, never thrown.
   */
  runAll(timeoutMs?: number): Promise<{ failed: string[] }>
}

export function createFlushRegistry(log: Logger): FlushRegistry {
  const flushers = new Map<string, () => Promise<void>>()

  return {
    add(name, fn) {
      flushers.set(name, fn)
      return () => flushers.delete(name)
    },
    async runAll(timeoutMs = 2000) {
      const failed: string[] = []
      await Promise.all(
        [...flushers.entries()].map(async ([name, fn]) => {
          let timer: ReturnType<typeof setTimeout> | undefined
          try {
            const timeout = new Promise<never>((_, reject) => {
              timer = setTimeout(() => reject(new Error('flush timed out')), timeoutMs)
            })
            await Promise.race([fn(), timeout])
          } catch (err) {
            failed.push(name)
            log.error(`flush "${name}" failed: ${String(err)}`)
          } finally {
            clearTimeout(timer)
          }
        })
      )
      return { failed }
    }
  }
}

/**
 * Quit coordination (D1-00 pattern): on `before-quit`, veto the quit, run the
 * registry, then quit again. The `flushed` guard keeps the second quit from
 * re-entering the veto.
 */
export function installQuitFlow(app: Electron.App, flush: FlushRegistry, log: Logger): void {
  let flushed = false
  app.on('before-quit', (event) => {
    if (flushed) return
    event.preventDefault()
    void flush
      .runAll()
      .then(({ failed }) => {
        if (failed.length > 0) log.warn(`quit flush incomplete: ${failed.join(', ')}`)
      })
      .finally(() => {
        flushed = true
        app.quit()
      })
  })
}
