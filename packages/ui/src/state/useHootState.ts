import type { HootApi, SliceName } from '@hoot/core'
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
    const offPatch = api.state.onPatch((patch) => dispatch({ type: 'patch', patch, slices }))
    const offDelta = slices.includes('chat' as K)
      ? api.chat.onDelta((delta) => dispatch({ type: 'delta', delta }))
      : undefined
    api.state.subscribe([...slices]).then(
      (patch) => {
        if (live) dispatch({ type: 'patch', patch, slices })
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
