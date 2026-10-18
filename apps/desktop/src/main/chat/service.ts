import { randomUUID } from 'node:crypto'
import {
  QUICK_ACTIONS,
  SYSTEM_PROMPT,
  buildMessages,
  clipboardTextBlock,
  titleFrom,
  type AiErrorCode,
  type ExplainMoreMessage,
  type Message,
  type SendPayload,
  type Session,
  type SessionMeta
} from '@hoot/core'
import { isAbortError, mapAiError, type AiProvider } from '../ai'
import type { Logger } from '../log'
import type { Broadcaster } from '../store/broadcast'
import type { Persistence } from '../store/persistence'
import type { Store } from '../store/store'
import type { DebouncedWriter } from '../store/writer'

/** What the buddy (d1) shows while a stream runs. */
export type ChatActivity = 'thinking' | 'talking' | 'done' | 'stopped' | 'error'

export interface ChatDeps {
  store: Store
  broadcaster: Broadcaster
  persistence: Persistence
  writer: DebouncedWriter
  /** Null when no Claude key is configured (the answer then shows "Add your key"). */
  getProvider(): Promise<AiProvider | null>
  log: Logger
  /** Armed clipboard text from the clipboard chip (d1); returned once, then cleared. */
  takeClipboardSelection?(): string | null
  /**
   * Runs right before a send composes its message: the live capture overlay
   * attaches a fresh full-screen frame to `pendingAttachments` here and
   * returns a note for the model (appended to what's sent, never shown).
   */
  beforeSend?(): Promise<string | null | void>
  /** Stream lifecycle, for owl moods and `answerReady` (d1 maps it onto the buddy slice). */
  onActivity?(activity: ChatActivity): void
  /** Opens a saved attachment (shell.openPath in production). */
  openPath?(path: string): Promise<void>
  now?(): number
  newId?(): string
  /** Undo window for deleting a session */
  deleteUndoMs?: number
  /** How often a streaming answer is saved, so a crash keeps the partial text */
  checkpointMs?: number
}

export interface ChatService {
  send(payload: SendPayload): Promise<void>
  stop(): Promise<void>
  regenerate(): Promise<void>
  newChat(): Promise<void>
  openSession(id: string): Promise<void>
  renameSession(id: string, title: string): Promise<void>
  deleteSession(id: string): Promise<void>
  undoDelete(id: string): Promise<void>
  clearAll(): Promise<void>
  search(query: string): Promise<SessionMeta[]>
  openAttachment(id: string): Promise<void>
  removeAttachment(id: string): Promise<void>
  /** "Explain more" from Lens: show `text`, send `sentText`, start right away. */
  startExplain(message: ExplainMoreMessage): Promise<void>
  /** Finish pending deletes and save everything; call before quit. */
  flush(): Promise<void>
}

const MAX_TOKENS = 8192
const DEFAULT_UNDO_MS = 5000
const DEFAULT_CHECKPOINT_MS = 500

interface ActiveStream {
  sessionId: string
  messageId: string
  abort: AbortController
  /** True once the session was deleted: the stream must not write anything back. */
  discarded: boolean
  /** Settles when the stream has finished and written its final state. */
  done: Promise<void>
}

const metaOf = (s: Session): SessionMeta => ({
  id: s.id,
  title: s.title,
  createdAt: s.createdAt,
  updatedAt: s.updatedAt,
  messageCount: s.messages.length
})

/**
 * Chat and sessions (C, F-C1). Slices are immutable: every change builds a
 * new Session and writes it to the store. Streaming text goes out on
 * `chat:delta` before the store's batched patch that contains it, so
 * renderers never double-count (AGENTS.md invariant).
 */
