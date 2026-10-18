import type { ChatDelta, HootApi, Session, SessionMeta, StatePatch } from '@hoot/core'
import { act } from 'react'
import { describe, expect, it, vi, type Mock } from 'vitest'
import { QUICK_ACTION_CHIPS, toMessageViews } from '../src/chat/views'
import { HootUIProvider } from '../src/components/HootUIProvider'
import { applyDelta, applyPatch } from '../src/state/slices'
import { useHootState } from '../src/state/useHootState'
import { ChatPane } from '../src/studio/ChatPane'
import { SessionList } from '../src/studio/SessionList'
import { StudioSidebar } from '../src/studio/StudioSidebar'
import { byName, click, render, wait, type Rendered } from './render'

const NOW = new Date(2026, 9, 18, 15, 0)
const at = (daysAgo: number): number => NOW.getTime() - daysAgo * 86_400_000
const meta = (id: string, title: string, daysAgo: number): SessionMeta => ({
  id,
  title,
  createdAt: at(daysAgo),
  updatedAt: at(daysAgo),
  messageCount: 2
})
const SESSIONS = [
  meta('a', 'Quarterly revenue chart', 0),
  meta('b', 'Excel VLOOKUP help', 0),
  meta('c', 'Translate the menu', 1),
  meta('d', 'Old chat', 30)
]

const session: Session = {
  id: 's1',
  title: 'Chart',
  createdAt: 0,
  updatedAt: 0,
  attachments: {
    att1: {
      id: 'att1',
      kind: 'capture',
      thumbDataUrl: 'data:,x',
      width: 1,
      height: 1,
      createdAt: 0
    }
  },
  messages: [
    {
      id: 'u',
      role: 'user',
      text: 'What is this?',
      attachmentIds: ['att1', 'gone'],
      createdAt: 0,
      status: 'done'
    },
    { id: 'm', role: 'assistant', text: 'A ', attachmentIds: [], createdAt: 0, status: 'streaming' }
  ]
}

describe('state mirror', () => {
  const chat = { session, stream: null, pendingAttachments: [], clipboardHint: null }

  it('applies patches only for subscribed slices, replacing them whole', () => {
    const s0 = { chat }
    const patch = {
      chat: { ...chat, stream: { sessionId: 's1', messageId: 'm' } },
      pins: { pins: [] }
    }
    const s1 = applyPatch(s0, patch as StatePatch, ['chat'])
    expect(s1.chat?.stream).toEqual({ sessionId: 's1', messageId: 'm' })
    expect('pins' in s1).toBe(false)
    expect(applyPatch(s1, { pins: { pins: [] } }, ['chat'])).toBe(s1)
  })

  it('appends deltas to the matching streaming message only', () => {
    const s = { chat }
    const d = (sessionId: string, messageId: string): ChatDelta => ({
      sessionId,
      messageId,
      delta: 'chart.'
    })
    expect(applyDelta(s, d('s1', 'm')).chat?.session?.messages[1]?.text).toBe('A chart.')
    expect(applyDelta(s, d('other', 'm'))).toBe(s)
    expect(applyDelta(s, d('s1', 'nope'))).toBe(s)
    expect(s.chat.session.messages[1]?.text).toBe('A ') // not mutated
  })

  it('useHootState subscribes, follows patches and deltas, and reports failures', async () => {
    let onPatch: ((p: StatePatch) => void) | undefined
    let onDelta: ((d: ChatDelta) => void) | undefined
    const api = {
      state: {
        subscribe: vi.fn(async () => ({ chat })),
        onPatch: (cb: (p: StatePatch) => void) => ((onPatch = cb), () => undefined)
      },
      chat: { onDelta: (cb: (d: ChatDelta) => void) => ((onDelta = cb), () => undefined) }
    } as unknown as HootApi
    const SL = ['chat'] as const
    let seen: ReturnType<typeof useHootState<'chat'>> | undefined
    function Probe(): null {
      seen = useHootState(api, SL)
      return null
    }
    render(<Probe />)
    await wait(0)
    expect(api.state.subscribe).toHaveBeenCalledWith(['chat'])
    expect(seen?.state?.chat?.session?.id).toBe('s1')
    act(() => onDelta?.({ sessionId: 's1', messageId: 'm', delta: 'chart.' }))
    expect(seen?.state?.chat?.session?.messages[1]?.text).toBe('A chart.')
    act(() => onPatch?.({ chat: { ...chat, session: null } }))
    expect(seen?.state?.chat?.session).toBeNull()

    const failing = {
      ...api,
      state: { ...api.state, subscribe: () => Promise.reject(new Error('no handler')) }
    } as HootApi
    let failed: ReturnType<typeof useHootState<'chat'>> | undefined
    function Probe2(): null {
      failed = useHootState(failing, SL)
      return null
    }
    render(<Probe2 />)
    await wait(0)
    expect(failed?.error).toBeInstanceOf(Error)
    expect(failed?.state).toBeNull()
  })

  it('useHootState replays patches that beat a late subscribe reply (#94)', async () => {
    let onPatch: ((p: StatePatch) => void) | undefined
    let reply: (p: StatePatch) => void = () => undefined
    const api = {
      state: {
        subscribe: () => new Promise<StatePatch>((r) => (reply = r)),
        onPatch: (cb: (p: StatePatch) => void) => ((onPatch = cb), () => undefined)
      },
      chat: { onDelta: () => () => undefined }
    } as unknown as HootApi
    const SL = ['chat'] as const
    let seen: ReturnType<typeof useHootState<'chat'>> | undefined
    function Probe(): null {
      seen = useHootState(api, SL)
      return null
    }
    render(<Probe />)
    // Main's newer patch lands first, then the older snapshot.
    act(() => onPatch?.({ chat: { ...chat, session: null } }))
    expect(seen?.state).toBeNull()
    await act(async () => reply({ chat }))
    expect(seen?.state?.chat?.session).toBeNull()
  })
})

