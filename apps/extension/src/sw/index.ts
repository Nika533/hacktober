import type { LensSettingsView } from '@hoot/lens-dom'
import { parseSettings, type PushMessage } from '../messages'
import { createDevUpstream } from './dev-upstream'
import { createRouter } from './router'
import { unavailableUpstream, type Upstream } from './upstream'

const SETTINGS_KEY = 'lens.settings'
const PAUSED_KEY = 'lens.pausedSites'
const DEV_LOG_KEY = 'lens.devLog'
const DEV_LOG_MAX = 50

const DEFAULT_SETTINGS: LensSettingsView = {
  enabled: __HOOT_DEV__,
  mode: 'ask',
  copy: 'original',
  highStakes: 'gloss'
}

async function readSettings(): Promise<LensSettingsView> {
  const stored = await chrome.storage.local.get(SETTINGS_KEY)
  return parseSettings(stored[SETTINGS_KEY]) ?? DEFAULT_SETTINGS
}

async function pausedSites(): Promise<string[]> {
  const stored = await chrome.storage.local.get(PAUSED_KEY)
  const value = stored[PAUSED_KEY]
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : []
}

const upstream: () => Upstream = __HOOT_DEV__
  ? lazy(() =>
      createDevUpstream({
        async push(kind, payload) {
          const stored = await chrome.storage.session.get(DEV_LOG_KEY)
          const log = Array.isArray(stored[DEV_LOG_KEY]) ? stored[DEV_LOG_KEY] : []
          await chrome.storage.session.set({
            [DEV_LOG_KEY]: [...log, { kind, payload, at: Date.now() }].slice(-DEV_LOG_MAX)
          })
        }
      })
    )
  : () => unavailableUpstream

function lazy<T>(create: () => T): () => T {
  let value: T | undefined
  return () => (value ??= create())
}

const router = createRouter({
  extensionId: chrome.runtime.id,
  upstream,
  settings: { get: readSettings },
  sites: {
    isPaused: async (site) => (await pausedSites()).includes(site),
    async setPaused(site, paused) {
      const sites = new Set(await pausedSites())
      if (paused) sites.add(site)
      else sites.delete(site)
      await chrome.storage.local.set({ [PAUSED_KEY]: [...sites] })
    }
  }
})

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  void router.handle(message, sender).then(sendResponse)
  return true
})

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes[SETTINGS_KEY]) return
  void readSettings().then(async (settings) => {
    const push: PushMessage = { type: 'lens.settings.changed', settings }
    for (const tab of await chrome.tabs.query({})) {
      if (tab.id !== undefined) chrome.tabs.sendMessage(tab.id, push).catch(() => undefined)
    }
  })
})
