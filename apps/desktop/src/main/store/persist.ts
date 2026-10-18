import type { Unsubscribe } from '@hoot/core'
import type { Persistence } from './persistence'
import type { Store } from './store'
import type { DebouncedWriter } from './writer'

/**
 * Persist-on-change: slice flushes become debounced writes. The active
 * session's content is saved by the chat service (D1-13); here `sessions`
 * only keeps the index's metadata list and activeId in sync.
 */
export function watchPersistence(
  store: Store,
  persistence: Persistence,
  writer: DebouncedWriter
): Unsubscribe {
  let lastActiveId = store.get('chat').session?.id ?? null
  return store.onChange((changed) => {
    if (changed.has('settings'))
      writer.schedule('settings', () => persistence.saveSettings(store.get('settings').settings))
    if (changed.has('pins'))
      writer.schedule('pins', () => persistence.savePins(store.get('pins').pins))
    // The index also records which session is active, so a chat switch
    // (chat slice only) must write it too.
    const activeId = store.get('chat').session?.id ?? null
    const activeChanged = changed.has('chat') && activeId !== lastActiveId
    lastActiveId = activeId
    if (changed.has('sessions') || activeChanged)
      writer.schedule('sessions.index', () =>
        persistence.saveSessionIndex({
          activeId: store.get('chat').session?.id ?? null,
          sessions: store.get('sessions').list
        })
      )
  })
}
