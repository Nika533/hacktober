import type { HootApi, SliceName, StatePatch } from '@hoot/core'
import { useEffect, useReducer } from 'react'
import { applyDelta, applyPatch, type Mirror } from './slices'

type Action<K extends SliceName> =
  | { type: 'patch'; patch: Parameters<typeof applyPatch>[1]; slices: readonly K[] }
  | { type: 'delta'; delta: Parameters<typeof applyDelta>[1] }
  | { type: 'error'; error: unknown }

interface HootState<K extends SliceName> {
  /** Null until the first subscription answer arrives. */
  state: Mirror<K> | null
  error: unknown
}

function reducer<K extends SliceName>(s: HootState<K>, a: Action<K>): HootState<K> {
  switch (a.type) {
    case 'patch':
      return { state: applyPatch(s.state ?? {}, a.patch, a.slices), error: null }
    case 'delta':
      return s.state ? { ...s, state: applyDelta(s.state, a.delta) } : s
    case 'error':
      return { ...s, error: a.error }
  }
}

/**
 * Subscribes a window to state slices through `window.hoot` and keeps a
 * local mirror: the subscribe answer, then `state:patch` events, plus
 * `chat:delta` appends when the chat slice is included. Pass the slice list
 * as a stable (module-level) array.
 */
export function useHootState<K extends SliceName>(
  api: HootApi | undefined,
  slices: readonly K[]
): HootState<K> {
  const [s, dispatch] = useReducer(reducer<K>, { state: null, error: null })
  useEffect(() => {
    if (!api) {
      dispatch({ type: 'error', error: new Error('window.hoot is not available') })
      return
    }
    let live = true
    // Hold what arrives before the subscribe reply, then replay it on top of
    // the snapshot (CONTRACTS: state subscription ordering). Otherwise a late
    // reply overwrites newer patches (#94). Early deltas are dropped: the
    // snapshot already contains every delta broadcast before it.
    let ready = false
    const early: StatePatch[] = []
    const offPatch = api.state.onPatch((patch) => {
      if (ready) dispatch({ type: 'patch', patch, slices })
      else early.push(patch)
    })
    const offDelta = slices.includes('chat' as K)
      ? api.chat.onDelta((delta) => {
          if (ready) dispatch({ type: 'delta', delta })
        })
      : undefined
    api.state.subscribe([...slices]).then(
      (snapshot) => {
        if (!live) return
        dispatch({ type: 'patch', patch: snapshot, slices })
        for (const patch of early.splice(0)) dispatch({ type: 'patch', patch, slices })
        ready = true
      },
      (error: unknown) => {
        if (live) dispatch({ type: 'error', error })
      }
    )
    return () => {
      live = false
      offPatch()
      offDelta?.()
    }
  }, [api, slices])
  return s
}
