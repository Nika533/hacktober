# Hoot: rules for every builder

Hoot is a Windows-first AI desktop buddy (a floating owl: Dot → Pill → Card →
Studio, circle-anything capture, sticky pins, streaming Gemini chat) plus
**Hoot Lens**, which rewrites text you don't understand in place, in the
browser and in local PDFs.

Read in this order before writing code:

1. `docs/hoot-lens.md`: the product spec (source of truth for **what**)
2. `docs/finish-plan.md`: **who builds what from now to the hackathon**, gates, queues
   (it replaces the remaining-task owners in `docs/rebuild-plan.md` §6; that file still
   holds the quality bar and milestones)
3. this file
4. `packages/core/CONTRACTS.md`: the shared contracts

## Layout and owners

| Path | What | Owner |
|---|---|---|
| `packages/core` | Contracts + pure logic: types, zod schemas, IPC routes, bridge protocol, chat and lens helpers, fakes | C |
| `packages/ui` | Design system + shared chat components | d3 |
| `packages/lens-dom` | In-page Lens (selection, signals, renderers, shadow-DOM UI) | d2 |
| `packages/pdf-view` | PDF.js view, overlay renderer, reflow mode | d3 |
| `packages/bridge` | hoot-bridge native messaging host | C |
| `apps/desktop/src/main` | Lifecycle, store, persistence, windows, buddy mode machine, hotkeys, tray, IPC registration (wires every feature) | d1 |
| `apps/desktop/src/main/{ai,lens,bridge}` | Gemini provider, Lens engine and profile, pipe server | C |
| `apps/desktop/src/main/{chat,pins}` + `renderer/note` | Chat service, pins and sticky notes | C |
| `apps/desktop/src/main/capture` + `renderer/capture` | Capture overlay | d2 |
| `apps/desktop/src/preload` | `window.hoot` (built from the routes in core) | d1 |
| `apps/desktop/src/renderer/{studio,reader,buddy}` | Studio, Hoot Reader, Buddy (dot, pill, card) | d3 |
| `apps/desktop/{electron-builder.yml,build,resources}` | Installer and packaging | C and d1 |
| `apps/extension` | MV3 extension: content script, service worker, options, PDF viewer | d2 |

The exact rules are in `scripts/ownership.json`, and CI enforces them on PRs
from `c/`, `d1/`, `d2/` and `d3/` branches. Everyone may change
`package-lock.json` and their own `docs/status/<id>.md`.

## Commands (repo root)

Windows: use `npm.cmd` / `npx.cmd`. The PowerShell execution policy blocks
the `.ps1` shims.

| Command | What |
|---|---|
| `npm.cmd install` | Install every workspace (also downloads Electron) |
| `npm.cmd run dev` | Desktop app in dev mode (electron-vite, via `run-electron.mjs`) |
| `npm.cmd run typecheck` | `tsc` in every workspace |
| `npm.cmd run lint` | ESLint over the repo |
| `npm.cmd test` | Vitest, every workspace as its own project |
| `npm.cmd run test:live` | Real Gemini calls; needs `GEMINI_API_KEY` |
| `npm.cmd run eval` | Lens rewrite-quality evals (C-31) on real Gemini; `EVAL_FAKE=1` dry-runs the harness; `EVAL_UPDATE_BASELINE=1` saves the baseline |
| `npm.cmd run build` | Build every workspace (desktop → `out/`, extension → `dist/`) |
| `npm.cmd run build:e2e -w @hoot/extension` | Extension with the fake backend, open shadow roots and Lens on (what the e2e suite loads) |
| `npm.cmd run serve:fixtures -w @hoot/extension` | Build and serve the Lens fixture pages on http://localhost:4510 |
| `npm.cmd run demo -w @hoot/lens-dom` | lens-dom demo page |
| `npm.cmd run e2e:desktop` | e2e build + Playwright `_electron` specs |
| `npm.cmd run e2e:extension` | Extension build + Playwright Chromium specs |
| `npm.cmd run build:win` | NSIS installer |
| `npm.cmd run register-host -w @hoot/bridge` | Build hoot-bridge and register it for Chrome, Edge, Chromium and Brave (current user); `unregister-host` undoes it |
| `npm.cmd run fake-server -w @hoot/bridge -- --port 7341 --code dev` | Fake Lens bridge on `ws://127.0.0.1:7341/?code=dev`, for using the extension without the app |
| `npm.cmd run check:ownership -- --branch d2/x --base origin/main` | Local ownership check |

