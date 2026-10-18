import type {
  BuddyMode,
  ClipboardHint,
  Greeting,
  ModeLayout,
  OwlMood,
  Pin,
  Platform,
  StudioView
} from './app'
import type { Attachment, Session, SessionMeta } from './chat'
import type { BridgeStatus } from './lens'
import type { VoiceSlice } from './voice'

/** A global shortcut that couldn't be registered (Settings shows it on that row). */
export interface HotkeyError {
  which: 'summonHotkey' | 'captureHotkey' | 'lensHotkey'
  accelerator: string
  message: string
}
import type { Settings } from './settings'

/**
 * Main owns app state as independent slices. A window subscribes to the
 * slices it renders and receives `state:patch` events carrying only the
 * slices that changed (each slice is replaced whole). Streaming text travels
 * separately on `chat:delta`, and a patch never contains a delta that was not
 * already broadcast.
 */
export interface StateSlices {
  settings: {
    settings: Settings
    hasApiKey: boolean
    /** 'memory' when OS encryption is unavailable and the key isn't saved. */
    keyStorage: 'os-encrypted' | 'memory'
    hotkeyErrors: HotkeyError[]
  }
  system: {
    platform: Platform
    version: string
    packaged: boolean
    /** '#RRGGBB' from the OS accent colour */
    accentColor: string
    /** nativeTheme.shouldUseDarkColors; media queries don't track themeSource */
    darkMode: boolean
    highContrast: boolean
  }
  buddy: {
    mode: BuddyMode
    layout: ModeLayout | null
    mood: OwlMood
    greeting: Greeting | null
    answerReady: boolean
  }
  studio: {
    open: boolean
    view: StudioView
    /** 0-based onboarding step */
    onboardingStep: number
  }
  chat: {
    session: Session | null
    /** The assistant message currently streaming, if any */
    stream: { sessionId: string; messageId: string } | null
    pendingAttachments: Attachment[]
    clipboardHint: ClipboardHint | null
  }
  sessions: {
    list: SessionMeta[]
    /** Soft-deleted session that can still be restored with Undo */
    pendingDelete: string | null
  }
  pins: {
    pins: Pin[]
  }
  lens: {
    bridge: BridgeStatus
    /** Connected browser extensions */
    clients: number
    lastError: string | null
  }
  /** The voice chat: one at a time, whichever surface started it. */
  voice: VoiceSlice
}

export type SliceName = keyof StateSlices

export const SLICE_NAMES = [
  'settings',
  'system',
  'buddy',
  'studio',
  'chat',
  'sessions',
  'pins',
  'lens',
  'voice'
] as const satisfies readonly SliceName[]

// Compile-time check that SLICE_NAMES lists every slice.
const _allSlices: Exclude<SliceName, (typeof SLICE_NAMES)[number]> extends never ? true : never =
  true
void _allSlices

export type StatePatch = Partial<StateSlices>

export type WindowKind = 'buddy' | 'studio' | 'capture' | 'note' | 'reader' | 'anywhere'

/** What each window subscribes to by default. */
export const DEFAULT_SUBSCRIPTIONS: Record<WindowKind, readonly SliceName[]> = {
  buddy: ['settings', 'system', 'buddy', 'chat', 'sessions', 'voice'],
  studio: ['settings', 'system', 'studio', 'chat', 'sessions', 'lens', 'voice'],
  capture: ['system'],
  note: ['system', 'pins'],
  reader: ['settings', 'system', 'lens'],
  anywhere: ['system', 'settings']
}
