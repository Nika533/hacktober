import { getState, updateState } from './store/state'
import { openStudio } from './windows/studio'
import type { Pin } from '../shared/types'
import type { Persistence } from './store/persistence'
import type { DebouncedWriter } from './store/persistence'
import type { NoteManager } from './windows/note'
import type { BuddyWindow } from './windows/buddy'

export interface PinDeps {
  persistence: Persistence
  writer: DebouncedWriter
  notes: NoteManager
  buddy(): BuddyWindow | null
}

let deps: PinDeps | null = null

export function initPins(d: PinDeps): void {
  deps = d
}

function persistPins(): void {
  deps?.writer.schedule('pins', () => deps!.persistence.savePins(getState().pins))
}

/** Pin an assistant message → new note window. No-op if already pinned. */
export function createPin(messageId: string): Pin | null {
  const d = deps
  if (!d) return null
  const s = getState()
  const sess = s.activeSession
  const msg = sess?.messages.find((m) => m.id === messageId)
  // A streaming answer isn't final yet — pinning it would freeze partial text.
  if (!sess || !msg || msg.role !== 'assistant' || msg.status === 'streaming') return null
  const existing = s.pins.find((p) => p.messageId === messageId)
  if (existing) {
    d.notes.show(existing)
    return existing
  }
  const pin: Pin = {
    id: crypto.randomUUID(),
    text: msg.text,
    sessionId: sess.id,
    messageId,
    bounds: d.notes.placement(s.pins.length),
    createdAt: Date.now()
  }
  updateState((st) => {
    st.pins.push(pin)
  })
  persistPins()
  d.notes.show(pin)
  return pin
}

/** Deleting the pin closes its note window. */
export function closePin(id: string): void {
  const d = deps
  if (!d) return
  updateState((s) => {
    s.pins = s.pins.filter((p) => p.id !== id)
  })
  persistPins()
  d.notes.destroy(id)
}

/** "Open in Hoot" — jump to the pinned session in the card (or Studio). */
export function openPinInHoot(id: string): void {
  const d = deps
  const pin = getState().pins.find((p) => p.id === id)
  if (!d || !pin) return
  void (async () => {
    const sess = await d.persistence.loadSession(pin.sessionId)
    if (sess) {
      updateState((st) => {
        st.activeSession = sess
      })
      d.writer.schedule('index', () =>
        d.persistence.saveSessionIndex({
          activeId: getState().activeSession?.id ?? null,
          sessions: getState().sessions
        })
      )
    }
    if (getState().studioOpen) openStudio('chat')
    else d.buddy()?.requestMode('card')
  })()
}
