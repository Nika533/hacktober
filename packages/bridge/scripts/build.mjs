/**
 * Builds hoot-bridge and the registration script into dist/ (CommonJS, so
 * the packaged app's Electron binary can run them with ELECTRON_RUN_AS_NODE).
 */
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as esbuild from 'esbuild'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

await esbuild.build({
  entryPoints: {
    'hoot-bridge': join(root, 'src/host/main.ts'),
    'register-native-host': join(root, 'src/registerCli.ts')
  },
  outdir: join(root, 'dist'),
  outExtension: { '.js': '.cjs' },
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  logLevel: 'warning'
})
