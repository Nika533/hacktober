import type { AppState, Session, SessionMeta } from '../../shared/types'
import { DEFAULT_SETTINGS } from '../../shared/types'

/**
 * Single authoritative AppState owned by the main process.
 * Mutations go through `updateState`, which notifies subscribers;
 * index.ts fans that out to every window as `state:changed`.
 * Streaming text never mutates through here per delta — the AI layer
 * appends to the session message directly and broadcasts `ai:delta`.
 */
let state: AppState = {
  settings: { ...DEFAULT_SETTINGS },
  hasApiKey: false,
  buddyMode: 'hidden',
  buddyLayout: null,
  studioOpen: false,
  studioView: 'chat',
  onboardingStep: 0,
  mood: 'idle',
  activeSession: null,
  sessions: [],
  pendingAttachments: [],
  clipboardHint: null,
  clipboardSelection: null,
  pins: [],
  streaming: false,
  answerReady: false,
  accentColor: '#5B8DEF',
  darkMode: false,
  greeting: null,
  hotkeyErrors: []
}

type Listener = (s: AppState) => void
const listeners = new Set<Listener>()

export function initState(patch: Partial<AppState>): void {
  state = { ...state, ...patch }
}

export function getState(): AppState {
  return state
}

export function updateState(mut: (s: AppState) => void): void {
  mut(state)
  for (const l of listeners) l(state)
}

export function onState(cb: Listener): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

export function sessionMetaOf(s: Session): SessionMeta {
  return {
    id: s.id,
    title: s.title,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
    messageCount: s.messages.length
  }
}
