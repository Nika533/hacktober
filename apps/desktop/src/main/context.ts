import { app, dialog, safeStorage } from 'electron'
import { randomBytes } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import os from 'node:os'
import { join } from 'node:path'
import {
  bridgePipePath,
  HOOT_API_ROUTES,
  type BridgeEnv,
  type ExplainMoreMessage,
  type LensContext,
  type Platform,
  type Unsubscribe
} from '@hoot/core'
import type { AiProvider } from './ai'
import { createFakeProvider, createGeminiProvider } from './ai'
import { AnotherInstanceError, createBridgeServer, type BridgeServer } from './bridge'
import { createBuddyWindow, type BuddyWindow } from './buddy/window'
import type { AppEnv } from './env'
import { handleInvoke } from './ipc/handle'
import { registerDomains } from './ipc/register'
import { applySettingsUpdate } from './ipc/settings'
import { createFsLensStorage, createLensService, type LensService } from './lens'
import { createFlushRegistry, type FlushRegistry } from './lifecycle'
import { createLogger, type Logger } from './log'
import { createSecretStore, type SecretStore } from './secrets'
import { createBroadcaster, sinkFor, type Broadcaster } from './store/broadcast'
import { watchLensSettings } from './store/lensWatch'
import { watchPersistence } from './store/persist'
import { createPersistence, PersistenceError, type Persistence } from './store/persistence'
import { createStore, initialSlices, type Store } from './store/store'
import { createDebouncedWriter, type DebouncedWriter } from './store/writer'
import { readSystem, watchSystem } from './system'
import { installTestHooks } from './testHooks'
import { createWindowRegistry, type WindowRegistry } from './windows/base'
import { createStudioWindow, type StudioWindow } from './windows/studio'

export interface AppContext {
  env: AppEnv
  paths: { userData: string; hootDir: string }
  log: Logger
  store: Store
  broadcaster: Broadcaster
  flush: FlushRegistry
  windows: WindowRegistry
  persistence: Persistence
  writer: DebouncedWriter
  secrets: SecretStore
  studio: StudioWindow
  buddy: BuddyWindow
  /** Chat provider: fake under HOOT_FAKE_AI, Gemini when a key exists, else null. */
  ai: { createProvider(): AiProvider | null }
  lens: LensService
  bridge: BridgeServer
  /** Feature seams filled in later (finish-plan §2). */
  hooks: {
    /** Lens "Explain more" → opens the card and sends; chat wires this in D1-23. */
    explain(message: ExplainMoreMessage, ctx: LensContext): void
  }
  /** False until the tray lands (D1-21); index.ts quits on window-all-closed. */
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
  const pins = await persistence.loadPins()

  // Pins load into the slice even when restorePins is off — that setting only
  // decides whether note windows open (D1-22).
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
  store.set('pins', { pins })

  const broadcaster = createBroadcaster(store)
  const windows = createWindowRegistry()

  // One Studio window, created hidden and reused. (Constructed here rather
  // than in start() so ctx.studio is always populated; nothing is visible
  // until start() decides what to open.)
  const studio = createStudioWindow({ store, windows, log })
  app.on('before-quit', () => studio.markQuitting())

  // The fixed-size Buddy window; created hidden, summoned (or not) in start().
  const buddy = createBuddyWindow({ store, windows, log })
  // Locking Studio always returns to the card; the onboarding flow overrides
  // with request('pill') afterwards.
  studio.onLock(() => buddy.request('card'))

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
    hooks: {
      explain() {
        log.info('explain requested before chat was wired')
      }
    },
    keepAliveWithoutWindows: false,

    onSecondInstance(argv) {
      log.info(`second instance invoked: ${argv.join(' ')}`)
      buddy.summon()
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
      // --hidden opens nothing (launch-at-login must never pop a window);
      // first run goes to onboarding, returning users get the owl.
      if (env.hidden) return
      if (!settings.onboardingDone) studio.open('onboarding')
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
    }
  }

  return ctx
}
