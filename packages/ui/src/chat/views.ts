import {
  QUICK_ACTIONS,
  stripAnnotationTags,
  type Attachment,
  type QuickActionId,
  type Session
} from '@hoot/core'
import type { ChatAttachmentView, ChatMessageView, QuickAction } from './types'

/** Core attachments → thumbnails for AttachmentsRow / Transcript. */
export function toAttachmentViews(attachments: readonly Attachment[]): ChatAttachmentView[] {
  return attachments.map((a) => ({ id: a.id, thumbUrl: a.thumbDataUrl }))
}

/** A session's messages as Transcript rows, attachment ids resolved to thumbnails. */
export function toMessageViews(session: Session | null | undefined): ChatMessageView[] {
  if (!session) return []
  return session.messages.map((m) => ({
    id: m.id,
    role: m.role,
    // A chat from the live overlay, continued in the card or Studio: no on-screen tags.
    text: m.role === 'assistant' ? stripAnnotationTags(m.text) : m.text,
    status: m.status,
    error: m.error,
    attachments: m.attachmentIds.flatMap((id) => {
      const a = session.attachments[id]
      return a ? [{ id, thumbUrl: a.thumbDataUrl }] : []
    })
  }))
}

const ORDER: readonly QuickActionId[] = ['explain', 'extract', 'translate', 'summarize', 'fix']

/** The quick-action chips, labelled from core's prompt catalogue. */
export const QUICK_ACTION_CHIPS: readonly QuickAction<QuickActionId>[] = ORDER.map((id) => ({
  id,
  label: QUICK_ACTIONS[id].label
}))
