import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  COLD_START_ASK_FIRST,
  COLD_START_THRESHOLD,
  DEFAULT_LENS_SETTINGS,
  DEFAULT_THRESHOLD,
  HOOT_API_ROUTES,
  type ExplainMoreMessage,
  type LensContext,
  type LensEvent,
  type LensSettings,
  type RewriteRequest
} from '@hoot/core'
import { INVOKE_ARGS } from '@hoot/core/schemas'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createLensHandlers } from '../../src/main/lens/ipc'
import { eventsFileFor } from '../../src/main/lens/history'
import { createLensService, type LensService } from '../../src/main/lens/service'
import {
  createFsLensStorage,
  createMemoryLensStorage,
  type LensStorage
} from '../../src/main/lens/storage'

const ctx = (span = 'API'): LensContext => ({
  span,
  paragraph: `An ${span} lets programs talk.`,
  headingPath: [],
  title: 'Intro',
  lang: 'en',
  site: 'example.com',
  siteCategory: 'general',
  surface: 'html',
  signals: {
    sizeClass: 'term',
    copiedWithinMs: null,
    dwellMs: 1500,
    reselectCount: 0,
    reread: 0,
    rarity: 0.5,
    knownTerm: false,
    topicFamiliarity: null,
    foreignLanguage: false,
    blocked: null
  },
  p: 0.9
})

const req = (span = 'API'): RewriteRequest => ({
  ctx: ctx(span),
  allowedTransforms: ['define', 'expand'],
  risk: 'normal'
})

const event = (kind: LensEvent['kind'], cacheKey: string, ts = 1_760_000_000_000): LensEvent => ({
  id: `e-${kind}`,
  ts,
  site: 'example.com',
  urlHash: 'h',
  kind,
  transform: 'expand',
  mode: 'replace',
  term: 'API',
  topic: null,
  lang: 'en',
  spanWords: 1,
  p: 0.9,
  difficulty: null,
  latencyMs: 20,
  cacheKey
})

let lens: LensSettings
let storage: LensStorage & { files: Map<string, string> }
let explained: ExplainMoreMessage[]
let service: LensService

beforeEach(async () => {
  lens = { ...DEFAULT_LENS_SETTINGS, enabled: true }
  storage = createMemoryLensStorage()
  explained = []
  service = await createLensService({
    storage,
    getLensSettings: () => lens,
    getProvider: async () => null,
    fake: true,
    onExplain: (m) => explained.push(m)
  })
})

describe('LensService history', () => {
  it('records a Recent change only when the rewrite is shown', async () => {
    const out = await service.rewrite('r1', req())
    if (out.kind !== 'rewritten') throw new Error('expected a rewrite')
    expect(service.recentChanges(10)).toEqual([])

    await service.feedback(event('shown', out.result.cacheKey))
    expect(service.recentChanges(10)).toMatchObject([
      { original: 'API', rewrite: 'API (Fake Expanded Form)', transform: 'expand' }
    ])
    expect(storage.files.get(eventsFileFor(1_760_000_000_000))).toContain('"kind":"shown"')
  })

  it('adds kept define/expand rewrites to the glossary and tracks "I knew this"', async () => {
    const out = await service.rewrite('r1', req())
    if (out.kind !== 'rewritten') throw new Error('expected a rewrite')
    await service.feedback(event('kept', out.result.cacheKey))
    expect(service.glossary()).toMatchObject([
      { term: 'API', gloss: 'API (Fake Expanded Form)', state: 'learning' }
    ])
    await service.feedback(event('knew_it', out.result.cacheKey))
    expect(service.glossary()[0]?.state).toBe('known')
  })

  it('ignores events it cannot link to a rewrite, but still logs them', async () => {
    await service.feedback(event('shown', 'missing'))
    expect(service.recentChanges(10)).toEqual([])
    expect([...storage.files.keys()].some((k) => k.startsWith('events-'))).toBe(true)
  })

  it('reset forgets the profile, history and cache, and notifies listeners', async () => {
    const out = await service.rewrite('r1', req())
    if (out.kind !== 'rewritten') throw new Error('expected a rewrite')
    await service.feedback(event('shown', out.result.cacheKey))
    const versions: number[] = []
    service.onProfile((s) => versions.push(s.version))
    const before = service.snapshot().version

    await service.resetProfile()
    expect(service.recentChanges(10)).toEqual([])
    expect(service.glossary()).toEqual([])
    expect(versions).toEqual([before + 1])
    const again = await service.rewrite('r2', req())
    expect(again.kind === 'rewritten' && again.result.cached).toBe(false)
  })
})