export function createChatService(deps: ChatDeps): ChatService {
  const now = deps.now ?? Date.now
  const newId = deps.newId ?? randomUUID
  const undoMs = deps.deleteUndoMs ?? DEFAULT_UNDO_MS
  const checkpointMs = deps.checkpointMs ?? DEFAULT_CHECKPOINT_MS
  const { store, broadcaster, persistence, writer, log } = deps

  /** Sessions touched this run, so a non-persisted session can still be reopened. */
  const loaded = new Map<string, Session>()
  let active: ActiveStream | null = null
  /** A send is awaiting `beforeSend` (it sets `active` right after). */
  let preparing = false
  let pendingDelete: {
    meta: SessionMeta
    session: Session | null
    timer: ReturnType<typeof setTimeout>
  } | null = null

  const current = (): Session | null => store.get('chat').session
  /** Deleted (or pending delete) sessions are never written again. */
  const deleted = new Set<string>()

  const saveSession = (s: Session): void => {
    if (deleted.has(s.id)) return
    writer.schedule(`session:${s.id}`, () => persistence.saveSession(s))
  }
  /** The writer keeps the last write per key, so this cancels a pending save. */
  const cancelSave = (id: string): void => writer.schedule(`session:${id}`, async () => {})

  const upsertMeta = (s: Session): void => {
    const list = store.get('sessions').list.filter((m) => m.id !== s.id)
    list.unshift(metaOf(s))
    list.sort((a, b) => b.updatedAt - a.updatedAt)
    store.update('sessions', { list })
  }

  /** Write a session everywhere it lives: the cache, the chat slice if active, disk. */
  const commit = (s: Session, opts: { meta?: boolean; persist?: boolean } = {}): void => {
    loaded.set(s.id, s)
    if (current()?.id === s.id) store.update('chat', { session: s })
    if (opts.meta) upsertMeta(s)
    if (opts.persist) saveSession(s)
  }

  const sessionById = async (id: string): Promise<Session | null> => {
    if (current()?.id === id) return current()
    const cached = loaded.get(id)
    if (cached) return cached
    const fromDisk = await persistence.loadSession(id)
    if (fromDisk) loaded.set(id, fromDisk)
    return fromDisk
  }

  const withMessage = (s: Session, id: string, update: (m: Message) => Message): Session => ({
    ...s,
    messages: s.messages.map((m) => (m.id === id ? update(m) : m))
  })

  async function readImages(s: Session): Promise<Map<string, string>> {
    const out = new Map<string, string>()
    const ids = new Set(s.messages.flatMap((m) => m.attachmentIds))
    await Promise.all(
      [...ids].map(async (id) => {
        const png = await persistence.readAttachment(id)
        if (png) out.set(id, Buffer.from(png).toString('base64'))
      })
    )
    return out
  }

  /** Stream an answer into the (already added) assistant message. */
  async function runStream(stream: ActiveStream, base: Session): Promise<void> {
    let text = ''
    let lastCheckpoint = now()
    // Always build on the newest version of the session (it may have been
    // renamed, or gained messages), changing only this stream's message.
    const latest = (): Session => loaded.get(stream.sessionId) ?? base

    const finish = (status: Message['status'], error?: AiErrorCode): void => {
      if (active === stream) {
        active = null
        store.update('chat', { stream: null })
      }
      if (stream.discarded) return
      const session = withMessage(latest(), stream.messageId, (m) => ({
        ...m,
        text,
        status,
        ...(error ? { error } : {})
      }))
      commit({ ...session, updatedAt: now() }, { meta: true, persist: true })
      deps.onActivity?.(status === 'done' ? 'done' : status === 'stopped' ? 'stopped' : 'error')
    }

    deps.onActivity?.('thinking')
    try {
      const provider = await deps.getProvider()
      if (stream.abort.signal.aborted) return finish('stopped')
      if (!provider) return finish('error', 'no_key')
      const images = await readImages(latest())
      if (stream.abort.signal.aborted) return finish('stopped')
      const snapshot = latest()
      const messages = buildMessages(
        { ...snapshot, messages: snapshot.messages.filter((m) => m.id !== stream.messageId) },
        (id) => ({ base64: images.get(id) ?? '', mediaType: 'image/png' })
      )
      let first = true
      await provider.stream(
        {
          model: store.get('settings').settings.model,
          system: SYSTEM_PROMPT,
          messages,
          maxTokens: MAX_TOKENS,
          signal: stream.abort.signal
        },
        (delta) => {
          if (stream.discarded || active !== stream) return
          text += delta
          if (first) {
            first = false
            deps.onActivity?.('talking')
          }
          // Delta first, then the store change that contains it.
          broadcaster.delta({ sessionId: stream.sessionId, messageId: stream.messageId, delta })
          const session = withMessage(latest(), stream.messageId, (m) => ({ ...m, text }))
          commit(session)
          if (now() - lastCheckpoint >= checkpointMs) {
            lastCheckpoint = now()
            saveSession(session)
          }
        }
      )
      finish(stream.abort.signal.aborted ? 'stopped' : 'done')
    } catch (e) {
      if (stream.abort.signal.aborted || isAbortError(e)) return finish('stopped')
      log.warn(`chat stream failed: ${e instanceof Error ? e.message : String(e)}`)
      finish('error', mapAiError(e))
    }
  }

  /** Append the user turn (if any) and an empty assistant turn, then stream. */
  function start(session: Session, userMessage: Message | null): void {
    const assistant: Message = {
      id: newId(),
      role: 'assistant',
      text: '',
      attachmentIds: [],
      createdAt: now(),
      status: 'streaming'
    }
    let next: Session = {
      ...session,
      messages: [...session.messages, ...(userMessage ? [userMessage] : []), assistant],
      updatedAt: now()
    }
    if (next.title === 'New chat' && userMessage)
      next = { ...next, title: titleFrom(userMessage.text) }

    // The abort controller exists before any await, so Stop always works.
    const stream: ActiveStream = {
      sessionId: next.id,
      messageId: assistant.id,
      abort: new AbortController(),
      discarded: false,
      done: Promise.resolve()
    }
    active = stream
    loaded.set(next.id, next)
    store.update('chat', { session: next, stream: { sessionId: next.id, messageId: assistant.id } })
    upsertMeta(next)
    saveSession(next)
    stream.done = runStream(stream, next)
  }

  function freshSession(): Session {
    const t = now()
    return {
      id: newId(),
      title: 'New chat',
      createdAt: t,
      updatedAt: t,
      messages: [],
      attachments: {}
    }
  }

  function sendInternal(display: string, sent: string | undefined): void {
    if (active) return
    const chat = store.get('chat')
    const session = chat.session ?? freshSession()
    const attachments = { ...session.attachments }
    for (const a of chat.pendingAttachments) attachments[a.id] = a
    const user: Message = {
      id: newId(),
      role: 'user',
      text: display,
      ...(sent !== undefined && sent !== display ? { sentText: sent } : {}),
      attachmentIds: chat.pendingAttachments.map((a) => a.id),
      createdAt: now(),
      status: 'done'
    }
    store.update('chat', { pendingAttachments: [], clipboardHint: null })
    start({ ...session, attachments }, user)
  }

  async function hardDelete(id: string, session: Session | null): Promise<void> {
    await persistence.deleteSession(id)
    for (const attachmentId of Object.keys(session?.attachments ?? {})) {
      await persistence.deleteAttachment(attachmentId)
    }
    loaded.delete(id)
  }

  async function finalizePendingDelete(): Promise<void> {
    if (!pendingDelete) return
    const { meta, session, timer } = pendingDelete
    clearTimeout(timer)
    pendingDelete = null
    store.update('sessions', { pendingDelete: null })
    await hardDelete(meta.id, session)
  }

  return {
    async send(payload) {
      // One stream at a time, and one send being prepared: a double click must
      // not grab a second frame that would be left pending.
      if (active || preparing) return
      preparing = true
      let note: string | null = null
      try {
        note = (await deps.beforeSend?.()) ?? null
      } catch (e) {
        log.warn(`chat: beforeSend failed: ${e instanceof Error ? e.message : String(e)}`)
      } finally {
        preparing = false
      }
      const settings = store.get('settings').settings
      let display = payload.text?.trim() ?? ''
      let sent: string | undefined
      if (payload.quickAction) {
        const action = QUICK_ACTIONS[payload.quickAction]
        sent = action.prompt({ translateTo: settings.translateTo })
        if (!display) display = action.label
        else sent = `${sent}\n\n${display}`
      }
      const clip = deps.takeClipboardSelection?.() ?? null
      if (clip) {
        const ask = sent ?? (display || 'Explain this briefly.')
        sent = `${clipboardTextBlock(clip)}\n\n${ask}`
        if (!display) display = 'Explain this briefly.'
      }
      if (note) sent = `${sent ?? display}\n\n${note}`
      sendInternal(display, sent)
    },

    async stop() {
      active?.abort.abort()
    },

    async regenerate() {
      const session = current()
      if (active || !session) return
      const lastUser = session.messages.findLastIndex((m) => m.role === 'user')
      if (lastUser < 0) return
      start({ ...session, messages: session.messages.slice(0, lastUser + 1) }, null)
    },

    async newChat() {
      const dropped = store.get('chat').pendingAttachments
      store.update('chat', { session: null, pendingAttachments: [], clipboardHint: null })
      // Unsent captures belong to no chat: their files go too.
      for (const a of dropped) {
        void persistence
          .deleteAttachment(a.id)
          .catch((e: unknown) => log.warn(`chat: dropping ${a.id} failed: ${String(e)}`))
      }
    },

    async openSession(id) {
      const session = await sessionById(id)
      if (!session) throw new Error(`session ${id} not found`)
      store.update('chat', { session })
    },

    async renameSession(id, title) {
      const session = await sessionById(id)
      if (!session) throw new Error(`session ${id} not found`)
      commit({ ...session, title: title.trim(), updatedAt: now() }, { meta: true, persist: true })
    },

    async deleteSession(id) {
      await finalizePendingDelete()
      const meta = store.get('sessions').list.find((m) => m.id === id)
      if (!meta) return
      if (active?.sessionId === id) {
        active.discarded = true
        active.abort.abort()
      }
      deleted.add(id)
      cancelSave(id)
      const session = loaded.get(id) ?? (current()?.id === id ? current() : null)
      if (current()?.id === id) store.update('chat', { session: null })
      store.update('sessions', {
        list: store.get('sessions').list.filter((m) => m.id !== id),
        pendingDelete: id
      })
      pendingDelete = {
        meta,
        session,
        timer: setTimeout(() => {
          void finalizePendingDelete().catch((e: unknown) =>
            log.error(`delete failed: ${String(e)}`)
          )
        }, undoMs)
      }
    },

    async undoDelete(id) {
      if (pendingDelete?.meta.id !== id) return
      const { meta, session, timer } = pendingDelete
      clearTimeout(timer)
      pendingDelete = null
      deleted.delete(id)
      if (session) saveSession(session)
      const list = [...store.get('sessions').list, meta].sort((a, b) => b.updatedAt - a.updatedAt)
      store.update('sessions', { list, pendingDelete: null })
    },

    async clearAll() {
      if (active) {
        active.discarded = true
        active.abort.abort()
      }
      if (pendingDelete) clearTimeout(pendingDelete.timer)
      pendingDelete = null
      for (const id of loaded.keys()) {
        deleted.add(id)
        cancelSave(id)
      }
      loaded.clear()
      store.update('chat', { session: null, stream: null, pendingAttachments: [] })
      store.update('sessions', { list: [], pendingDelete: null })
      await persistence.clearSessions()
    },

    async search(query) {
      const q = query.trim().toLowerCase()
      const list = store.get('sessions').list
      return q ? list.filter((m) => m.title.toLowerCase().includes(q)) : list
    },

    async openAttachment(id) {
      const known =
        Object.hasOwn(current()?.attachments ?? {}, id) ||
        store.get('chat').pendingAttachments.some((a) => a.id === id)
      if (!known) throw new Error('unknown attachment')
      await deps.openPath?.(persistence.attachmentPath(id))
    },

    async removeAttachment(id) {
      const pending = store.get('chat').pendingAttachments
      if (!pending.some((a) => a.id === id)) return
      store.update('chat', { pendingAttachments: pending.filter((a) => a.id !== id) })
      await persistence.deleteAttachment(id)
    },

    async startExplain(message) {
      const running = active
      if (running) {
        running.abort.abort()
        await running.done
      }
      sendInternal(message.text, message.sentText)
    },

    async flush() {
      await finalizePendingDelete()
      const session = current()
      if (session) saveSession(session)
      await writer.flush()
    }
  }
}
