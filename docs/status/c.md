# Status: C (Claude Code)

Only C edits this file. Updated when plans or blockers change (AGENTS.md).

## Now

- **C-30 wiring** (`c/C-30-wire-learning`): `LensService.feedback` applies the §8.3 learning
  rules (`applyLensEvent`, revert timing measured from the `shown` event) and topic decay runs
  at startup.

## Done (merged)

- M0: monorepo, contracts, Gemini provider, CI, ownership check, extension ID (#6, #7).
- M1: guardrails + prompts (#10), Lens engine + `LensService` + Lens IPC (#11),
  bridge connection + fake server (#12).
- M2: scorer + risk classifier (#13), hoot-bridge native host + registration (#16),
  bridge server in the app (#20), learning rules (#17), hotkey contract (#19),
  d2/d3 requests (#15).

## Next

- C-31 eval harness (`apps/desktop/evals`, `npm run eval`).
- Live Gemini run (`npm run test:live`) as soon as a key is available on the C machine.
- Integration gate M2 with d1 (Lens + bridge wiring in main) and d2 (D2-20 bridge client).

## Blocked on

- Nothing. The live Gemini tests need a key (`GEMINI_API_KEY`).

## For d1: wiring Lens into main (after D1-10)

```ts
import { createLensService, createLensHandlers, createFsLensStorage } from './lens'
const lens = await createLensService({
  storage: createFsLensStorage(join(userData, 'hoot', 'lens')),
  getLensSettings: () => state.settings.settings.lens,
  getProvider: async () => (fakeAi ? createFakeProvider() : key ? createGeminiProvider(key) : null),
  fake: process.env.HOOT_FAKE_LENS === '1',
  onExplain: (message, ctx) => chat.startExplain(message), // D1-23: open the card, send right away
  chooseExportPath: (name) => dialog.showSaveDialog({ defaultPath: name }).then((r) => r.filePath ?? null)
})
for (const [ch, fn] of Object.entries(createLensHandlers(lens)))
  ipcMain.handle(ch, (_e, ...args) => fn(...parseInvokeArgs(ch, args)))
lens.onProfile((snap) => broadcast('lens:profileChanged', snap))
// before-quit: await lens.flush()
```

Bridge server (C-20), after `whenReady` and the single-instance lock (d1 request 1):

```ts
import { createBridgeServer, AnotherInstanceError } from './bridge'
const bridge = createBridgeServer({
  lens, appVersion: app.getVersion(), platform: process.platform, env: process.env,
  pipePath: bridgePipePath(process.platform, os.userInfo().username, os.tmpdir()),
  getLensSettings: () => state.settings.settings.lens,
  patchLensSettings: (patch) => settings.update({ lens: patch }).then(() => state.settings.settings.lens),
  devWebSocket: process.env.HOOT_DEV_BRIDGE === '1'
    ? { port: Number(process.env.HOOT_DEV_BRIDGE_PORT ?? 7341), pairingCode: process.env.HOOT_DEV_BRIDGE_CODE ?? randomCode() }
    : null,
  onStatus: (s) => updateSlice('lens', s)
})
await bridge.start() // AnotherInstanceError → another Hoot owns the pipe: exit
// when Lens settings change from Studio: bridge.pushSettings(newLensSettings)
// will-quit: await bridge.stop()
```

## Requests

-

## Handled requests

| From | Request | Where |
|---|---|---|
| d1 #2 | `buddy:hitRegions` renderer → main | `HootApi.buddy.setHitRegions(rects)`, channel `buddy:hitRegions` (PR #6) |
| d1 #2 | Windows facts in AGENTS.md | AGENTS.md "Windows facts verified in D1-00" (PR #6) |
| d1 #1 | Bridge server `start()`/`stop()` promises, no bind at import | Accepted for C-20 (M2). `EADDRINUSE` maps to "another Hoot is running" |
| d3 | Pick up `packages/ui` and `packages/pdf-view` as workspaces | Root workspaces glob `packages/*`; M0 no longer creates stubs there, so d3's PRs rebase without conflicts |
| d3 | Root `happy-dom` 20.14.6 and `@axe-core/playwright` 4.13.0 | Root devDependencies (PR #6) |
| d3 | `OwlMood` in core | `packages/core/src/types/app.ts`, buddy slice |
| d3 | `@hoot/ui` scripts and the styles.css rule in AGENTS.md | AGENTS.md Conventions (PR #6) |
| d3 | Reader CSP `worker-src` for PDF.js | AGENTS.md Windows facts (CSP); d1 implements the headers in D1-12 |
| d3 | 7-day package age | Adopted repo-wide. `@google/genai` → 2.28.0, `zod` → 4.6.5 |

| #9 review | Log `shown` / Recent changes only when lens-dom renders | Already the design: `LensEvent.cacheKey` links shown/kept events to the cached rewrite (#10) |
| #9 review | "Explain more" auto-streams with a compact line + full context | `buildExplainMore()` in core; `LensServiceDeps.onExplain(message)` gives d1 `{ text, sentText }` |
| #9 review | Tighter inline replace (≤1.15× length, ≤7-word gloss) | Not adopted: it overrides spec §7.1, and a gloss block shifts layout too. Limits stay constants in `TRANSFORM_RULES` / guardrails; revisit with C-31 eval data |

| d3 | `useHootState` must buffer patches until the subscribe snapshot arrives | Asked on #21; rule in CONTRACTS.md "State subscription ordering" |

## Notes

- `legacy-v0` tag: the legacy app on Gemini, plus the plan.
- Dev extension ID `angnmpllmankipgoikeahfhidpcjninj`, from the manifest `key`.
- After M0, workspace packages that don't exist yet (`@hoot/ui`,
  `@hoot/lens-dom`, `@hoot/pdf-view`) are **not** listed in
  `apps/desktop/package.json`. Undeclared workspace names would make npm look
  them up on the public registry. Add them when the packages land.
- Live Gemini tests (`npm run test:live`) haven't run: no key on the C machine.
