# Hoot rebuild plan: four builders in parallel

> Source of truth for **what** to build: [`hoot-lens.md`](./hoot-lens.md).
> This document says **who builds what, in what order, and how the pieces meet**.
> Every builder reads both documents and `AGENTS.md` before writing code.

| Builder | Agent | Machine | Owns |
|---|---|---|---|
| **C** | Claude Code | macOS | Contracts, Gemini AI layer, Lens engine and profile, bridge, CI, merging |
| **d1** | Devin | Windows | Electron main process, Buddy (Dot/Pill/Card), capture, pins, tray, installer |
| **d2** | Devin | Windows + Chrome/Edge | `lens-dom` (in-page Lens), MV3 extension, PDF interception |
| **d3** | Devin | Windows | Design system, shared chat UI, Studio (including Lens pages), PDF view, Hoot Reader |

C is on macOS, so C takes the work that doesn't depend on the platform: pure logic, the AI provider and the protocols. Everything that needs Windows to verify (windows, DPAPI, named pipes in the installed app, NSIS) belongs to a Devin.

---

## 1. Why rebuild, and the quality bar

The current build typechecks, lints and passes 73 unit tests. The problems are
structural. An audit of the code (tag `legacy-v0`) found:

| Problem in legacy | Where | Fixed by |
|---|---|---|
| One mutable global `AppState`, broadcast in full to every window on every change (sessions, base64 thumbnails, pins) | `main/store/state.ts`, `main/index.ts` | d1 (D1-10) |
| A 544-line `ipc.ts` god file: chat, sessions, settings, secrets, pins, mood timers and errors in one closure, with module-level singletons | `main/ipc.ts` | d1 (D1-12, D1-13) |
| No IPC input validation: `settings:update` does `Object.assign`, ids go straight into `path.join` (path traversal), an unknown quick action throws | `ipc.ts`, `persistence.ts` | C (schemas), d1 (handlers) |
| `sandbox:false` on all four windows; CSP only in a meta tag with `unsafe-inline` styles | `main/windows/*` | d1 (D1-12) |
| Stream races: Stop is ignored before the first await; deleting a session mid-stream brings it back; a crash leaves messages stuck in "streaming" | `ipc.ts` | d1 (D1-13) |
| Persistence: corrupt JSON silently resets settings, write errors are swallowed, `saveHistory` is ignored for the index, no schema versions | `store/persistence.ts` | d1 (D1-11) |
| Capture can start twice: the guard is set after an async grab | `capture.ts` | d1 (D1-20) |
| Dot/Pill/Card choreography timed separately in two processes (main 450 ms, renderer 240 ms) | `windows/buddy.ts`, `BuddyApp.tsx` | d1 (D1-14) |
| UI: about 74 raw colours outside tokens, 27 inline styles, about 5 focus-visible rules, `window.confirm`, segmented controls without radio semantics, global `user-select:none` | renderer | d3 |
| Fakes and test hooks ship in the production bundle | `ai/fake.ts`, `testHooks.ts` | C, d1 |
| No tests for IPC, the state store, the buddy mode machine, capture, pins or any React component | `tests/` | everyone |

