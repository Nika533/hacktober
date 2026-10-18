import { app, dialog, powerMonitor, safeStorage, screen, shell } from 'electron'
import { randomBytes, randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readFile, stat } from 'node:fs/promises'
import os from 'node:os'
import { join } from 'node:path'
import {
  bridgePipePath,
  HOOT_API_ROUTES,
  type BridgeEnv,
  type ExplainMoreMessage,
  type LensContext,
  type Platform,
  type Point,
  type Unsubscribe
} from '@hoot/core'
import type { AiProvider } from './ai'
import { createFakeProvider, createGeminiProvider } from './ai'
import { AnotherInstanceError, createBridgeServer, type BridgeServer } from './bridge'
import { applyChatActivity } from './buddy/activity'
import { createBuddyWindow, type BuddyWindow } from './buddy/window'
import {
  addImageAttachment,
  createCaptureService,
  fromNativeImage,
  MAX_PENDING,
  type CaptureService
} from './capture'
import { createChatService, type ChatService } from './chat'
import { createClipboardWatcher, readClipboardImage, type ClipboardWatcher } from './clipboardWatch'
import type { AppEnv } from './env'
import { createHotkeys, type Hotkeys } from './hotkeys'
import { handleInvoke } from './ipc/handle'
import { finishOnboarding } from './ipc/onboarding'
import { registerDomains } from './ipc/register'
import { applySettingsUpdate } from './ipc/settings'
import { createFsLensStorage, createLensService, type LensService } from './lens'
import { createFlushRegistry, type FlushRegistry } from './lifecycle'
import { reconcileLoginItem } from './login'
import { createLogger, type Logger } from './log'
import { createNoteWindows, createPinsService, type NoteWindows, type PinsService } from './pins'
import { createReaderService, type ReaderService } from './services/reader'
import { createSecretStore, type SecretStore } from './secrets'
import { createBroadcaster, sinkFor, type Broadcaster } from './store/broadcast'
import { watchLensSettings } from './store/lensWatch'
import { watchPersistence } from './store/persist'
import {
  createPersistence,
  PersistenceError,
  type Persistence,
  type UiStateStore
} from './store/persistence'
import { createStore, initialSlices, type Store } from './store/store'
import { createDebouncedWriter, type DebouncedWriter } from './store/writer'
import { readSystem, watchSystem } from './system'
import { installTestHooks } from './testHooks'
import { createTray, type TrayHandle } from './tray'
import { createWindowRegistry, rendererUrlFor, type WindowRegistry } from './windows/base'
import { watchDisplays } from './windows/displays'
import { fileArgFromArgv } from './windows/drop'
import { createReaderWindow } from './windows/reader'
import { createStudioWindow, type StudioWindow } from './windows/studio'
import { watchPower } from './powerWatch'

export interface AppContext {
  env: AppEnv
  paths: { userData: string; hootDir: string }
  log: Logger
  store: Store
  broadcaster: Broadcaster
  flush: FlushRegistry
  windows: WindowRegistry
  persistence: Persistence & UiStateStore
  writer: DebouncedWriter
  secrets: SecretStore
  studio: StudioWindow
  buddy: BuddyWindow
  /** Chat provider: fake under HOOT_FAKE_AI, Gemini when a key exists, else null. */
  ai: { createProvider(): AiProvider | null }
  lens: LensService
  bridge: BridgeServer
  chat: ChatService
  pins: PinsService
  notes: NoteWindows
  capture: CaptureService
  hotkeys: Hotkeys
  tray: TrayHandle
  clipboard: ClipboardWatcher
  reader: ReaderService
  /**
   * Feature seams later PRs reassign (finish-plan §2): kept mutable on
   * purpose so late-landing features can re-point them.
   */
  hooks: {
    /** Lens "Explain more" → surfaces chat and starts the explanation. */
    explain(message: ExplainMoreMessage, ctx: LensContext): void
    /** Focus whatever surface shows the chat (Studio or the buddy card). */
    showChatSurface(): void
    /** The owl's anchor in screen DIP; notes cascade near it. */
    buddyAnchor(): Point
    /** Circle-something capture hotkey / tray item. */
    startCapture(): void
    /** Armed clipboard text for the next send; the watcher holds the snapshot. */
    takeClipboardSelection(): string | null
    /** Tray "Hide pinned notes". */
    setNotesVisible(visible: boolean): void
    /** Open a file in the Reader (F-D1-6 drop, tray item). */
    openInReader(path: string): void
  }
  /** Tray-resident app: closing all windows no longer quits. */
  keepAliveWithoutWindows: boolean
  onSecondInstance(argv: readonly string[]): void
  start(): Promise<void>
  stop(): Promise<void>
}

