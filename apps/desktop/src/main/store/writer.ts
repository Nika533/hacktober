export interface DebouncedWriter {
  /** Last fn per key wins. */
  schedule(key: string, fn: () => Promise<void>): void
  /** Runs everything pending now and awaits it. */
  flush(): Promise<void>
  pending(): number
}

/**
 * Coalesces debounced writes. A rejected fn goes to `onError`, never out of
 * the timer; `flush()` awaits all pending work (used on quit).
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

  const run = async (key: string): Promise<void> => {
    const entry = pending.get(key)
    if (!entry) return
    pending.delete(key)
    clearTimeout(entry.timer)
    try {
      await entry.fn()
    } catch (e) {
      opts.onError(e, key)
    }
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
      await Promise.all([...pending.keys()].map(run))
    },
    pending: () => pending.size
  }
}
