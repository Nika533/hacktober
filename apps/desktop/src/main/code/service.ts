import { randomUUID } from 'node:crypto'
import type { Unsubscribe } from '@hoot/core'
import {
  codeNote,
  parseCodeAnswer,
  resolveCodeTags,
  snapshotFiles,
  type CodeActionResult,
  type CodeEdit,
  type CodeFile,
  type CodeLinkStatus,
  type CodeMark,
  type CodeNoteMemory,
  type CodeTag,
  type CodeTagState,
  type CodeWindowInfo
} from '@hoot/core/code'
import type { Logger } from '../log'
import type { Store } from '../store/store'
import type { CodeLinkServer, CodeLinkServerDeps, CodePeer } from './server'

export interface CodeServiceDeps {
  store: Pick<Store, 'get' | 'onChange'>
  log: Logger
  /** The pipe server (tests pass a fake), given the service's hooks. */
  createServer(
    hooks: Required<Pick<CodeLinkServerDeps, 'onChange' | 'onApplied'>>
  ): Pick<CodeLinkServer, 'start' | 'stop' | 'peers'>
  now?(): number
  newId?(): string
  /** How long VS Code counts as "the app you were just in" after it loses focus. */
  recentMs?: number
}

export interface CodeService {
  start(): Promise<void>
  stop(): Promise<void>
  status(): CodeLinkStatus
  /**
   * The VS Code window focused now, or left less than `graceMs` ago (starting
   * a capture from Hoot's own UI blurs it first): the live overlay pins it.
   */
  focusedWindow(graceMs?: number): CodeWindowInfo | null
  /**
   * The window the owl and Studio chat read: the one this chat already reads,
   * else the focused one, else the one the user left less than `recentMs` ago.
   */
  chatWindow(): string | null
  /**
   * What goes with the next message instead of a screenshot: a fresh read of
   * `windowId`, said relative to what this chat was already shown. Null when
   * the window is gone or didn't answer in time (callers fall back).
   */
  note(windowId: string): Promise<string | null>
  /** Tag `index` of an answer: apply its edit in VS Code. */
  apply(messageId: string, index: number): Promise<CodeActionResult>
  /** Tag `index` of an answer: open its file in VS Code and scroll to it. */
  reveal(messageId: string, index: number): Promise<CodeActionResult>
  /** Each tag's state for an answer Hoot read code for; null for other answers. */
  tagStates(messageId: string): CodeTagState[] | null
  /** Windows came or went, focus moved, or an edit was applied. */
  onChange(listener: () => void): Unsubscribe
}

export const RECENT_MS = 2 * 60_000
/** A send's note binds to the chat its stream starts in, if that happens this soon. */
const BIND_MS = 10_000
/** Answers whose tags stay usable from the overlay. */
const KEEP_ANSWERS = 20

interface Reading {
  windowId: string
  /** The chat that was told about the code; null until the send creates it. */
  sessionId: string | null
  /** Set when the note went out before its chat existed. */
  bindBy: number | null
  memory: CodeNoteMemory | null
  /** The latest text of the files in the last snapshot, to resolve tags against. */
  files: CodeFile[]
}

type Item = { mark: CodeMark } | { edit: CodeEdit } | null

interface Answer {
  windowId: string
  items: Item[]
}

const NO_ANSWER: CodeActionResult = {
  ok: false,
  message: 'Hoot can’t find this in VS Code anymore. Ask again with the file open.'
}

/**
 * The code link (VS Code ⇄ Hoot): reads the user's code as text instead of a
 * screenshot, and turns the model's `[[line]]` / `[[edit]]` tags into
 * highlights and proposed edits in VS Code. Edits are applied only on request
 * (`apply`, or the user's click in VS Code).
 */