/**
 * Composition root: everything stateful in main is built here and passed
 * explicitly. No module-level mutable singletons.
 */
export async function createAppContext(env: AppEnv): Promise<AppContext> {
  const log = createLogger('main')

  const userData = app.getPath('userData')
  const hootDir = join(userData, 'hoot')
  await mkdir(hootDir, { recursive: true })

  const persistence = createPersistence({
    root: hootDir,
    log,
    // store is declared below; historyEnabled only runs at call time.
    historyEnabled: () => store.get('settings').settings.saveHistory,
    onError: (e: PersistenceError) =>
      log.error(`${e.message}${e.cause ? `: ${String(e.cause)}` : ''}`)
  })
  const writer = createDebouncedWriter({
    onError: (e, key) => {
      // PersistenceErrors already reported themselves via deps.onError.
      if (!(e instanceof PersistenceError))
        log.error(`debounced write "${key}" failed: ${String(e)}`)
    }
  })
  const secrets = createSecretStore({
    file: join(hootDir, 'gemini-key.bin'),
    safeStorage,
    envKey: process.env['GEMINI_API_KEY'],
    log
  })
  const flush = createFlushRegistry(log)
  flush.add('persistence', () => writer.flush())

  await persistence.ensureDirs()
  const settings = await persistence.loadSettings()
  // safeStorage is only usable after whenReady — context is created after it.
  await secrets.load()
  log.info(`key: ${secrets.source}/${secrets.storage}`)
  const index = await persistence.loadSessionIndex()
  const activeSession =
    settings.saveHistory && index.activeId !== null
      ? await persistence.loadSession(index.activeId)
      : null
  const savedPins = await persistence.loadPins()
  // #70: the onboarding step survives restarts, but only matters when
  // onboarding isn't done yet.
  const uiState = settings.onboardingDone ? null : await persistence.loadUiState()

  // Pins load into the slice even when restorePins is off — that setting only
  // decides whether note windows open.
  const store = createStore(
    initialSlices({
      settings,
      hasApiKey: secrets.get() !== null,
      keyStorage: secrets.storage,
      system: readSystem()
    })
  )
  store.set('sessions', { list: index.sessions, pendingDelete: null })
  store.update('chat', { session: activeSession })
  store.set('pins', { pins: savedPins })
  if (uiState !== null) store.update('studio', { onboardingStep: uiState.onboardingStep })

  const broadcaster = createBroadcaster(store)
  const windows = createWindowRegistry()

  const clipboardWatcher = createClipboardWatcher({
    store,
    log,
    // "Use copied image" attaches it like a capture, within the same cap.
    attachImage: async () => {
      if (store.get('chat').pendingAttachments.length >= MAX_PENDING) return false
      const image = await readClipboardImage()
      if (!image) return false
      await addImageAttachment(
        { store, persistence, newId: randomUUID, now: Date.now },
        fromNativeImage(image),
        'clipboard-image'
      )
      return true
    }
  })

  // A file dropped on any Hoot surface opens in the Reader (F-D1-6). ctx is
  // assigned below; the guard can't fire before a page loads anyway.
  const onFileDrop = (p: string): void => ctx.hooks.openInReader(p)

  // One Studio window, created lazily on first open() and reused — a hidden
  // start pays no renderer for it. (Constructed here rather than in start()
  // so ctx.studio is always populated.)
  const studio = createStudioWindow({ store, windows, log, onFileDrop })
  // Shared with the note windows: closing on quit must not delete the pin.
  let quitting = false
  app.on('before-quit', () => {
    quitting = true
    studio.markQuitting()
  })

  // The fixed-size Buddy window; created hidden, summoned (or not) in start().
  // beforeSummon runs the clipboard probe before hidden → pill, so the chip
  // is in the slice when the greeting is computed.
  const buddy = createBuddyWindow({
    store,
    windows,
    log,
    beforeSummon: () => clipboardWatcher.onSummon(),
    onFileDrop
  })
  // Locking Studio always returns to the card; the onboarding flow overrides
  // with request('pill') afterwards.
  studio.onLock(() => buddy.request('card'))

  // Summon hotkey / tray "Show Hoot" / second-instance: Studio-aware toggle.
  const onSummonHotkey = (): void => {
    const s = store.get('studio')
    if (s.open && s.view === 'onboarding') {
      // Only the last step ("try it now") finishes on the hotkey.
      if (s.onboardingStep >= 2) finishOnboarding(ctx)
      else studio.focus()
      return
    }
    if (s.open && studio.isVisible()) {
      if (studio.isFocused()) studio.lock()
      else studio.focus()
      return
    }
    buddy.toggle()
  }

  const hotkeys = createHotkeys({
    store,
    log,
    enabled: !env.test,
    onSummon: onSummonHotkey,
    onCapture: () => ctx.hooks.startCapture()
  })
  flush.add('hotkeys', async () => hotkeys.dispose())

  // Monitor/DPI changes re-resolve the buddy anchor and re-centre stranded
  // windows; sleep/unlock repaints the transparent owl + re-registers keys.
  const unwatchDisplays = watchDisplays({
    screen,
    windows,
    relayoutBuddy: () => buddy.relayout()
  })
  const unwatchPower = watchPower({ powerMonitor, buddy, hotkeys })
  flush.add('displays', async () => unwatchDisplays())
  flush.add('power', async () => unwatchPower())

  const tray = createTray({
    store,
    log,
    // Clicking the tray blurs Hoot first, so the focus test can't apply:
    // hidden → summon with greeting, visible → hide; Studio wins focus.
    onTrayClick: () => {
      if (store.get('studio').open) {
        studio.focus()
        return
      }
      if (buddy.mode() === 'hidden') buddy.summon()
      else buddy.request('hidden')
    },
    onSummon: onSummonHotkey,
    onCapture: () => ctx.hooks.startCapture(),
    onToggleNotes: (hidden) => ctx.hooks.setNotesVisible(!hidden),
    onOpenStudio: () => studio.open(),
    onOpenReader: () =>
      void reader.pickFile().catch((e: unknown) => log.warn(`tray pickFile failed: ${String(e)}`)),
    onOpenSettings: () => studio.open('settings'),
    onQuit: () => app.quit()
  })
  flush.add('tray', async () => tray.destroy())

  const ai: AppContext['ai'] = {
    createProvider() {
      if (env.fakeAi) return createFakeProvider()
      const key = secrets.get()
      return key ? createGeminiProvider(key) : null
    }
  }

  // Lens: the service loads its files eagerly; the profile broadcast and the
  // IPC handler map are wired in start() below.
  const lens = await createLensService({
    storage: createFsLensStorage(join(hootDir, 'lens')),
    getLensSettings: () => store.get('settings').settings.lens,
    getProvider: async () => ai.createProvider(),
    fake: env.fakeLens,
    onExplain: (message, lensCtx) => ctx.hooks.explain(message, lensCtx),
    chooseExportPath: (name) =>
      dialog
        .showSaveDialog({ defaultPath: name })
        .then((r) => (r.canceled || !r.filePath ? null : r.filePath)),
    onError: (e) => log.error(`lens: ${String(e)}`)
  })
  flush.add('lens', () => lens.flush())

  const chat = createChatService({
    store,
    broadcaster,
    persistence,
    writer,
    log,
    getProvider: async () => ai.createProvider(),
    takeClipboardSelection: () => ctx.hooks.takeClipboardSelection(),
    onActivity: (a) => applyChatActivity(store, a),
    openPath: (p) => shell.openPath(p).then(() => undefined)
  })
  flush.add('chat', () => chat.flush())

  // notes before pins (pins needs the windows), pins inside the callbacks
  // (notes need the service) — the reference resolves at call time.
  const notes = createNoteWindows({
    rendererUrl: rendererUrlFor,
    anchor: () => ctx.hooks.buddyAnchor(),
    isQuitting: () => quitting,
    onCloseRequest: (id) => pins.remove(id),
    onBounds: (id, b) => pins.setBounds(id, b)
  })
  const pins = createPinsService({
    store,
    windows: notes,
    openSession: async (id) => {
      await chat.openSession(id)
      ctx.hooks.showChatSurface()
    }
  })

  // Capture (d2 skeleton #60, overlay lands in F-D2-3): hides our surfaces
  // before the grab; a composer-bound capture returns to the card.
  const capture = createCaptureService({
    store,
    windows,
    studio,
    persistence,
    log,
    surfaces: {
      hide: () => buddy.hide(),
      restore: (added) => buddy.request(added ? 'card' : 'pill')
    }
  })

  // The Reader window is lazy: it exists once a document or an explicit
  // open asks for it, centred on the owl's display.
  const reader = createReaderService({
    window: createReaderWindow({
      windows,
      log,
      anchor: () => ctx.hooks.buddyAnchor(),
      onFileDrop
    }),
    dialog,
    readFile: async (p) => readFile(p),
    stat: (p) => stat(p),
    log
  })

  const devPairingCode = process.env['HOOT_DEV_BRIDGE_CODE'] ?? randomBytes(4).toString('hex')
  const bridge = createBridgeServer({
    lens,
    appVersion: app.getVersion(),
    platform: process.platform as Platform,
    env: process.env as BridgeEnv,
    pipePath: bridgePipePath(process.platform as Platform, os.userInfo().username, os.tmpdir()),
    getLensSettings: () => store.get('settings').settings.lens,
    patchLensSettings: async (patch) => {
      applySettingsUpdate({ store }, { lens: patch })
      return store.get('settings').settings.lens
    },
    devWebSocket: env.devBridge
      ? {
          port: Number(process.env['HOOT_DEV_BRIDGE_PORT'] ?? 7341),
          pairingCode: devPairingCode
        }
      : null,
    onStatus: (s) => store.set('lens', s),
    log: (m) => log.info(m)
  })
  flush.add('bridge', () => bridge.stop())

  let unwatchSystem: Unsubscribe | undefined
  let unwatchPersist: Unsubscribe | undefined
  let unwatchLens: Unsubscribe | undefined
  let started = false

  const registerIpc = (): void => {
    handleInvoke('state:subscribe', (sender, slices) =>
      broadcaster.subscribe(sinkFor(sender), slices)
    )
    registerDomains(ctx)
  }

  const ctx: AppContext = {
    env,
    paths: { userData, hootDir },
    log,
    store,
    broadcaster,
    flush,
    windows,
    persistence,
    writer,
    secrets,
    studio,
    buddy,
    ai,
    lens,
    bridge,
    chat,
    pins,
    notes,
    capture,
    hotkeys,
    tray,
    clipboard: clipboardWatcher,
    reader,
    hooks: {
      explain(message) {
        ctx.hooks.showChatSurface()
        void chat
          .startExplain(message)
          .catch((e: unknown) => log.warn(`explain failed: ${String(e)}`))
      },
      showChatSurface() {
        if (studio.isVisible()) studio.focus()
        else buddy.request('card')
      },
      buddyAnchor() {
        return buddy.anchor()
      },
      startCapture: () => void capture.start('lasso'),
      takeClipboardSelection: () => clipboardWatcher.take(),
      setNotesVisible: (visible) => pins.setVisible(visible),
      openInReader(path) {
        void reader
          .openPath(path)
          .catch((e: unknown) => log.warn(`openInReader failed: ${String(e)}`))
      }
    },
    keepAliveWithoutWindows: true,

    onSecondInstance(argv) {
      const file = fileArgFromArgv(argv, existsSync)
      log.info(`second instance invoked: ${argv.join(' ')}`)
      // `hoot doc.pdf` on a running app opens it instead of summoning.
      if (file !== null) ctx.hooks.openInReader(file)
      else onSummonHotkey()
    },

    async start() {
      if (started) return
      started = true
      registerIpc()
      unwatchSystem = watchSystem(store)
      unwatchPersist = watchPersistence(store, persistence, writer)
      unwatchLens = watchLensSettings(store, bridge)
      lens.onProfile((snap) =>
        broadcaster.emit(HOOT_API_ROUTES.lens.onProfile.channel, snap, 'lens')
      )
      // The bridge failing must not take the app down: a stale process (or a
      // second instance that slipped past the lock) leaves Lens unavailable
      // over the pipe but everything else keeps working.
      try {
        await bridge.start()
        if (env.devBridge) log.info(`bridge dev pairing code: ${devPairingCode}`)
      } catch (e) {
        const lastError =
          e instanceof AnotherInstanceError ? 'another Hoot owns the bridge pipe' : String(e)
        log.warn(`bridge not started: ${lastError}`)
        store.set('lens', { bridge: 'stopped', clients: 0, lastError })
      }
      installTestHooks(ctx)
      // Sticky notes are the user's pins, not the app's windows — they
      // come back even on a hidden (launch-at-login) start.
      if (settings.restorePins) pins.restore()
      // Packaged only: if Windows disagrees with the setting (Task Manager
      // toggle), our settings win.
      reconcileLoginItem(app, settings.launchAtLogin, log)
      // Whatever was already on the clipboard is never suggested.
      void clipboardWatcher
        .init()
        .catch((e: unknown) => log.warn(`clipboard init failed: ${String(e)}`))
      hotkeys.apply()
      // The first desktopCapturer grab takes ~3 s cold — warm it once idle.
      capture.prewarm()
      // --hidden opens nothing (launch-at-login must never pop a window);
      // first run goes to onboarding, returning users get the owl — or the
      // document they launched us with ("Open with Hoot" / `hoot doc.pdf`).
      if (env.hidden) return
      const file = fileArgFromArgv(process.argv, existsSync)
      if (!settings.onboardingDone) studio.open('onboarding')
      else if (file !== null) ctx.hooks.openInReader(file)
      else buddy.summon()
    },

    async stop() {
      unwatchSystem?.()
      unwatchSystem = undefined
      unwatchPersist?.()
      unwatchPersist = undefined
      unwatchLens?.()
      unwatchLens = undefined
      buddy.dispose()
      hotkeys.dispose()
      tray.destroy()
    }
  }

  return ctx
}
