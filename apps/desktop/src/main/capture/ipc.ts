import type { InvokeChannel, InvokeResult } from '@hoot/core'
import type { InvokeArgs } from '@hoot/core/schemas'
import type { CaptureService } from './service'

export type CaptureChannel = Extract<InvokeChannel, `capture:${string}`>

export type CaptureHandlers = {
  [C in CaptureChannel]: (...args: InvokeArgs<C>) => Promise<InvokeResult<C>>
}

/**
 * Handlers for every `capture:*` invoke channel. d1 registers them once:
 *
 *   registerHandlerMap(createCaptureHandlers(ctx.capture))
 *
 * The overlay window's `capture:open` / `capture:closed` events are sent by
 * the service itself, to that window only.
 */
export function createCaptureHandlers(capture: CaptureService): CaptureHandlers {
  return {
    'capture:start': (mode) => capture.start(mode),
    'capture:getInit': async () => capture.getInit(),
    'capture:commit': (commit) => capture.commit(commit),
    'capture:cancel': () => capture.cancel(),
    'capture:click': (at) => capture.click(at),
    'capture:minimize': () => capture.minimize()
  }
}