describe('LensService profile', () => {
  it('starts cold until setup is done', async () => {
    expect(service.snapshot()).toMatchObject({ threshold: 0.8, askFirstRemaining: 10 })
    lens = { ...lens, coldStartDone: true }
    const fresh = await createLensService({
      storage: createMemoryLensStorage(),
      getLensSettings: () => lens,
      getProvider: async () => null
    })
    expect(fresh.snapshot()).toMatchObject({ threshold: 0.75, askFirstRemaining: 0 })
  })

  it('patches terms and returns the summary the prompts use', async () => {
    const view = await service.patchProfile({ terms: { Kubernetes: 'known' } })
    expect(view.profile.terms['kubernetes']?.state).toBe('known')
    expect(view.summary).toContain('Already knows: kubernetes')
    expect(service.snapshot().knownTerms).toEqual(['kubernetes'])
  })

  it('"Explain more" hands the card a compact line and the full context', async () => {
    await service.explain(ctx('heteroscedasticity'))
    expect(explained).toHaveLength(1)
    expect(explained[0]?.text).toBe('Explain “heteroscedasticity”')
    expect(explained[0]?.sentText).toContain('An heteroscedasticity lets programs talk.')
  })
})

describe('export and persistence (filesystem)', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'hoot-lens-'))
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('survives a restart and exports to the chosen path', async () => {
    const fsStorage = createFsLensStorage(join(dir, 'lens'))
    const first = await createLensService({
      storage: fsStorage,
      getLensSettings: () => lens,
      getProvider: async () => null,
      fake: true
    })
    // Patch first: a profile edit bumps the version and retires cached rewrites.
    await first.patchProfile({ terms: { latency: 'known' } })
    const out = await first.rewrite('r1', req())
    if (out.kind !== 'rewritten') throw new Error('expected a rewrite')
    await first.feedback(event('shown', out.result.cacheKey, Date.now()))
    await first.flush()

    const target = join(dir, 'export.json')
    const second = await createLensService({
      storage: createFsLensStorage(join(dir, 'lens')),
      getLensSettings: () => lens,
      getProvider: async () => null,
      fake: true,
      chooseExportPath: async () => target
    })
    expect(second.snapshot().knownTerms).toEqual(['latency'])
    expect(second.recentChanges(5)).toHaveLength(1)
    const again = await second.rewrite('r2', req())
    expect(again.kind === 'rewritten' && again.result.cached).toBe(true)

    await expect(second.exportProfile()).resolves.toBe(target)
    const exported = JSON.parse(readFileSync(target, 'utf8'))
    expect(exported.profile.terms.latency.state).toBe('known')
  })

  it('returns null when the export dialog is cancelled', async () => {
    const s = await createLensService({
      storage: createFsLensStorage(join(dir, 'lens')),
      getLensSettings: () => lens,
      getProvider: async () => null,
      chooseExportPath: async () => null
    })
    await expect(s.exportProfile()).resolves.toBeNull()
  })

  it('refuses path-like file names', () => {
    const fsStorage = createFsLensStorage(dir)
    expect(() => fsStorage.pathOf('../secret.bin')).toThrow()
    expect(() => fsStorage.pathOf('a/b.json')).toThrow()
  })
})

describe('createLensHandlers', () => {
  it('covers every lens:* invoke channel', () => {
    const handlers = createLensHandlers(service)
    const lensChannels = Object.values(HOOT_API_ROUTES.lens)
      .filter((r) => r.kind === 'invoke')
      .map((r) => r.channel)
    expect(Object.keys(handlers).sort()).toEqual([...lensChannels].sort())
    for (const channel of Object.keys(handlers)) expect(channel in INVOKE_ARGS).toBe(true)
  })

  it('routes calls to the service', async () => {
    const handlers = createLensHandlers(service)
    const out = await handlers['lens:rewrite']('r1', req())
    expect(out.kind).toBe('rewritten')
    await expect(handlers['lens:snapshot']()).resolves.toMatchObject({ version: 1 })
    await expect(handlers['lens:recentChanges'](5)).resolves.toEqual([])
  })
})

