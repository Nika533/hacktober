/**
 * The code link: the Hoot VS Code extension hands the app the code the user
 * is looking at as text (no screenshot), and the app hands back highlights
 * and the edits the user approved.
 */

/** A 1-based, inclusive range of lines. */
export interface LineRange {
  start: number
  end: number
}

export interface CodeSelection extends LineRange {
  /** The selected text, capped at CODE_LIMITS.selectionChars. */
  text: string
}

export type CodeSeverity = 'error' | 'warning' | 'info' | 'hint'

/** A problem VS Code reports (language servers, linters). */
export interface CodeDiagnostic extends LineRange {
  path: string
  severity: CodeSeverity
  message: string
  /** e.g. `ts 2322`, `eslint no-unused-vars`; null when unknown. */
  source: string | null
}

/** One editor's document, as much of it as fits. */
export interface CodeFile {
  /** Workspace-relative with forward slashes; untitled files use their title. */
  path: string
  /** The document URI: edits go back to exactly this document. */
  uri: string
  languageId: string
  /** VS Code's document version; it bumps on every change. */
  version: number
  /** Unsaved changes. */
  dirty: boolean
  lineCount: number
  /** The lines in `text`: the whole file when it fits, else a window around what the user sees. */
  window: LineRange
  /** Lines `window.start`..`window.end`, joined with '\n'. */
  text: string
  /** What's on screen in the editor. */
  visible: LineRange[]
  selection: CodeSelection | null
}

/** What one VS Code window shows right now. */
export interface CodeSnapshot {
  /** Workspace name; '' when no folder is open. */
  workspace: string
  /** The focused editor; null when no text editor is active. */
  active: CodeFile | null
  /** Other visible editors (split view), with smaller windows. */
  others: CodeFile[]
  diagnostics: CodeDiagnostic[]
  /** Visible files the user keeps from Hoot (`hoot.code.exclude`): only their paths. */
  excluded: string[]
}

/** A spot Hoot points at, highlighted in VS Code. */
export interface CodeMark {
  id: string
  path: string
  /** From the snapshot Hoot answered from; null → the extension resolves `path` in the workspace. */
  uri: string | null
  range: LineRange
  label: string
}

/** A change Hoot proposes. It is applied only when the user asks for it. */
export interface CodeEdit extends CodeMark {
  uri: string
  /** The complete new text for `range`; '' removes those lines. */
  replacement: string
  /**
   * What `range` held in the snapshot Hoot answered from. The extension
   * refuses the edit when that text is no longer at `range` or anywhere else
   * exactly once.
   */
  expected: string
}

/** Which VS Code window a connection is. */
export interface CodeWindowInfo {
  /** `vscode.env.sessionId`: unique per window. */
  id: string
  /** The workspace name, for logs and the UI. */
  name: string
}

/** The file in the focused editor, pushed on focus and editor changes. */
export interface CodeFocusFile {
  path: string
  languageId: string
}

/** The result of asking VS Code to do something (apply, reveal, show). */
export interface CodeActionResult {
  ok: boolean
  /** What to tell the user; null when there's nothing to add. */
  message: string | null
}

/** Where each tag of an answer stands, in tag order (`parseCodeAnswer`). */
export type CodeTagState = 'ready' | 'applied' | 'unavailable'

/** What the app knows about the code link right now. */
export interface CodeLinkStatus {
  /** Connected VS Code windows. */
  windows: number
  /** The focused VS Code window, if any. */
  focused: CodeWindowInfo | null
}
