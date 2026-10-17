export type BuddyMode = 'hidden' | 'dot' | 'pill' | 'card'

export type OwlMood = 'idle' | 'listening' | 'thinking' | 'talking' | 'celebrate' | 'error'

export type ModelId = 'claude-haiku-5-5' | 'claude-sonnet-5-5' | 'claude-opus-5-5'

export type QuickActionId = 'explain' | 'extract' | 'translate' | 'summarize' | 'fix'

export type StudioView = 'chat' | 'settings' | 'onboarding'

export type CaptureMode = 'lasso' | 'rect' | 'full'

/** Payload the overlay renderer pulls each time the overlay shows. */
export interface OverlayInit {
  /** JPEG q90 data URL of the whole display, shown under the veil. */
  imageDataUrl: string
  /** Display size in DIP — the overlay window covers exactly this. */
  displayWidth: number
  displayHeight: number
  mode: CaptureMode
  accentColor: string
  pendingCount: number
}

export type OverlayCommit =
  { kind: 'lasso'; points: Point[] } | { kind: 'rect'; rect: Rect } | { kind: 'full' }

export interface Point {
  x: number
  y: number
}

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export interface Attachment {
  id: string
  kind: 'capture' | 'clipboard-image'
  path: string
  thumbDataUrl: string
  width: number
  height: number
  createdAt: number
}

export interface Message {
  id: string
  role: 'user' | 'assistant'
  /** Displayed text */
  text: string
  /** Text sent to the model, if different from `text` */
  sentText?: string
  attachmentIds: string[]
  createdAt: number
  status: 'streaming' | 'done' | 'stopped' | 'error'
  error?: 'no-key' | string
}

export interface Session {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  messages: Message[]
  attachments: Record<string, Attachment>
}

export interface SessionMeta {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  messageCount: number
}

export interface Pin {
  id: string
  text: string
  sessionId: string
  messageId: string
  bounds: Rect
  createdAt: number
}

export interface Settings {
  model: ModelId
  summonHotkey: string
  captureHotkey: string
  launchAtLogin: boolean
  saveHistory: boolean
  restorePins: boolean
  clipboardHint: boolean
  translateTo: string
  collapseToDotAfterMs: number
  pillAnchor: Point | null
  studioBounds: Rect | null
  onboardingDone: boolean
}

export interface ModeLayout {
  /** Window bounds in screen DIP */
  bounds: Rect
  /** Owl centre, window-local DIP */
  owl: Point
  openX: 'left' | 'right'
  openY: 'up' | 'down'
}

export interface ClipboardHint {
  kind: 'text' | 'image'
  chars?: number
  /** True once the user armed the chip — the next send includes it. */
  selected?: boolean
}

export interface Greeting {
  title: string
  subtitle: string
  action?: 'continue' | 'clipboard'
}

export interface AppState {
  settings: Settings
  hasApiKey: boolean
  buddyMode: BuddyMode
  buddyLayout: ModeLayout | null
  studioOpen: boolean
  studioView: StudioView
  /** 0-based onboarding step; only the last step finishes on the summon hotkey. */
  onboardingStep: number
  mood: OwlMood
  activeSession: Session | null
  sessions: SessionMeta[]
  pendingAttachments: Attachment[]
  clipboardHint: ClipboardHint | null
  /** Copied text snapshotted when the clipboard chip was armed. */
  clipboardSelection: string | null
  pins: Pin[]
  streaming: boolean
  answerReady: boolean
  /** '#RRGGBB' from systemPreferences.getAccentColor() */
  accentColor: string
  /** nativeTheme.shouldUseDarkColors — media queries don't track themeSource. */
  darkMode: boolean
  greeting: Greeting | null
  hotkeyErrors: string[]
}

export const DEFAULT_SETTINGS: Settings = {
  model: 'claude-sonnet-5-5',
  summonHotkey: 'CommandOrControl+Shift+Space',
  captureHotkey: 'CommandOrControl+Alt+Space',
  launchAtLogin: false,
  saveHistory: true,
  restorePins: true,
  clipboardHint: true,
  translateTo: 'English',
  collapseToDotAfterMs: 5000,
  pillAnchor: null,
  studioBounds: null,
  onboardingDone: false
}
