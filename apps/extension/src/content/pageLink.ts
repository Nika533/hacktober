import type { PageMark } from '@hoot/core'
import { showMarks } from './highlight'
import { readPage } from './snapshot'

/** What the service worker asks the top frame (chrome.tabs.sendMessage, frameId 0). */
export type PageLinkRequest = { type: 'page.read' } | { type: 'page.marks'; marks: PageMark[] }

interface RuntimeLike {
  onMessage: {
    addListener(
      listener: (message: unknown, sender: unknown, reply: (response: unknown) => void) => void
    ): void
  }
}

const isRequest = (raw: unknown): raw is PageLinkRequest => {
  const type = (raw as { type?: unknown } | null)?.type
  return (
    type === 'page.read' ||
    (type === 'page.marks' && Array.isArray((raw as { marks?: unknown }).marks))
  )
}

/** Answers the service worker's page-link requests for this frame. */
export function listenForPageLink(runtime: RuntimeLike, doc: Document, win: Window): void {
  runtime.onMessage.addListener((message, _sender, reply) => {
    if (!isRequest(message)) return
    if (message.type === 'page.read') reply(readPage(doc, win))
    else reply({ found: showMarks(doc, message.marks) })
  })
}
