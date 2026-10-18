import { app } from 'electron'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { DEFAULT_SETTINGS } from '@hoot/core'
import type { Unsubscribe } from '@hoot/core'
import type { AppEnv } from './env'
import { handleInvoke } from './ipc/handle'
import { createFlushRegistry, type FlushRegistry } from './lifecycle'
import { createLogger, type Logger } from './log'
import { createBroadcaster, sinkFor, type Broadcaster } from './store/broadcast'
import { createStore, initialSlices, type Store } from './store/store'
import { readSystem, watchSystem } from './system'
import {
  createSecureWindow,
  createWindowRegistry,
  loadRenderer,
  type WindowRegistry
} from './windows/base'

export interface AppContext {
  env: AppEnv
  paths: { userData: string; hootDir: string }
  log: Logger
  store: Store
  broadcaster: Broadcaster
  flush: FlushRegistry
  windows: WindowRegistry
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

  // D1-11 loads persisted settings and the API key instead of these defaults.
  const store = createStore(
    initialSlices({
      settings: DEFAULT_SETTINGS,
      system: readSystem()
    })
  )
  const broadcaster = createBroadcaster(store)
  const flush = createFlushRegistry(log)
  const windows = createWindowRegistry()

  let unwatchSystem: Unsubscribe | undefined
  let started = false

  const registerIpc = (): void => {
    handleInvoke('state:subscribe', (sender, slices) =>
      broadcaster.subscribe(sinkFor(sender), slices)
    )
    // D1-12 registers the domain handlers (chat, sessions, pins, windows…).
  }

  const ctx: AppContext = {
    env,
    paths: { userData, hootDir },
    log,
    store,
    broadcaster,
    flush,
    windows,
    keepAliveWithoutWindows: false,

    onSecondInstance(argv) {
      log.info(`second instance invoked: ${argv.join(' ')}`)
      // Buddy summon arrives in D1-14; for now surface the Studio window.
      const studio = windows.get('studio')
      if (studio) {
        if (studio.isMinimized()) studio.restore()
        studio.focus()
      }
    },

    async start() {
      if (started) return
      started = true
      registerIpc()
      unwatchSystem = watchSystem(store)
      // Stub window until D1-14/15 wire the real buddy + studio lifecycle.
      if (!env.hidden) {
        const studio = createSecureWindow('studio', {
          width: 960,
          height: 640,
          title: 'Hoot'
        })
        windows.set('studio', studio)
        loadRenderer(studio, 'studio')
      }
    },

    async stop() {
      unwatchSystem?.()
      unwatchSystem = undefined
    }
  }

  return ctx
}
