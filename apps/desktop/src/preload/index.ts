import { contextBridge, ipcRenderer } from 'electron'
import { createHootApi } from '@hoot/core'

/** window.hoot, built from the route table in @hoot/core (ipc/routes.ts). */
const hoot = createHootApi({
  invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args),
  send: (channel, ...args) => ipcRenderer.send(channel, ...args),
  on: (channel, listener) => {
    const wrapped = (_e: Electron.IpcRendererEvent, payload: unknown): void => listener(payload)
    ipcRenderer.on(channel, wrapped)
    return () => ipcRenderer.removeListener(channel, wrapped)
  }
})

contextBridge.exposeInMainWorld('hoot', hoot)