**Carried over (port, don't rewrite):** `shared/geometry`, `accelerator`,
`clipboard` (hint logic), `sessions`, `prompts`, `ai/conversation`
(`buildMessages`, `titleFrom`) together with their tests. Also the `AiClient`
seam, the rule that a delta is broadcast before the snapshot, atomic JSON
writes, `safeStorage` key handling, the single-instance lock, undo after
delete, the Owl and Markdown components, and the token approach (light, dark,
high contrast, reduced motion).

### Quality bar (applies to every PR)

- TypeScript `strict` + `noUncheckedIndexedAccess`. No `any` without a one-line reason.
- **Every boundary is validated with zod** (from `@hoot/core`): IPC payloads, bridge messages, model JSON output, files read from disk.
- Every window runs with `sandbox: true`, `contextIsolation: true`, a CSP sent as a header, and navigation and window-open guards.
- No module-level mutable singletons in main. Services are built in one place (`AppContext`) and passed in explicitly.
- Fakes and test hooks are compiled only into the e2e build (`--mode e2e`), never into the installer.
- Every pure module has unit tests. Every user-visible flow has an e2e test. Studio, the Reader and the Lens UI pass an axe check.
- UI: no raw colours outside tokens, no inline styles except dynamic geometry, every control reachable by keyboard with a visible focus ring, and `prefers-reduced-motion` / `prefers-contrast` / reduced transparency respected. Motion follows `.devin/skills/apple-design`.
- Every UI PR includes light and dark screenshots.

---

## 2. Target architecture and repo layout

Monorepo with npm workspaces. Ownership is by directory, so four builders can push all day without touching the same files.

```
hacktober/
  package.json              workspaces: apps/*, packages/*         [C]
  tsconfig.base.json, eslint.config.mjs, .prettierrc.yaml,
  vitest.workspace.ts, .github/workflows/ci.yml                    [C]
  scripts/check-ownership.mjs   CI: branch prefix → allowed paths  [C]
  AGENTS.md                 rules for all builders                 [C]
  docs/
    hoot-lens.md            product spec (source of truth)
    rebuild-plan.md         this file                              [C]
    status/{c,d1,d2,d3}.md  one status file per builder            [each]
  packages/
    core/                   pure TS: no DOM, Node or Electron      [C]
      src/types/            settings, chat, app-state slices, lens types
      src/schemas/          zod schemas for every boundary
      src/ipc/              channel map + HootApi (preload) type
      src/protocol/         bridge messages, framing, LensBackend interface
      src/chat/             buildMessages, titleFrom, prompts, groupSessions
      src/lens/             prompts, guardrails, scorer, profile rules,
                            profile summary, risk classifier, cache key
      src/util/             geometry, accelerator, clipboard decision
      src/testing/          fake lens backend + fake protocol server
    ui/                     React design system + shared chat UI   [d3]
    lens-dom/               framework-free in-page Lens (shadow DOM)[d2]
    pdf-view/               PDF.js document view, text layer,
                            overlay renderer, reflow mode           [d3]
    bridge/                 hoot-bridge native messaging host      [C]
  apps/
    desktop/                Electron app
      src/main/             lifecycle, AppContext, store, persistence,
                            secrets, windows, capture, pins, tray,
                            hotkeys, chat service, IPC handlers     [d1]
      src/main/ai/          Gemini provider, fake, errors, models   [C]
      src/main/lens/        engine, profile store, events, cache,
                            lens IPC handlers                       [C]
      src/main/bridge/      pipe server, dev WebSocket, routing     [C]
      src/preload/          window.hoot implementing HootApi        [d1]
      src/renderer/buddy|capture|note                               [d1]
      src/renderer/studio|reader                                    [d3]
      e2e/                  buddy-*, capture-*, pins-* [d1] · studio-*, reader-* [d3]
      evals/                rewrite quality eval set + runner       [C]
    extension/              MV3: manifest, sw, content, viewer,
                            options, fixtures, e2e                  [d2]
```

### Runtime picture

```
 Chrome / Edge                                   Hoot desktop app (Electron)
 ┌─────────────────────────────┐                 ┌──────────────────────────────────────┐
 │ content script              │                 │ main                                 │
 │  lens-dom [d2]              │                 │  lens/engine ─ ai/gemini [C]         │
 │   ├ selection + signals     │                 │  lens/profile, events, cache [C]     │
 │   ├ core/lens/score [C]     │                 │  bridge/server [C] ◄────────┐        │
 │   └ renderers + UI          │                 │  chat service, store,       │        │
 │ service worker [d2]         │  native msg     │  windows, capture [d1]      │        │
 │   bridge client ────────────┼──► hoot-bridge ─┼──► named pipe ──────────────┘        │
 │ viewer.html [d2]            │      [C]        │                                      │
 │   pdf-view [d3] + lens-dom  │                 │ renderers: buddy [d1] · studio,      │
 └─────────────────────────────┘                 │   reader (pdf-view + lens-dom) [d3]  │
                                                 └──────────────────────────────────────┘
```

**One Lens interface, three hosts.** `lens-dom` talks only to the
`LensBackend` interface in `@hoot/core`: `assess`, `rewrite`, `cancel`,
`feedback`, `getProfile`, `getSettings`, `onSettings`, `explainMore`.

| Host | Backend implementation | Built by |
|---|---|---|
| Extension content script | `chrome.runtime` → service worker → native messaging → app | d2 |
| Reader window | preload IPC → `main/lens` | d3 (renderer), C (main) |
| Tests and fixtures | `core/testing/fakeLensBackend` | C |

### Stack

Keep the existing stack: Electron 44, electron-vite 6, React 19, TypeScript
5.9, Vitest 5, Playwright 1.64, motion 14 and lucide-react. Add:

| Package | Version | Used for |
|---|---|---|
| `@google/genai` | 2.28.0 | Gemini. Pin below 3.0, because 3.0 changes function calling and needs Node 22 or later |
| `zod` | 4.6.5 | All boundary schemas (one copy, forced by root `overrides`) |
| `pdfjs-dist` | 6.4.299 | `pdf-view` |
| `esbuild` | 0.28.2 | Building the extension and `hoot-bridge` |
| `happy-dom` | 20.14.6 | Unit tests for `lens-dom` and `ui` |
| `@axe-core/playwright` | 4.13.0 | Accessibility checks in e2e |
| `@types/chrome` | 0.3.5 | Extension types |
| `ws` | 8.22.0 | Dev-only bridge transport |

Every version is exact and was published at least 7 days before it was added (supply-chain rule, see `AGENTS.md`).

---

## 3. AI provider: Google Gemini

All model calls happen in the desktop main process through `@google/genai`.
The extension and renderers never see the key. The legacy app is already
switched (see §12).

| Use | Model ID | Notes |
|---|---|---|
| Chat default ("Flash") | `gemini-3.8-flash` | Stable. Thinking level `LOW` |
| Chat fast ("Flash-Lite") | `gemini-3.5-flash-lite` | Stable |
| Chat smartest ("Argon") | `gemini-4-argon` | Stable, **not on the free tier**, so label it in the UI. Thinking levels: low, medium, high |
| Lens gray-zone assess | `gemini-3.5-flash-lite` | JSON output, lowest thinking level |
| Lens rewrite: define, expand, translate | `gemini-3.5-flash-lite` | JSON output |
| Lens rewrite: simplify, unpack (long spans) | `gemini-3.8-flash` | JSON output |
| Eval grader | `gemini-3.8-flash` | Used only by `npm run eval` |

Rules for the provider (C owns `apps/desktop/src/main/ai/`):

- `maxOutputTokens` counts **thinking plus output**, so leave headroom. Chat uses 8192.
- Structured output: `responseMimeType: 'application/json'` and `responseJsonSchema`, then parse with zod. If parsing fails, drop the result, as the spec's guardrail 1 says.
- Cancel with `config.abortSignal`. An aborted call rejects with `AbortError`.
- Errors: 400 `API_KEY_INVALID` or 403 means the key was rejected. 429 means rate limited. 500, 503 and 504 mean busy: retry once with jitter, Lens calls only. `promptFeedback.blockReason` or finish reasons `SAFETY` / `PROHIBITED_CONTENT` / … mean blocked. These map to the codes in `src/main/ai/errors.ts`.
- The key lives at `<userData>/hoot/gemini-key.bin`, encrypted with DPAPI through `safeStorage`. The `GEMINI_API_KEY` environment variable is the dev fallback.
- Do not use Gemini 2.5 models. Google Cloud lists them for retirement on 2026-10-20.
- Privacy copy: Google's data terms for the free tier and paid tiers differ. Lens copy must not promise that "your text is never used to improve models" unless the key is on a paid tier. Have C check the current terms before the consent screen (D3-20) is written.
- Everything has to run without a key: `HOOT_FAKE_AI=1` (chat) and `HOOT_FAKE_LENS=1` (Lens).

---

## 4. Contracts (frozen at the end of M0)

C writes these first. Everyone builds against them, using fakes, from day one.

| Contract | File in `packages/core` | Consumers |
|---|---|---|
| Settings v2 (with `schemaVersion`, `LensSettings`), migrations | `types/settings.ts`, `schemas/settings.ts` | d1, d3 |
| Chat types (Session, Message, Attachment) + `buildMessages` | `types/chat.ts`, `chat/*` | d1, d3 |
| App state **slices** (`buddy`, `chat`, `sessions`, `capture`, `pins`, `settings`, `system`) and per-window subscriptions | `types/state.ts` | d1, d3 |
| IPC channel map + `HootApi` (the full `window.hoot` surface, including `lens.*`) with zod payload schemas | `ipc/*` | d1 (implements), d3 and d1 renderers (call) |
| Lens types: `LensContext`, `RewriteResult`, `LensEvent`, `ReaderProfile`, `ProfileView` | `types/lens.ts` | all |
| `LensBackend` interface | `protocol/backend.ts` | d2, d3 |
| Bridge protocol: the messages from spec §10.2, **plus** `settings.patch`, `explain`, `profile` carrying `threshold` and `knownTerms`, and an `error` with codes. Framing: 4-byte little-endian length + UTF-8 JSON | `protocol/bridge.ts` | C, d2 |
| `AiProvider` (`stream`, `generateJson`, `validateKey`) | `apps/desktop/src/main/ai/types.ts` | d1, C |

**Changing a contract after M0:** open a PR touching only `packages/core`,
title it `contract: …`, keep it **additive**, and C reviews it within about
30 minutes. A breaking change also needs a "seen" line from every consumer in
their `docs/status/*.md`.

---

## 5. Milestones (gates, not dates)

Each milestone ends with an **integration check** that C runs on `main`, with
d1 running the Windows half. Nobody starts the next milestone's integration
work until the gate passes, but builders keep working on their own tasks.

| Gate | Exit criteria |
|---|---|
| **M0 Foundation** | Monorepo builds; CI green on Windows and Ubuntu; contracts merged; tag `scaffold-ready`; `@hoot/core` fakes usable; Gemini provider ported |
| **M1 Slices on fakes** | Each surface works alone against fakes. Buddy opens and streams with the fake AI. Studio renders sessions and settings. lens-dom swaps and restores on the fixture pages in Ask-first mode with the fake backend. The Lens engine passes guardrail tests |
| **M2 Wired together** *(demo cut line)* | Real Gemini end to end: the extension, on a real site, goes Ask-first chip → native bridge → engine → mark → restore → event logged. Hoot base reaches feature parity with legacy (summon, capture, chat, pins, Studio, onboarding). Lens consent and Reading settings exist |
| **M3 Lens complete** | Implicit detection with the scorer, gray zone, rate limits and personalization v1 (spec Phase 2). PDFs work in the extension viewer and the Hoot Reader (spec Phase 3). Profile, glossary and Recent-changes pages exist. The installer registers the native host |
| **M4 Ship** | The eval gate passes; the latency targets in spec §7.2 are met; a11y and visual QA done; the packaged installer passes a smoke test; extension zip and listing ready; README and demo script done |

**If time runs out, demo the M2 cut**: Hoot base plus Ask-first Lens on HTML
pages. M3 and M4 items marked *stretch* below are the first to drop.

---

## 6. Workstreams

Task IDs are referenced in PR titles (`D1-13: per-stream abort controller`).
"Needs" lists inputs from other builders. Until an input lands, use the fake.

### C: contracts, AI and Lens brain, bridge, integration (Claude Code, macOS)

**M0 (blocking, done first; the others do the D*-00 tasks meanwhile)**

- **C-01 Monorepo.** Tag `legacy-v0` on the current `main`. Create workspaces, `tsconfig.base.json`, shared eslint and prettier, the vitest workspace, and root scripts (`typecheck`, `lint`, `test`, `e2e:desktop`, `e2e:extension`, `build:win`, `eval`). Add an `apps/desktop` electron-vite skeleton with five stub renderer entries (buddy, studio, capture, note, reader) plus an `apps/extension` skeleton. Remove the legacy sources from `main`. Builders read legacy with `git show legacy-v0:<path>` or `git worktree add ../hoot-legacy legacy-v0`.
- **C-02 Core contracts** (section 4), plus porting the "carry over" modules with their tests.
- **C-03 AI provider.** Port today's Gemini client. Add `generateJson<T>(zodSchema)`, per-call timeouts and Lens retries, a model registry, a scripted fake provider, and `npm run test:live`, which is skipped when `GEMINI_API_KEY` is unset.
- **C-04 CI.** `windows-latest`: install, typecheck, lint, unit, desktop e2e and extension e2e. `ubuntu-latest`: typecheck, lint, unit. Plus `scripts/check-ownership.mjs`, which fails a PR from branch `dN/*` that touches paths it doesn't own (section 7).
- **C-05 Stable extension ID.** Generate a key pair and put the public key in `apps/extension/manifest.json` (`key`), so the unpacked extension ID is the same on every machine and the native host's `allowed_origins` can name it.

**M1**

- **C-10 Lens engine** (`main/lens/engine.ts`). Assess and rewrite through `generateJson`, model routing by transform, allowed-transform limits, cancellation per `reqId`, de-duplication of identical requests in flight, a memory LRU backed by `lens/cache.json` with key = hash(span + paragraph + transform + profileVersion), and latency timing.
- **C-11 Guardrails** (`core/lens/guardrails.ts`). Spec §7.4: schema check; skip, meaning-preserved and confidence floors; the invariant check (numbers, units, dates, URLs, negations in EN plus the Phase-1 languages); length rules per transform; forced gloss on high-stakes pages. Table-driven tests with at least 60 cases.
- **C-12 Prompts and profile summary** (`core/lens/prompts.ts`). Spec §7.3 and §8.5, with the summary under 150 tokens.
- **C-13 Fakes for others.** `core/testing/fakeLensBackend`, the `HOOT_FAKE_LENS` engine mode, and `createFakeLensServer` in `@hoot/bridge/testing` (the bridge protocol over a local WebSocket) so d2's extension e2e needs no Electron. The protocol logic, `createBridgeConnection`, is shared with the real server (C-20).
- **C-14 Lens IPC for Studio and the Reader:** `lens.profile.get|patch|reset|export`, `lens.events.recent`, `lens.glossary.list`, `lens.settings.get|patch`, `lens.assess|rewrite|cancel|feedback`.

**M2**

- **C-20 Bridge, app side** (`main/bridge/`). Named-pipe server (`\\.\pipe\hoot-lens-<user>` on Windows, a unix socket for dev on macOS), length-prefixed framing, and a handshake token (written to `<userData>/hoot/bridge.token`, readable only by the user). Routes to the engine, profile and settings; pushes `settings.changed`; answers every `reqId` exactly once. A dev WebSocket transport is enabled only with `HOOT_DEV_BRIDGE=1` and requires a pairing code.
- **C-21 `packages/bridge` (hoot-bridge).** Relays stdin/stdout to the pipe; checks the caller's `chrome-extension://` origin; launches `hoot.exe --hidden` if the app isn't running. Built to `hoot-bridge.exe` with esbuild + Node SEA, with a dev `.cmd` wrapper. `scripts/register-native-host.mjs` writes the HKCU registry entries for Chrome and Edge, and the macOS dev path. Hands d1 the binary and the registration logic for the installer (D1-30).
- **C-22 Scorer and signals math** (`core/lens/score.ts`). Spec §6.2: sigmoid with hand-set weights, gray zone, θu updates, rate limits (3 per minute, 12 per page, Ask-first after 2 reverts), cooldowns. Pure; d2 calls it from the content script.
- **C-23 Risk classifier and default deny list** (`core/lens/risk.ts` plus data). Spec §7.5 and §11.

**M3**

- **C-30 Profile and events.** Spec §8. Monthly JSONL event logs with 30/90/365-day retention; the §8.3 update rules; topic decay; cold start; glossary derivation; export and reset.
- **C-31 Eval harness** (`apps/desktop/evals/`). About 200 spans (JSONL) across domains and languages. Scores meaning preserved, easier to read, length ratio and invariants intact, graded by a model rubric. `npm run eval` writes a report and fails on regression.

**M4:** **C-40** latency, cost and privacy review of what leaves the machine; **C-41** rewrite `AGENTS.md`, README and `packages/core/CONTRACTS.md`.

**All the time:** keeper of `main`. Review CODEOWNERS-gated PRs (contracts, security, dependencies, tooling) within about 30 minutes, skim other merged diffs and revert anything that breaks `main`, run each gate's integration check.

### d1: desktop shell (Devin, Windows)

**M0 (start now, no dependencies)**

- **D1-00** Read the spec, this plan and legacy. Do Windows spikes in a scratch folder that is **not committed**: a transparent, frameless, always-on-top buddy with click-through regions on Electron 44; Mica on Studio; `desktopCapturer` across monitors at mixed DPI. Write the findings in `docs/status/d1.md`.

**M1**

- **D1-10 Main foundation.** Lifecycle (single instance, `--hidden`, flush before quit), an `AppContext` composition root with no module singletons, and a store built from **slices**: windows subscribe to the slices they need and receive only patches for those. Streaming deltas go out on `chat:delta`, still broadcast before the snapshot.
- **D1-11 Persistence v2.** Versioned schemas and migrations (from core), atomic writes with unique temp names, a backup when a file is corrupt (`*.corrupt-<ts>.json`), write errors surfaced, `saveHistory` respected everywhere, ids checked against a uuid pattern before touching paths.
- **D1-12 IPC and security.** One handler module per domain (chat, sessions, settings, capture, pins, windows). Every payload is zod-validated. Preload implements `HootApi`. Every window gets `sandbox: true`, a CSP header and navigation guards; `openExternal` checks an allowlist.
- **D1-13 Chat service.** One controller per stream, with the abort created **before any await**. Switching or deleting a session mid-stream is safe. Partial text is checkpointed about every 500 ms, and a message still "streaming" at startup is loaded as "stopped". Stop and Regenerate. Uses C's `AiProvider` (fake until C-03 lands).
- **D1-14 Buddy mode machine.** A pure reducer with tests for hidden/dot/pill/card. **One** source of timing: main sets the target, the renderer animates, then acks. Drag at 1:1, flick and snap to edges (port `geometry`), the collapse timer and click-through.
- **D1-15 Buddy renderer.** Dot, Pill, Card, greeting and owl moods, using d3's `@hoot/ui` chat components (placeholders until D3-10 lands).

**M2**

- **D1-20 Capture overlay.** Guard set synchronously, multi-display, lasso / rect / full, crop pipeline, up to 4 pending, quick chips.
- **D1-21** Clipboard chip; tray; global hotkeys (re-recordable, conflicts shown); launch at login.
- **D1-22** Pins and sticky-note windows. Also an API that d3's glossary uses to pin an entry.
- **D1-23 Explain more.** The bridge or Reader event `explain` opens the Buddy card pre-filled with the span and its paragraph.
- **D1-24 E2E** for buddy, chat, capture and pins with the fake AI. Test hooks exist only in the `--mode e2e` build.

**M3**

- **D1-30 Installer.** electron-builder NSIS; ship `hoot-bridge.exe` as an extra resource; an NSIS include registers the native host for Chrome and Edge (HKCU) and removes it on uninstall; autostart with `--hidden`; drop a file on the owl or use the tray to "Open in Hoot Reader" (calls d3's Reader).
- **D1-31 Windows polish.** Mica, accent colour, high contrast, DPI changes, sleep and resume, monitors being plugged in and out.

**M4:** **D1-40** Smoke test the packaged app; add a code-signing hook that is skipped when no certificate is present (Smart App Control can block unsigned builds, see `AGENTS.md`); idle budget under 1% CPU and 200 MB.

**Needs:** C-02 contracts (M0), C-03 provider (M1), D3-10 chat components (M1), C-21 bridge binary (for D1-30).

### d2: Lens in the browser (Devin, Windows, Chrome and Edge)

**M0 (start now, no dependencies)**

- **D2-00 Spec Phase 0 spike, directly in `packages/lens-dom`.** Select text, swap in a hard-coded rewrite, add the mark, show a popover with the original, restore. Whitespace must round-trip exactly on a static fixture page. happy-dom unit tests.

**M1**

- **D2-10 Inline renderer.** Split text nodes at the range boundaries, wrap them in a `<hoot-lens-mark>` custom element, keep the originals in a WeakMap, restore exactly, support ranges that span several nodes. Never touch inputs, textareas, `contenteditable`, `pre`/`code`, quotes or paused sites. A MutationObserver drops marks the page re-renders and re-applies them from cache.
- **D2-11 Overlay renderer.** Dim the range with the CSS Custom Highlight API and place a shadow-DOM box over it, repositioned on scroll and resize. Detect dynamic pages (framework root markers plus mutation rate). Export the `Renderer` interface so d3's `pdf-view` can implement it.
- **D2-12 Lens UI** (shadow DOM). The mark style from spec §5.4; the popover (original, Restore, I knew this, Explain more, transform footer, high-stakes note); the page pill; the Ask-first chip; the thinking shimmer; motion from §5.5; reduced motion and high contrast; the keyboard map (Alt+Z, Alt+Shift+Z, Alt+H, Tab/Enter/Esc); `aria-describedby`; copying gives the original.
- **D2-13 Selection and context.** Listeners for `selectionchange`, copy, scroll and typing; dwell timing; extraction of span (600 characters), paragraph (1500), `headingPath`, `title` and `lang`.
- **D2-14 Fixtures.** Static article, a React page that re-renders, iframes, code plus inputs, a high-stakes page, a foreign-language page (`apps/extension/fixtures/`).
- **D2-15 MV3 skeleton.** Manifest using C-05's key, esbuild build, and a content script that runs lens-dom with the service worker as backend. Ask-first works end to end with the fake backend.

**M2**

- **D2-20 Service worker.** Native-messaging port with reconnect on demand, `reqId` routing and cancel; dev WebSocket fallback; per-tab rate limits; session cache; settings cache with pushed updates; off in incognito; deny list and pages with password fields enforced.
- **D2-21 Options page.** Site lists (always, paused, never), quick toggles, and connection status ("Hoot isn't running" or "Hoot isn't installed", with how to fix it).
- **D2-22 Extension e2e.** Playwright Chromium persistent context with `--load-extension` against the fixtures and C-13's fake protocol server. Plus one full-stack test against the real app in `HOOT_FAKE_LENS` mode.

**M3**

- **D2-30 Implicit detection.** Collect signals s1–s10 and call `core/lens/score` (C-22); gray-zone assess; cooldowns; infer "kept" (30 s or scrolled past); report reselected and copied-original as feedback.
- **D2-31 PDF in the browser.** Watch navigations, redirect PDFs to `viewer.html`, which hosts d3's `pdf-view` with lens-dom on top; ask once for `file://` access; a toolbar toggle falls back to the browser's own viewer.

**M4:** **D2-40** Store readiness: permission justifications, privacy text, icons, zip script, Edge check. Budgets: content script under 50 KB gzipped, no long task over 50 ms on select. Word-frequency lists must have a verified permissive licence, recorded in `THIRD_PARTY.md`.

**Needs:** C-02 / C-13 (M1), C-20 / C-21 (M2), C-22 / C-23 (M3), D3-30 `pdf-view` (M3).

### d3: design system, Studio, PDF view and Reader (Devin, Windows)

**M0 (start now, no dependencies)**

- **D3-00 `packages/ui` design system.** Tokens with the theme blocks de-duplicated (light, dark, high contrast, reduced transparency); materials; type scale (Segoe UI Variable, falling back to the system font); spacing, radius and elevation; spring presets; focus rings. Components: Owl (all moods), IconButton, Button, Segmented (radio semantics), Switch, TextField, Slider, Toast, Dialog (replaces `window.confirm`) and Tooltip. Add a `#/gallery` dev route for screenshots.

**M1**

- **D3-10 Shared chat UI, delivered first because d1 depends on it.** Markdown (safe, with code copy), Transcript (stays pinned to the bottom only when the user is at the bottom; text selectable), Composer, AttachmentsRow, QuickChips, ClipboardChip, and an ErrorBody that covers the Gemini error codes.
- **D3-11 Studio shell.** Mica chrome; session sidebar (grouping, search, rename, delete with an undo toast); chat pane; keyboard map.
- **D3-12 Settings.** Gemini key (validate, status, link to aistudio.google.com/apikey); model picker (Flash-Lite, Flash, Argon with a "paid tier" note); hotkey recorder that works with a keyboard and screen reader; behaviour toggles; clearing data through a Dialog.
- **D3-13 Onboarding.** Welcome → Gemini key → hotkeys → done.

**M2**

- **D3-20 Lens consent and Reading settings** (spec §5.6 and §11): what gets sent and when, off by default, mode, sensitivity, site lists, high-stakes handling, copy behaviour, languages, retention.
- **D3-21 Lens pages:** "What Hoot knows about me" (known terms, struggling areas, topics, style; edit, export, reset); Recent changes (original next to the rewrite); My glossary (pin an entry as a note through d1's API).
- **D3-22** Cold-start setup (about 30 seconds, spec §8.4).
- **D3-23** Studio e2e with axe: onboarding, settings persistence, and the Lens pages with the fake Lens.

**M3**

- **D3-30 `packages/pdf-view`.** A PDF.js document view with text layer; an overlay renderer that implements d2's `Renderer` (covers the glyph run, shrinks the font down to a minimum, then grows the box); margin glosses; reflow mode. Used by d2's extension viewer and by the Reader.
- **D3-31 Hoot Reader window** (`reader.html`). Local PDF and HTML files; `pdf-view` plus lens-dom with an IPC `LensBackend` (C-14); the same marks, popover, pill and shortcuts as the extension.
- **D3-32** Visual QA across every window: light, dark and high-contrast screenshots; axe run on Studio and Reader.

**M4:** **D3-40** Polish: micro-interactions per the apple-design skill, empty states, a copy pass.

**Needs:** C-02 (M0), C-14 (M2), D2-11 `Renderer` interface (M2), D1-22 pins API (M2).

### Hand-off matrix

| From → To | What | Needed by |
|---|---|---|
| C → all | `@hoot/core` contracts + fakes | M0 |
| C → d1 | `AiProvider` (Gemini + fake) | start of M1 |
| d3 → d1 | `@hoot/ui` chat components (D3-10) | middle of M1 |
| C → d2 | Protocol schemas, fake protocol server (C-13) | middle of M1 |
| C → d3 | Lens IPC + fake data (C-14) | end of M1 |
| d2 → d3 | `Renderer` interface + lens-dom public API | M2 |
| C → d2 | Bridge server + hoot-bridge (C-20, C-21) | M2 |
| d1 → C | Lifecycle hook that starts the bridge server; `--hidden` launch | M2 |
| C → d2 | Scorer + risk classifier (C-22, C-23) | end of M2 |
| d3 → d2 | `pdf-view` (D3-30) | M3 |
| C → d1 | `hoot-bridge.exe` + registration logic | M3 (installer) |

---

## 7. Working agreement

**Git**

- `main` is protected: no direct pushes, required CI checks, review only where `.github/CODEOWNERS` asks (core contracts, security boundary, dependencies, tooling). Branches use the builder prefix: `c/…`, `d1/…`, `d2/…`, `d3/…`.
- **Merge on green:** open the PR with auto-merge on; it merges when CI passes. C reviews merged diffs afterwards and reverts anything that breaks `main`. About 400 changed lines is a guideline, not a rule.
- Don't stack PRs; branch from `main`. **Lockfile conflicts:** take `main`'s `package-lock.json`, then run `npm.cmd install`. Never hand-merge it.
- Commit messages: `<TASK-ID>: <what>`.

**Ownership** (enforced by `scripts/check-ownership.mjs`)

- Paths belong to the builder shown in section 2. Root config, `packages/core` and `docs/rebuild-plan.md` belong to C.
- Need a change in someone else's path? Write it under "Requests" in your status file and in the PR description. Don't edit it yourself.
- `docs/status/<you>.md` is the only shared-folder file you edit. Update it when your plan or blockers change (at least daily), under the headings **Now / Next / Blocked on / Requests / Notes**.
- `.devin/` is managed by the tooling. Never delete or overwrite it.

**Definition of done for a task**

1. CI green: typecheck, lint, unit; e2e for any user-visible flow; `ui-shots` (axe clean) for UI.
2. Runs with `HOOT_FAKE_AI=1` / `HOOT_FAKE_LENS=1` and no key.
3. Meets the quality bar in section 1. For UI, CI's `ui-screenshots` artifact is the screenshot evidence.
4. Status file current if your plan or blockers changed. If behaviour or commands changed, a note in `AGENTS.md` (sent to C as a request).

**Environment** (Windows builders): use `npm.cmd` and `npx.cmd`, not
`npm`/`npx`. `ELECTRON_RUN_AS_NODE` is stripped by `scripts/run-electron.mjs`.
Smart App Control may block unsigned packaged builds; that is OS policy, so
don't try to bypass it. No secrets in git: `GEMINI_API_KEY` comes from the
environment only.

---

## 8. Testing and CI

| Layer | Tool | Owner | Runs |
|---|---|---|---|
| Pure logic (core, guardrails, scorer, profile rules, migrations, mode machine) | Vitest | each owner | every PR, Windows and Ubuntu |
| DOM (lens-dom, ui components) | Vitest + happy-dom | d2, d3 | every PR |
| Desktop e2e (buddy, chat, capture, pins, Studio, Reader) | Playwright `_electron`, fake AI and fake Lens | d1, d3 | every PR, Windows |
| Extension e2e (fixture pages, select → change → restore, copy → nothing, rate limits, deny list, PDF viewer) | Playwright Chromium + `--load-extension`, fake protocol server | d2 | every PR, Windows |
| Full stack (extension → hoot-bridge → app in fake-Lens mode) | Playwright | d2 + C | M2 gate onward |
| Live Gemini smoke | Vitest, needs `GEMINI_API_KEY` | C | manually, and at each gate |
| Rewrite quality | `npm run eval` | C | when prompts or models change; M4 gate |
| Accessibility | axe in Playwright | d3, d2 | every PR |

---

## 9. Risks

| Risk | Mitigation |
|---|---|
| Contracts churn and stall three builders | Contracts are frozen at M0 and changed additively; everyone builds on fakes; C reviews contract PRs first |
| Merge conflicts across four agents | Ownership by directory with a CI check; small PRs; frequent rebases; lockfile rule |
| Native messaging plus named pipe is hard to debug on Windows | Dev WebSocket transport (C-20) keeps d2 unblocked; a full-stack e2e from M2 onward |
| Gemini latency misses the p50 700 ms target | Flash-Lite, lowest thinking level, cache, local scoring so most selections never call the model; measure in C-40 |
| Argon chosen on a free-tier key | Labelled "paid tier" in Settings; the 403/400 response maps to a clear message |
| PDF layout can't fit a longer rewrite | Overlay box that shrinks the font and then grows; margin glosses; reflow mode (spec §9.2) |
| Smart App Control blocks the unsigned installer | Demo from `npm.cmd run dev` or the unpacked build; signing hook ready (D1-40) |
| A builder drifts outside scope | Task IDs in PR titles; C rejects PRs without a task ID or with paths the builder doesn't own |

---

## 10. Demo script (M2 cut, extended at M3)

1. Fresh install: Studio onboarding asks for a **Gemini** key, then summon with `Ctrl+Shift+Space`.
2. `Ctrl+Alt+Space`: circle a chart, choose **Explain**, the answer streams, pin it as a sticky note.
3. Chrome with the extension: on an article, select "heteroscedasticity". The Ask-first chip appears; click it and the term shimmers, then is glossed in place with a mark. Hover shows the original. **I knew this** restores it, and Studio's "What Hoot knows about me" now lists the term as known.
4. A legal ToS page: the dense sentence gets a gloss only, with the reading-aid disclaimer.
5. Copy a term: nothing happens.
6. *(M3)* Linger without clicking and Lens triggers on its own. A foreign-language sentence is translated. A PDF opens in the Lens viewer, gets a rewrite overlay, then switches to reflow mode.

---

## 11. Kickoff prompts

Paste one into each Devin session. They assume the repo is cloned and that
this plan is on `main`.

### d1

```
You are builder d1 on the Hoot rebuild (repo: Nika533/hacktober). Read, in order:
docs/hoot-lens.md (product spec), docs/rebuild-plan.md (team plan; you are "d1"),
AGENTS.md (environment rules: use npm.cmd/npx.cmd). Legacy code lives at tag
legacy-v0; read it with `git show legacy-v0:<path>`, port only what section 1
lists as carried over.

You own: apps/desktop/src/main/** except main/ai, main/lens and main/bridge;
apps/desktop/src/preload/**; apps/desktop/src/renderer/{buddy,capture,note}/**;
apps/desktop/e2e/{buddy,capture,pins}-*; docs/status/d1.md. Do not edit any
other path. If you need a change elsewhere, write it under "Requests" in
docs/status/d1.md.

Start with D1-00 (Windows spikes in an uncommitted scratch folder; findings in
docs/status/d1.md). Once the tag `scaffold-ready` exists, do D1-10 through D1-15
in order, then the M2 tasks. One branch and one PR per task: branch `d1/<task-id>-<slug>`,
PR title `<TASK-ID>: <summary>`. Every PR has to meet the plan's quality bar and
definition of done (zod-validated IPC, sandboxed windows, tests, light and dark
screenshots for UI). Use HOOT_FAKE_AI=1; never commit an API key.

When your plan or blockers change, update docs/status/d1.md (Now / Next / Blocked on / Requests / Notes).
If you are blocked on another builder, switch to your next unblocked task;
don't work around their code. Stop and report when M2's tasks are merged, or
if CI on main is red because of your change and you can't fix it in 30 minutes.
```

### d2

```
You are builder d2 on the Hoot rebuild (repo: Nika533/hacktober). Read, in order:
docs/hoot-lens.md (product spec; sections 5, 6, 9 and 10 are yours),
docs/rebuild-plan.md (team plan; you are "d2"), AGENTS.md (environment
rules: use npm.cmd/npx.cmd).

You own: packages/lens-dom/**, apps/extension/**, docs/status/d2.md. Do not edit
any other path. If you need a change elsewhere, write it under "Requests" in
docs/status/d2.md.

Start now with D2-00 in packages/lens-dom (spec Phase 0: select → swap → mark →
popover → exact restore, with happy-dom tests). Once the tag `scaffold-ready`
exists, do D2-10 through D2-15, then the M2 tasks. Talk to the app only through
the LensBackend interface and bridge protocol in @hoot/core. Until the real
bridge lands, use core/testing/fakeLensBackend and createFakeLensServer. One
branch and one PR per task: branch `d2/<task-id>-<slug>`, PR title
`<TASK-ID>: <summary>`. Meet the plan's quality bar: shadow-DOM UI, never touch
editable or code content, keyboard and screen-reader support, reduced motion,
tests.

When your plan or blockers change, update docs/status/d2.md (Now / Next / Blocked on / Requests / Notes).
If you are blocked, switch to your next unblocked task. Stop and report when
M2's tasks are merged, or if CI on main is red because of your change and you
can't fix it in 30 minutes.
```

### d3

```
You are builder d3 on the Hoot rebuild (repo: Nika533/hacktober). Read, in order:
docs/hoot-lens.md (product spec; sections 5.4-5.6, 8.6, 9.2-9.3 and 11 are yours),
docs/rebuild-plan.md (team plan; you are "d3"), AGENTS.md (environment
rules: use npm.cmd/npx.cmd), .devin/skills/apple-design/SKILL.md (motion and
materials). Legacy UI lives at tag legacy-v0 (tokens.css, Owl.tsx and Markdown.tsx
are worth porting).

You own: packages/ui/**, packages/pdf-view/**,
apps/desktop/src/renderer/{studio,reader}/**, apps/desktop/e2e/{studio,reader}-*,
docs/status/d3.md. Do not edit any other path. If you need a change
elsewhere, write it under "Requests" in docs/status/d3.md.

Start now with D3-00 (design system in packages/ui). Then do D3-10 first, because
d1's Buddy card depends on it, then D3-11 through D3-13 and the M2 tasks. The AI
provider is Google Gemini: model picker Flash-Lite (gemini-3.5-flash-lite), Flash
(gemini-3.8-flash, default), Argon (gemini-4-argon, label it "paid tier").
Keys come from aistudio.google.com/apikey. One branch and one PR per task: branch
`d3/<task-id>-<slug>`, PR title `<TASK-ID>: <summary>`. Every UI PR includes light
and dark screenshots and passes axe. No raw colours outside tokens, no
window.confirm.

When your plan or blockers change, update docs/status/d3.md (Now / Next / Blocked on / Requests / Notes).
If you are blocked, switch to your next unblocked task. Stop and report when
M2's tasks are merged, or if CI on main is red because of your change and you
can't fix it in 30 minutes.
```

---

## 12. Already done before kickoff

- **Gemini switch in the legacy app** ([PR #1](https://github.com/Nika533/hacktober/pull/1), branch
  `c/gemini-switch`; merge it before C-01 tags `legacy-v0`). It makes the app run on Gemini now
  and gives C-03 a tested base:
  - `@anthropic-ai/sdk` replaced by `@google/genai@2.30.0`.
  - `src/main/ai/client.ts`: Gemini streaming with `systemInstruction`, `thinkingLevel: LOW`, `abortSignal`, inline image parts, thought parts filtered out, and blocked responses surfaced.
  - `src/main/ai/errors.ts`: Gemini error mapping.
  - Model list: Flash-Lite, Flash (default), Argon.
  - Settings saved with an old Claude model id fall back to the default.
  - The key moved to `gemini-key.bin`, so a stored Anthropic key is never sent to Google. The env var is `GEMINI_API_KEY`.
  - UI copy, e2e, README, AGENTS.md and spec §7.2 updated.
  - Unit tests 81/81. The request shape was checked against the real SDK with a stubbed `fetch`.
  - **Not yet tested against the live API, because no key was available.**
