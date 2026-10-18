import type { SendPayload } from '@hoot/core'
import type { AgentsService } from './service'

/** The part of a WebContents the handlers need. */
export interface Sender {
  id: number
}

/**
 * Handlers for the `agents:*` channels. Agent windows are known by their
 * sender, so every handler takes it first (`registerSenderHandlerMap`).
 */
export function createAgentsHandlers(agents: AgentsService): {
  invoke: {
    'agents:create': (sender: Sender) => Promise<boolean>
    'agents:send': (sender: Sender, payload: SendPayload) => Promise<void>
    'agents:stop': (sender: Sender) => Promise<void>
    'agents:regenerate': (sender: Sender) => Promise<void>
    'agents:minimize': (sender: Sender) => Promise<void>
    'agents:restore': (sender: Sender) => Promise<void>
    'agents:close': (sender: Sender) => Promise<void>
  }
  send: {
    'agents:dragStart': (sender: Sender) => void
    'agents:dragMove': (sender: Sender) => void
    'agents:dragEnd': (sender: Sender) => void
  }
} {
  return {
    invoke: {
      'agents:create': () => agents.create(),
      'agents:send': (s, payload) => agents.send(s.id, payload),
      'agents:stop': (s) => agents.stop(s.id),
      'agents:regenerate': (s) => agents.regenerate(s.id),
      'agents:minimize': (s) => agents.minimize(s.id),
      'agents:restore': (s) => agents.restore(s.id),
      'agents:close': (s) => agents.close(s.id)
    },
    send: {
      'agents:dragStart': (s) => agents.dragStart(s.id),
      'agents:dragMove': (s) => agents.dragMove(s.id),
      'agents:dragEnd': (s) => agents.dragEnd(s.id)
    }
  }
}
