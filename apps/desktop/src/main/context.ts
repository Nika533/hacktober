import { app, safeStorage } from 'electron'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { Unsubscribe } from '@hoot/core'
import type { AiProvider } from './ai'
import { createFakeProvider, createGeminiProvider } from './ai'
import type { AppEnv } from './env'
import { handleInvoke } from './ipc/handle'
import { registerDomains } from './ipc/register'
import { createFlushRegistry, type FlushRegistry } from './lifecycle'
import { createLogger, type Logger } from './log'
import { createSecretStore, type SecretStore } from './secrets'
import { createBroadcaster, sinkFor, type Broadcaster } from './store/broadcast'
import { watchPersistence } from './store/persist'
import { createPersistence, PersistenceError, type Persistence } from './store/persistence'
import { createStore, initialSlices, type Store } from './store/store'
import { createDebouncedWriter, type DebouncedWriter } from './store/writer'
import { readSystem, watchSystem } from './system'
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
  /** Chat provider for D1-13: fake under HOOT_FAKE_AI, Gemini when a key exists, else null. */
  ai: { createProvider(): AiProvider | null }
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

  const ai: AppContext['ai'] = {
    createProvider() {
      if (env.fakeAi) return createFakeProvider()
      const key = secrets.get()
      return key ? createGeminiProvider(key) : null
    }
  }

  let unwatchSystem: Unsubscribe | undefined
  let unwatchPersist: Unsubscribe | undefined
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
    ai,
    keepAliveWithoutWindows: false,

    onSecondInstance(argv) {
      log.info(`second instance invoked: ${argv.join(' ')}`)
      // Buddy summon arrives in D1-14; for now surface the Studio window.
      if (studio.isVisible()) studio.focus()
    },

    async start() {
      if (started) return
      started = true
      registerIpc()
      unwatchSystem = watchSystem(store)
      unwatchPersist = watchPersistence(store, persistence, writer)
      // Placeholder until the buddy lands (D1-14: this becomes the pill
      // summon). --hidden opens nothing (launch-at-login must never pop a
      // window); otherwise first run goes to onboarding.
      if (env.hidden) return
      if (!settings.onboardingDone) studio.open('onboarding')
      else studio.open('chat')
    },

    async stop() {
      unwatchSystem?.()
      unwatchSystem = undefined
      unwatchPersist?.()
      unwatchPersist = undefined
    }
  }

  return ctx
}
