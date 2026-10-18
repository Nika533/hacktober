import {
  DEFAULT_SETTINGS,
  type HootApi,
  type LensBackend,
  type LensCallOptions,
  type LensSettings,
  type Unsubscribe
} from '@hoot/core'

/** The Lens settings the window already mirrors (its `settings` slice). */
export interface LensSettingsFeed {
  current(): LensSettings | null
  subscribe(cb: (lens: LensSettings) => void): Unsubscribe
}

let seq = 0
const newReqId = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `r${Date.now().toString(36)}${(seq++).toString(36)}`

/**
 * The Reader's `LensBackend`: the same calls the extension makes over the
 * bridge, through `window.hoot`. Each assess/rewrite gets its own reqId, and
 * aborting the signal sends `lens.cancel` for it, as the extension does.
 */
export function createIpcLensBackend(
  hoot: Pick<HootApi, 'lens' | 'settings'>,
  feed: LensSettingsFeed
): LensBackend {
  const cancellable = async <T>(
    opts: LensCallOptions | undefined,
    call: (reqId: string) => Promise<T>
  ): Promise<T> => {
    const reqId = newReqId()
    const signal = opts?.signal
    const cancel = (): void => void hoot.lens.cancel(reqId).catch(() => undefined)
    signal?.addEventListener('abort', cancel, { once: true })
    try {
      const pending = call(reqId)
      if (signal?.aborted) cancel()
      return await pending
    } finally {
      signal?.removeEventListener('abort', cancel)
    }
  }

  return {
    assess: (ctx, opts) => cancellable(opts, (id) => hoot.lens.assess(id, ctx)),
    rewrite: (req, opts) => cancellable(opts, (id) => hoot.lens.rewrite(id, req)),
    feedback: (event) => hoot.lens.feedback(event),
    explainMore: (ctx) => hoot.lens.explain(ctx),
    getProfile: () => hoot.lens.snapshot(),
    getSettings: async () => feed.current() ?? DEFAULT_SETTINGS.lens,
    patchSettings: async (patch) => {
      await hoot.settings.update({ lens: patch })
      // Main answers through the settings slice; wait for that echo.
      return new Promise<LensSettings>((resolve) => {
        const timer = setTimeout(() => {
          off()
          resolve(feed.current() ?? DEFAULT_SETTINGS.lens)
        }, 1000)
        const off = feed.subscribe((lens) => {
          clearTimeout(timer)
          off()
          resolve(lens)
        })
      })
    },
    onSettings: (cb) => feed.subscribe(cb),
    onProfile: (cb) => hoot.lens.onProfile(cb)
  }
}

/** A feed the window pushes its mirrored `settings.lens` into. */
export function createLensSettingsFeed(): LensSettingsFeed & { push(lens: LensSettings): void } {
  let latest: LensSettings | null = null
  const listeners = new Set<(lens: LensSettings) => void>()
  return {
    current: () => latest,
    subscribe: (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    push: (lens) => {
      if (lens === latest) return
      latest = lens
      for (const cb of [...listeners]) cb(lens)
    }
  }
}
