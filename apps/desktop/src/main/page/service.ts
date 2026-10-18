import {
  pageNote,
  parsePageAnswer,
  type Browser,
  type PageInfo,
  type PageMark,
  type PageNoteMemory,
  type PageSnapshot,
  type Unsubscribe
} from '@hoot/core'
import type { BridgePageHooks } from '@hoot/bridge'
import type { Logger } from '../log'
import type { Store } from '../store/store'

/** One extension connection, as the bridge server hands it over. */
export interface PageLinkConn {
  browser(): Browser | null
  read(timeoutMs: number): Promise<PageSnapshot | null>
  mark(tab: number, marks: PageMark[]): void
}

export interface PagePeer {
  readonly id: number
  readonly browser: Browser
  readonly focused: boolean
  /** When the browser last gained or lost focus (ms since epoch). */
  readonly focusAt: number
  /** Its front tab; null until the extension says. */
  readonly page: PageInfo | null
}

/** A question from the extension's popup. */
export interface PageAsk {
  text: string
  /** Spoken (the browser's speech recognition): answer aloud. */
  voice: boolean
  /** The active chat already reads this page: continue it, else start a new chat. */
  sameChat: boolean
  /** The page note, built once the chat to send in is chosen. */
  note(): string | null
}

export interface PageServiceDeps {
  store: Pick<Store, 'get' | 'onChange'>
  log: Logger
  onAsk(ask: PageAsk): Promise<void>
  now?(): number
  /** How long the browser counts as "the app you were just in" after it loses focus. */
  recentMs?: number
  readTimeoutMs?: number
}

export interface PageService {
  /** The bridge server registers each extension connection. */
  connect(conn: PageLinkConn): { hooks: BridgePageHooks; disconnect(): void }
  start(): void
  stop(): void
  /** The browser the user is in now, or left less than `withinMs` ago. */
  activePeer(withinMs?: number): PagePeer | null
  /** When the user was last in that browser (now, while it has focus). */
  activeAt(peerId: number): number
  /**
   * What goes with the next message instead of a screenshot: a fresh read of
   * the peer's front tab, relative to what this chat was already shown. Null
   * when the browser is gone or didn't answer in time.
   */
  note(peerId: number): Promise<string | null>
  status(): { browsers: number; focused: PageInfo | null }
}

export const PAGE_RECENT_MS = 2 * 60_000
export const PAGE_READ_TIMEOUT_MS = 1_500
/** A send's note binds to the chat its stream starts in, if that happens this soon. */
const BIND_MS = 10_000

interface Peer extends PagePeer {
  conn: PageLinkConn
  focused: boolean
  focusAt: number
  page: PageInfo | null
}

interface Reading {
  peerId: number
  tab: number
  url: string
  sessionId: string | null
  bindBy: number | null
  memory: PageNoteMemory | null
  /** Highlights are on the page now. */
  marked: boolean
}

/**
 * The page link (browser extension ⇄ Hoot): reads the page in front of the
 * user as text when they chat with Hoot right after being in the browser,
 * and turns the answer's `[[find]]` tags into highlights on that page.
 */
