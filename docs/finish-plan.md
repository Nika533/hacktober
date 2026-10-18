# Finish plan: from here to a polished, hackathon-ready Hoot

This is the schedule for everything still left. It **replaces the owners and order
in `docs/rebuild-plan.md` §6 for the remaining tasks**. The spec
(`docs/hoot-lens.md`), the quality bar (rebuild-plan §1), the contracts and
AGENTS.md still apply.

Phases are gates, not dates. A phase ends when its gate passes, and nobody waits
for a phase to end before starting their next task.

## 0. Where we are

| | Done (on `main`) | Open | Left |
|---|---|---|---|
| **C** (Pera08) | Monorepo, contracts, Gemini provider, CI, Lens engine + guardrails + prompts, Lens IPC, bridge server, hoot-bridge native host, scorer, risk, learning rules | #31 evals, #35 contracts doc | Docs, latency check, plus the slices moved to C below |
| **d1** (Nika533) | Windows spikes, main foundation (store, lifecycle, broadcast), persistence v2 | #30 window security + core IPC domains + Studio window | Buddy mode machine, hotkeys/tray, Lens + bridge wiring, Explain more, Reader main side, Windows polish |
| **d2** (andria0506) | Every lens-dom renderer, Lens UI, selection, fixtures, MV3 extension, options page, Auto mode (D2-30) | – | Bridge client, connection status, e2e, PDF viewer, zip, plus capture (moved to d2) |
| **d3** (vakopr) | Design system, chat UI, Studio, Settings, onboarding, extension status, pdf-view + PDF overlay | – | Lens consent/Reading, Lens pages, cold start, Studio e2e, Reader, visual QA, polish, plus the Buddy renderer (moved to d3) |

The contracts in `@hoot/core` already cover every remaining feature (chat,
sessions, attachments, buddy, capture, pins, reader, lens, onboarding, windows).
**They are frozen.** Only additive fixes, which C lands within 30 minutes.

Most of d1's old backlog is a port of the legacy app (`git show legacy-v0:src/main/capture.ts`,
`pins.ts`, `hotkeys.ts`, `tray.ts`, `cursor.ts`, `windows/*`, `src/renderer/src/*`). Port,
don't redesign.

## 1. What "hackathon ready" means (the finish line)

1. **The demo script works** (rebuild-plan §10, steps 1–5) with real Gemini, **three runs in
   a row** from a fresh profile (`HOOT_USER_DATA=<new dir>`) on the demo machine.
   Step 6 (auto-trigger, translation, PDF) is in the demo only if it works every time.
2. **An offline fallback works:** the same script with `HOOT_FAKE_AI=1 HOOT_FAKE_LENS=1` and no
   network, in case the venue Wi-Fi dies.
3. **Setup from a clean clone takes 10 commands or fewer**, written in the README: install,
   build, register the native host, load the unpacked extension, run.
4. **Packaged:** `npm run build:unpack -w @hoot/desktop` launches. The NSIS installer builds
   (unsigned is fine).
5. **Clean:** no console errors in any window. axe is clean on Studio, Reader, Buddy card,
   notes, the capture overlay, and the extension popover and options page. Light, dark and
   high-contrast screenshots are reviewed (D3-32).
6. **Fast enough:** spec §7.2 latency targets are met on the demo pages (measured by C).
7. **Presentable:** README with an architecture diagram, a 2-minute demo video, and pitch
   notes.
8. CI is green on `main`, nothing is left open, and `main` is tagged `hackathon-v1`.

### Cut for the hackathon (don't build these)

Firefox · store submission (a zip and load-unpacked instructions are enough) · code signing
(keep the skip-if-no-certificate hook only) · macOS · guaranteed mixed-DPI multi-monitor
(single monitor tested, multi best effort) · the eval as a merge gate (report only) ·
telemetry · languages beyond the primary plus one foreign demo language.

## 2. Ownership changes (in this PR, via `scripts/ownership.json`)

d1's backlog is the critical path, so whole features move to builders with spare capacity.
Each feature has **one owner end to end** (main side + renderer + tests):

| Feature (old task) | New owner | Paths |
|---|---|---|
| Chat service + chat/sessions/attachments IPC (D1-13) | **C** | `apps/desktop/src/main/chat/**`, `apps/desktop/test/chat/**`, `apps/desktop/e2e/chat-*` |
| Pins + sticky-note windows (D1-22) | **C** | `apps/desktop/src/main/pins/**`, `apps/desktop/src/renderer/note/**` (+ `note.html`), `apps/desktop/test/pins/**`, `apps/desktop/e2e/pins-*` |
| Installer + packaged smoke (D1-30, D1-40) | **C** (shared with d1) | `apps/desktop/electron-builder.yml`, `apps/desktop/build/**`, `apps/desktop/resources/**` |
| Capture overlay (D1-20) | **d2** | `apps/desktop/src/main/capture/**`, `apps/desktop/src/renderer/capture/**` (+ `capture.html`), `apps/desktop/test/capture/**`, `apps/desktop/e2e/capture-*` |
| Buddy renderer (D1-15) | **d3** | `apps/desktop/src/renderer/buddy/**` (+ `buddy.html`), `apps/desktop/e2e/card-*`. Component tests live in `packages/ui`, like Studio |

