import type { ChatDelta, SliceName, StatePatch, StateSlices } from '@hoot/core'

/**
 * Pure helpers behind `useHootState`: a window's local mirror of the slices
 * it subscribed to. Patches replace whole slices; deltas append to the
 * streaming message. Main guarantees a patch never contains a delta it
 * hasn't broadcast, so applying both never double-counts.
 */

export type Mirror<K extends SliceName> = Partial<Pick<StateSlices, K>>

/** Merges a patch, keeping only the slices this window asked for. */
export function applyPatch<K extends SliceName>(
  state: Mirror<K>,
  patch: StatePatch,
  slices: readonly K[]
): Mirror<K> {
  let next: Mirror<K> | null = null
  for (const k of slices) {
    if (k in patch) {
      next ??= { ...state }
      ;(next as StatePatch)[k] = patch[k] as never
    }
  }
  return next ?? state
}

/** Appends a streamed chunk to its message, if that message is on screen. */
export function applyDelta<K extends SliceName>(state: Mirror<K>, d: ChatDelta): Mirror<K> {
  const chat = (state as StatePatch).chat
  const session = chat?.session
  if (!chat || !session || session.id !== d.sessionId) return state
  const i = session.messages.findIndex((m) => m.id === d.messageId)
  const msg = session.messages[i]
  if (!msg) return state
  const messages = session.messages.slice()
  messages[i] = { ...msg, text: msg.text + d.delta }
  return { ...state, chat: { ...chat, session: { ...session, messages } } }
}
