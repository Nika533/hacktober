import { app, clipboard, dialog, powerMonitor, safeStorage, screen, shell } from 'electron'
import { randomBytes, randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readFile, stat } from 'node:fs/promises'
import os from 'node:os'
import { join } from 'node:path'
import {
  bridgePipePath,
  HOOT_API_ROUTES,
  voiceNote,
  type BridgeEnv,
  type ExplainMoreMessage,
  type LensContext,
  type Platform,
  type Point,
  type Unsubscribe
} from '@hoot/core'
import { codeLinkPipePath, codeLinkTokenPath } from '@hoot/core/code'
import type { AiProvider } from './ai'
import { createAiProvider, createFakeProvider } from './ai'
import { createAnywhereService, createBubbleWindow, type AnywhereService } from './anywhere'
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
import { createCodeLinkServer, createCodeService, type CodeService } from './code'
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
import { createPageService, type PageService } from './page'
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
import { createTextAccess, type TextAccess } from './textAccess'
import {
  createFakeSpeechEngine,
  createVoiceService,
  createWindowsSpeechEngine,
  unavailableEngine,
  type VoiceService
} from './voice'

/** The live overlay reads VS Code if it was in front this recently (a click on Hoot blurs it). */
const CODE_FOCUS_GRACE_MS = 5000

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
  /** Chat provider: fake under HOOT_FAKE_AI, Claude when a key exists, else null. */
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
  /** Text in other desktop apps (UI Automation + clipboard fallback). */
  textAccess: TextAccess
  /** Lens anywhere: the Lens hotkey's bubble over any app. */
  anywhere: AnywhereService
  /** The code link: VS Code's code as text instead of screenshots, highlights and edits back. */
  code: CodeService
  /** The page link: the browser page in front as text (the extension), highlights back. */
  pages: PageService
  /** The voice chat: Windows speech in and out, driving the active chat. */
  voice: VoiceService
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
    // A new file name: a Gemini key saved before the move to Claude is left behind.
    file: join(hootDir, 'claude-key.bin'),
    safeStorage,
    envKey: process.env['ANTHROPIC_API_KEY'],
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
  const textAccess = createTextAccess({ log, enabled: !env.test && process.platform === 'win32' })
  flush.add('textAccess', async () => textAccess.dispose())

  // The code link: the Hoot VS Code extension hands over the code on screen as
  // text (no screenshots) and applies the edits the user accepts. Its own pipe
  // and per-launch token, next to the Lens bridge's. Started in start().
  const code = createCodeService({
    store,
    log,
    createServer: (hooks) =>
      createCodeLinkServer({
        pipePath: codeLinkPipePath(
          process.platform as Platform,
          os.userInfo().username,
          os.tmpdir()
        ),
        tokenPath: codeLinkTokenPath(process.platform as Platform, process.env as BridgeEnv),
        platform: process.platform as Platform,
        appVersion: app.getVersion(),
        log: (m) => log.info(m),
        ...hooks
      })
  })
  flush.add('code', () => code.stop())

  // The page link: the browser extension (over the Lens bridge) hands over the
  // page in front as text when the user chats right after being in the
  // browser, and highlights the passages an answer points at. A question
  // asked from the extension's popup lands in the chat (aloud when spoken).
  const pages = createPageService({
    store,
    log,
    onAsk: async ({ text, voice: spoken, sameChat, note }) => {
      if (!sameChat) {
        await chat.stop()
        clipboardWatcher.dismiss()
        await chat.newChat()
      }
      ctx.hooks.showChatSurface()
      const replies = store.get('settings').settings.voiceReplies
      const notes = [note(), spoken ? voiceNote(replies) : null].filter((n) => n !== null)
      await chat.send({ text }, { context: false, notes })
      if (spoken) voice.answerAloud()
    }
  })
  flush.add('pages', async () => pages.stop())

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
    onCapture: () => ctx.hooks.startCapture(),
    onLens: () =>
      void ctx.anywhere
        .trigger()
        .catch((e: unknown) => log.warn(`lens anywhere failed: ${String(e)}`))
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
      return key ? createAiProvider(key) : null
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
    // The live capture overlay sends the current screen (or VS Code's code)
    // with every message; any other chat gets VS Code's code or the browser's
    // page, whichever app the user was just in.
    beforeSend: async () => {
      const live = await capture.attachLiveScreen()
      if (live !== null || (capture.isCapturing() && !capture.isMinimized())) return live
      const window = code.chatWindow()
      const browser = pages.activePeer()
      if (window && (!browser || code.activeAt(window) >= pages.activeAt(browser.id))) {
        return code.note(window)
      }
      return browser ? pages.note(browser.id) : null
    },
    onActivity: (a) => applyChatActivity(store, a),
    openPath: (p) => shell.openPath(p).then(() => undefined)
  })
  flush.add('chat', () => chat.flush())

  // Voice chats: Windows speech (System.Speech through a PowerShell helper),
  // the scripted fake under HOOT_FAKE_VOICE, nothing in e2e runs.
  const voice = createVoiceService({
    store,
    log,
    engine: env.fakeVoice
      ? createFakeSpeechEngine()
      : !env.test && process.platform === 'win32'
        ? createWindowsSpeechEngine({ log })
        : unavailableEngine,
    send: (text) =>
      chat.send({ text }, { notes: [voiceNote(store.get('settings').settings.voiceReplies)] }),
    stopAnswer: () => chat.stop()
  })
  flush.add('voice', async () => voice.dispose())

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

  // Lens anywhere: the bubble window is created on the first Lens hotkey.
  const anywhere = createAnywhereService({
    readSelection: () => textAccess.selection(),
    lens,
    bubble: createBubbleWindow({ windows, onDismiss: () => anywhere.dismissed() }),
    settings: () => store.get('settings').settings,
    cursor: () => screen.getCursorScreenPoint(),
    workArea: (rect) => screen.getDisplayMatching(rect).workArea,
    writeClipboard: (text) => clipboard.writeText(text),
    pin: (text) => pins.createFromText(text),
    openStudio: (view) => {
      studio.open(view)
      buddy.hide()
    },
    log
  })
  flush.add('anywhere', async () => anywhere.dispose())

  // Capture (d2 skeleton #60, overlay lands in F-D2-3): hides our surfaces
  // before the grab; a composer-bound capture returns to the card. Outside
  // tests the overlay is live: it stays open over the real screen and the
  // user chats about what they circled right there.
  const capture = createCaptureService({
    store,
    windows,
    studio,
    persistence,
    log,
    live: !env.test,
    // A new shape: stop an answer still streaming, and drop an armed clipboard
    // snapshot, so nothing unseen goes with the first message about it.
    newChat: async () => {
      await chat.stop()
      clipboardWatcher.dismiss()
      await chat.newChat()
    },
    // HOOT_NO_CAPTURE_EXCLUDE=1 for a recorded demo (each grab would blank the overlay).
    excludeFromGrabs: process.env['HOOT_NO_CAPTURE_EXCLUDE'] !== '1',
    readScreenText: (rect) => textAccess.textInRect(rect),
    clickScreen: (at) => textAccess.click(at),
    onScreenClick: (l) => textAccess.onClick(l),
    owlAnchor: () => buddy.anchor(),
    // Starting a capture from Hoot's own UI blurs VS Code a moment earlier.
    codeWindow: () => code.focusedWindow(CODE_FOCUS_GRACE_MS),
    codeNote: (id) => code.note(id),
    browserPage: () => {
      const browser = pages.activePeer(CODE_FOCUS_GRACE_MS)
      return browser?.page ? { id: browser.id, title: browser.page.title } : null
    },
    pageNote: (id) => pages.note(id),
    surfaces: {
      hide: () => buddy.hide(),
      restore: (added) => buddy.request(added ? 'card' : 'pill'),
      // The chat shrinks into the owl: just the owl (with its badge), no greeting pop.
      minimize: () => {
        buddy.request('dot')
        buddy.dismissGreeting()
      },
      // Coming back out: the owl steps aside; the answer is on screen again.
      unminimize: () => {
        buddy.hide()
        store.update('buddy', { answerReady: false })
      }
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
    log: (m) => log.info(m),
    pages
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
    textAccess,
    anywhere,
    code,
    pages,
    voice,
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
      pages.start()
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
      // e2e runs never open the per-user code pipe (a real Hoot may own it).
      if (!env.test) {
        code.onChange(() => broadcaster.emit(HOOT_API_ROUTES.code.onChange.channel, undefined))
        void code.start()
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
      textAccess.prewarm()
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
