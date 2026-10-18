import type { Message, PageSnapshot, SliceName, StateSlices } from '@hoot/core'
import { describe, expect, it, vi, type Mock } from 'vitest'
import {
  createPageService,
  type PageAsk,
  type PageLinkConn,
  type PageServiceDeps
} from '../../src/main/page'

type Chat = StateSlices['chat']

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type -- test fixture bag
function fakeStore() {
  let chat: Chat = { session: null, stream: null, pendingAttachments: [], clipboardHint: null }
  const listeners = new Set<(changed: ReadonlySet<SliceName>) => void>()
  return {
    get: ((name: SliceName) =>
      name === 'chat' ? chat : undefined) as PageServiceDeps['store']['get'],
    onChange(cb: (changed: ReadonlySet<SliceName>) => void) {
      listeners.add(cb)
      return () => void listeners.delete(cb)
    },
    set(patch: Partial<Chat>) {
      chat = { ...chat, ...patch }
      for (const l of listeners) l(new Set(['chat']))
    }
  }
}

const snap = (over: Partial<PageSnapshot> = {}): PageSnapshot => ({
  tab: 3,
  url: 'https://example.com/a',
  title: 'Tides',
  site: 'example.com',
  lang: 'en',
  selection: '',
  visible: 'The moon pulls the oceans.',
  text: 'The moon pulls the oceans. Twice a day.',
  headings: [],
  blocked: null,
  ...over
})

const msg = (id: string, text: string, status: Message['status'] = 'done'): Message => ({
  id,
  role: 'assistant',
  text,
  attachmentIds: [],
  createdAt: 0,
  status
})

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type -- test fixture bag
function setup() {
  let t = 1_000
  const store = fakeStore()
  const asks: PageAsk[] = []
  const service = createPageService({
    store,
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    onAsk: async (ask) => {
      asks.push(ask)
    },
    now: () => t
  })
  service.start()
  const conn = (
    snapshot: PageSnapshot | null = snap()
  ): { c: PageLinkConn & { read: Mock; mark: Mock }; link: ReturnType<typeof service.connect> } => {
    const c = {
      browser: () => 'chrome' as const,
      read: vi.fn<PageLinkConn['read']>(async () => snapshot),
      mark: vi.fn<PageLinkConn['mark']>()
    }
    return { c, link: service.connect(c) }
  }
  return { service, store, asks, conn, tick: (ms: number) => (t += ms) }
}

describe('page service', () => {
  it('reads the browser the user is in, or just left', () => {
    const { service, conn, tick } = setup()
    const { link } = conn()
    expect(service.activePeer()).toBeNull()
    link.hooks.focus(true, { tab: 3, url: 'https://example.com/a', title: 'Tides' })
    const peer = service.activePeer()
    expect(peer?.browser).toBe('chrome')
    link.hooks.focus(false, { tab: 3, url: 'https://example.com/a', title: 'Tides' })
    tick(60_000)
    expect(service.activePeer()?.id).toBe(peer?.id)
    expect(service.activeAt(peer!.id)).toBe(1_000)
    tick(120_000)
    expect(service.activePeer()).toBeNull()
  })

  it('forgets a browser whose page link is off', () => {
    const { service, conn } = setup()
    const { link } = conn()
    link.hooks.focus(true, { tab: 3, url: 'https://example.com/a', title: 'Tides' })
    link.hooks.focus(true, null)
    expect(service.activePeer()).toBeNull()
  })

  it('notes the page for the chat, then highlights what the answer points at', async () => {
    const { service, store, conn } = setup()
    const { c, link } = conn()
    link.hooks.focus(true, { tab: 3, url: 'https://example.com/a', title: 'Tides' })
    const note = await service.note(service.activePeer()!.id)
    expect(note).toContain('[Browser: the web page in front of the user, read from Chrome')

    // The send starts its chat and stream; the answer finishes with a [[find]] tag.
    const session = {
      id: 's1',
      title: 't',
      createdAt: 0,
      updatedAt: 0,
      attachments: {},
      messages: [msg('a1', '', 'streaming')]
    }
    store.set({ session, stream: { sessionId: 's1', messageId: 'a1' } })
    store.set({
      session: { ...session, messages: [msg('a1', 'Here.\n[[find: "The moon pulls", "cause"]]')] },
      stream: null
    })
    expect(c.mark).toHaveBeenCalledWith(3, [{ quote: 'The moon pulls', label: 'cause' }])

    // A new chat clears them.
    store.set({ session: null })
    expect(c.mark).toHaveBeenLastCalledWith(3, [])
  })

  it('sends only what changed for the same page in the same chat', async () => {
    const { service, store, conn } = setup()
    const { link } = conn()
    link.hooks.focus(true, { tab: 3, url: 'https://example.com/a', title: 'Tides' })
    const id = service.activePeer()!.id
    store.set({
      session: { id: 's1', title: 't', createdAt: 0, updatedAt: 0, attachments: {}, messages: [] }
    })
    await service.note(id)
    expect(await service.note(id)).toContain('unchanged since the page I sent earlier')
  })

  it('returns null when the browser doesn’t answer', async () => {
    const { service, conn } = setup()
    const { link } = conn(null)
    link.hooks.focus(true, { tab: 3, url: 'https://example.com/a', title: 'Tides' })
    expect(await service.note(service.activePeer()!.id)).toBeNull()
  })

  it('hands a popup question over with its page note, continuing the chat about the same page', async () => {
    const { service, store, asks, conn } = setup()
    const { link } = conn()
    link.hooks.focus(true, { tab: 3, url: 'https://example.com/a', title: 'Tides' })
    await link.hooks.ask('What causes this?', true, snap())
    expect(asks[0]).toMatchObject({ text: 'What causes this?', voice: true, sameChat: false })
    expect(asks[0]?.note()).toContain('Page: “Tides”')

    store.set({
      session: { id: 's1', title: 't', createdAt: 0, updatedAt: 0, attachments: {}, messages: [] },
      stream: { sessionId: 's1', messageId: 'a1' }
    })
    await link.hooks.ask('And then?', false, snap())
    expect(asks[1]?.sameChat).toBe(true)
    void service
  })

  it('drops a browser when its connection closes', () => {
    const { service, conn } = setup()
    const { link } = conn()
    link.hooks.focus(true, { tab: 3, url: 'https://example.com/a', title: 'Tides' })
    link.disconnect()
    expect(service.activePeer()).toBeNull()
    expect(service.status()).toEqual({ browsers: 0, focused: null })
  })
})
