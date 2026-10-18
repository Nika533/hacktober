import { createFakeLensServer } from './fakeServer'

/**
 * `npm run fake-server -w @hoot/bridge [-- --port 7341 --code dev --delay 300]`
 * Runs the fake Lens bridge until Ctrl+C, for using the extension without
 * the desktop app.
 */
const arg = (name: string): string | undefined => {
  const i = process.argv.indexOf(name)
  return i >= 0 ? process.argv[i + 1] : undefined
}

const server = await createFakeLensServer({
  port: Number(arg('--port') ?? 7341),
  pairingCode: arg('--code'),
  delayMs: Number(arg('--delay') ?? 300)
})
console.log(`Fake Hoot Lens bridge listening on ${server.url}`)
console.log('Rules: SKIP → skipped, ERROR → busy, ACRONYM → expand, word → define, else simplify')
process.on('SIGINT', () => void server.close().then(() => process.exit(0)))
