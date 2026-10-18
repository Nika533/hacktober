import type { InvokeChannel, InvokeResult } from '@hoot/core'
import type { InvokeArgs } from '@hoot/core/schemas'
import type { ChatService } from './service'

export type ChatChannel = Extract<
  InvokeChannel,
  `chat:${string}` | `sessions:${string}` | `attachments:${string}`
>

export type ChatHandlers = {
  [C in ChatChannel]: (...args: InvokeArgs<C>) => Promise<InvokeResult<C>>
}

/**
 * Handlers for every chat, sessions and attachments channel. d1 registers
 * them once, the same way as the Lens handlers:
 *
 *   for (const [channel, fn] of Object.entries(createChatHandlers(chat)))
 *     handleInvoke(channel, (_sender, ...args) => fn(...args))
 */
export function createChatHandlers(chat: ChatService): ChatHandlers {
  return {
    'chat:send': (payload) => chat.send(payload),
    'chat:stop': () => chat.stop(),
    'chat:regenerate': () => chat.regenerate(),
    'chat:new': () => chat.newChat(),
    'sessions:open': (id) => chat.openSession(id),
    'sessions:rename': (id, title) => chat.renameSession(id, title),
    'sessions:delete': (id) => chat.deleteSession(id),
    'sessions:undoDelete': (id) => chat.undoDelete(id),
    'sessions:clearAll': () => chat.clearAll(),
    'sessions:search': (query) => chat.search(query),
    'attachments:open': (id) => chat.openAttachment(id),
    'attachments:remove': (id) => chat.removeAttachment(id)
  }
}