One workspace: `npm.cmd run <script> -w @hoot/desktop` (or `@hoot/extension`,
`@hoot/core`, …). Load the unpacked extension from `apps/extension/dist`.

## Environment

- Node 24. No Rust or Python needed.
- `.devin/` is managed tooling. Never delete or overwrite it.
- If the host exports `ELECTRON_RUN_AS_NODE=1` (Devin/Windsurf hosts do),
  `electron.exe` runs as plain Node. `dev`/`start` go through
  `apps/desktop/scripts/run-electron.mjs`, which strips it; e2e must strip it too.
- **Smart App Control** can block a freshly built, unsigned
  `dist/win-unpacked/hoot.exe` ("An Application Control policy has blocked
  this file"). That's OS policy, not a bug. Don't try to bypass it; dev and
  e2e through `electron.exe` are unaffected.
- Dark-mode screenshots: drive the theme through the app (test hook), not
  `emulateMedia`. Windows refuses to steal focus, so call
  `setAlwaysOnTop(true, 'pop-up-menu')` + `moveTop()` before `capturePage` or a
  desktop grab, then restore. An occluded window captures empty.
- No secrets in git. `GEMINI_API_KEY` comes from the environment only.

### Windows facts verified in D1-00

- `safeStorage.isEncryptionAvailable()` is **false before `ready`**. Never touch
  secrets at module init. `getSelectedStorageBackend()` doesn't exist on Windows.
- Single instance: the first instance receives the second's argv, and Electron
  inserts its own flags. Parse flags by prefix, never by position.
- Flush before quit: `before-quit` → `preventDefault` → flush → `app.quit()`.
  Keep a "flushed" guard flag or the veto re-enters forever.
- Named pipe: a second `listen()` on the same name throws `EADDRINUSE`. Treat
  it as "another Hoot is running". `server.close()` frees the name at once.
- CSP: send it as a **response header**, not a meta tag. Use
  `session.webRequest.onHeadersReceived` for the dev URL and a privileged
  `hoot://` scheme (`protocol.handle`) in production. The Reader needs
  `worker-src 'self' blob:` for PDF.js; it never needs `unsafe-eval`.
- Click-through: clicks on fully transparent pixels pass through natively.
  `setIgnoreMouseEvents(true, { forward: true })` delivers `mousemove` only
  for a **physical** mouse, not injected input. So main also polls the cursor
  against renderer-reported hit regions (`buddy.setHitRegions`). Every buddy
  PR gets a manual check with a real mouse.
- `desktopCapturer`: a `thumbnailSize` larger than the display is
  **upscaled**. Compute the crop ratio from `image.width / display.bounds.width`.
  The first `getSources` takes about 3 s cold, so pre-warm it once at idle.
  Multi-monitor and mixed DPI are not verified yet.
- Double-click on Windows selects the word **and its trailing space**. lens-dom trims
  selections before anything else sees them.
- `nativeTheme.themeSource` may or may not flip `prefers-color-scheme` in a
  sandboxed renderer. The `system.darkMode` slice is the source of truth.

### Environment variables

| Variable | Effect |
|---|---|
| `GEMINI_API_KEY` | Dev fallback when no key is stored (`<userData>/hoot/gemini-key.bin`) |
| `HOOT_FAKE_AI=1` | Deterministic chat provider, no key or network |
| `HOOT_FAKE_LENS=1` | Lens engine answers with `@hoot/core/testing` fakes |
| `HOOT_TEST=1` | e2e build only: test hooks, no global hotkeys |
| `HOOT_USER_DATA=<dir>` | Redirects `app.getPath('userData')` |
| `HOOT_DEV_BRIDGE=1` | Dev-only WebSocket bridge transport (pairing code required) |

## Contracts

- Shared types, schemas and IPC routes live **only** in `@hoot/core`. Import
  them; never redefine them locally.
  - `@hoot/core`: types, models, chat and lens helpers, IPC routes, framing (no zod; safe for the content script)
  - `@hoot/core/schemas`: zod schemas, `migrateSettings`, `applySettingsPatch`, `parseInvokeArgs`
  - `@hoot/core/testing`: `createFakeLensBackend`, `fakeRewrite`, `fakeAssess`
- Validate at every boundary: IPC handlers call `parseInvokeArgs`/`parseSendArgs`;
  bridge frames go through `ExtToAppSchema`/`AppToExtSchema`; files from disk
  go through their schema (or `migrateSettings`); model output goes through
  `generateJson`'s schema.
- **Changing a contract:** open a PR touching only `packages/core`, titled
  `contract: …`. Additive changes (new optional fields, routes, types) merge
  once CI is green and C has reviewed (CODEOWNERS; C aims for 30 minutes).
  The root typecheck builds every consumer, so CI catches breakage. A
  breaking change also needs a "seen" line from every consumer in their
  status file.

## Conventions

- All network and model calls happen in main. Renderers are sandboxed
  (`sandbox: true`, `contextIsolation`, CSP header) and reach main only via
  `window.hoot`.
- State: main owns slices (`StateSlices`). Windows subscribe to the slices
  they render and get `state:patch` with only the changed slices. Streaming
  text goes over `chat:delta`. Invariant: a patch never contains a delta that
  wasn't already broadcast (mutate → broadcast delta → patch), so appends
  never double-count.
- Persist on structural changes and at stream end (debounced writes, atomic
  temp + rename). Write errors are surfaced, never swallowed.
- Buddy transitions: main sends `buddy:transition {id, from, to}`, the renderer
  animates, then calls `transitionDone(id)`. One source of timing.
  The owl's anchor (centre, screen DIP) never moves during a transition.
- Motion: springs, critically damped by default; bounce only for momentum
  gestures. `prefers-reduced-motion` → cross-fades, no idle motion. See
  `.devin/skills/apple-design/SKILL.md`.
- UI: renderers import `@hoot/ui/styles.css` once per window and wrap the app
  in `HootUIProvider`; theme and accent come from the `system` slice via
  `applyTheme` / `applyAccent`. Text is selectable by default; add
  `.hoot-chrome` to chrome that shouldn't be. `@hoot/ui` scripts: `typecheck`,
  `test`, `gallery` (vite on :5199, `#/gallery?theme=dark&accent=ca5010`),
  `shots` (Playwright screenshots + axe).
- Gemini: `maxOutputTokens` includes thinking tokens; structured output uses
  `responseJsonSchema` + zod. Gemini 4 Argon is paid-tier only and accepts
  thinking levels low/medium/high (not minimal).

## Workflow

**Merge on green.** CI is the gate, not a person.

- **Never push to `main`.** Every change goes through a PR so CI and the ownership check
  run on it.
- Branch `<you>/<TASK-ID>-<slug>` (e.g. `d2/D2-10-inline-renderer`) from
  `main`. PR title `<TASK-ID>: <summary>`.
- Open the PR and turn on auto-merge (`gh pr merge --auto --squash`). It
  merges as soon as the required checks pass: `ownership`, `checks`
  (Ubuntu + Windows: typecheck, lint errors, unit, build), `e2e` (Windows;
  skipped for docs-only PRs) and `ui-shots` (gallery screenshots + axe; only
  when `packages/ui` or a renderer changed).
- No approval is needed unless `.github/CODEOWNERS` asks for one: core
  contracts, preload/IPC/window hardening, the bridge, dependencies, and
  tooling/rules. Everything else merges on green.
- **Post-merge review:** C skims merged diffs. If something on `main` is
  wrong, revert first and discuss after. A red `main` is everyone's top
  priority.
- **Don't stack.** Each PR merges within minutes of going green, so start
  the next branch from `main`. If you truly depend on an unmerged PR, say so
  in the description.
- Small PRs merge faster; about 400 changed lines is a guideline, not a rule
  (tests and screenshots don't count).
- Dependencies: exact versions only, and only versions **published at least
  7 days earlier** (check `npm view <pkg> time`). There is one `zod` and one
  React (19.3.0), forced by the root `overrides` and root devDependencies.
- **Lockfile conflict:** take `main`'s `package-lock.json`, then run
  `npm.cmd install`. Never hand-merge it.
- Update `docs/status/<you>.md` (Now / Next / Blocked on / Requests / Notes)
  when your plan or blockers change, and at least daily; not after every PR.
- Blocked on another builder? Use the fakes or move to your next unblocked
  task. Don't edit their paths.

**Definition of done:**

1. CI green: typecheck, lint, unit, plus e2e for user-visible flows and
   `ui-shots` (axe clean) for UI.
2. Runs with `HOOT_FAKE_AI=1` / `HOOT_FAKE_LENS=1` and no key.
3. Meets the quality bar in `docs/rebuild-plan.md` §1. For UI, the
   `ui-screenshots` CI artifact (light, dark, high contrast) is the
   screenshot evidence; link it or attach a crop in the PR.
4. Status file current if your plan or blockers changed.
