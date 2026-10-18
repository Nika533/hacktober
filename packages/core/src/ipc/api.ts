import type { CodeActionResult, CodeTagState } from '../code/types'
import type { Unsubscribe } from '../protocol/backend'
import type { AnywhereAction, AnywhereState } from '../types/anywhere'
import type {
  BuddyMode,
  CaptureMode,
  OverlayCommit,
  OverlayInit,
  OverlayRestore,
  Point,
  Rect,
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
    /**
     * Window-local DIP rects the renderer treats as clickable. Main compares
     * the polled cursor against them to toggle click-through itself, so the
     * buddy doesn't depend on forwarded mousemove events alone.
     */
    setHitRegions(rects: Rect[]): void
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
    /** Live overlay: click a spot on this display (overlay-local DIP). */
    click(at: Point): Promise<boolean>
    /**
     * Live overlay: hide it into the owl, keeping the chat. Opening the
     * owl's chat (or circling again) brings it back (`onRestore`).
     */
    minimize(): Promise<void>
    onOpen(cb: () => void): Unsubscribe
    onClosed(cb: () => void): Unsubscribe
    /** Live overlay: the user clicked at this spot on the display (overlay-local DIP). */
    onUserClick(cb: (at: Point) => void): Unsubscribe
    /** Live overlay: shown again after `minimize`. */
    onRestore(cb: (restore: OverlayRestore) => void): Unsubscribe
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
    /**
     * Pause Hoot's global shortcuts while a hotkey recorder is recording:
     * Windows delivers a registered combination only to its owner, so the
     * recorder would never see it. Main resumes them when the calling window
     * closes, or after 60 s, even if `false` never arrives.
     */
    suspendHotkeys(on: boolean): Promise<void>
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
  /** The Lens anywhere bubble only: main ignores calls from other windows. */
  anywhere: {
    current(): Promise<AnywhereState | null>
    onUpdate(cb: (state: AnywhereState) => void): Unsubscribe
    /** The bubble's content height (DIP); main resizes the window, capped. */
    resize(height: number): void
    act(action: AnywhereAction): Promise<void>
    close(): Promise<void>
  }
  /**
   * The code link (VS Code): an answer's `[[line]]` / `[[edit]]` tags, by
   * their index in `parseCodeAnswer(text).tags`.
   */
  code: {
    /** Apply tag `index`'s edit in VS Code (the user clicked Apply). */
    apply(messageId: string, index: number): Promise<CodeActionResult>
    /** Open tag `index`'s file in VS Code and scroll to it. */
    reveal(messageId: string, index: number): Promise<CodeActionResult>
    /** Each tag's state; null when Hoot didn't read code for this answer. */
    tagStates(messageId: string): Promise<CodeTagState[] | null>
    /** Something changed (an edit applied, VS Code came or went): ask again. */
    onChange(cb: () => void): Unsubscribe
  }
  /**
   * The voice chat (Windows speech): main listens, sends what it heard to the
   * active chat, reads the answer aloud and listens again. Its state is the
   * `voice` slice.
   */
  voice: {
    /** Start a voice chat; while Hoot is speaking, cut it off and listen now. */
    start(): Promise<void>
    /** Done talking: send what Hoot heard so far, without waiting for a pause. */
    finish(): Promise<void>
    /** End the voice chat: stop listening and speaking. */
    stop(): Promise<void>
    /** Read one assistant message of the active chat aloud. */
    speak(messageId: string): Promise<void>
  }
  /**
   * Agents: extra chats answering at the same time as the owl's, each in its
   * own window (the `agents` slice). `create` comes from the card or Studio;
   * every other call comes from an agent's window and acts on that agent.
   */
  agents: {
    /** Call a new agent; its window opens by the owl. False when MAX_AGENTS are already out. */
    create(): Promise<boolean>
    send(payload: SendPayload): Promise<void>
    stop(): Promise<void>
    regenerate(): Promise<void>
    /** Shrink into its coloured owl: the window becomes just the owl. */
    minimize(): Promise<void>
    /** Open again out of the owl. */
    restore(): Promise<void>
    /** Done with this agent: the window closes; its chat stays in Studio's list. */
    close(): Promise<void>
    /** The minimized owl is a drag handle: main moves the window 1:1 with the cursor. */
    dragStart(): void
    dragMove(): void
    dragEnd(v: DragEnd): void
  }
  app: {
    /** Opens http(s) URLs on the allowlist in the default browser. */
    openExternal(url: string): Promise<void>
  }
}
