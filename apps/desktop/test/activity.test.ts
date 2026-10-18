import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, type StateSlices } from '@hoot/core'
import { applyChatActivity, type ActivityTimers } from '../src/main/buddy/activity'
import { createStore, initialSlices, type Store } from '../src/main/store/store'

const system: StateSlices['system'] = {
  platform: 'win32',
  version: '1.0.0',
  packaged: false,
  accentColor: '#CA5010',
  darkMode: false,
  highContrast: false
}

const makeStore = (): Store =>
  createStore(
    initialSlices({
      settings: DEFAULT_SETTINGS,
      hasApiKey: false,
      keyStorage: 'os-encrypted',
      system
    })
  )

/** Manual timers: run() fires every pending callback oldest-first. */
const makeTimers = (): ActivityTimers & { pending(): number; run(): void } => {
  const queue: { fn: () => void }[] = []
  return {
    setTimeout: (fn) => {
      const h = { fn }
      queue.push(h)
      return h
    },
    clearTimeout: (h) => {
      const i = queue.indexOf(h as { fn: () => void })
      if (i >= 0) queue.splice(i, 1)
    },
    pending: () => queue.length,
    run: () => {
      for (const h of queue.splice(0)) h.fn()
    }
  }
}

describe('applyChatActivity', () => {
  it('maps thinking and talking straight onto the mood', () => {
    const store = makeStore()
    const timers = makeTimers()
    applyChatActivity(store, 'thinking', timers)
    expect(store.get('buddy').mood).toBe('thinking')
    applyChatActivity(store, 'talking', timers)
    expect(store.get('buddy').mood).toBe('talking')
    expect(timers.pending()).toBe(0)
  })

  it('celebrates on done, sets answerReady, then settles to idle', () => {
    const store = makeStore() // mode 'hidden'
    const timers = makeTimers()
    applyChatActivity(store, 'done', timers)
    expect(store.get('buddy').mood).toBe('celebrate')
    expect(store.get('buddy').answerReady).toBe(true)
    expect(timers.pending()).toBe(1)
    timers.run()
    expect(store.get('buddy').mood).toBe('idle')
    expect(store.get('buddy').answerReady).toBe(true) // badge stays until cleared elsewhere
  })

  it('does not set answerReady while the card is open', () => {
    const store = makeStore()
    store.update('buddy', { mode: 'card' })
    applyChatActivity(store, 'done', makeTimers())
    expect(store.get('buddy').mood).toBe('celebrate')
    expect(store.get('buddy').answerReady).toBe(false)
  })

  it('shows error, then settles to idle without touching answerReady', () => {
    const store = makeStore()
    const timers = makeTimers()
    applyChatActivity(store, 'error', timers)
    expect(store.get('buddy').mood).toBe('error')
    expect(store.get('buddy').answerReady).toBe(false)
    timers.run()
    expect(store.get('buddy').mood).toBe('idle')
  })

  it('maps stopped straight to idle', () => {
    const store = makeStore()
    store.update('buddy', { mood: 'talking' })
    const timers = makeTimers()
    applyChatActivity(store, 'stopped', timers)
    expect(store.get('buddy').mood).toBe('idle')
    expect(timers.pending()).toBe(0)
  })

  it('a new activity cancels the pending settle timer', () => {
    const store = makeStore()
    const timers = makeTimers()
    applyChatActivity(store, 'done', timers)
    expect(store.get('buddy').mood).toBe('celebrate')
    applyChatActivity(store, 'thinking', timers) // new stream supersedes
    expect(store.get('buddy').mood).toBe('thinking')
    expect(timers.pending()).toBe(0) // the done settle was cancelled
    timers.run()
    expect(store.get('buddy').mood).toBe('thinking') // no stale idle
  })
})
