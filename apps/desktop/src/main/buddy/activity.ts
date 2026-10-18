import type { ChatActivity } from '../chat'
import type { Store } from '../store/store'

export interface ActivityTimers {
  setTimeout(fn: () => void, ms: number): unknown
  clearTimeout(handle: unknown): void
}

const defaultTimers: ActivityTimers = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (h) => clearTimeout(h as NodeJS.Timeout)
}

const CELEBRATE_MS = 1200
const ERROR_MS = 1500

// The pending "settle back to idle" timer, one per store — kept out of the
// slice so a new activity can always cancel the previous one.
const settleTimers = new WeakMap<Store, unknown>()

/**
 * Map a chat stream's lifecycle onto the buddy slice: thinking → talking →
 * celebrate/error → idle. `answerReady` (the dot badge) is set only when the
 * card isn't already open — the user is looking at the answer then anyway.
 */
export function applyChatActivity(
  store: Store,
  activity: ChatActivity,
  timers: ActivityTimers = defaultTimers
): void {
  const pending = settleTimers.get(store)
  if (pending !== undefined) {
    timers.clearTimeout(pending)
    settleTimers.delete(store)
  }
  const settle = (ms: number): void => {
    settleTimers.set(
      store,
      timers.setTimeout(() => {
        settleTimers.delete(store)
        store.update('buddy', { mood: 'idle' })
      }, ms)
    )
  }
  switch (activity) {
    case 'thinking':
      store.update('buddy', { mood: 'thinking' })
      break
    case 'talking':
      store.update('buddy', { mood: 'talking' })
      break
    case 'done':
      store.update('buddy', {
        mood: 'celebrate',
        answerReady: store.get('buddy').mode !== 'card'
      })
      settle(CELEBRATE_MS)
      break
    case 'error':
      store.update('buddy', { mood: 'error' })
      settle(ERROR_MS)
      break
    case 'stopped':
      store.update('buddy', { mood: 'idle' })
      break
  }
}
