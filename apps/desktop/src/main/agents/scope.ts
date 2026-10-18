import type { SliceName, StatePatch, StateSlices, Unsubscribe } from '@hoot/core'
import type { Store } from '../store/store'

type Chat = StateSlices['chat']

const CHAT_ONLY: ReadonlySet<SliceName> = new Set(['chat'])

export const EMPTY_CHAT: Chat = {
  session: null,
  stream: null,
  pendingAttachments: [],
  clipboardHint: null
}

/**
 * The store an agent's chat service runs on: a `chat` slice of its own, and
 * the app's store for everything else (settings, the session list, so its
 * chats show in Studio). `onChat` sees every change to that chat, right away;
 * `onChange` listeners get them coalesced in a microtask, like the app's store.
 */
export function createAgentStore(app: Store, onChat: (chat: Chat) => void): Store {
  let chat = EMPTY_CHAT
  const listeners = new Set<(changed: ReadonlySet<SliceName>) => void>()
  let flushing = false

  const setChat = (next: Chat): void => {
    if (Object.is(chat, next)) return
    chat = next
    onChat(chat)
    if (flushing) return
    flushing = true
    queueMicrotask(() => {
      flushing = false
      for (const cb of [...listeners]) cb(CHAT_ONLY)
    })
  }

  const store: Store = {
    get: <K extends SliceName>(name: K): StateSlices[K] =>
      name === 'chat' ? (chat as StateSlices[K]) : app.get(name),
    set<K extends SliceName>(name: K, next: StateSlices[K]): void {
      if (name === 'chat') setChat(next as Chat)
      else app.set(name, next)
    },
    update<K extends SliceName>(name: K, patch: Partial<StateSlices[K]>): void {
      if (name === 'chat') setChat({ ...chat, ...(patch as Partial<Chat>) })
      else app.update(name, patch)
    },
    snapshot(slices: readonly SliceName[]): StatePatch {
      const patch = app.snapshot(slices.filter((s) => s !== 'chat'))
      return slices.includes('chat') ? { ...patch, chat } : patch
    },
    onChange(cb: (changed: ReadonlySet<SliceName>) => void): Unsubscribe {
      listeners.add(cb)
      return () => listeners.delete(cb)
    }
  }
  return store
}
