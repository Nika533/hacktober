import type {
  AppState,
  OverlayCommit,
  OverlayInit,
  QuickActionId,
  SessionMeta,
  Settings
} from './types'

/** Typed IPC channel names shared between main, preload and renderer. */
export const IPC = {
  // state (main → renderer)
  stateChanged: 'state:changed',
  aiDelta: 'ai:delta',
  cursor: 'cursor',

  // state (renderer → main)
  stateGet: 'state:get',

  // buddy window
  buddyRequestMode: 'buddy:requestMode',
  buddyExitDone: 'buddy:exitDone',
  buddySetIgnoreMouse: 'buddy:setIgnoreMouse',
  buddyDragStart: 'buddy:dragStart',
  buddyDragMove: 'buddy:dragMove',
  buddyDragEnd: 'buddy:dragEnd',
  buddySetCursorTracking: 'buddy:setCursorTracking',
  buddyDismissGreeting: 'buddy:dismissGreeting',

  // ai
  aiSend: 'ai:send',
  aiStop: 'ai:stop',
  aiRegenerate: 'ai:regenerate',

  // sessions
  sessionsNew: 'sessions:new',
  sessionsOpen: 'sessions:open',
  sessionsRename: 'sessions:rename',
  sessionsDelete: 'sessions:delete',
  sessionsUndoDelete: 'sessions:undoDelete',
  sessionsClearAll: 'sessions:clearAll',
  sessionsSearch: 'sessions:search',

  // windows
  windowsUnlock: 'windows:unlock',
  windowsLock: 'windows:lock',
  windowsOpenSettings: 'windows:openSettings',

  // capture overlay
  captureStart: 'capture:start',
  captureRemoveAttachment: 'capture:removeAttachment',
  overlayOpen: 'overlay:open',
  overlayClosed: 'overlay:closed',
  overlayGetInit: 'overlay:getInit',
  overlayCommit: 'overlay:commit',
  overlayCancel: 'overlay:cancel',

  // attachments
  attachmentOpen: 'attachment:open',

  // clipboard
  clipboardWriteText: 'clipboard:writeText',
  clipboardArm: 'clipboard:arm',
  clipboardDismiss: 'clipboard:dismiss',

  // sticky-note pins
  pinsCreate: 'pins:create',
  pinsResize: 'pins:resize',
  pinsClose: 'pins:close',
  pinsOpenInHoot: 'pins:openInHoot',

  // settings
  settingsUpdate: 'settings:update',
  settingsSetApiKey: 'settings:setApiKey',
  settingsClearApiKey: 'settings:clearApiKey',
  settingsValidateApiKey: 'settings:validateApiKey',
  settingsResetAnchor: 'settings:resetAnchor',

  // app info + onboarding
  appInfo: 'app:info',
  appOpenExternal: 'app:openExternal',
  onboardingFinish: 'onboarding:finish',
  onboardingStep: 'onboarding:step'
} as const

export type IpcChannel = (typeof IPC)[keyof typeof IPC]

export interface DeltaPayload {
  sessionId: string
  messageId: string
  delta: string
}

export interface SendPayload {
  text?: string
  quickAction?: QuickActionId
}

export type RequestedMode = 'dot' | 'pill' | 'card' | 'hidden'

export interface DragEndPayload {
  /** release velocity, DIP/s */
  vx: number
  vy: number
}

export interface IpcInvokeMap {
  [IPC.stateGet]: { args: []; result: AppState }
  [IPC.sessionsSearch]: { args: [string]; result: SessionMeta[] }
  [IPC.settingsValidateApiKey]: { args: [string]; result: boolean }
  [IPC.overlayGetInit]: { args: []; result: OverlayInit | null }
  [IPC.appInfo]: { args: []; result: AppInfo }
}

export interface AppInfo {
  packaged: boolean
  version: string
}

export interface IpcSendMap {
  [IPC.buddyRequestMode]: [RequestedMode]
  [IPC.buddyExitDone]: []
  [IPC.buddySetIgnoreMouse]: [boolean]
  [IPC.buddyDragStart]: []
  [IPC.buddyDragMove]: []
  [IPC.buddyDragEnd]: [DragEndPayload]
  [IPC.buddySetCursorTracking]: [boolean]
  [IPC.buddyDismissGreeting]: []
  [IPC.aiSend]: [SendPayload]
  [IPC.aiStop]: []
  [IPC.aiRegenerate]: []
  [IPC.sessionsNew]: []
  [IPC.sessionsOpen]: [string]
  [IPC.sessionsRename]: [string, string]
  [IPC.sessionsDelete]: [string]
  [IPC.sessionsUndoDelete]: [string]
  [IPC.sessionsClearAll]: []
  [IPC.windowsUnlock]: []
  [IPC.windowsLock]: []
  [IPC.windowsOpenSettings]: []
  [IPC.captureStart]: ['lasso' | 'rect' | 'full' | undefined]
  [IPC.captureRemoveAttachment]: [string]
  [IPC.overlayCommit]: [OverlayCommit]
  [IPC.overlayCancel]: []
  [IPC.attachmentOpen]: [string]
  [IPC.clipboardWriteText]: [string]
  [IPC.clipboardArm]: []
  [IPC.clipboardDismiss]: []
  [IPC.pinsCreate]: [string]
  [IPC.pinsResize]: [number]
  [IPC.pinsClose]: []
  [IPC.pinsOpenInHoot]: []
  [IPC.settingsUpdate]: [Partial<Settings>]
  [IPC.settingsSetApiKey]: [string]
  [IPC.settingsClearApiKey]: []
  [IPC.settingsResetAnchor]: []
  [IPC.appOpenExternal]: [string]
  [IPC.onboardingFinish]: []
  [IPC.onboardingStep]: [number]
}
