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

const setup = (): { store: Store; broadcaster: Broadcaster; pump: () => void } => {
  const store = createStore(
    initialSlices({
      settings: DEFAULT_SETTINGS,
      hasApiKey: false,
      keyStorage: 'os-encrypted',
      system
    })
  )
  const pending: (() => void)[] = []
  const broadcaster = createBroadcaster(store, (fn) => pending.push(fn))
  return { store, broadcaster, pump: () => pending.splice(0).forEach((f) => f()) }
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

  it('emit reaches every sink when no slice filter is given', () => {
    const { broadcaster } = setup()
    const a = new FakeSink(1)
    const b = new FakeSink(2)
    broadcaster.subscribe(a, ['chat'])
    broadcaster.subscribe(b, ['pins'])
    broadcaster.emit('reader:document', { name: 'x.pdf' })
    expect(a.messages).toEqual([['reader:document', { name: 'x.pdf' }]])
    expect(b.messages).toEqual([['reader:document', { name: 'x.pdf' }]])
  })

  it('emit with a slice filter reaches only subscribers of that slice', () => {
    const { broadcaster } = setup()
    const lensSink = new FakeSink(1)
    const chatSink = new FakeSink(2)
    broadcaster.subscribe(lensSink, ['lens'])
    broadcaster.subscribe(chatSink, ['chat'])
    broadcaster.emit('lens:profileChanged', { seq: 1 }, 'lens')
    expect(lensSink.messages).toEqual([['lens:profileChanged', { seq: 1 }]])
    expect(chatSink.messages).toEqual([])
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

  it('re-syncs the sink once on the next tick after subscribe', () => {
    const { store, broadcaster, pump } = setup()
    const sink = new FakeSink(1)
    const patch = broadcaster.subscribe(sink, ['buddy', 'system'])
    expect(patch.buddy).toBeDefined()
    pump()
    const syncs = sink.messages.filter(([c]) => c === 'state:patch')
    expect(syncs.length).toBe(1)
    const sync = syncs[0]![1] as Record<string, unknown>
    expect(sync['buddy']).toEqual(store.get('buddy'))
    expect(sync['system']).toEqual(store.get('system'))
    pump()
    expect(sink.messages.length).toBe(1)
  })

  it('the re-sync includes changes that landed between subscribe and the tick', () => {
    const { store, broadcaster, pump } = setup()
    const sink = new FakeSink(1)
    broadcaster.subscribe(sink, ['buddy'])
    store.update('buddy', { mood: 'thinking' })
    pump()
    const patch = sink.messages.at(-1)![1] as Record<string, unknown>
    expect((patch['buddy'] as { mood: string }).mood).toBe('thinking')
  })

  it('a re-subscribe supersedes the pending re-sync', () => {
    const { broadcaster, pump } = setup()
    const sink = new FakeSink(1)
    broadcaster.subscribe(sink, ['buddy'])
    broadcaster.subscribe(sink, ['pins'])
    pump()
    expect(sink.messages.length).toBe(1)
    const [channel, patch] = sink.messages[0] as [string, Record<string, unknown>]
    expect(channel).toBe('state:patch')
    expect(patch['pins']).toBeDefined()
    expect(patch['buddy']).toBeUndefined()
  })

  it('a destroyed sink gets no re-sync', () => {
    const { broadcaster, pump } = setup()
    const sink = new FakeSink(1)
    broadcaster.subscribe(sink, ['buddy'])
    sink.destroy()
    pump()
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