export function createCodeService(deps: CodeServiceDeps): CodeService {
  const { store, log } = deps
  const now = deps.now ?? Date.now
  const newId = deps.newId ?? randomUUID
  const recentMs = deps.recentMs ?? RECENT_MS
  const listeners = new Set<() => void>()
  const answers = new Map<string, Answer>()
  const applied = new Set<string>()
  let reading: Reading | null = null
  let stream = store.get('chat').stream
  let sessionId = store.get('chat').session?.id ?? null
  let unwatch: Unsubscribe | null = null

  const emit = (): void => {
    for (const listener of [...listeners]) listener()
  }

  const server = deps.createServer({
    onChange: emit,
    onApplied: (_peer, editId) => {
      applied.add(editId)
      emit()
    }
  })

  const peerById = (id: string): CodePeer | null =>
    server.peers().find((p) => p.window.id === id) ?? null

  const focusedPeer = (): CodePeer | null =>
    server
      .peers()
      .filter((p) => p.focused)
      .sort((a, b) => b.focusAt - a.focusAt)[0] ?? null

  /** The window an answer came from, or the one the user is in now. */
  const peerFor = (windowId: string): CodePeer | null => {
    const peers = server.peers()
    return peerById(windowId) ?? focusedPeer() ?? (peers.length === 1 ? (peers[0] ?? null) : null)
  }

  const resolve = (tag: CodeTag, files: readonly CodeFile[]): Item => {
    const { marks, edits } = resolveCodeTags([tag], files, newId)
    if (edits[0]) return { edit: edits[0] }
    if (marks[0]) return { mark: marks[0] }
    // An edit Hoot can't check still shows where it is.
    if (tag.kind === 'edit') {
      const mark = resolveCodeTags([{ ...tag, kind: 'line' }], files, newId).marks[0]
      if (mark) return { mark }
    }
    return null
  }

  /** A finished answer in the chat that read code: highlight and propose in VS Code. */
  const answered = (s: { sessionId: string; messageId: string }): void => {
    const r = reading
    if (!r || r.sessionId !== s.sessionId) return
    const session = store.get('chat').session
    const message =
      session?.id === s.sessionId ? session.messages.find((m) => m.id === s.messageId) : undefined
    if (!message?.text) return
    const { tags } = parseCodeAnswer(message.text)
    if (tags.length === 0) return
    const items = tags.map((tag) => resolve(tag, r.files))
    answers.delete(s.messageId)
    answers.set(s.messageId, { windowId: r.windowId, items })
    while (answers.size > KEEP_ANSWERS) answers.delete(answers.keys().next().value as string)
    const marks = items.flatMap((i) => (i && 'mark' in i ? [i.mark] : []))
    const edits = items.flatMap((i) => (i && 'edit' in i ? [i.edit] : []))
    const peer = peerFor(r.windowId)
    if (!peer || (marks.length === 0 && edits.length === 0)) return
    void peer.show(marks, edits, true).then((res) => {
      if (!res.ok) log.warn(`code link: show failed: ${res.message ?? '?'}`)
    })
    emit()
  }

  const onChat = (): void => {
    const chat = store.get('chat')
    const r = reading
    if (r?.bindBy && chat.stream && chat.stream.messageId !== stream?.messageId) {
      if (now() <= r.bindBy) r.sessionId = chat.stream.sessionId
      r.bindBy = null
    }
    if (stream && chat.stream?.messageId !== stream.messageId) answered(stream)
    stream = chat.stream
    const next = chat.session?.id ?? null
    if (next === sessionId) return
    // Another chat (or a new one): what VS Code shows was about the old one.
    if (r && r.sessionId !== null && r.sessionId === sessionId) {
      reading = null
      void peerFor(r.windowId)?.clear()
    }
    sessionId = next
  }

  const item = (messageId: string, index: number): { answer: Answer; item: Item } | null => {
    const answer = answers.get(messageId)
    return answer ? { answer, item: answer.items[index] ?? null } : null
  }

  return {
    async start() {
      unwatch ??= store.onChange((changed) => {
        if (changed.has('chat')) onChat()
      })
      try {
        await server.start()
      } catch (e) {
        log.warn(`code link not started: ${e instanceof Error ? e.message : String(e)}`)
      }
    },

    async stop() {
      unwatch?.()
      unwatch = null
      await server.stop()
    },

    status() {
      return { windows: server.peers().length, focused: focusedPeer()?.window ?? null }
    },

    focusedWindow(graceMs = 0) {
      const focused = focusedPeer()
      if (focused || graceMs <= 0) return focused?.window ?? null
      const left = server
        .peers()
        .filter((p) => now() - p.focusAt <= graceMs)
        .sort((a, b) => b.focusAt - a.focusAt)[0]
      return left?.window ?? null
    },

    chatWindow() {
      const sid = store.get('chat').session?.id ?? null
      if (reading && sid !== null && reading.sessionId === sid && peerById(reading.windowId)) {
        return reading.windowId
      }
      const focused = focusedPeer()
      if (focused) return focused.window.id
      const recent = server
        .peers()
        .filter((p) => now() - p.focusAt <= recentMs)
        .sort((a, b) => b.focusAt - a.focusAt)[0]
      return recent?.window.id ?? null
    },

    async note(windowId) {
      const peer = peerById(windowId)
      if (!peer) return null
      const snapshot = await peer.snapshot()
      if (!snapshot) {
        log.warn(`code link: ${peer.window.name || 'VS Code'} didn’t send its code in time`)
        return null
      }
      const sid = store.get('chat').session?.id ?? null
      const previous =
        reading && reading.windowId === windowId && sid !== null && reading.sessionId === sid
          ? reading.memory
          : null
      const { note, memory } = codeNote(snapshot, previous)
      reading = {
        windowId,
        sessionId: sid,
        bindBy: sid === null ? now() + BIND_MS : null,
        memory,
        files: snapshotFiles(snapshot)
      }
      return note
    },

    async apply(messageId, index) {
      const found = item(messageId, index)
      if (!found?.item) return NO_ANSWER
      if (!('edit' in found.item))
        return { ok: false, message: 'That one only points at the code.' }
      const peer = peerFor(found.answer.windowId)
      if (!peer) return { ok: false, message: 'VS Code isn’t connected. Open it and try again.' }
      const { edit } = found.item
      const result = await peer.apply(edit)
      if (result.ok) {
        applied.add(edit.id)
        emit()
      }
      return result
    },

    async reveal(messageId, index) {
      const found = item(messageId, index)
      if (!found?.item) return NO_ANSWER
      const peer = peerFor(found.answer.windowId)
      if (!peer) return { ok: false, message: 'VS Code isn’t connected. Open it and try again.' }
      const target = 'edit' in found.item ? found.item.edit : found.item.mark
      return peer.reveal({
        id: target.id,
        path: target.path,
        uri: target.uri,
        range: target.range,
        label: target.label
      })
    },

    tagStates(messageId) {
      const answer = answers.get(messageId)
      if (!answer) return null
      return answer.items.map((i) =>
        !i ? 'unavailable' : 'edit' in i && applied.has(i.edit.id) ? 'applied' : 'ready'
      )
    },

    onChange(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    }
  }
}
