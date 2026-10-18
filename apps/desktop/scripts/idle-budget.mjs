// Idle budget measurement for F-D1-7 (finish-plan: <1% CPU, <200 MB).
// Normal (non-e2e) build, fake AI/Lens, fresh profile with onboarding done.
// Uses Electron's app.getAppMetrics() (all processes: browser, GPU, renderers,
// utility). percentCPUUsage is per-process CPU since the previous call, in
// percent of ONE logical core; we report the raw sum and the sum divided by
// the logical core count (= share of the whole machine).
//
// Usage (from apps/desktop, after `npm.cmd run build -w @hoot/desktop`):
//   node <this file> [seconds=60]
import { _electron as electron } from '@playwright/test'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { cpus, tmpdir } from 'node:os'
import { join } from 'node:path'

const SECONDS = Number(process.argv[2] ?? 60)
const SAMPLE_MS = 5000
const CORES = cpus().length

const userData = mkdtempSync(join(tmpdir(), 'hoot-idle-'))
mkdirSync(join(userData, 'hoot'), { recursive: true })
writeFileSync(
  join(userData, 'hoot', 'settings.json'),
  JSON.stringify({ onboardingDone: true, collapseToDotAfterMs: 1500 })
)
const env = { ...process.env, HOOT_FAKE_AI: '1', HOOT_FAKE_LENS: '1', HOOT_USER_DATA: userData }
delete env.ELECTRON_RUN_AS_NODE
delete env.HOOT_TEST

const app = await electron.launch({ args: [join(process.cwd(), 'out/main/index.js')], env })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function buddyPage() {
  for (let i = 0; i < 100; i++) {
    const p = app.windows().find((w) => w.url().includes('buddy.html'))
    if (p) return p
    await sleep(100)
  }
  throw new Error('no buddy page')
}
const buddy = await buddyPage()
const buddyMode = () =>
  buddy.evaluate(async () => (await window.hoot.state.subscribe(['buddy'])).buddy.mode)

async function waitMode(want, ms) {
  const end = Date.now() + ms
  while (Date.now() < end) {
    if ((await buddyMode()) === want) return true
    await sleep(200)
  }
  return false
}

async function metrics() {
  return app.evaluate(({ app: a, webContents }) => {
    // Renderer pid → the page it hosts, so per-window cost is visible.
    const pageOf = new Map(
      webContents.getAllWebContents().map((wc) => [
        wc.getOSProcessId(),
        (wc.getURL().split('/').pop() ?? '').split('#')[0]
      ])
    )
    return a.getAppMetrics().map((m) => ({
      type: m.type === 'Tab' ? `Tab:${pageOf.get(m.pid) ?? '?'}` : m.type,
      name: m.name ?? '',
      pid: m.pid,
      cpu: m.cpu.percentCPUUsage,
      wakeups: m.cpu.idleWakeupsPerSecond,
      wsMB: m.memory.workingSetSize / 1024,
      privMB: (m.memory.privateBytes ?? 0) / 1024
    }))
  })
}

async function measure(label) {
  await metrics() // prime: percentCPUUsage is relative to the previous call
  await sleep(SAMPLE_MS)
  const samples = []
  const end = Date.now() + SECONDS * 1000
  while (Date.now() < end) {
    samples.push(await metrics())
    await sleep(SAMPLE_MS)
  }
  const n = samples.length
  const avg = (f) => samples.reduce((s, ms) => s + ms.reduce((t, m) => t + f(m), 0), 0) / n
  const byType = {}
  for (const ms of samples)
    for (const m of ms) {
      const k = m.type
      byType[k] ??= { cpu: 0, wsMB: 0, privMB: 0, count: 0 }
      byType[k].cpu += m.cpu / n
      byType[k].wsMB += m.wsMB / n
      byType[k].privMB += m.privMB / n
    }
  const last = samples[n - 1]
  for (const k of Object.keys(byType)) byType[k].count = last.filter((m) => m.type === k).length
  const cpuSum = avg((m) => m.cpu)
  return {
    label,
    samples: n,
    cores: CORES,
    cpuSumPctOfOneCore: +cpuSum.toFixed(2),
    cpuPctOfMachine: +(cpuSum / CORES).toFixed(3),
    maxSampleCpuSum: +Math.max(...samples.map((ms) => ms.reduce((t, m) => t + m.cpu, 0))).toFixed(2),
    workingSetMB: +avg((m) => m.wsMB).toFixed(1),
    privateMB: +avg((m) => m.privMB).toFixed(1),
    idleWakeupsPerSec: +avg((m) => m.wakeups).toFixed(1),
    processes: last.length,
    byType: Object.fromEntries(
      Object.entries(byType).map(([k, v]) => [
        k,
        { count: v.count, cpu: +v.cpu.toFixed(2), wsMB: +v.wsMB.toFixed(1), privMB: +v.privMB.toFixed(1) }
      ])
    )
  }
}

const results = []
// A: owl visible as a dot, nothing happening (cursor left where it is).
await waitMode('pill', 15000)
await app.evaluate(({ BrowserWindow }) => {
  for (const w of BrowserWindow.getAllWindows()) if (w.webContents.getURL().includes('buddy.html')) w.blur()
})
const dot = await waitMode('dot', 10000)
results.push({ ...(await measure('dot idle')), reachedDot: dot })
// B: buddy hidden, tray only.
await buddy.evaluate(() => window.hoot.buddy.requestMode('hidden'))
await waitMode('hidden', 5000)
results.push(await measure('hidden (tray only)'))

await app.close()
console.log(JSON.stringify(results, null, 2))
