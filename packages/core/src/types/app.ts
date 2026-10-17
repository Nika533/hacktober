/** Desktop-app vocabulary shared by main, preload and renderers. */

export type BuddyMode = 'hidden' | 'dot' | 'pill' | 'card'

/** Modes a renderer may ask for; main decides what actually happens. */
export type RequestedMode = 'dot' | 'pill' | 'card' | 'hidden'

export type OwlMood = 'idle' | 'listening' | 'thinking' | 'talking' | 'celebrate' | 'error'

export type QuickActionId = 'explain' | 'extract' | 'translate' | 'summarize' | 'fix'

export type StudioView = 'chat' | 'settings' | 'onboarding' | 'reading' | 'profile' | 'glossary'

export type CaptureMode = 'lasso' | 'rect' | 'full'

export type Platform = 'win32' | 'darwin' | 'linux'

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

export interface ModeLayout {
  /** Window bounds in screen DIP */
  bounds: Rect
  /** Owl centre, window-local DIP */
  owl: Point
  openX: 'left' | 'right'
  openY: 'up' | 'down'
}

/** Payload the capture overlay pulls each time it shows. */
export interface OverlayInit {
  /** JPEG data URL of the whole display, shown under the veil. */
  imageDataUrl: string
  /** Display size in DIP; the overlay window covers exactly this. */
  displayWidth: number
  displayHeight: number
  mode: CaptureMode
  accentColor: string
  pendingCount: number
}

export type OverlayCommit =
  { kind: 'lasso'; points: Point[] } | { kind: 'rect'; rect: Rect } | { kind: 'full' }

export interface ClipboardHint {
  kind: 'text' | 'image'
  chars?: number
  /** True once the user armed the chip; the next send includes it. */
  selected?: boolean
}

export interface Greeting {
  title: string
  subtitle: string
  action?: 'continue' | 'clipboard'
}

export interface Pin {
  id: string
  text: string
  /** Null for pins not made from a chat answer (e.g. a glossary entry). */
  sessionId: string | null
  messageId: string | null
  bounds: Rect
  createdAt: number
}