d1 keeps the rest of `apps/desktop/src/main/**` (context, IPC registration, windows,
buddy mode machine, hotkeys, tray, Reader main side), `preload`, and `e2e/buddy-*`.

### How features plug into main (the same pattern as `main/lens`)

Each feature folder exports a service factory and an IPC-handler factory from its
`index.ts`. The rest of main imports only from there:

```ts
// apps/desktop/src/main/<feature>/index.ts (feature owner)
export function create<Feature>Service(deps: <Feature>Deps): <Feature>Service
export function create<Feature>Handlers(svc: <Feature>Service): Record<InvokeChannel, Handler>
```

`<Feature>Deps` uses only what `AppContext` already has (`store`, `broadcaster`,
`persistence`, `writer`, `windows`, `secrets`, `flush`, `log`, plus a provider getter).
**d1 wires each feature once** in `context.ts` / `ipc/register.ts` and never edits the
feature's folder. The feature owner never edits `context.ts`.

## 3. Phases and gates

### Phase 0: unblock (everyone, first thing)

| Who | Task |
|---|---|
| **Nika533** | Merge this PR (it changes ownership). Turn on branch protection (required checks, code-owner review, no bypass), as in the owner prompt. Merge #30 once it's green. |
| **C** | Merge #31 and #35. Review #30 within 30 minutes. Contract audit for the moved slices: if anything is missing for chat, pins, capture or buddy, land **one** additive `contract:` PR. |
| **C, d2** | **Skeleton PRs:** `main/chat/index.ts` and `main/pins/index.ts` (C), and `main/capture/index.ts` (d2). Each exports the factories above with a minimal working fake (chat echoes through `createFakeProvider`, pins and capture no-op), so d1 can wire them now. |
| **d1** | After #30: one wiring PR that registers chat, pins, capture **and Lens + bridge** (C's snippet in `docs/status/c.md`) in `AppContext`. From then on, features are filled in behind wiring that already exists. |
| **d3** | Clean up Studio's leftover workarounds (the `suspendHotkeys` cast and `string[]` hotkey errors; #19 is merged). |

### Phase 1: the app runs on fakes (critical path)

| Who | Task |
|---|---|
| **C** | **Chat service:** port the legacy chat flow onto `AiProvider`. One controller per stream, with the abort created before any await. Switching or deleting a session mid-stream is safe. Checkpoint about every 500 ms; a message left "streaming" loads as "stopped". Stop and Regenerate. Send a `chat:delta` before each patch (AGENTS.md invariant). Handle `sessions.*` and `attachments.*`. |
| **d1** | **Buddy mode machine + buddy window** (D1-14): a pure reducer for hidden/dot/pill/card, `buddy:transition` → renderer → `transitionDone`, 1:1 drag, flick and snap (port `geometry`), the collapse timer, click-through with hit-region polling (D1-00 facts), cursor tracking. Then **hotkeys/tray** (D1-21): global shortcuts with `suspendHotkeys` and structured `HotkeyError`, tray, launch at login, the clipboard-chip watcher. |
| **d3** | **Buddy renderer** (D1-15): Dot, Pill, Card, greeting and owl moods on `@hoot/ui`. The card uses the shared chat components (Transcript, Composer, chips; recipe in `docs/status/d3.md`). It animates on `buddy:transition` and acks with `transitionDone`, and reports hit regions. Develop against a fake transition driver in the gallery until d1's machine lands. Then **D3-20 Lens consent + Reading settings** (off by default; mode, sensitivity, site lists, high stakes, copy behaviour, languages, retention). Mark the consent copy "pending C's data-terms check". |
| **d2** | **Bridge client** (D2-20): native messaging through hoot-bridge, reconnect on demand, `reqId` routing and cancel, per-tab rate limits, settings cache with pushes, off in incognito, deny list and password pages. Then **connection status** on the options page (D2-21 part 2). |

**Gate G1:** fresh profile, `HOOT_FAKE_AI=1 HOOT_FAKE_LENS=1 npm.cmd run dev`.
1. Onboarding appears. After it, the owl shows as a dot.
2. `Ctrl+Shift+Space` opens the card, and a message streams.
3. `Ctrl+L` opens Studio, which lists the session.
4. Settings survive a restart.
5. With the extension loaded and `register-host` run, Ask-first works through the **real
   bridge** with the fake Lens.

C runs the gate and posts the result on the tracking issue (§5).

