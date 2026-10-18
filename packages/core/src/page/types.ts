/** Size limits on what crosses the page link (and what goes to the model). */
export const PAGE_LIMITS = {
  urlChars: 2048,
  titleChars: 300,
  siteChars: 253,
  langChars: 35,
  selectionChars: 2_000,
  /** The text on screen right now. */
  visibleChars: 6_000,
  /** The page's main text beyond the screen. */
  textChars: 16_000,
  headings: 30,
  headingChars: 160,
  /** `[[find]]` highlights in one answer. */
  marks: 5,
  quoteChars: 300,
  labelChars: 160,
  /** A question asked from the extension's popup. */
  askChars: 2_000
} as const

/** The tab in front of the user, as the browser extension reports it. */
export interface PageInfo {
  /** The browser's tab id: highlights go back to this tab. */
  tab: number
  url: string
  title: string
}

/**
 * Why a page wasn't read: a site Hoot keeps private by default (banking,
 * email, chat, password managers, pages with a password field), the user's
 * own "never" rule, or a page an extension can't read (browser pages, PDFs).
 */
export type PageBlocked = 'private' | 'never' | 'unreadable'

/** The page as text, read by the extension when Hoot asks (never continuously). */
export interface PageSnapshot extends PageInfo {
  /** Registrable domain ("news.bbc.co.uk" → "bbc.co.uk"); '' for files. */
  site: string
  /** The page's language (`<html lang>`), '' when it doesn't say. */
  lang: string
  selection: string
  /** Text on screen right now, in reading order. */
  visible: string
  /** The page's main text, cut to PAGE_LIMITS.textChars. */
  text: string
  headings: string[]
  /** Set when the page wasn't read; the text fields are '' then. */
  blocked: PageBlocked | null
}

/** A passage Hoot highlights on the page (`[[find: "…", "label"]]`). */
export interface PageMark {
  quote: string
  label: string
}
