import { DEFAULT_LENS_SETTINGS, type LensSettings, type PageSnapshot } from '@hoot/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { findQuotes, indexText, showMarks } from '../src/content/highlight'
import { readPage, readText } from '../src/content/snapshot'
import type { BridgeEvent } from '../src/sw/bridge'
import { blockedFor, createPageLink, type PageLinkOptions, type TabLike } from '../src/sw/page'

afterEach(() => {
  document.body.innerHTML = ''
  document.title = ''
})

describe('reading the page (content script)', () => {
  it('reads blocks on their own lines and leaves out hidden text, form fields and scripts', () => {
    document.body.innerHTML = `
      <h1>Tides</h1>
      <p>The moon <b>pulls</b> the oceans.</p>
      <p hidden>Secret</p>
      <div aria-hidden="true">Decor</div>
      <script>var x = 1</script>
      <input value="typed">
      <p>Twice a day.</p>`
    expect(readText(document.body, window, 1000)).toBe(
      'Tides\nThe moon pulls the oceans.\nTwice a day.'
    )
  })

  it('cuts long text to the limit', () => {
    document.body.innerHTML = `<p>${'word '.repeat(100)}</p>`
    const text = readText(document.body, window, 50)
    expect(text.length).toBeLessThanOrEqual(50)
    expect(text.endsWith('…')).toBe(true)
  })

  it('reads the title, the main content, headings and the selection', () => {
    document.title = 'How tides work'
    document.body.innerHTML = `<nav>Menu</nav><main><h2>Why</h2><p id="p">The moon pulls.</p></main>`
    const range = document.createRange()
    range.selectNodeContents(document.getElementById('p')!)
    getSelection()?.removeAllRanges()
    getSelection()?.addRange(range)
    const read = readPage(document, window)
    expect(read).toMatchObject({
      title: 'How tides work',
      selection: 'The moon pulls.',
      headings: ['Why'],
      blocked: null
    })
    expect(read.text).toBe('Why\nThe moon pulls.')
    getSelection()?.removeAllRanges()
  })

  it('never reads a page with a password field', () => {
    document.body.innerHTML = '<p>Account 1234</p><input type="password">'
    expect(readPage(document, window)).toMatchObject({ blocked: 'private', visible: '', text: '' })
  })
})

describe('highlighting passages (content script)', () => {
  it('finds quotes whatever their case, spacing and quote marks', () => {
    document.body.innerHTML = '<p>It’s the <em>Moon</em>   that pulls — always.</p>'
    expect(indexText(document.body).text).toBe("it's the moon that pulls - always.")
    const [range] = findQuotes(document.body, ['"it\'s the moon that pulls"'])
    expect(range?.toString()).toBe('It’s the Moon   that pulls')
    expect(findQuotes(document.body, ['not on the page'])).toEqual([])
  })

  it('registers a CSS highlight and scrolls to it; an empty list clears it', () => {
    document.body.innerHTML = '<p>The moon pulls the oceans.</p>'
    const registry = new Map<string, unknown>()
    const win = window as unknown as { Highlight?: unknown }
    const before = win.Highlight
    const css = vi
      .spyOn(window, 'CSS', 'get')
      .mockReturnValue({ highlights: registry } as unknown as typeof CSS)
    win.Highlight = class {
      ranges: Range[]
      constructor(...ranges: Range[]) {
        this.ranges = ranges
      }
    }
    const scroll = vi.fn()
    HTMLElement.prototype.scrollIntoView = scroll
    try {
      expect(showMarks(document, [{ quote: 'moon pulls', label: '' }])).toBe(1)
      expect(registry.has('hoot-find')).toBe(true)
      expect(document.getElementById('hoot-find-style')).not.toBeNull()
      expect(scroll).toHaveBeenCalled()
      expect(showMarks(document, [])).toBe(0)
      expect(registry.has('hoot-find')).toBe(false)
    } finally {
      css.mockRestore()
      win.Highlight = before
    }
  })
})

describe('blockedFor', () => {
  const settings: LensSettings = { ...DEFAULT_LENS_SETTINGS, sites: { 'quiet.com': 'never' } }
  it('keeps private and excluded sites unread, and browser pages unreadable', () => {
    expect(blockedFor('https://mail.google.com/mail/u/0', settings)).toBe('private')
    expect(blockedFor('https://www.quiet.com/a', settings)).toBe('never')
    expect(blockedFor('chrome://settings', settings)).toBe('unreadable')
    expect(blockedFor('https://example.com/', settings)).toBeNull()
    expect(blockedFor('file:///C:/notes.html', settings)).toBeNull()
  })
})

