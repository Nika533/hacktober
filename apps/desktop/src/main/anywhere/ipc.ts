import type { AnywhereAction, AnywhereState } from '@hoot/core'
import type { AnywhereService } from './service'

/** The part of a WebContents the handlers need. */
export interface Sender {
  id: number
}

/**
 * Handlers for the `anywhere:*` channels. Only the bubble window may use
 * them, so they take the sender first. d1 registers them once:
 *
 *   const h = createAnywhereHandlers(ctx.anywhere)
 *   registerSenderHandlerMap(h.invoke)
 *   registerSenderSendMap(h.send)
 */
export function createAnywhereHandlers(anywhere: AnywhereService): {
  invoke: {
    'anywhere:current': (sender: Sender) => Promise<AnywhereState | null>
    'anywhere:act': (sender: Sender, action: AnywhereAction) => Promise<void>
    'anywhere:close': (sender: Sender) => Promise<void>
  }
  send: { 'anywhere:resize': (sender: Sender, height: number) => void }
} {
  return {
    invoke: {
      'anywhere:current': async (s) => anywhere.current(s.id),
      'anywhere:act': (s, action) => anywhere.act(s.id, action),
      'anywhere:close': (s) => anywhere.close(s.id)
    },
    send: { 'anywhere:resize': (s, height) => anywhere.resize(s.id, height) }
  }
}
