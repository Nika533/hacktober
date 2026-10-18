import type { PinsService } from './service'

/** The part of a WebContents the handlers need. */
export interface Sender {
  id: number
}

/**
 * Handlers for the pins channels. Note windows are identified by the
 * sender, so these take it first. d1 registers them once:
 *
 *   const h = createPinsHandlers(pins)
 *   for (const [ch, fn] of Object.entries(h.invoke)) handleInvoke(ch, (sender, ...a) => fn(sender, ...a))
 *   for (const [ch, fn] of Object.entries(h.send)) onSend(ch, (sender, ...a) => fn(sender, ...a))
 */
export function createPinsHandlers(pins: PinsService): {
  invoke: {
    'pins:create': (sender: Sender, messageId: string) => Promise<void>
    'pins:createFromText': (sender: Sender, text: string) => Promise<void>
    'pins:close': (sender: Sender) => Promise<void>
    'pins:openInHoot': (sender: Sender) => Promise<void>
  }
  send: { 'pins:resize': (sender: Sender, height: number) => void }
} {
  return {
    invoke: {
      'pins:create': (_s, messageId) => pins.create(messageId),
      'pins:createFromText': (_s, text) => pins.createFromText(text),
      'pins:close': (s) => pins.closeFrom(s.id),
      'pins:openInHoot': (s) => pins.openInHootFrom(s.id)
    },
    send: { 'pins:resize': (s, height) => pins.resizeFrom(s.id, height) }
  }
}
