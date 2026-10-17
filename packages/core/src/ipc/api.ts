import type { Unsubscribe } from '../protocol/backend'
import type {
  BuddyMode,
  CaptureMode,
  OverlayCommit,
  OverlayInit,
  Point,
  RequestedMode,
  StudioView
} from '../types/app'
import type { ChatDelta, SendPayload, SessionMeta } from '../types/chat'
import type {
  AssessResult,
  GlossaryEntry,
  LensContext,
  LensEvent,
  ProfilePatch,
  ProfileSnapshot,
  ProfileView,
  RecentChange,
  RewriteOutcome,
  RewriteRequest
} from '../types/lens'
import type { SettingsPatch } from '../types/settings'
import type { SliceName, StatePatch } from '../types/state'

export type { Unsubscribe } from '../protocol/backend'

export interface ApiKeyResult {
  ok: boolean
  reason?: 'rejected' | 'unreachable'
}

/** Release velocity of a buddy drag, DIP/s. */
export interface DragEnd {
  vx: number
  vy: number
}

/** Main asks the buddy renderer to animate; the renderer answers `transitionDone(id)`. */
export interface BuddyTransition {
  id: number
  from: BuddyMode
  to: BuddyMode
}

export interface ReaderDocument {
  name: string
  kind: 'pdf' | 'html'
  bytes: Uint8Array
}

/**
 * `window.hoot`: the whole renderer → main surface. Preload builds it from
 * HOOT_API_ROUTES, and main validates every call's arguments against
 * INVOKE_ARGS / SEND_ARGS. Fire-and-forget methods (`void`) are reserved for
 * high-frequency pointer traffic; everything else returns a Promise that
 * rejects when main refuses the call.
 */
export interface HootApi {
  state: {
    /** Subscribe this window to slices; resolves with their current values. */
    subscribe(slices: SliceName[]): Promise<StatePatch>
    onPatch(cb: (patch: StatePatch) => void): Unsubscribe
  }
  chat: {
    send(payload: SendPayload): Promise<void>
    stop(): Promise<void>
    regenerate(): Promise<void>
    newChat(): Promise<void>
    onDelta(cb: (delta: ChatDelta) => void): Unsubscribe
  }
  sessions: {
    open(id: string): Promise<void>
    rename(id: string, title: string): Promise<void>
    delete(id: string): Promise<void>
    undoDelete(id: string): Promise<void>
    clearAll(): Promise<void>
    search(query: string): Promise<SessionMeta[]>
  }
  attachments: {
    open(id: string): Promise<void>
    remove(id: string): Promise<void>
  }
  clipboard: {
    writeText(text: string): Promise<void>
    arm(): Promise<void>
    dismiss(): Promise<void>
  }
  buddy: {
    requestMode(mode: RequestedMode): void
    transitionDone(id: number): void
    setIgnoreMouse(ignore: boolean): void
    dragStart(): void
    dragMove(): void
    dragEnd(v: DragEnd): void
    setCursorTracking(on: boolean): void
    dismissGreeting(): Promise<void>
    onTransition(cb: (t: BuddyTransition) => void): Unsubscribe
    /** Cursor position relative to the owl, for the eyes */
    onCursor(cb: (p: Point) => void): Unsubscribe
  }
  capture: {
    start(mode?: CaptureMode): Promise<void>
    getInit(): Promise<OverlayInit | null>
    commit(commit: OverlayCommit): Promise<void>
    cancel(): Promise<void>
    onOpen(cb: () => void): Unsubscribe
    onClosed(cb: () => void): Unsubscribe
  }
  pins: {
    /** Pin an assistant message from the active session. */
    create(messageId: string): Promise<void>
    /** Pin arbitrary text, e.g. a glossary entry. */
    createFromText(text: string): Promise<void>
    /** Note windows only: the pin is identified by the sender. */
    resize(height: number): void
    close(): Promise<void>
    openInHoot(): Promise<void>
  }
  settings: {
    update(patch: SettingsPatch): Promise<void>
    setApiKey(key: string): Promise<ApiKeyResult>
    validateApiKey(key: string): Promise<boolean>
    clearApiKey(): Promise<void>
    resetAnchor(): Promise<void>
  }
  windows: {
    openStudio(view?: StudioView): Promise<void>
    lockStudio(): Promise<void>
    openReader(): Promise<void>
  }
  onboarding: {
    setStep(step: number): Promise<void>
    finish(): Promise<void>
  }
  reader: {
    /** Shows an open-file dialog; null when cancelled. */
    pickFile(): Promise<ReaderDocument | null>
    current(): Promise<ReaderDocument | null>
    onDocument(cb: (doc: ReaderDocument) => void): Unsubscribe
  }
  lens: {
    assess(reqId: string, ctx: LensContext): Promise<AssessResult>
    rewrite(reqId: string, req: RewriteRequest): Promise<RewriteOutcome>
    cancel(reqId: string): Promise<void>
    feedback(event: LensEvent): Promise<void>
    explain(ctx: LensContext): Promise<void>
    profile(): Promise<ProfileView>
    snapshot(): Promise<ProfileSnapshot>
    patchProfile(patch: ProfilePatch): Promise<ProfileView>
    resetProfile(): Promise<void>
    /** Save-file dialog; resolves with the written path, or null when cancelled. */
    exportProfile(): Promise<string | null>
    recentChanges(limit: number): Promise<RecentChange[]>
    glossary(): Promise<GlossaryEntry[]>
    onProfile(cb: (snapshot: ProfileSnapshot) => void): Unsubscribe
  }
  app: {
    /** Opens http(s) URLs on the allowlist in the default browser. */
    openExternal(url: string): Promise<void>
  }
}