describe('the page link (service worker)', () => {
  const TAB: TabLike = { id: 9, url: 'https://example.com/a', title: 'Tides' }
  const READ = {
    url: 'https://example.com/a',
    title: 'Tides',
    lang: 'en',
    selection: '',
    visible: 'The moon pulls.',
    text: 'The moon pulls. Twice a day.',
    headings: [],
    blocked: null
  }

  // eslint-disable-next-line @typescript-eslint/explicit-function-return-type -- test fixture bag
  function setup(over: Partial<PageLinkOptions> = {}) {
    const listeners = new Set<(e: BridgeEvent) => void>()
    const bridge = {
      pageFocus: vi.fn(async () => undefined),
      pageSnapshot: vi.fn(),
      pageAsk: vi.fn(async () => undefined),
      subscribe: (l: (e: BridgeEvent) => void) => {
        listeners.add(l)
        return () => void listeners.delete(l)
      }
    }
    const options: PageLinkOptions = {
      bridge,
      settings: async () => DEFAULT_LENS_SETTINGS,
      enabled: async () => true,
      frontTab: async () => TAB,
      browserFocused: async () => true,
      ask: vi.fn(async () => READ),
      warm: vi.fn(),
      debounceMs: 0,
      ...over
    }
    const link = createPageLink(options)
    const emit = (e: BridgeEvent): void => {
      for (const l of [...listeners]) l(e)
    }
    return { link, bridge, options, emit }
  }
  const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 5))

  it('tells the app which tab is in front, once per change', async () => {
    const { link, bridge, options } = setup()
    link.focusChanged(true)
    await settle()
    link.focusChanged()
    await settle()
    expect(bridge.pageFocus).toHaveBeenCalledTimes(1)
    expect(bridge.pageFocus).toHaveBeenCalledWith(true, {
      tab: 9,
      url: 'https://example.com/a',
      title: 'Tides'
    })
    expect(options.warm).toHaveBeenCalled()
    link.focusChanged(false)
    await settle()
    expect(bridge.pageFocus).toHaveBeenLastCalledWith(false, expect.objectContaining({ tab: 9 }))
  })

  it('hides the address of a private page, and says nothing when the link is off', async () => {
    const mail = setup({
      frontTab: async () => ({ id: 2, url: 'https://mail.google.com/', title: 'Inbox (3)' })
    })
    mail.link.focusChanged(true)
    await settle()
    expect(mail.bridge.pageFocus).toHaveBeenCalledWith(true, { tab: 2, url: '', title: '' })

    const off = setup({ enabled: async () => false })
    off.link.focusChanged(true)
    await settle()
    expect(off.bridge.pageFocus).toHaveBeenCalledWith(true, null)
  })

  it('answers the app’s page.read with the front tab’s page', async () => {
    const { bridge, emit } = setup()
    emit({ type: 'page.read', reqId: 'page-1' })
    await settle()
    const [reqId, snapshot] = bridge.pageSnapshot.mock.calls[0] as [string, PageSnapshot]
    expect(reqId).toBe('page-1')
    expect(snapshot).toMatchObject({ tab: 9, site: 'example.com', visible: 'The moon pulls.' })
  })

  it('reads nothing from private pages, and marks pages without a content script unreadable', async () => {
    const mail = setup({
      frontTab: async () => ({ id: 2, url: 'https://mail.google.com/', title: 'Inbox' })
    })
    mail.emit({ type: 'page.read', reqId: 'r' })
    await settle()
    expect(mail.options.ask).not.toHaveBeenCalled()
    expect(mail.bridge.pageSnapshot.mock.calls[0]?.[1]).toMatchObject({
      blocked: 'private',
      url: '',
      title: '',
      site: ''
    })

    const store = setup({ ask: vi.fn(async () => Promise.reject(new Error('no receiver'))) })
    store.emit({ type: 'page.read', reqId: 'r' })
    await settle()
    expect(store.bridge.pageSnapshot.mock.calls[0]?.[1]).toMatchObject({ blocked: 'unreadable' })
  })

  it('puts the app’s highlights on the tab', async () => {
    const { options, emit } = setup()
    emit({ type: 'page.marks', tab: 9, marks: [{ quote: 'moon', label: '' }] })
    await settle()
    expect(options.ask).toHaveBeenCalledWith(9, {
      type: 'page.marks',
      marks: [{ quote: 'moon', label: '' }]
    })
  })

  it('sends a popup question with the page', async () => {
    const { link, bridge } = setup()
    await link.ask('What pulls?', true)
    expect(bridge.pageAsk).toHaveBeenCalledWith(
      'What pulls?',
      true,
      expect.objectContaining({ tab: 9, text: 'The moon pulls. Twice a day.' })
    )
  })

  it('tells the popup when the page link is off', async () => {
    expect(await setup({ enabled: async () => false }).link.current()).toMatchObject({
      blocked: 'off'
    })
  })
})
