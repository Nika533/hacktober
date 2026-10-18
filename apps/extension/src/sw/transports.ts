import { NATIVE_HOST_NAME } from '@hoot/core'
import { TransportError, type Connect } from './bridge'

const NOT_INSTALLED = /not found|forbidden/i

/** Native messaging to hoot-bridge (C-21), which relays to the app's pipe. */
export const nativeTransport: Connect = (handlers) => {
  const port = chrome.runtime.connectNative(NATIVE_HOST_NAME)
  port.onMessage.addListener((message: unknown) => handlers.message(message))
  port.onDisconnect.addListener(() => {
    const error = chrome.runtime.lastError?.message ?? ''
    handlers.closed(NOT_INSTALLED.test(error) ? 'not_installed' : 'not_running')
  })
  return { send: (message) => port.postMessage(message), close: () => port.disconnect() }
}

/** The dev/e2e transport: one JSON message per WebSocket text frame (CONTRACTS.md). */
export const webSocketTransport =
  (url: string): Connect =>
  (handlers) =>
    new Promise((resolve, reject) => {
      const socket = new WebSocket(url)
      let open = false
      socket.onopen = () => {
        open = true
        resolve({
          send: (message) => socket.send(JSON.stringify(message)),
          close: () => socket.close()
        })
      }
      socket.onmessage = (event) => {
        try {
          handlers.message(JSON.parse(String(event.data)))
        } catch {
          return
        }
      }
      socket.onclose = () => {
        if (open) handlers.closed('not_running')
        else reject(new TransportError('not_running'))
      }
    })
