import { randomUUID } from 'node:crypto'
import type { Pin, Rect } from '@hoot/core'
import type { Store } from '../store/store'

/** The note windows, behind an interface so the service is testable without Electron. */
export interface NoteWindows {
  /** Show the pin's note, creating its window if needed. */
  open(pin: Pin): void
  close(pinId: string): void
  hideAll(): void
  /** The pin whose note window sent an IPC call, by webContents id. */
  pinIdFor(senderId: number): string | null
  resize(pinId: string, height: number): void
  /** Where the next new note goes (cascaded near the owl). */
  placement(index: number): Rect
}

export interface PinsDeps {
  store: Store
  windows: NoteWindows
  /** "Open in Hoot": show this session in the card, or Studio when it's open (d1). */
  openSession(sessionId: string): Promise<void>
  now?(): number
  newId?(): string
}

export interface PinsService {
  /** Pin an assistant answer from the open chat; an existing pin is just shown. */
  create(messageId: string): Promise<void>
  /** Pin any text, e.g. a glossary entry; identical text reuses its pin. */
  createFromText(text: string): Promise<void>
  /** Note windows: close / open in Hoot / resize, identified by the sender. */
  closeFrom(senderId: number): Promise<void>
  openInHootFrom(senderId: number): Promise<void>
  resizeFrom(senderId: number, height: number): void
  /** Delete a pin (also called when its window is closed by the OS). */
  remove(pinId: string): void
  /** The window moved; the new bounds are saved with the pin. */
  setBounds(pinId: string, bounds: Rect): void
  /** At startup: reopen every note when settings.restorePins is on. */
  restore(): void
  /** Tray: show or hide all notes. */
  setVisible(visible: boolean): void
}

/**
 * Sticky-note pins (C, F-C2, docs/finish-plan.md). The `pins` slice is the
 * source of truth and persistence follows it (d1's watchPersistence).
 */
export function createPinsService(deps: PinsDeps): PinsService {
  const { store, windows } = deps
  const now = deps.now ?? Date.now
  const newId = deps.newId ?? randomUUID
  const pins = (): Pin[] => store.get('pins').pins

  const add = (pin: Pin): void => {
    store.set('pins', { pins: [...pins(), pin] })
    windows.open(pin)
  }

  const pinFrom = (senderId: number): Pin | undefined => {
    const id = windows.pinIdFor(senderId)
    return id ? pins().find((p) => p.id === id) : undefined
  }

  return {
    async create(messageId) {
      const session = store.get('chat').session
      const message = session?.messages.find((m) => m.id === messageId)
      // A streaming answer isn't final yet; pinning it would freeze partial text.
      if (!session || !message || message.role !== 'assistant' || message.status === 'streaming') {
        throw new Error('only a finished answer from the open chat can be pinned')
      }
      const existing = pins().find((p) => p.messageId === messageId)
      if (existing) return windows.open(existing)
      add({
        id: newId(),
        text: message.text,
        sessionId: session.id,
        messageId,
        bounds: windows.placement(pins().length),
        createdAt: now()
      })
    },

    async createFromText(text) {
      const existing = pins().find((p) => p.messageId === null && p.text === text)
      if (existing) return windows.open(existing)
      add({
        id: newId(),
        text,
        sessionId: null,
        messageId: null,
        bounds: windows.placement(pins().length),
        createdAt: now()
      })
    },

    async closeFrom(senderId) {
      const pin = pinFrom(senderId)
      if (pin) this.remove(pin.id)
    },

    async openInHootFrom(senderId) {
      const pin = pinFrom(senderId)
      if (pin?.sessionId) await deps.openSession(pin.sessionId)
    },

    resizeFrom(senderId, height) {
      const pin = pinFrom(senderId)
      if (pin) windows.resize(pin.id, height)
    },

    remove(pinId) {
      if (!pins().some((p) => p.id === pinId)) return
      store.set('pins', { pins: pins().filter((p) => p.id !== pinId) })
      windows.close(pinId)
    },

    setBounds(pinId, bounds) {
      if (!pins().some((p) => p.id === pinId)) return
      store.set('pins', { pins: pins().map((p) => (p.id === pinId ? { ...p, bounds } : p)) })
    },

    restore() {
      if (!store.get('settings').settings.restorePins) return
      for (const pin of pins()) windows.open(pin)
    },

    setVisible(visible) {
      if (visible) for (const pin of pins()) windows.open(pin)
      else windows.hideAll()
    }
  }
}
