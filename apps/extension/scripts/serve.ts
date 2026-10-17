import { readFile, stat } from 'node:fs/promises'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { dirname, extname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.pdf': 'application/pdf',
  '.svg': 'image/svg+xml',
  '.png': 'image/png'
}

export interface FixtureServer {
  url: string
  crossOriginUrl: string
  close(): Promise<void>
}

const here = dirname(fileURLToPath(import.meta.url))

export async function serveFixtures(
  options: { root?: string; port?: number } = {}
): Promise<FixtureServer> {
  const root = resolve(options.root ?? resolve(here, '../fixtures'))
  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? '/', 'http://fixtures')
    let file = resolve(join(root, decodeURIComponent(url.pathname)))
    if (file !== root && !file.startsWith(root + sep)) {
      response.writeHead(403).end()
      return
    }
    try {
      if ((await stat(file)).isDirectory()) file = join(file, 'index.html')
      const body = await readFile(file)
      response.writeHead(200, {
        'content-type': TYPES[extname(file)] ?? 'application/octet-stream',
        'cache-control': 'no-store'
      })
      response.end(body)
    } catch {
      response.writeHead(404).end('not found')
    }
  })
  await new Promise<void>((done) => server.listen(options.port ?? 0, '127.0.0.1', done))
  const { port } = server.address() as AddressInfo
  return {
    url: `http://127.0.0.1:${port}`,
    crossOriginUrl: `http://localhost:${port}`,
    close: () => new Promise<void>((done) => server.close(() => done()))
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { url, crossOriginUrl } = await serveFixtures({ port: Number(process.env.PORT ?? 4510) })
  console.log(`Fixtures: ${url}/  (second origin: ${crossOriginUrl}/)`)
}
