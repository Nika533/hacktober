import type { Browser } from '../protocol/bridge'
import type { PageSnapshot } from './types'

/** How Hoot asks the model to point at a page (parsed by `parsePageAnswer`). */
export const PAGE_GUIDE = `How to answer about this page:
- Answer from the page text above: it is what the user sees in their browser right now. If the answer isn't in it, say so.
- To show the user a passage, put [[find: "exact words", "short label"]] on its own line after the sentence it belongs to, with 3 to 12 consecutive words copied exactly from the page text. Hoot highlights them on the page and scrolls to the first one. Use at most 3 [[find]] tags, never in backticks or code blocks.
- You can't click, type or scroll on the page: tell the user what to do instead.`

const BROWSER_NAMES: Record<Browser, string> = {
  chrome: 'Chrome',
  edge: 'Edge',
  brave: 'Brave',
  arc: 'Arc',
  other: 'the browser'
}

export const browserName = (browser: Browser): string => BROWSER_NAMES[browser]

/** What the model was last shown of the page in this chat. */
export interface PageNoteMemory {
  url: string
  /** Hashes of the page text and of what was on screen. */
  text: string
  visible: string
}

export interface PageNote {
  /** Appended to what's sent (never shown). */
  note: string
  /** Pass back as `previous` for the next message in the same chat. */
  memory: PageNoteMemory | null
}

/** FNV-1a, 32-bit: enough to tell "same text" from "changed". */
function hash(text: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(16)
}

const quoted = (text: string): string => `"""\n${text.replace(/"""/g, '“””')}\n"""`
const oneLine = (s: string): string => s.replace(/\s+/g, ' ').trim()

function selected(selection: string): string {
  const s = oneLine(selection)
  return s ? `Selected on the page: “${s}”` : 'Selected on the page: nothing.'
}

/**
 * What goes with a message about the page in the user's browser, instead of
 * a screenshot. The first message in a chat gets the page (what's on screen,
 * the main text, the headings, PAGE_GUIDE); later ones about the same,
 * unchanged page only say what's on screen and selected now. A blocked page
 * says why it wasn't read and nothing else (not even its title).
 */
export function pageNote(
  s: PageSnapshot,
  previous: PageNoteMemory | null,
  browser: Browser = 'other'
): PageNote {
  const from = browserName(browser)
  if (s.blocked === 'private' || s.blocked === 'never') {
    const why =
      s.blocked === 'private'
        ? 'which Hoot keeps private (banking, email, chat, passwords)'
        : 'a site the user told Hoot never to read'
    return {
      note: `[Browser: the user is on ${s.site || 'a page'} in ${from}, ${why}, so Hoot didn't read the page. Don't guess what it shows.]`,
      memory: null
    }
  }
  if (s.blocked === 'unreadable') {
    return {
      note: `[Browser: the user is on “${oneLine(s.title) || s.url}” in ${from}, a page Hoot can't read (a browser page, a PDF or an empty page).]`,
      memory: null
    }
  }
  const memory: PageNoteMemory = { url: s.url, text: hash(s.text), visible: hash(s.visible) }
  const page = `“${oneLine(s.title) || 'Untitled'}” — ${s.url}`
  if (previous && previous.url === s.url && previous.text === memory.text) {
    const screen =
      previous.visible === memory.visible
        ? 'The same part of it is on screen.'
        : `On screen now:\n${quoted(s.visible)}`
    return {
      note: [
        `[Browser: still on ${page} in ${from}, unchanged since the page I sent earlier in this chat.]`,
        selected(s.selection),
        screen
      ].join('\n'),
      memory
    }
  }
  const parts = [
    `[Browser: the web page in front of the user, read from ${from} (not a screenshot), as of this message.]`,
    `Page: ${page}`
  ]
  if (s.lang) parts.push(`Language: ${s.lang}`)
  parts.push(selected(s.selection), `On screen now:\n${quoted(s.visible || '(nothing readable)')}`)
  if (s.headings.length) parts.push(`Headings: ${s.headings.map(oneLine).join(' · ')}`)
  if (s.text && s.text !== s.visible) parts.push(`More of the page:\n${quoted(s.text)}`)
  parts.push(PAGE_GUIDE)
  return { note: parts.join('\n'), memory }
}
