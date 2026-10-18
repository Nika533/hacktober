import {
  VOICE_OFF,
  type Settings,
  type SliceName,
  type StatePatch,
  type StateSlices,
  type Unsubscribe
} from '@hoot/core'

export interface Store {
  get<K extends SliceName>(name: K): StateSlices[K]
  /** Replace the whole slice (slices are immutable values; never mutate in place). */
  set<K extends SliceName>(name: K, next: StateSlices[K]): void
  /** Shallow-merge into the slice. */
  update<K extends SliceName>(name: K, patch: Partial<StateSlices[K]>): void
  snapshot(slices: readonly SliceName[]): StatePatch
  /**
   * Called once per flush with every slice changed since the last flush
   * (coalesced in a microtask).
   */
  onChange(cb: (changed: ReadonlySet<SliceName>) => void): Unsubscribe
}

export function createStore(initial: StateSlices): Store {
  const state = { ...initial }
  const listeners = new Set<(changed: ReadonlySet<SliceName>) => void>()
  const changed = new Set<SliceName>()
  let flushing = false

  const recordChange = (name: SliceName): void => {
    changed.add(name)
    if (flushing) return
    flushing = true
    queueMicrotask(() => {
      const batch: ReadonlySet<SliceName> = new Set(changed)
      changed.clear()
      flushing = false
      for (const cb of listeners) cb(batch)
    })
  }

  const set = <K extends SliceName>(name: K, next: StateSlices[K]): void => {
    // Identical reference → nothing to publish.
    if (Object.is(state[name], next)) return
    state[name] = next
    recordChange(name)
  }

  return {
    get: (name) => state[name],
    set,
    update(name, patch) {
      set(name, { ...state[name], ...patch } as StateSlices[typeof name])
    },
    snapshot(slices) {
      const patch: StatePatch = {}
      for (const name of slices) Object.assign(patch, { [name]: state[name] })
      return patch
    },
    onChange(cb) {
      listeners.add(cb)
      return () => listeners.delete(cb)
    }
  }
}

export function initialSlices(input: {
  settings: Settings
  hasApiKey: boolean
  keyStorage: 'os-encrypted' | 'memory'
  system: StateSlices['system']
}): StateSlices {
  return {
    settings: {
      settings: input.settings,
      hasApiKey: input.hasApiKey,
      keyStorage: input.keyStorage,
      hotkeyErrors: []
    },
    system: input.system,
    buddy: { mode: 'hidden', layout: null, mood: 'idle', greeting: null, answerReady: false },
    studio: { open: false, view: 'chat', onboardingStep: 0 },
    chat: { session: null, stream: null, pendingAttachments: [], clipboardHint: null },
    sessions: { list: [], pendingDelete: null },
    pins: { pins: [] },
    lens: { bridge: 'stopped', clients: 0, lastError: null },
    voice: VOICE_OFF,
    agents: { list: [] }
  }
}