### Phase 2: the demo works (M2)

| Who | Task |
|---|---|
| **C** | **Pins + sticky notes:** port legacy `pins.ts` and the note window on `@hoot/ui`, including `pins.createFromText` for glossary pins. Then a **live Gemini check** (`npm run test:live`; a human supplies the key). |
| **d2** | **Capture overlay:** port legacy `capture.ts` + overlay. The guard is set synchronously. Lasso, rect and full. Crop pipeline per the D1-00 `desktopCapturer` facts (the ratio comes from `image.width / display.bounds.width`, and getSources is pre-warmed). Up to 4 pending; quick chips. Then **D2-22 e2e** against C-13's fake server, plus one full-stack test with the app in `HOOT_FAKE_LENS` mode. |
| **d1** | **Explain more** (D1-23): Lens `onExplain` → the chat service → open the card pre-filled and send. **Reader main side:** `reader.pickFile/current/onDocument`, the Reader window, and the CSP with `worker-src 'self' blob:`. Then **e2e** for buddy modes + chat streaming with the fake AI (`e2e/buddy-*`). |
| **d3** | **D3-21 Lens pages** ("What Hoot knows about me": edit, export, reset; Recent changes; My glossary with pin-as-note through `pins.createFromText`). **D3-22 cold start.** **D3-23 Studio e2e + axe** (onboarding, settings persistence, Lens pages with the fake Lens). |

**Gate G2 (the demo cut):** demo script steps 1–5 with real Gemini, twice in a row from a
fresh profile, then once more with the fakes and no network. Every failure becomes a
`blocker` issue. **After G2: no new features.** Only the Phase 3 stretch items and fixes.

### Phase 3: the stretch for demo step 6 (run in parallel with polish)

| Who | Task |
|---|---|
| **d2** | **D2-31 PDF in the browser** (`viewer.html` hosting `pdf-view` with lens-dom; ask once for `file://`; a toggle back to the native viewer). Check that the translation path works on the foreign fixture. |
| **d3** | **D3-31 Hoot Reader** window (local PDF/HTML, `pdf-view` + lens-dom with an IPC `LensBackend`, same marks, popover and shortcuts as the extension). **Margin glosses** in `pdf-view`. |
| **C** | Finish the C-31 **eval report** (not a gate). **Latency/cost check** against spec §7.2 on the demo pages; fix the model routing if a target is missed. |
| **d1** | Drop a file on the owl / tray "Open in Hoot Reader". |

**Gate G3:** each part of step 6 is either reliable (in the demo) or cut from the demo
script. Never demo something flaky.

### Phase 4: polish and ship

| Who | Task |
|---|---|
| **d3** | **D3-32 visual QA** of every window (Buddy, card, Studio, Reader, notes, capture overlay, extension popover/options) in light, dark and high contrast, plus axe. File an issue per defect for its owner. **D3-40 polish:** micro-interactions per the apple-design skill, empty states, and a copy pass across all UI. Demo screenshots. |
| **d1** | **Windows polish** (D1-31): Mica, accent, high contrast, DPI change, sleep/resume, a monitor plugged or unplugged (single monitor must be perfect). Idle budget: under 1% CPU and 200 MB. |
| **d2** | Extension **zip script**, permission justifications, icons. Content-script budget (under 50 KB gzipped; no long task over 50 ms on select). axe pass on the Lens UI. |
| **C** | **Installer** with native-host registration (HKCU for Chrome and Edge, removed on uninstall) and autostart `--hidden`. **Packaged smoke** (signing skipped). **README** (10-command setup, architecture diagram, demo script, offline fallback), refreshed `AGENTS.md` and `CONTRACTS.md`. Tag `hackathon-v1` when §1 passes. |
| **Humans** | Three rehearsals on the demo machine, a 2-minute video, pitch notes. |

**Gate G4 = §1 passes.** During Phase 4 only fixes and polish merge.

### Critical path

```
C chat service ─┐
d1 buddy machine ┼─► G1 ─► d1 Explain more ─┐
d3 buddy renderer┘                          ├─► G2 (demo) ─► polish ─► G4
d2 bridge client ─► d1 wiring (Phase 0) ────┤
d2 capture, C pins, d3 Lens pages ──────────┘
```

If anything on this path slips, its owner says so on the tracking issue right away, and C
moves the next unblocked task to whoever is free.

## 4. Per-agent queues (work top to bottom; never wait)

Mark progress in your status file using these IDs.

**C (Pera08):** F-C0 merge #31/#35, contract audit, chat + pins skeletons → F-C1 chat
service → F-C2 pins + notes → F-C3 live Gemini check, G1/G2 runs → F-C4 eval report +
latency → F-C5 installer + packaged smoke → F-C6 README/docs → tag.

