/**
 * Service worker: bridge client (native messaging to hoot-bridge), PDF
 * interception, per-tab rate limits and caches. d2 builds it in D2-20.
 */
import { DEFAULT_LENS_SETTINGS, type Browser, type LensSettings } from '@hoot/core'
import { LensSettingsSchema } from '@hoot/core/schemas'
import type { PushMessage } from './messages'
import { TransportError, createBridgeClient, type Connect } from './sw/bridge'
import { FILE_ASKED_KEY, PDF_ENABLED_KEY, createPdfRouter } from './sw/pdf'
import { createRouter } from './sw/router'
import { SETTINGS_KEY, createSettingsStore } from './sw/settings'
import { createLensSync } from './sw/sync'
import { nativeTransport, webSocketTransport } from './sw/transports'

const DEV_BRIDGE_KEY = 'lens.devBridge'

const defaults: LensSettings = __HOOT_E2E__
  ? { ...DEFAULT_LENS_SETTINGS, enabled: true, consentedAt: 0, mode: 'ask' }
  : DEFAULT_LENS_SETTINGS

const connect: Connect = __HOOT_E2E__
  ? async (handlers) => {
      const url = (await chrome.storage.local.get(DEV_BRIDGE_KEY))[DEV_BRIDGE_KEY]
      if (typeof url !== 'string') throw new TransportError('not_running')
      return webSocketTransport(url)(handlers)
    }
  : nativeTransport

function currentBrowser(): Browser {
  const data = (navigator as { userAgentData?: { brands?: Array<{ brand: string }> } })
    .userAgentData
  const brands = (data?.brands ?? []).map((entry) => entry.brand.toLowerCase())
  if (brands.some((brand) => brand.includes('edge'))) return 'edge'
  if (brands.some((brand) => brand.includes('brave'))) return 'brave'
  if (brands.some((brand) => brand.includes('chrom'))) return 'chrome'
  return 'other'
}

function broadcast(push: PushMessage, toTabs = true): void {
  chrome.runtime.sendMessage(push).catch(() => undefined)
  if (!toTabs) return
  void chrome.tabs.query({}).then((tabs) => {
    for (const tab of tabs) {
      if (tab.id !== undefined) chrome.tabs.sendMessage(tab.id, push).catch(() => undefined)
    }
  })
}

const bridge = createBridgeClient({
  connect,
  extVersion: chrome.runtime.getManifest().version,
  browser: currentBrowser()
})

const sync = createLensSync({
  bridge,
  store: createSettingsStore(chrome.storage.local, defaults),
  local: chrome.storage.local,
  session: chrome.storage.session,
  onProfile: (profile) => broadcast({ type: 'lens.profile.changed', profile })
})

bridge.subscribe((event) => {
  if (event.type === 'status')
    broadcast({ type: 'lens.status.changed', status: event.status }, false)
})

const stored = async (key: string): Promise<unknown> => (await chrome.storage.local.get(key))[key]

const pdf = createPdfRouter({
  base: chrome.runtime.getURL(''),
  enabled: async () => (await stored(PDF_ENABLED_KEY)) !== false,
  fileAccess: () => chrome.extension.isAllowedFileSchemeAccess(),
  fileAsked: async () => (await stored(FILE_ASKED_KEY)) === true,
  redirect: (tabId, url) => void chrome.tabs.update(tabId, { url })
})

chrome.webRequest.onHeadersReceived.addListener(
  (details) => void pdf.onResponse(details),
  { urls: ['http://*/*', 'https://*/*'], types: ['main_frame'] },
  ['responseHeaders']
)
chrome.webNavigation.onBeforeNavigate.addListener((details) => void pdf.onNavigation(details), {
  url: [{ schemes: ['file'] }]
})

const router = createRouter({
  extensionId: chrome.runtime.id,
  upstream: () => bridge,
  settings: sync.settings,
  profile: () => sync.profile(),
  status: (connectNow) => sync.status(connectNow),
  warm: () => sync.warm(),
  allowNativePdf: (url) => pdf.allowNative(url)
})

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  void router.handle(message, sender).then(sendResponse)
  return true
})

chrome.storage.onChanged.addListener((changes, area) => {
  const change = changes[SETTINGS_KEY]
  if (area !== 'local' || !change) return
  const parsed = LensSettingsSchema.safeParse(change.newValue)
  if (parsed.success) broadcast({ type: 'lens.settings.changed', lens: parsed.data })
})