export function createPageService(deps: PageServiceDeps): PageService {
  const { store, log } = deps
  const now = deps.now ?? Date.now
  const recentMs = deps.recentMs ?? PAGE_RECENT_MS
  const readTimeoutMs = deps.readTimeoutMs ?? PAGE_READ_TIMEOUT_MS
  const peers = new Map<number, Peer>()
  let nextId = 1
  let reading: Reading | null = null
  let stream = store.get('chat').stream
  let sessionId = store.get('chat').session?.id ?? null
  let unwatch: Unsubscribe | null = null

  const clearMarks = (r: Reading): void => {
    if (r.marked) peers.get(r.peerId)?.conn.mark(r.tab, [])
    r.marked = false
  }

  /** Read `snapshot` into a note for the active chat, and remember what it showed. */
  const noteFrom = (peer: Peer, snapshot: PageSnapshot): string => {
    const sid = store.get('chat').session?.id ?? null
    const previous =
      reading &&
      reading.peerId === peer.id &&
      reading.url === snapshot.url &&
      sid !== null &&
      reading.sessionId === sid
        ? reading.memory
        : null
    const { note, memory } = pageNote(snapshot, previous, peer.browser)
    if (reading && reading.tab !== snapshot.tab) clearMarks(reading)
    reading = memory
      ? {
          peerId: peer.id,
          tab: snapshot.tab,
          url: snapshot.url,
          sessionId: sid,
          bindBy: sid === null ? now() + BIND_MS : null,
          memory,
          marked: reading?.marked === true && reading.tab === snapshot.tab
        }
      : null
    return note
  }

  /** A finished answer in the chat that read the page: highlight its passages. */
  const answered = (s: { sessionId: string; messageId: string }): void => {
    const r = reading
    if (!r || r.sessionId !== s.sessionId) return
    const message = store.get('chat').session?.messages.find((m) => m.id === s.messageId)
    if (!message?.text || message.status !== 'done') return
    const { marks } = parsePageAnswer(message.text)
    const peer = peers.get(r.peerId)
    if (!peer || (marks.length === 0 && !r.marked)) return
    peer.conn.mark(r.tab, marks)
    r.marked = marks.length > 0
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
    // Another chat (or a new one): the highlights were about the old one.
    if (r && r.sessionId !== null && r.sessionId === sessionId) {
      clearMarks(r)
      reading = null
    }
    sessionId = next
  }

  const withPage = (p: Peer): boolean => p.page !== null

  return {
    connect(conn) {
      const peer: Peer = {
        id: nextId++,
        conn,
        get browser() {
          return conn.browser() ?? 'other'
        },
        focused: false,
        focusAt: 0,
        page: null
      }
      peers.set(peer.id, peer)
      const hooks: BridgePageHooks = {
        focus(focused, page) {
          if (focused !== peer.focused) peer.focusAt = now()
          peer.focused = focused
          // null: the extension's page link is off (or no tab): don't read this browser.
          peer.page = page
        },
        async ask(text, voice, snapshot) {
          if (snapshot) {
            peer.page = { tab: snapshot.tab, url: snapshot.url, title: snapshot.title }
          }
          const sid = store.get('chat').session?.id ?? null
          const sameChat =
            !!snapshot &&
            reading?.peerId === peer.id &&
            reading.url === snapshot.url &&
            sid !== null &&
            reading.sessionId === sid
          await deps.onAsk({
            text,
            voice,
            sameChat,
            note: () => (snapshot ? noteFrom(peer, snapshot) : null)
          })
        }
      }
      return {
        hooks,
        disconnect() {
          peers.delete(peer.id)
          if (reading?.peerId === peer.id) reading = null
        }
      }
    },

    start() {
      unwatch ??= store.onChange((changed) => {
        if (changed.has('chat')) onChat()
      })
    },

    stop() {
      unwatch?.()
      unwatch = null
    },

    activePeer(withinMs = recentMs) {
      const list = [...peers.values()].filter(withPage)
      const focused = list.filter((p) => p.focused).sort((a, b) => b.focusAt - a.focusAt)[0]
      if (focused) return focused
      return (
        list
          .filter((p) => now() - p.focusAt <= withinMs)
          .sort((a, b) => b.focusAt - a.focusAt)[0] ?? null
      )
    },

    activeAt(peerId) {
      const peer = peers.get(peerId)
      if (!peer) return 0
      return peer.focused ? now() : peer.focusAt
    },

    async note(peerId) {
      const peer = peers.get(peerId)
      if (!peer) return null
      const snapshot = await peer.conn.read(readTimeoutMs)
      if (!snapshot) {
        log.warn(`page link: ${peer.browser} didn’t send its page in time`)
        return null
      }
      if (!peers.has(peerId)) return null
      return noteFrom(peer, snapshot)
    },

    status() {
      const list = [...peers.values()].filter(withPage)
      const focused = list.find((p) => p.focused)
      return { browsers: list.length, focused: focused?.page ?? null }
    }
  }
}