describe('views', () => {
  it('maps messages and resolves attachment thumbnails, skipping missing ones', () => {
    const views = toMessageViews(session)
    expect(views[0]).toMatchObject({
      id: 'u',
      role: 'user',
      attachments: [{ id: 'att1', thumbUrl: 'data:,x' }]
    })
    expect(views[1]).toMatchObject({ id: 'm', status: 'streaming', attachments: [] })
    expect(toMessageViews(null)).toEqual([])
  })

  it('labels quick actions from core', () => {
    expect(QUICK_ACTION_CHIPS.map((a) => a.label)).toEqual([
      'Explain',
      'Extract text',
      'Translate',
      'Summarize',
      'Fix this'
    ])
  })
})

type Mocked<T> = {
  [K in keyof T]-?: T[K] extends ((...a: never[]) => unknown) | undefined
    ? Mock<NonNullable<T[K]>>
    : T[K]
}
type ListProps = Parameters<typeof SessionList>[0]

function list(
  over: Partial<ListProps> = {}
): Rendered & { props: Pick<Mocked<ListProps>, 'onOpen' | 'onRename' | 'onDelete'> } {
  const props = {
    sessions: SESSIONS,
    activeId: 'b',
    now: NOW,
    onOpen: vi.fn<ListProps['onOpen']>(),
    onRename: vi.fn<ListProps['onRename']>(),
    onDelete: vi.fn<ListProps['onDelete']>(),
    ...over
  }
  return { ...render(<SessionList {...props} />), props: props as never }
}

const rowsOf = (c: HTMLElement): HTMLButtonElement[] => [
  ...c.querySelectorAll<HTMLButtonElement>('.hoot-session__open')
]

function keydown(el: Element, key: string): void {
  act(() => {
    el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))
  })
}

