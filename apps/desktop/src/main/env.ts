/**
 * Process environment, parsed once at startup. Pure: no Electron import, so
 * it can run before `app` is ready and in unit tests.
 */
export interface AppEnv {
  /** `--hidden` anywhere in argv (prefix match, never positional). */
  hidden: boolean
  /** `HOOT_TEST=1`: e2e build only — test hooks, no global hotkeys. */
  test: boolean
  /** `HOOT_FAKE_AI=1`: deterministic chat provider, no key or network. */
  fakeAi: boolean
  /** `HOOT_FAKE_LENS=1`: Lens engine answers with `@hoot/core/testing` fakes. */
  fakeLens: boolean
  /** `HOOT_DEV_BRIDGE=1`: dev-only WebSocket bridge transport. */
  devBridge: boolean
  /** `HOOT_FAKE_VOICE=1`: a scripted speech engine (hears set phrases, says nothing aloud). */
  fakeVoice: boolean
  /** `HOOT_USER_DATA=<dir>`: redirects `app.getPath('userData')`. */
  userDataOverride: string | null
  /** Unpackaged and served from the electron-vite dev server. */
  isDev: boolean
}

const flag = (name: string, arg: string): boolean =>
  arg === `--${name}` || arg.startsWith(`--${name}=`)

/**
 * Electron inserts its own flags (e.g. `--allow-file-access-from-files`) and
 * the app path into argv, so flags are matched by prefix, never by position
 * (D1-00 finding).
 */
export function parseArgv(argv: readonly string[]): { hidden: boolean } {
  return { hidden: argv.some((a) => flag('hidden', a)) }
}

export function readEnv(
  argv: readonly string[],
  env: NodeJS.ProcessEnv,
  isPackaged: boolean
): AppEnv {
  const on = (name: string): boolean => env[name] === '1'
  return {
    hidden: parseArgv(argv).hidden,
    test: on('HOOT_TEST'),
    fakeAi: on('HOOT_FAKE_AI'),
    fakeLens: on('HOOT_FAKE_LENS'),
    devBridge: on('HOOT_DEV_BRIDGE'),
    fakeVoice: on('HOOT_FAKE_VOICE'),
    userDataOverride: env['HOOT_USER_DATA'] ?? null,
    isDev: !isPackaged && env['ELECTRON_RENDERER_URL'] !== undefined
  }
}
