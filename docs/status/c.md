# Status: C (Claude Code)

Only C edits this file. Updated when plans or blockers change (AGENTS.md).

## Now

- **F-C5 installer + packaged smoke** (`c/F-C5-installer`): native-host registration in the
  NSIS installer and on first run, the `packaged` CI job, the installer as a CI artifact.

Queue (docs/finish-plan.md §4): F-C0 ✅ → F-C1 ✅ #39 → F-C2 #41 → F-C3 (blocked: #47 G1
needs d1's wiring, #48 Gemini key) → **F-C5** → F-C4 eval report + latency → F-C6 README/docs
→ tag. Gate results go on the pinned tracking issue #49.

## Done (merged)

- M0–M2: monorepo, contracts, Gemini provider, CI, ownership check; guardrails, prompts, Lens
  engine and service, scorer, risk, learning rules; bridge connection, hoot-bridge, bridge
  server; hotkey contract (#6–#20).
- F-C0: reviewed and merged #30; contract audit for chat, pins, capture and buddy found
  nothing missing (every legacy channel and payload has a core counterpart).
- F-C1: chat service (#39).

## Blocked on

- G1: #47 (chat and pins wiring, buddy machine, Buddy renderer).
- F-C3 live check and G2: #48 (a Gemini key on C's machine, environment variable only).
- #31 and #35: Nika533's code-owner review (C wrote them).

## For d1: wiring chat, pins and the native host

Lens and the bridge are wired (#46). The rest uses the same seams:

```ts
import { createChatHandlers, createChatService } from './chat'
import { createNoteWindows, createPinsHandlers, createPinsService } from './pins'
import { ensureNativeHost } from './bridge'

const chat = createChatService({
  store, broadcaster, persistence, writer, log,
  getProvider: async () => ai.createProvider(),
  takeClipboardSelection: () => clipboard.takeArmedText(), // D1-21 clipboard chip
  onActivity: (a) => buddy.onChatActivity(a), // thinking/talking/done/stopped/error → mood, answerReady
  openPath: (p) => shell.openPath(p).then(() => undefined)
})
registerHandlerMap(createChatHandlers(chat))
flush.add('chat', () => chat.flush()) // finishes a pending delete, saves the open session
ctx.hooks.explain = (message) => { buddy.openCard(); void chat.startExplain(message) }

// Pins (#41): note windows act only on their own pin, so these handlers take the sender.
const notes = createNoteWindows({
  rendererUrl, anchor: () => buddy.anchor(), isQuitting: () => quitting,
  onCloseRequest: (id) => pins.remove(id), onBounds: (id, b) => pins.setBounds(id, b)
})
const pins = createPinsService({ store, windows: notes, openSession: (id) => openInCardOrStudio(id) })
const h = createPinsHandlers(pins)
for (const [ch, fn] of Object.entries(h.invoke)) handleInvoke(ch, (sender, ...a) => fn(sender, ...a))
for (const [ch, fn] of Object.entries(h.send)) onSend(ch, (sender, ...a) => fn(sender, ...a))
pins.restore() // after the window registry is up; tray: pins.setVisible(show)

// Packaged only, after start(): repairs the browser registration (build:unpack, moved install).
if (app.isPackaged) {
  void ensureNativeHost({
    platform: process.platform as Platform, resourcesPath: process.resourcesPath,
    home: os.homedir(), localAppData: process.env['LOCALAPPDATA'], log: (m) => log.info(m)
  })
}
```

Also for d1 (launch at login, low priority): `settings:update` sets the login item only when
the setting changes. The default (off) matches a fresh install, but after a reinstall or a
settings reset the two can drift. Syncing once at packaged startup keeps them in step:
`app.setLoginItemSettings({ openAtLogin: settings.launchAtLogin, args: ['--hidden'] })`.

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