describe('SessionList', () => {
  it('groups by recency under headings and marks the open chat', () => {
    const { container } = list()
    const groups = [...container.querySelectorAll('[role="group"]')]
    expect(
      groups.map((g) => document.getElementById(g.getAttribute('aria-labelledby')!)?.textContent)
    ).toEqual(['Today', 'Yesterday', 'Older'])
    const rows = rowsOf(container)
    expect(rows.map((r) => r.textContent)).toEqual([
      'Quarterly revenue chart',
      'Excel VLOOKUP help',
      'Translate the menu',
      'Old chat'
    ])
    expect(rows[1]?.getAttribute('aria-current')).toBe('page')
  })

  it('keeps one row tabbable and moves with the arrow keys, Home and End', () => {
    const { container } = list()
    const rows = rowsOf(container)
    expect(rows.map((r) => r.tabIndex)).toEqual([-1, 0, -1, -1]) // the open chat
    act(() => rows[1]!.focus())
    keydown(rows[1]!, 'ArrowDown')
    expect(document.activeElement).toBe(rows[2])
    keydown(rows[2]!, 'End')
    expect(document.activeElement).toBe(rows[3])
    keydown(rows[3]!, 'Home')
    expect(document.activeElement).toBe(rows[0])
    expect(rowsOf(container).map((r) => r.tabIndex)).toEqual([0, -1, -1, -1])
  })

  it('opens on click, renames with F2 (Enter saves, Escape cancels)', () => {
    const { container, props } = list()
    click(rowsOf(container)[0]!)
    expect(props.onOpen).toHaveBeenCalledWith('a')

    keydown(rowsOf(container)[0]!, 'F2')
    let input = container.querySelector<HTMLInputElement>('.hoot-session__rename')!
    expect(input.value).toBe('Quarterly revenue chart')
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(
        input,
        '  Q3 revenue '
      )
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    keydown(input, 'Enter')
    expect(props.onRename).toHaveBeenCalledWith('a', 'Q3 revenue')

    keydown(rowsOf(container)[0]!, 'F2')
    input = container.querySelector<HTMLInputElement>('.hoot-session__rename')!
    keydown(input, 'Escape')
    expect(props.onRename).toHaveBeenCalledTimes(1)
    expect(container.querySelector('.hoot-session__rename')).toBeNull()
  })

  it('deletes with the Delete key or the row button', () => {
    const { container, props } = list()
    keydown(rowsOf(container)[2]!, 'Delete')
    expect(props.onDelete).toHaveBeenCalledWith(SESSIONS[2])
    click(byName(container, 'button', 'Delete Old chat'))
    expect(props.onDelete).toHaveBeenLastCalledWith(SESSIONS[3])
  })

  it('explains an empty list, with or without a search', () => {
    expect(list({ sessions: [] }).container.textContent).toContain('No chats yet')
    expect(list({ sessions: [], query: 'tax' }).container.textContent).toContain(
      'No chats match “tax”'
    )
  })
})

describe('StudioSidebar', () => {
  type SidebarProps = Parameters<typeof StudioSidebar>[0]
  const sidebar = (): Rendered & { props: Mocked<Omit<SidebarProps, 'searchRef'>> } => {
    const props = {
      sessions: SESSIONS,
      activeId: null,
      onOpen: vi.fn<SidebarProps['onOpen']>(),
      onRename: vi.fn<SidebarProps['onRename']>(),
      onDelete: vi.fn<SidebarProps['onDelete']>(),
      onUndoDelete: vi.fn<SidebarProps['onUndoDelete']>(),
      onNewChat: vi.fn<SidebarProps['onNewChat']>(),
      onOpenSettings: vi.fn<SidebarProps['onOpenSettings']>(),
      summonShortcut: 'Ctrl+Shift+Space'
    }
    return {
      ...render(
        <HootUIProvider>
          <StudioSidebar {...props} />
        </HootUIProvider>
      ),
      props: props as never
    }
  }

  it('filters by title as you type, and Escape clears the search', () => {
    const { container } = sidebar()
    const search = container.querySelector<HTMLInputElement>('input[type="search"]')!
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(
        search,
        'excel'
      )
      search.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(rowsOf(container).map((r) => r.textContent)).toEqual(['Excel VLOOKUP help'])
    keydown(search, 'Escape')
    expect(rowsOf(container)).toHaveLength(4)
  })

  it('offers Undo after a delete', () => {
    const { container, props } = sidebar()
    click(byName(container, 'button', 'Delete Old chat'))
    expect(props.onDelete).toHaveBeenCalledWith('d')
    expect(document.body.textContent).toContain('Deleted “Old chat”')
    click(byName(document, 'button', 'Undo'))
    expect(props.onUndoDelete).toHaveBeenCalledWith('d')
  })

  it('has New chat and Settings', () => {
    const { container, props } = sidebar()
    click(byName(container, 'button', 'New chat'))
    click(byName(container, 'button', 'Settings'))
    expect(props.onNewChat).toHaveBeenCalled()
    expect(props.onOpenSettings).toHaveBeenCalled()
  })
})

describe('ChatPane', () => {
  it('welcomes an empty chat and wires the header actions', () => {
    const onNewChat = vi.fn()
    const onLock = vi.fn()
    const { container } = render(
      <ChatPane
        title={null}
        messages={[]}
        streaming={false}
        captureShortcut="Ctrl+Alt+C"
        onSend={() => undefined}
        onStop={() => undefined}
        onNewChat={onNewChat}
        onLock={onLock}
      />
    )
    expect(container.querySelector('h1')?.textContent).toBe('New chat')
    expect(container.textContent).toContain('What can I help with?')
    expect(container.textContent).toContain('Ctrl+Alt+C')
    click(byName(container, 'button', 'Back to the card'))
    expect(onLock).toHaveBeenCalled()
    const section = container.querySelector('section')!
    expect(document.getElementById(section.getAttribute('aria-labelledby')!)?.tagName).toBe('H1')
  })
})
