import {
  PAGE_LIMITS,
  isDeniedHost,
  registrableDomain,
  type LensSettings,
  type PageBlocked,
  type PageInfo,
  type PageSnapshot
} from '@hoot/core'
import { PageSnapshotSchema } from '@hoot/core/schemas'
import type { PageLinkRequest } from '../content/pageLink'
import type { CurrentPage } from '../messages'
import type { BridgeClient } from './bridge'

/** chrome.storage.local: false turns the page link off (the options page switch). */
export const PAGE_ENABLED_KEY = 'page.enabled'
const READ_TIMEOUT_MS = 1_200
const FOCUS_DEBOUNCE_MS = 150

export interface TabLike {
  id?: number
  url?: string
  title?: string
}

export interface PageLinkOptions {
  bridge: Pick<BridgeClient, 'pageFocus' | 'pageSnapshot' | 'pageAsk' | 'subscribe'>
  settings: () => Promise<LensSettings>
  enabled: () => Promise<boolean>
  /** The tab in front: the active tab of the last focused window. */
  frontTab: () => Promise<TabLike | null>
  /** Whether a browser window has focus right now. */
  browserFocused: () => Promise<boolean>
  /** Send a request to a tab's top frame (the content script). */
  ask: (tab: number, request: PageLinkRequest) => Promise<unknown>
  /** Connect to the app in the background (respecting the back-off). */
  warm: () => void
  debounceMs?: number
}

export interface PageLink {
  /** Browser focus (or the front tab) changed; undefined keeps the focus as it was. */
  focusChanged(focused?: boolean): void
  /** The popup's header: the tab it would ask about. */
  current(): Promise<CurrentPage | null>
  /** The popup asked (typed or spoken): send it with the page to Hoot. */
  ask(text: string, voice: boolean): Promise<void>
}

const clip = (text: string, max: number): string => text.slice(0, max)

function hostOf(url: string): { host: string; readable: boolean } {
  try {
    const u = new URL(url)
    if (u.protocol === 'http:' || u.protocol === 'https:') {
      return { host: u.hostname.toLowerCase(), readable: true }
    }
    return { host: '', readable: u.protocol === 'file:' }
  } catch {
    return { host: '', readable: false }
  }
}

/** Why Hoot won't read a page at `url`, before asking the page anything. */
export function blockedFor(url: string, settings: LensSettings | null): PageBlocked | null {
  const { host, readable } = hostOf(url)
  if (!readable) return 'unreadable'
  if (!host) return null
  if (isDeniedHost(host)) return 'private'
  return settings?.sites[registrableDomain(host)] === 'never' ? 'never' : null
}

const infoOf = (tab: TabLike & { id: number }): PageInfo => ({
  tab: tab.id,
  url: clip(tab.url ?? '', PAGE_LIMITS.urlChars),
  title: clip(tab.title ?? '', PAGE_LIMITS.titleChars)
})

function withTimeout<T>(work: Promise<T>, ms: number): Promise<T | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), ms)
    work.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      () => {
        clearTimeout(timer)
        resolve(null)
      }
    )
  })
}

/**
 * The extension's half of the page link: tells the app which tab is in front
 * (while connected), reads that tab's page when the app asks, puts the
 * app's highlights on it, and sends the popup's questions. Private pages
 * (banking, email, chat, password fields), sites on the user's "never" list
 * and browser pages are never read: the app only learns that they're private.
 */
export function createPageLink(options: PageLinkOptions): PageLink {
  const { bridge } = options
  const debounceMs = options.debounceMs ?? FOCUS_DEBOUNCE_MS
  let focused = false
  let timer: ReturnType<typeof setTimeout> | undefined
  let last = ''

  const settings = (): Promise<LensSettings | null> => options.settings().catch(() => null)

  async function snapshotOf(tab: TabLike | null): Promise<PageSnapshot | null> {
    if (tab?.id === undefined || !(await options.enabled())) return null
    const info = infoOf({ ...tab, id: tab.id })
    const { host } = hostOf(info.url)
    const site = host ? registrableDomain(host) : ''
    const empty = { site, lang: '', selection: '', visible: '', text: '', headings: [] }
    const blocked = blockedFor(info.url, await settings())
    // A private page doesn't even send its address, title or site.
    const hidden = { ...info, url: '', title: '', ...empty, site: '' }
    if (blocked === 'private' || blocked === 'never') return { ...hidden, blocked }
    if (blocked) return { ...info, ...empty, blocked }
    const read = await withTimeout(options.ask(info.tab, { type: 'page.read' }), READ_TIMEOUT_MS)
    const parsed = PageSnapshotSchema.safeParse({ ...(read as object | null), tab: info.tab, site })
    if (!read || !parsed.success) return { ...info, ...empty, blocked: 'unreadable' }
    if (parsed.data.blocked === 'private') return { ...hidden, blocked: 'private' }
    return parsed.data
  }

  /** The front tab as the app may see it: no address for private pages. */
  async function frontInfo(): Promise<PageInfo | null> {
    if (!(await options.enabled())) return null
    const tab = await options.frontTab()
    if (tab?.id === undefined) return null
    const info = infoOf({ ...tab, id: tab.id })
    const blocked = blockedFor(info.url, await settings())
    return blocked === 'private' || blocked === 'never' ? { ...info, url: '', title: '' } : info
  }

  async function report(): Promise<void> {
    const page = await frontInfo()
    const key = JSON.stringify([focused, page])
    if (key === last) return
    last = key
    if (focused && page) options.warm()
    await bridge.pageFocus(focused, page)
  }

  bridge.subscribe((event) => {
    if (event.type === 'status' && event.status.state === 'connected') {
      // A new connection: the app knows nothing yet.
      last = ''
      void options
        .browserFocused()
        .catch(() => false)
        .then((now) => {
          focused = now
          return report()
        })
    } else if (event.type === 'page.read') {
      void options
        .frontTab()
        .then(snapshotOf)
        .catch(() => null)
        .then((snapshot) => bridge.pageSnapshot(event.reqId, snapshot))
    } else if (event.type === 'page.marks') {
      void options.ask(event.tab, { type: 'page.marks', marks: event.marks }).catch(() => undefined)
    }
  })

  return {
    focusChanged(next) {
      if (next !== undefined) focused = next
      clearTimeout(timer)
      timer = setTimeout(() => void report().catch(() => undefined), debounceMs)
    },

    async current() {
      const tab = await options.frontTab()
      if (tab?.id === undefined) return null
      const info = infoOf({ ...tab, id: tab.id })
      if (!(await options.enabled())) return { ...info, blocked: 'off' }
      return { ...info, blocked: blockedFor(info.url, await settings()) }
    },

    async ask(text, voice) {
      const snapshot = await snapshotOf(await options.frontTab())
      await bridge.pageAsk(text, voice, snapshot)
    }
  }
}
