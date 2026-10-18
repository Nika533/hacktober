import { app, session } from 'electron'
import { join } from 'node:path'
import { createAppContext, type AppContext } from './context'
import { readEnv } from './env'
import { installQuitFlow } from './lifecycle'
import { createLogger } from './log'
import { installDevCsp, cspFor } from './windows/csp'
import { installSessionHardening } from './windows/hardening'
import { installHootProtocol, registerHootScheme } from './windows/protocol'

const env = readEnv(process.argv, process.env, app.isPackaged)
const log = createLogger('main')

// Must run before app.whenReady().
registerHootScheme()

// HOOT_USER_DATA must apply before the single-instance lock so both instances
// of the same "user" agree on the profile they lock (and log into).
if (env.userDataOverride) app.setPath('userData', env.userDataOverride)

let ctx: AppContext | null = null

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', (_event, argv) => ctx?.onSecondInstance(argv))

  void app.whenReady().then(async () => {
    installSessionHardening(log)
    // Packaged windows load hoot://app/…; dev windows load the Vite URL and
    // get their CSP injected via onHeadersReceived.
    installHootProtocol(join(__dirname, '../renderer'), (kind) => cspFor(kind, 'prod'))
    if (env.isDev && process.env['ELECTRON_RENDERER_URL']) {
      installDevCsp(session.defaultSession, new URL(process.env['ELECTRON_RENDERER_URL']).origin)
    }

    ctx = await createAppContext(env)
    installQuitFlow(app, ctx.flush, ctx.log)
    await ctx.start()
    log.info(`Hoot is running — ${ctx.store.get('settings').settings.summonHotkey} to summon`)
  })

  app.on('window-all-closed', () => {
    if (ctx?.keepAliveWithoutWindows !== true) app.quit()
  })
}
