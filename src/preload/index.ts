import { contextBridge, ipcRenderer } from 'electron'
import { IPC, type AppInfo } from '../shared/ipc'
import type { AppState, OverlayCommit, OverlayInit, Point, Settings } from '../shared/types'
import type { DeltaPayload, RequestedMode, SendPayload } from '../shared/ipc'

function onChannel<T>(channel: string, cb: (payload: T) => void): () => void {
  const listener = (_e: Electron.IpcRendererEvent, payload: T): void => cb(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

const hoot = {
  getState: (): Promise<AppState> => ipcRenderer.invoke(IPC.stateGet),
  onState: (cb: (s: AppState) => void) => onChannel<AppState>(IPC.stateChanged, cb),
  onDelta: (cb: (d: DeltaPayload) => void) => onChannel<DeltaPayload>(IPC.aiDelta, cb),
  onCursor: (cb: (p: Point) => void) => onChannel<Point>(IPC.cursor, cb),

  buddy: {
    requestMode: (m: RequestedMode) => ipcRenderer.send(IPC.buddyRequestMode, m),
    exitDone: () => ipcRenderer.send(IPC.buddyExitDone),
    setIgnoreMouse: (ignore: boolean) => ipcRenderer.send(IPC.buddySetIgnoreMouse, ignore),
    dragStart: () => ipcRenderer.send(IPC.buddyDragStart),
    dragMove: () => ipcRenderer.send(IPC.buddyDragMove),
    dragEnd: (v: { vx: number; vy: number }) => ipcRenderer.send(IPC.buddyDragEnd, v),
    setCursorTracking: (on: boolean) => ipcRenderer.send(IPC.buddySetCursorTracking, on),
    dismissGreeting: () => ipcRenderer.send(IPC.buddyDismissGreeting)
  },

  ai: {
    send: (p: SendPayload) => ipcRenderer.send(IPC.aiSend, p),
    stop: () => ipcRenderer.send(IPC.aiStop),
    regenerate: () => ipcRenderer.send(IPC.aiRegenerate)
  },

  sessions: {
    new: () => ipcRenderer.send(IPC.sessionsNew),
    open: (id: string) => ipcRenderer.send(IPC.sessionsOpen, id),
    rename: (id: string, title: string) => ipcRenderer.send(IPC.sessionsRename, id, title),
    delete: (id: string) => ipcRenderer.send(IPC.sessionsDelete, id),
    undoDelete: (id: string) => ipcRenderer.send(IPC.sessionsUndoDelete, id),
    clearAll: () => ipcRenderer.send(IPC.sessionsClearAll),
    search: (q: string) => ipcRenderer.invoke(IPC.sessionsSearch, q)
  },

  windows: {
    unlock: () => ipcRenderer.send(IPC.windowsUnlock),
    lock: () => ipcRenderer.send(IPC.windowsLock),
    openSettings: () => ipcRenderer.send(IPC.windowsOpenSettings)
  },

  capture: {
    start: (mode?: 'lasso' | 'rect' | 'full') => ipcRenderer.send(IPC.captureStart, mode),
    removeAttachment: (id: string) => ipcRenderer.send(IPC.captureRemoveAttachment, id)
  },

  overlay: {
    getInit: (): Promise<OverlayInit | null> => ipcRenderer.invoke(IPC.overlayGetInit),
    onOpen: (cb: () => void) => onChannel<void>(IPC.overlayOpen, cb),
    onClosed: (cb: () => void) => onChannel<void>(IPC.overlayClosed, cb),
    commit: (p: OverlayCommit) => ipcRenderer.send(IPC.overlayCommit, p),
    cancel: () => ipcRenderer.send(IPC.overlayCancel)
  },

  attachments: {
    open: (id: string) => ipcRenderer.send(IPC.attachmentOpen, id)
  },

  clipboard: {
    writeText: (t: string) => ipcRenderer.send(IPC.clipboardWriteText, t),
    arm: () => ipcRenderer.send(IPC.clipboardArm),
    dismiss: () => ipcRenderer.send(IPC.clipboardDismiss)
  },

  pins: {
    create: (messageId: string) => ipcRenderer.send(IPC.pinsCreate, messageId),
    /** Note windows only — the pin is identified by the sender. */
    resize: (height: number) => ipcRenderer.send(IPC.pinsResize, height),
    close: () => ipcRenderer.send(IPC.pinsClose),
    openInHoot: () => ipcRenderer.send(IPC.pinsOpenInHoot)
  },

  settings: {
    update: (p: Partial<Settings>) => ipcRenderer.send(IPC.settingsUpdate, p),
    setApiKey: (k: string) => ipcRenderer.send(IPC.settingsSetApiKey, k),
    clearApiKey: () => ipcRenderer.send(IPC.settingsClearApiKey),
    validateApiKey: (k: string) => ipcRenderer.invoke(IPC.settingsValidateApiKey, k),
    resetAnchor: () => ipcRenderer.send(IPC.settingsResetAnchor),
    openExternal: (url: string) => ipcRenderer.send(IPC.appOpenExternal, url)
  },

  app: {
    info: (): Promise<AppInfo> => ipcRenderer.invoke(IPC.appInfo)
  },

  onboarding: {
    finish: () => ipcRenderer.send(IPC.onboardingFinish),
    setStep: (n: number) => ipcRenderer.send(IPC.onboardingStep, n)
  }
}

export type HootApi = typeof hoot

contextBridge.exposeInMainWorld('hoot', hoot)
