import { app } from 'electron'
import { createAppContext, type AppContext } from './context'
import { readEnv } from './env'
import { installQuitFlow } from './lifecycle'
import { createLogger } from './log'

const env = readEnv(process.argv, process.env, app.isPackaged)
const log = createLogger('main')

// HOOT_USER_DATA must apply before the single-instance lock so both instances
// of the same "user" agree on the profile they lock (and log into).
if (env.userDataOverride) app.setPath('userData', env.userDataOverride)

let ctx: AppContext | null = null

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', (_event, argv) => ctx?.onSecondInstance(argv))

  void app.whenReady().then(async () => {
    ctx = await createAppContext(env)
    installQuitFlow(app, ctx.flush, ctx.log)
    await ctx.start()
    log.info(`Hoot is running — ${ctx.store.get('settings').settings.summonHotkey} to summon`)
  })

  app.on('window-all-closed', () => {
    if (ctx?.keepAliveWithoutWindows !== true) app.quit()
  })
}
