import type { Session } from '../types/chat'

export interface ImageBlock {
  type: 'image'
  source: { type: 'base64'; media_type: 'image/png'; data: string }
}

export interface TextBlock {
  type: 'text'
  text: string
}

export type ContentBlock = TextBlock | ImageBlock

export interface ConversationMessage {
  role: 'user' | 'assistant'
  content: string | ContentBlock[]
}

export const MAX_MESSAGES = 24
export const MAX_IMAGES = 8

const OMITTED_IMAGE_PLACEHOLDER = '[Earlier capture omitted to save space]'

export type ImageResolver = (attachmentId: string) => { base64: string; mediaType: 'image/png' }

/**
 * Convert a session into the message list sent to the model.
 * - uses `sentText` when present
 * - skips empty/errored assistant turns, keeps partial stopped text
 * - keeps the last 24 messages, drops leading assistant turns
 * - user content = image blocks (attachment order) then a text block
 * - at most 8 images: the 8 most recent; older ones become a placeholder
 */
export function buildMessages(
  session: Session,
  resolveImage: ImageResolver
): ConversationMessage[] {
  const kept = session.messages
    .filter((m) => {
      if (m.role === 'assistant') {
        if (m.status === 'error') return false
        const text = m.sentText ?? m.text
        if (!text || text.length === 0) return false
      }
      return true
    })
    .slice(-MAX_MESSAGES)

  while (kept.length > 0 && kept[0]?.role !== 'user') kept.shift()

  // Collect image-bearing user messages in order to apply the image cap.
  // In a live-screen chat, each turn's last image is the whole screen then;
  // once a newer turn brings a fresh screen, earlier full-screen frames are
  // superseded (the first turn's circled crop, before its screen frame, stays).
  const liveScreens = kept.flatMap((m) => {
    if (m.role !== 'user') return []
    const last = m.attachmentIds.at(-1)
    return last &&
      session.attachments[last] &&
      (m.sentText ?? m.text).includes('[Live screen attached:')
      ? [last]
      : []
  })
  const staleScreens = new Set(liveScreens.slice(0, -1))
  const imageOrder: { messageIndex: number; attachmentId: string }[] = []
  kept.forEach((m, messageIndex) => {
    if (m.role !== 'user') return
    for (const id of m.attachmentIds) {
      if (session.attachments[id] && !staleScreens.has(id)) {
        imageOrder.push({ messageIndex, attachmentId: id })
      }
    }
  })
  const omitted = new Set([
    ...staleScreens,
    ...imageOrder.slice(0, Math.max(0, imageOrder.length - MAX_IMAGES)).map((e) => e.attachmentId)
  ])

  const out: ConversationMessage[] = []
  for (const m of kept) {
    const text = m.sentText ?? m.text
    if (m.role === 'assistant') {
      out.push({ role: 'assistant', content: text })
      continue
    }
    const blocks: ContentBlock[] = []
    for (const id of m.attachmentIds) {
      const att = session.attachments[id]
      if (!att) continue
      if (omitted.has(id)) {
        blocks.push({ type: 'text', text: OMITTED_IMAGE_PLACEHOLDER })
      } else {
        const img = resolveImage(id)
        blocks.push({
          type: 'image',
          source: { type: 'base64', media_type: img.mediaType, data: img.base64 }
        })
      }
    }
    blocks.push({ type: 'text', text: text || '(see attached capture)' })
    out.push({ role: 'user', content: blocks })
  }
  return out
}

/**
 * Session title heuristic: strip markdown + newlines, first 6 words,
 * 48-char cap, '…' when truncated, 'New chat' when empty.
 */
export function titleFrom(text: string): string {
  const stripped = text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[#>*_~`|-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  if (!stripped) return 'New chat'

  const words = stripped.split(' ')
  let title = words.slice(0, 6).join(' ')
  const truncated = words.length > 6 || title.length > 48
  if (title.length > 48) title = title.slice(0, 48).trimEnd()
  if (truncated) title += '…'
  return title
}