describe('learning from feedback (C-30)', () => {
  const T = 1_760_000_000_000

  async function shown(): Promise<string> {
    const out = await service.rewrite(`r-${Math.random()}`, req())
    if (out.kind !== 'rewritten') throw new Error('expected a rewrite')
    await service.feedback(event('shown', out.result.cacheKey, T))
    return out.result.cacheKey
  }

  it('"I knew this" marks the term known and pushes the new snapshot', async () => {
    const pushed: string[][] = []
    service.onProfile((s) => pushed.push(s.knownTerms))
    const key = await shown()
    const before = service.snapshot()
    await service.feedback(event('knew_it', key, T + 1000))
    const after = service.snapshot()
    expect(after.knownTerms).toEqual(['api'])
    expect(after.version).toBe(before.version + 1)
    expect(after.threshold).toBeCloseTo(before.threshold + 0.03)
    expect(pushed.at(-1)).toEqual(['api'])
  })

  it('measures a revert from the shown event: fast raises θ, slow does not', async () => {
    const key = await shown()
    const base = service.snapshot().threshold
    await service.feedback(event('reverted', key, T + 2000))
    expect(service.snapshot().threshold).toBeCloseTo(base + 0.03)

    const slowKey = await shown()
    const mid = service.snapshot().threshold
    await service.feedback(event('reverted', slowKey, T + 30_000))
    expect(service.snapshot().threshold).toBe(mid)
  })

  it('counts down the cold-start Ask-first triggers on shown', async () => {
    const before = service.snapshot().askFirstRemaining
    await shown()
    expect(service.snapshot().askFirstRemaining).toBe(before - 1)
  })

  it('decays stale topics when the service starts', async () => {
    const storage2 = createMemoryLensStorage()
    const stale = Date.now() - 200 * 24 * 60 * 60 * 1000
    const profile = {
      ...(
        await createLensService({
          storage: storage2,
          getLensSettings: () => lens,
          getProvider: async () => null
        })
      ).profileView().profile,
      topics: { law: { familiarity: 0.95, depth: 0, updatedAt: stale } }
    }
    await storage2.writeJson('profile.json', profile)
    const restarted = await createLensService({
      storage: storage2,
      getLensSettings: () => lens,
      getProvider: async () => null
    })
    const familiarity = restarted.profileView().profile.topics['law']?.familiarity ?? 0
    expect(familiarity).toBeLessThan(0.95)
    expect(familiarity).toBeGreaterThan(0.5)
  })
})

describe('LensService cold start (#59)', () => {
  const coldService = async (
    settings: () => LensSettings,
    store: LensStorage = createMemoryLensStorage()
  ): Promise<LensService> =>
    createLensService({
      storage: store,
      getLensSettings: settings,
      getProvider: async () => null,
      fake: true
    })

  it('finishing the setup drops the cold-start premium and the Ask-first triggers', async () => {
    let settings: LensSettings = { ...DEFAULT_LENS_SETTINGS, enabled: true, coldStartDone: false }
    const s = await coldService(() => settings)
    expect(s.snapshot()).toMatchObject({
      threshold: COLD_START_THRESHOLD,
      askFirstRemaining: COLD_START_ASK_FIRST
    })
    const pushed: number[] = []
    s.onProfile((snap) => pushed.push(snap.askFirstRemaining))
    const before = s.snapshot().version

    settings = { ...settings, coldStartDone: true }
    const view = await s.patchProfile({ style: { plainWords: true } })
    expect(view.profile.threshold).toBeCloseTo(DEFAULT_THRESHOLD)
    expect(view.profile.askFirstRemaining).toBe(0)
    expect(view.profile.style.plainWords).toBe(true)
    expect(view.profile.version).toBeGreaterThan(before)
    expect(pushed).toContain(0)
  })

  it('keeps what feedback taught the threshold', async () => {
    let settings: LensSettings = { ...DEFAULT_LENS_SETTINGS, enabled: true, coldStartDone: false }
    const store = createMemoryLensStorage()
    const first = await coldService(() => settings, store)
    // Two "I knew this" during cold start: +0.03 each.
    await first.feedback(event('knew_it', 'k1'))
    await first.feedback(event('knew_it', 'k2'))
    const learned = first.snapshot().threshold
    expect(learned).toBeGreaterThan(COLD_START_THRESHOLD)

    settings = { ...settings, coldStartDone: true }
    expect(first.snapshot().threshold).toBeCloseTo(
      learned - (COLD_START_THRESHOLD - DEFAULT_THRESHOLD)
    )
  })

  it('settingsChanged applies the finish at once, before any other call', async () => {
    let settings: LensSettings = { ...DEFAULT_LENS_SETTINGS, enabled: true, coldStartDone: false }
    const s = await coldService(() => settings)
    const pushed: number[] = []
    s.onProfile((snap) => pushed.push(snap.askFirstRemaining))
    settings = { ...settings, coldStartDone: true }
    s.settingsChanged()
    await new Promise((r) => setTimeout(r, 0))
    expect(pushed).toEqual([0])
    s.settingsChanged()
    await new Promise((r) => setTimeout(r, 0))
    expect(pushed).toEqual([0])
  })

  it('finishes a profile still in cold start at launch, and leaves others alone', async () => {
    const store = createMemoryLensStorage()
    const cold = { ...DEFAULT_LENS_SETTINGS, enabled: true, coldStartDone: false }
    await (await coldService(() => cold, store)).flush()

    const done = { ...cold, coldStartDone: true }
    const relaunched = await coldService(() => done, store)
    expect(relaunched.snapshot()).toMatchObject({
      threshold: DEFAULT_THRESHOLD,
      askFirstRemaining: 0
    })
    await new Promise((r) => setTimeout(r, 0))
    const saved = JSON.parse(store.files.get('profile.json') ?? '{}') as {
      askFirstRemaining?: number
    }
    expect(saved.askFirstRemaining).toBe(0)

    const stillCold = await coldService(() => cold, createMemoryLensStorage())
    expect(stillCold.profileView().profile.askFirstRemaining).toBe(COLD_START_ASK_FIRST)
  })
})
