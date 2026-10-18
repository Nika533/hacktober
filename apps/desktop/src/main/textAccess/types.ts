import type { Point, Rect, Unsubscribe } from '@hoot/core'

/** The foreground app, for context (Lens anywhere's title, the capture note). */
export interface ForegroundApp {
  /** Process name without `.exe`, e.g. `Code`, `WINWORD`, `notepad`. */
  process: string
  /** Window title, e.g. `notes.md - Visual Studio Code`. */
  title: string
}

/** Text the user selected in another app. */
export interface SelectionInfo {
  /** The selected text, trimmed. Never empty. */
  text: string
  /** The enclosing paragraph (UI Automation), or '' when unknown. */
  paragraph: string
  /** Bounding rects of the selection in screen DIP; empty when unknown. */
  rects: Rect[]
  app: ForegroundApp
  /** How the text was read: UI Automation, or a simulated Ctrl+C (clipboard restored). */
  source: 'uia' | 'clipboard'
}

/**
 * Reading text out of other desktop apps (Windows UI Automation, with a
 * clipboard fallback). Every method resolves (never rejects) and resolves
 * null when there's nothing to read, on other platforms, or on timeout.
 */
export interface TextAccess {
  /** The selection in the foreground app: UI Automation first, then Ctrl+C with the clipboard restored. */
  selection(): Promise<SelectionInfo | null>
  /** Readable text inside a screen rectangle (DIP), capped at TEXT_IN_RECT_MAX characters. */
  textInRect(rect: Rect): Promise<string | null>
  foreground(): Promise<ForegroundApp | null>
  /**
   * The agent's eyes on the user's hands: every left click anywhere on screen
   * (screen DIP, where the button was released), while at least one listener
   * is subscribed. Watching starts with the first listener and stops with the last.
   */
  onClick(listener: (at: Point) => void): Unsubscribe
  /** The agent's hands: move the pointer to a screen point (DIP) and left-click there. */
  click(at: Point): Promise<boolean>
  /** Start the helper ahead of the first call (safe to call at startup). */
  prewarm(): void
  dispose(): void
}

/** The most text `textInRect` returns. */
export const TEXT_IN_RECT_MAX = 8000
