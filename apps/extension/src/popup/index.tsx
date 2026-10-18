/** Toolbar popup: ask Hoot about the page in front, typed or spoken. */
import '@hoot/ui/styles.css'
import './popup.css'
import { HootUIProvider } from '@hoot/ui'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import type { Reply } from '../messages'
import { PopupApp, type PopupHost } from './App'
import { browserRecognizer } from './speech'

const host: PopupHost = {
  request: async <T,>(message: unknown): Promise<Reply<T>> => {
    try {
      return (await chrome.runtime.sendMessage(message)) as Reply<T>
    } catch {
      return { ok: false, error: { code: 'app_unavailable', message: 'no service worker' } }
    }
  },
  micPermission: async () => {
    try {
      return (await navigator.permissions.query({ name: 'microphone' as PermissionName })).state
    } catch {
      return 'prompt'
    }
  },
  openMicSetup: () => void chrome.tabs.create({ url: chrome.runtime.getURL('mic.html') }),
  close: () => window.close()
}

const root = document.getElementById('root')
if (root) {
  createRoot(root).render(
    <StrictMode>
      <HootUIProvider>
        <PopupApp host={host} recognizer={browserRecognizer(window, navigator.language)} />
      </HootUIProvider>
    </StrictMode>
  )
}
