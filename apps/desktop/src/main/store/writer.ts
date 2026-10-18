export interface DebouncedWriter {
  /** Last fn per key wins. */
  schedule(key: string, fn: () => Promise<void>): void
  /** Runs everything pending now and awaits it, plus any write already running. */
  flush(): Promise<void>
  pending(): number
}

/**
 * Coalesces debounced writes. A rejected fn goes to `onError`, never out of
 * the timer; `flush()` awaits all pending and running work (used on quit).
 * Writes to one key run one at a time, in order.
 */
export function createDebouncedWriter(opts: {
  delayMs?: number
  onError(e: unknown, key: string): void
}): DebouncedWriter {
  const delayMs = opts.delayMs ?? 300
  const pending = new Map<
    string,
    { fn: () => Promise<void>; timer: ReturnType<typeof setTimeout> }
  >()
  /** The latest write started per key; the next one for that key waits for it. */
  const running = new Map<string, Promise<void>>()

  const run = (key: string): Promise<void> => {
    const entry = pending.get(key)
    if (!entry) return running.get(key) ?? Promise.resolve()
    pending.delete(key)
    clearTimeout(entry.timer)
    const write = async (): Promise<void> => {
      try {
        await entry.fn()
      } catch (e) {
        opts.onError(e, key)
      }
    }
    // Overlapping atomic writes (temp + rename) could land an older
    // snapshot last, so a key's writes are chained.
    const next = (running.get(key) ?? Promise.resolve()).then(write, write)
    running.set(key, next)
    const settle = (): void => {
      if (running.get(key) === next) running.delete(key)
    }
    next.then(settle, settle)
    return next
  }

  return {
    schedule(key, fn) {
      const prev = pending.get(key)
      if (prev) clearTimeout(prev.timer)
      pending.set(key, {
        fn,
        timer: setTimeout(() => void run(key), delayMs)
      })
    },
    async flush() {
      // A write whose timer already fired is still running; quit must wait for it too.
      const keys = new Set([...pending.keys(), ...running.keys()])
      await Promise.all([...keys].map(run))
    },
    pending: () => pending.size
  }
}
