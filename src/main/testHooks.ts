import { nativeImage, nativeTheme } from 'electron'
import path from 'path'
import type { BuddyWindow } from './windows/buddy'
import { getState, updateState } from './store/state'
import { lockStudio, openStudio } from './windows/studio'
import { isCapturing, startCapture } from './capture'
import { createPin } from './pins'
import type {
  AppState,
  BuddyMode,
  CaptureMode,
  Pin,
  Point,
  Settings,
  StudioView
} from '../shared/types'
import type { SendPayload } from '../shared/ipc'

export interface TestHookDeps {
  buddy: BuddyWindow
  summon(): void
  send(payload: SendPayload): void
  finishOnboarding(): void
  /** Debounced-persist settings so hook-driven changes survive relaunch. */
  persistSettings(): void
}

export interface HootHooks {
  getState(): AppState
  summon(): void
  hide(): void
  requestMode(mode: BuddyMode): void
  send(text: string): void
  setAnchor(p: Point): void
  updateSettings(p: Partial<Settings>): void
  startCapture(mode?: CaptureMode): Promise<void>
  openStudio(view?: StudioView): void
  lockStudio(): void
  finishOnboarding(): void
  isCapturing(): boolean
  setThemeSource(src: 'system' | 'light' | 'dark'): void
  /** Probes that packaged resource paths resolve (asar). */
  assetsOk(): { tray: boolean; app: boolean }
  createPin(messageId: string): void
  listPins(): Pin[]
}

/** Exposed on globalThis.__hoot when HOOT_TEST=1. */
export function exposeTestHooks(deps: TestHookDeps): void {
  const hooks: HootHooks = {
    getState: () => getState(),
    summon: () => deps.summon(),
    hide: () => deps.buddy.requestMode('hidden'),
    requestMode: (mode) => deps.buddy.requestMode(mode),
    send: (text) => deps.send({ text }),
    setAnchor: (p) => deps.buddy.setAnchor(p),
    updateSettings: (p) => {
      updateState((s) => {
        Object.assign(s.settings, p)
      })
      deps.persistSettings()
    },
    startCapture: (mode) => startCapture(mode),
    openStudio: (view) => openStudio(view),
    lockStudio: () => lockStudio(),
    finishOnboarding: () => deps.finishOnboarding(),
    isCapturing: () => isCapturing(),
    setThemeSource: (src) => {
      nativeTheme.themeSource = src
    },
    assetsOk: () => {
      const tray = nativeImage.createFromPath(path.join(__dirname, '../../resources/tray.png'))
      const app = nativeImage.createFromPath(path.join(__dirname, '../../resources/icon.png'))
      return { tray: !tray.isEmpty(), app: !app.isEmpty() }
    },
    createPin: (messageId) => {
      createPin(messageId)
    },
    listPins: () => getState().pins
  }
  ;(globalThis as Record<string, unknown>).__hoot = hooks
}
