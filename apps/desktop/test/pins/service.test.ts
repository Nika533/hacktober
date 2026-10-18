import { DEFAULT_SETTINGS, HOOT_API_ROUTES, type Pin, type Rect, type Session } from '@hoot/core'
import { describe, expect, it } from 'vitest'
import { createPinsHandlers, createPinsService, type NoteWindows } from '../../src/main/pins'
import { createStore, initialSlices } from '../../src/main/store/store'

function fakeWindows(): NoteWindows & {
  opened: string[]
  closed: string[]
  senders: Map<number, string>
} {
  const opened: string[] = []
  const closed: string[] = []
  const senders = new Map<number, string>()
  return {
    opened,
    closed,
    senders,
    open: (pin: Pin) => {
      opened.push(pin.id)
    },
    close: (id) => {
      closed.push(id)
    },
    hideAll: () => undefined,
    pinIdFor: (senderId) => senders.get(senderId) ?? null,
    resize: () => undefined,
    placement: (i): Rect => ({ x: 100 + i * 28, y: 100, width: 300, height: 200 })
  }
}

const session: Session = {
  id: 's1',
  title: 'Chat',
  createdAt: 0,
  updatedAt: 0,
  attachments: {},
  messages: [
    { id: 'u1', role: 'user', text: 'q', attachmentIds: [], createdAt: 0, status: 'done' },
    {
      id: 'a1',
      role: 'assistant',
      text: '**Answer**',
      attachmentIds: [],
      createdAt: 0,
      status: 'done'
    },
    {
      id: 'a2',
      role: 'assistant',
      text: 'partial',
      attachmentIds: [],
      createdAt: 0,
      status: 'streaming'
    }
  ]
}

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type -- test fixture bag
function setup(restorePins = true) {
  const store = createStore(
    initialSlices({
      settings: { ...DEFAULT_SETTINGS, restorePins },
      hasApiKey: true,
      keyStorage: 'os-encrypted',
      system: {
        platform: 'win32',
        version: '1',
        packaged: false,
        accentColor: '#0078D4',
        darkMode: false,
        highContrast: false
      }
    })
  )
  store.update('chat', { session })
  const windows = fakeWindows()
  const opened: string[] = []
  let n = 0
  const pins = createPinsService({
    store,
    windows,
    openSession: async (id) => {
      opened.push(id)
    },
    newId: () => `p${++n}`,
    now: () => 42
  })
  return { store, windows, pins, openedSessions: opened }
}

describe('pins service', () => {
  it('pins a finished answer once and shows the existing note on repeat', async () => {
    const { store, windows, pins } = setup()
    await pins.create('a1')
    await pins.create('a1')
    expect(store.get('pins').pins).toEqual([
      {
        id: 'p1',
        text: '**Answer**',
        sessionId: 's1',
        messageId: 'a1',
        bounds: { x: 100, y: 100, width: 300, height: 200 },
        createdAt: 42
      }
    ])
    expect(windows.opened).toEqual(['p1', 'p1'])
  })

  it('pins a live-overlay answer without its on-screen tags', async () => {
    const { store, pins } = setup()
    const tagged = {
      ...session.messages[1]!,
      id: 'a3',
      text: 'Click **Save**.\n[[point: 120, 40, "Save"]]\nThen close it.'
    }
    store.update('chat', { session: { ...session, messages: [...session.messages, tagged] } })
    await pins.create('a3')
    expect(store.get('pins').pins[0]?.text).toBe('Click **Save**.\nThen close it.')
  })

  it('refuses streaming answers, user turns and unknown messages', async () => {
    const { pins, store } = setup()
    await expect(pins.create('a2')).rejects.toThrow()
    await expect(pins.create('u1')).rejects.toThrow()
    await expect(pins.create('nope')).rejects.toThrow()
    expect(store.get('pins').pins).toEqual([])
  })

  it('pins arbitrary text (glossary) once, cascading new notes', async () => {
    const { pins, store } = setup()
    await pins.create('a1')
    await pins.createFromText('API (a way for programs to talk)')
    await pins.createFromText('API (a way for programs to talk)')
    const list = store.get('pins').pins
    expect(list).toHaveLength(2)
    expect(list[1]).toMatchObject({ sessionId: null, messageId: null, bounds: { x: 128 } })
  })

  it('identifies note windows by sender for close, open in Hoot and resize', async () => {
    const { pins, windows, store, openedSessions } = setup()
    await pins.create('a1')
    windows.senders.set(7, 'p1')
    await pins.openInHootFrom(7)
    expect(openedSessions).toEqual(['s1'])
    await pins.closeFrom(99)
    expect(store.get('pins').pins).toHaveLength(1)
    await pins.closeFrom(7)
    expect(store.get('pins').pins).toEqual([])
    expect(windows.closed).toEqual(['p1'])
  })

  it('saves moved bounds and restores notes only when the setting is on', async () => {
    const on = setup(true)
    await on.pins.create('a1')
    on.pins.setBounds('p1', { x: 5, y: 6, width: 300, height: 180 })
    expect(on.store.get('pins').pins[0]?.bounds).toEqual({ x: 5, y: 6, width: 300, height: 180 })
    on.windows.opened.length = 0
    on.pins.restore()
    expect(on.windows.opened).toEqual(['p1'])

    const off = setup(false)
    await off.pins.create('a1')
    off.windows.opened.length = 0
    off.pins.restore()
    expect(off.windows.opened).toEqual([])
  })

  it('exposes handlers for every pins channel', () => {
    const { pins } = setup()
    const h = createPinsHandlers(pins)
    const routes = Object.values(HOOT_API_ROUTES.pins)
    const of = (kind: string): string[] =>
      routes
        .filter((r) => r.kind === kind)
        .map((r) => r.channel)
        .sort()
    expect(Object.keys(h.invoke).sort()).toEqual(of('invoke'))
    expect(Object.keys(h.send).sort()).toEqual(of('send'))
  })
})
