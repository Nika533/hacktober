import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, type StateSlices } from '@hoot/core'
import { createBroadcaster, type Broadcaster, type PatchSink } from '../src/main/store/broadcast'
import { createStore, initialSlices, type Store } from '../src/main/store/store'

const system: StateSlices['system'] = {
  platform: 'win32',
  version: '1.0.0',
  packaged: false,
  accentColor: '#CA5010',
  darkMode: false,
  highContrast: false
}

class FakeSink implements PatchSink {
  messages: [string, unknown][] = []
  private destroyCb: (() => void) | null = null

  constructor(readonly id: number) {}

  send(channel: string, payload: unknown): void {
    this.messages.push([channel, payload])
  }

  onDestroyed(cb: () => void): void {
    this.destroyCb = cb
  }

  destroy(): void {
    this.destroyCb?.()
  }
}

const setup = (): { store: Store; broadcaster: Broadcaster } => {
  const store = createStore(initialSlices({ settings: DEFAULT_SETTINGS, system }))
  const broadcaster = createBroadcaster(store)
  return { store, broadcaster }
}

const flush = async (): Promise<void> => {
  await new Promise((r) => setTimeout(r, 0))
}

describe('broadcaster', () => {
  it('subscribe returns the snapshot of the requested slices', () => {
    const { store, broadcaster } = setup()
    const sink = new FakeSink(1)
    const patch = broadcaster.subscribe(sink, ['buddy', 'system'])
    expect(patch.buddy).toBe(store.get('buddy'))
    expect(patch.system).toBe(store.get('system'))
    expect(patch.chat).toBeUndefined()
  })

  it('sends one patch per flush with only the subscribed intersection', async () => {
    const { store, broadcaster } = setup()
    const sink = new FakeSink(1)
    broadcaster.subscribe(sink, ['buddy'])
    store.update('buddy', { mood: 'thinking' })
    store.update('pins', { pins: [] }) // not subscribed
    await flush()
    expect(sink.messages.length).toBe(1)
    const [channel, patch] = sink.messages[0] as [string, Record<string, unknown>]
    expect(channel).toBe('state:patch')
    expect(Object.keys(patch)).toEqual(['buddy'])
    expect((patch['buddy'] as { mood: string }).mood).toBe('thinking')
  })

  it('coalesces two updates in one tick into one patch', async () => {
    const { store, broadcaster } = setup()
    const sink = new FakeSink(1)
    broadcaster.subscribe(sink, ['buddy'])
    store.update('buddy', { mood: 'thinking' })
    store.update('buddy', { greeting: null })
    await flush()
    expect(sink.messages.length).toBe(1)
  })

  it('sends nothing when no subscribed slice changed', async () => {
    const { store, broadcaster } = setup()
    const sink = new FakeSink(1)
    broadcaster.subscribe(sink, ['pins'])
    store.update('buddy', { mood: 'thinking' })
    await flush()
    expect(sink.messages).toEqual([])
  })

  it('delta reaches only chat subscribers, synchronously', () => {
    const { broadcaster } = setup()
    const chatSink = new FakeSink(1)
    const pinsSink = new FakeSink(2)
    broadcaster.subscribe(chatSink, ['chat'])
    broadcaster.subscribe(pinsSink, ['pins'])
    const d = { sessionId: 's1', messageId: 'm1', delta: 'hi' }
    broadcaster.delta(d)
    expect(chatSink.messages).toEqual([['chat:delta', d]])
    expect(pinsSink.messages).toEqual([])
  })

  it('delta precedes the patch that contains the appended text', async () => {
    const { store, broadcaster } = setup()
    const sink = new FakeSink(1)
    broadcaster.subscribe(sink, ['chat'])
    const d = { sessionId: 's1', messageId: 'm1', delta: 'hi' }
    // Invariant order: broadcast delta → mutate → patch.
    broadcaster.delta(d)
    store.set('chat', {
      ...store.get('chat'),
      stream: { sessionId: 's1', messageId: 'm1' }
    })
    await flush()
    expect(sink.messages.map(([c]) => c)).toEqual(['chat:delta', 'state:patch'])
  })

  it('unsubscribes on destroy', async () => {
    const { store, broadcaster } = setup()
    const sink = new FakeSink(1)
    broadcaster.subscribe(sink, ['buddy'])
    sink.destroy()
    store.update('buddy', { mood: 'error' })
    await flush()
    expect(sink.messages).toEqual([])
  })

  it('explicit unsubscribe stops delivery', async () => {
    const { store, broadcaster } = setup()
    const sink = new FakeSink(1)
    broadcaster.subscribe(sink, ['buddy'])
    broadcaster.unsubscribe(1)
    store.update('buddy', { mood: 'error' })
    await flush()
    expect(sink.messages).toEqual([])
  })

  it('re-subscribing replaces the previous subscription', async () => {
    const { store, broadcaster } = setup()
    const sink = new FakeSink(1)
    broadcaster.subscribe(sink, ['buddy'])
    broadcaster.subscribe(sink, ['pins'])
    store.update('buddy', { mood: 'error' })
    await flush()
    expect(sink.messages).toEqual([])
    store.set('pins', { pins: [] })
    await flush()
    expect(sink.messages.length).toBe(1)
  })
})
