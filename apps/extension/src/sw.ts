/**
 * Service worker: bridge client (native messaging to hoot-bridge), PDF
 * interception, per-tab rate limits and caches. d2 builds it in D2-20.
 */
import { DEFAULT_LENS_SETTINGS, type LensSettings } from '@hoot/core'
import { LensSettingsSchema } from '@hoot/core/schemas'
import { createFakeLensBackend } from '@hoot/core/testing'
import type { PushMessage } from './messages'
import { createRouter } from './sw/router'
import { SETTINGS_KEY, createSettingsStore } from './sw/settings'
import { unavailableUpstream, type Upstream } from './sw/upstream'

const E2E_LOG_KEY = 'lens.e2eLog'
const E2E_LOG_MAX = 50

const defaults: LensSettings = __HOOT_E2E__
  ? { ...DEFAULT_LENS_SETTINGS, enabled: true, consentedAt: 0, mode: 'ask' }
  : DEFAULT_LENS_SETTINGS

async function logForE2e(kind: 'feedback' | 'explain', payload: unknown): Promise<void> {
  const stored = await chrome.storage.session.get(E2E_LOG_KEY)
  const log = Array.isArray(stored[E2E_LOG_KEY]) ? stored[E2E_LOG_KEY] : []
  await chrome.storage.session.set({
    [E2E_LOG_KEY]: [...log, { kind, payload, at: Date.now() }].slice(-E2E_LOG_MAX)
  })
}

const upstream: () => Upstream = __HOOT_E2E__
  ? lazy(() => {
      const fake = createFakeLensBackend({ delayMs: 250, settings: defaults })
      return {
        assess: (ctx, opts) => fake.assess(ctx, opts),
        rewrite: (request, opts) => fake.rewrite(request, opts),
        getProfile: () => fake.getProfile(),
        feedback: async (event) => {
          await fake.feedback(event)
          await logForE2e('feedback', event)
        },
        explainMore: async (ctx) => {
          await fake.explainMore(ctx)
          await logForE2e('explain', ctx)
        }
      }
    })
  : () => unavailableUpstream

function lazy<T>(create: () => T): () => T {
  let value: T | undefined
  return () => (value ??= create())
}

const router = createRouter({
  extensionId: chrome.runtime.id,
  upstream,
  settings: createSettingsStore(chrome.storage.local, defaults)
})

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  void router.handle(message, sender).then(sendResponse)
  return true
})

chrome.storage.onChanged.addListener((changes, area) => {
  const change = changes[SETTINGS_KEY]
  if (area !== 'local' || !change) return
  const parsed = LensSettingsSchema.safeParse(change.newValue)
  if (!parsed.success) return
  const push: PushMessage = { type: 'lens.settings.changed', lens: parsed.data }
  chrome.runtime.sendMessage(push).catch(() => undefined)
  void chrome.tabs.query({}).then((tabs) => {
    for (const tab of tabs) {
      if (tab.id !== undefined) chrome.tabs.sendMessage(tab.id, push).catch(() => undefined)
    }
  })
})
