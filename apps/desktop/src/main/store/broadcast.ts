import {
  HOOT_API_ROUTES,
  type ChatDelta,
  type EventChannel,
  type SliceName,
  type StatePatch
} from '@hoot/core'
import type { Store } from './store'

const PATCH_CHANNEL = HOOT_API_ROUTES.state.onPatch.channel
const DELTA_CHANNEL = HOOT_API_ROUTES.chat.onDelta.channel

/** Adapter over WebContents; tests use a fake. */
export interface PatchSink {
  id: number
  send(channel: string, payload: unknown): void
  onDestroyed(cb: () => void): void
}

export interface Broadcaster {
  /**
   * Registers (replacing any previous subscription for that id),
   * auto-unsubscribes on destroy, returns the current snapshot.
   */
  subscribe(sink: PatchSink, slices: readonly SliceName[]): StatePatch
  unsubscribe(id: number): void
  /** Immediate, synchronous, to every sink subscribed to 'chat'. Never batched. */
  delta(d: ChatDelta): void
  /**
   * Send an arbitrary event channel to every sink — or only sinks subscribed
   * to `onlySlice` (e.g. `lens:profileChanged` to 'lens' subscribers).
   */
  emit(channel: EventChannel, payload: unknown, onlySlice?: SliceName): void
}

interface Subscription {
  sink: PatchSink
  slices: ReadonlySet<SliceName>
}

/**
 * Per-window state subscriptions. On each store flush every sink gets one
 * `state:patch` with only the intersection of changed slices and its
 * subscription. `chat:delta` is sent synchronously, before the patch that
 * contains the appended text, so renderers never double-count.
 *
 * `schedule` (tests inject a queue) drives the post-subscribe re-sync.
 */
export function createBroadcaster(
  store: Store,
  schedule: (fn: () => void) => void = setImmediate
): Broadcaster {
  const subs = new Map<number, Subscription>()

  const unsubscribe = (id: number): void => {
    subs.delete(id)
  }

  store.onChange((changed) => {
    for (const { sink, slices } of subs.values()) {
      const hit = [...changed].filter((s) => slices.has(s))
      if (hit.length > 0) sink.send(PATCH_CHANNEL, store.snapshot(hit))
    }
  })

  return {
    subscribe(sink, slices) {
      // One destroy hook per window, however often it re-subscribes.
      if (!subs.has(sink.id)) sink.onDestroyed(() => unsubscribe(sink.id))
      const sub: Subscription = { sink, slices: new Set(slices) }
      subs.set(sink.id, sub)
      const snapshot = store.snapshot(slices)
      // The invoke reply can land after a newer patch on a slow renderer;
      // one re-sync per subscription converges the mirror regardless.
      schedule(() => {
        // The chat slice we send already contains every delta broadcast so
        // far and later deltas apply on top, so this can't double-append.
        if (subs.get(sink.id) === sub) sink.send(PATCH_CHANNEL, store.snapshot(slices))
      })
      return snapshot
    },
    unsubscribe,
    delta(d) {
      for (const { sink, slices } of subs.values()) {
        if (slices.has('chat')) sink.send(DELTA_CHANNEL, d)
      }
    },
    emit(channel, payload, onlySlice) {
      for (const { sink, slices } of subs.values()) {
        if (onlySlice !== undefined && !slices.has(onlySlice)) continue
        sink.send(channel, payload)
      }
    }
  }
}

export function sinkFor(wc: Electron.WebContents): PatchSink {
  return {
    id: wc.id,
    send(channel, payload) {
      if (!wc.isDestroyed()) wc.send(channel, payload)
    },
    onDestroyed(cb) {
      wc.once('destroyed', cb)
    }
  }
}
