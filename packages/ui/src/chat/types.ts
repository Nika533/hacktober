import type { AiErrorCode, MessageStatus } from '@hoot/core'

/**
 * Presentational shapes for the chat components. They are smaller than the
 * stored chat types in @hoot/core: renderers map Message/Attachment onto
 * these (attachment ids resolved to thumbnails), so the UI never depends on
 * how chats are persisted or sent over IPC. Codes and statuses are core's.
 */

export interface ChatAttachmentView {
  id: string
  /** Thumbnail URL (data: or file URL the window's CSP allows). */
  thumbUrl: string
  /** Accessible description; defaults to "Capture N". */
  label?: string
}

export interface ChatMessageView {
  id: string
  role: 'user' | 'assistant'
  /** Display text. Assistant text is Markdown. */
  text: string
  status: MessageStatus
  error?: AiErrorCode
  attachments?: readonly ChatAttachmentView[]
}

export interface QuickAction<T extends string = string> {
  id: T
  label: string
}