**d1 (Nika533):** F-D1-0 land #30, wiring PR (chat, pins, capture, Lens, bridge) → F-D1-1
buddy mode machine + window → F-D1-2 hotkeys, tray, launch at login, clipboard watcher →
F-D1-3 Explain more → F-D1-4 Reader main side → F-D1-5 buddy/chat e2e → F-D1-6 drop to
Reader → F-D1-7 Windows polish + idle budget.

**d2 (andria0506):** F-D2-0 capture skeleton → F-D2-1 bridge client → F-D2-2 connection
status → F-D2-3 capture overlay → F-D2-4 extension e2e (fake server + full stack) →
F-D2-5 PDF viewer + translation check → F-D2-6 zip, budgets, Lens UI axe.

**d3 (vakopr):** F-D3-0 Studio cleanup → F-D3-1 Buddy renderer → F-D3-2 Lens consent +
Reading settings → F-D3-3 Lens pages → F-D3-4 cold start → F-D3-5 Studio e2e + axe →
F-D3-6 Reader + margin glosses → F-D3-7 visual QA across all windows → F-D3-8 polish
pass + demo screenshots.

## 5. Rules that keep this moving

1. **Merge on green** (AGENTS.md). Use `gh pr merge <n> --auto --squash` on every PR.
   CODEOWNERS reviews happen within 30 minutes. If there's still none after 60 minutes,
   the other code owner approves.
2. **Never idle.** Blocked? Use the fakes or the skeleton, open an issue titled
   `blocked: <what>` assigned to the owner, and start your next queue item.
3. **One tracking issue**, "Finish plan", pinned. Gate results, slips and reassignments go
   there, so nobody has to read four status files to know the state.
4. **Bugs are issues** labelled `bug` plus the area. They're owned by the path owner. A
   `blocker` (breaks the demo script) jumps every queue.
5. **Red `main`:** the author reverts within 15 minutes. Discuss afterwards.
6. **Contracts are frozen.** Additive fixes only, as `contract:` PRs. C lands them within
   30 minutes.
7. **Small, unstacked PRs**, each branched from `main`. One task ID per PR.
8. **Scope freeze after G2**; fixes and polish only during Phase 4.
9. **Status files:** update when your queue position or blockers change, at least daily.

## 6. Human checklist

- [ ] **Nika533:** merge this PR; branch protection (required checks `ownership`,
      `checks (ubuntu-latest)`, `checks (windows-latest)`, `e2e`, `ui-shots`; code-owner
      review; no bypass); secret scanning + push protection.
- [ ] Open and pin the "Finish plan" tracking issue.
- [ ] A Gemini API key (environment variable only) on C's machine and the demo machine.
      Flash is enough; Argon needs a paid tier.
- [ ] Demo machine: Windows 11, Chrome, one 1080p+ monitor. Run the dev or unpacked build
      (Smart App Control can block an unsigned installer).
- [ ] Saba (C): set `git config user.email` to the GitHub noreply address.
- [ ] After G4: three rehearsals, a 2-minute video, pitch notes.

## 7. Kickoff prompts (paste one into each agent)

**C:**
> Read `docs/finish-plan.md`, then AGENTS.md. You are C (Pera08). Work your queue in §4 top
> to bottom, starting with Phase 0. You now also own `main/chat`, `main/pins`, the note
> window, and the installer files (§2). Follow the feature pattern in §2 so d1 wires each
> feature once. Run gates G1 and G2 and post the results on the tracking issue. Use
> `gh pr merge --auto --squash` on every PR. Never idle: if you're blocked, use the fakes
> and move to the next item.

**d1:**
> Read `docs/finish-plan.md`, then AGENTS.md. You are d1 (Nika533). Chat, pins and capture
> moved to other builders (§2); you wire them into `AppContext` once (Phase 0) and own the
> buddy mode machine, hotkeys/tray, Explain more, the Reader main side and Windows polish.
> Work your queue in §4 top to bottom. Use the legacy code (`git show legacy-v0:…`) as the
> base: port, don't redesign. Use `gh pr merge --auto --squash` on every PR. Never idle.

**d2:**
> Read `docs/finish-plan.md`, then AGENTS.md. You are d2 (andria0506). You now also own the
> capture overlay (main + renderer, §2). Work your queue in §4 top to bottom, with the
> bridge client first: it's on the demo's critical path. Port legacy `capture.ts` and the
> overlay. Use `gh pr merge --auto --squash` on every PR. Never idle.

**d3:**
> Read `docs/finish-plan.md`, then AGENTS.md. You are d3 (vakopr). You now also own the
> Buddy renderer (§2). Work your queue in §4 top to bottom: Studio cleanup, the Buddy
> renderer (against a fake transition driver until d1's machine lands), then the Lens
> pages, e2e, the Reader, and the visual QA and polish passes across every window. Use
> `gh pr merge --auto --squash` on every PR. Never idle.
