# Product Polish & Seamlessness Audit (M1–M3 Quality Bar)

> **Audience:** Agent lead **C** (merge captain & contracts/engine owner) and builders **d1**, **d2**, **d3**.
> **Scope:** Zero feature bloat. This audit identifies **5 product-level seams** in the current spec (`docs/hoot-lens.md`), rebuild plan (`docs/rebuild-plan.md`), and M0 contracts (`@hoot/core`) that would make Hoot feel like a stitched-together demo if left unaddressed, paired with concrete, drop-in solutions mapped to existing M1/M2 tasks.

---

## Executive Summary

With PR #6 (`c/m0-foundation`), `D1-00` (Windows spikes), and `D3-00`/`D3-10`/`D3-30` (`@hoot/ui` + `@hoot/pdf-view`), the structural architecture is unusually strong. The remaining risk is **interaction seam friction** — places where latency, DOM reflow jumps, OS window resize flicker, or multi-surface handoffs break the illusion of a single, native-grade product.

| # | Seam | Where it shows up | Affected Tasks | Fix Summary |
|---|---|---|---|---|
| **1** | **~1.9s serial wait in Hoot Lens** (`1.2s` dwell + `700ms` LLM call) | User stares at a selection for ~2s before anything happens, or waits ~700ms after clicking *Ask-first* | `C-10`, `D2-13`, `D2-30` | Decouple **speculative prefetch (`350ms`)** from **DOM commit (`1,200ms` / click)**; only log `'shown'` on DOM render |
| **2** | **Paragraph line-wrap jumps** on inline `replace` (`1.5×` length ratio / 15-word `define`) | Inline replacement shifts every subsequent line in the paragraph downward mid-read | `C-11`, `D2-10`, `D2-12` | Tighten inline `replace` length ratio to `<= 1.15×` (else downgrade to `gloss`); animate block glosses with `0fr -> 1fr` spring grid rows |
| **3** | **Windows 11 DWM resize flicker & lockouts** on `Dot ↔ Pill ↔ Card` | Calling `BrowserWindow.setBounds()` on mode transitions flashes/stretches the DWM surface and blocks mid-flight interruption | `D1-14`, `D1-15` | Keep a **fixed Card-sized transparent `BrowserWindow`** while visible (`dot`/`pill`/`card`), driving click-through via `buddy.setHitRegions` |
| **4** | **`~500ms` warm capture delay & rough lasso release** on `Ctrl+Alt+Space` | Transient UI or cursor moves before the screen freezes; freehand lasso disappears abruptly on mouse-up | `D1-20` | Show crosshair overlay in `<16ms` and fade frame in (`120ms`); spring-morph the freehand Bezier loop into the resolved crop card |
| **5** | **Two-click friction on *"Explain more"* & silent Extension ↔ Desktop seam** | *"Explain more"* dumps raw text into `Composer` waiting for `Enter`; extension and desktop feel disconnected | `C-14`, `C-20`, `D1-23`, `D3-13`, `D3-20` | Auto-stream `lens.explain(ctx)` using `Message.text` (compact quote) vs. `Message.sentText` (full context); pulse Owl mood on bridge activity; live bridge badge in Onboarding |

---

## Finding 1: Eliminate the ~1.9s Perceived Wait in Lens via Speculative Prefetch

### The Problem
In `docs/hoot-lens.md` §6.1 (`s3`) and §7.2:
1. The content script waits **1,200ms** of selection dwell (`dwellMs > 1200`) before scoring and calling `LensBackend.rewrite()`.
2. The Gemini Flash-Lite call then takes **500–700ms** (p50) to **1,500ms** (p95).
3. Result: in **Auto** mode, the user waits **1.7s–2.7s** after selecting text before seeing a rewrite. In **Ask-first** mode, clicking *"Make this clearer?"* starts a cold 700ms wait looking at a shimmer.

### The Solution (`C-10`, `D2-13`, `D2-30`)
1. **Two-stage Speculative Prefetch in `lens-dom` (`D2-13` / `D2-30`):**
   - **Stage 1 — Speculative Prefetch at `350ms`:** Once a selection settles for `350ms` with no `copy` event (`copiedWithinMs === null`) and no `s10` hard block (`blocked === null`), if static signals (`sizeClass` is `'term' | 'phrase' | 'sentence'` and `rarity`, `foreignLanguage`, or `reselectCount` make it a plausible candidate), call `backend.rewrite(req, { signal })` **silently in the background** (no shimmer yet).
   - If the user deselects, copies (`Ctrl+C`), types, or scrolls fast before `1,200ms`, call `abortController.abort()`, which sends `cancel { reqId }`.
   - **Stage 2 — Instant Commit at `1,200ms` (or on Ask-first chip click):** When the `1,200ms` dwell threshold is reached (Auto mode) or the user clicks the Ask-first chip, the `RewriteOutcome` is already resolved (or nearly resolved) in the in-flight/LRU cache (`C-10`) and swaps into the DOM in **<50ms**.
2. **Crucial Engine Rule — Do Not Log `'shown'` Inside `engine.rewrite()` (`C-10`):**
   - Because a speculative prefetch may resolve just before the user deselects or never click the Ask-first chip, `apps/desktop/src/main/lens/engine.ts` must **not** append a `'shown'` `LensEvent` or `RecentChange` when the LLM call completes.
   - Instead, record `'shown'` (and push to `RecentChange`) only when `lens-dom` actually commits the mark to the DOM and emits `backend.feedback({ kind: 'shown', ... })` (`LENS_EVENT_KINDS` in `packages/core/src/types/lens.ts` already includes `'shown'`).

---

## Finding 2: Prevent Paragraph Reflow & Line-Jump Jank on Inline Replacements

### The Problem
In `packages/core/src/lens/transforms.ts`:
```ts
export const TRANSFORM_RULES: Record<Transform, TransformRule> = {
  define: { label: 'Defined a term', defaultAction: 'replace', maxWords: 15 },
  expand: { label: 'Expanded an acronym', defaultAction: 'replace', maxWords: 12 },
  simplify: { label: 'Simplified a sentence', defaultAction: 'replace', maxLengthRatio: 1.5 },
  ...
}
```
When an inline `<hoot-lens-mark>` inside a multi-line paragraph replaces a 25-word sentence with a 37-word sentence (`1.5×`), or appends a 15-word parenthetical definition to a single word, **every line below the selection in that paragraph re-wraps and jumps downward by 1–2 lines**. Shifting line geometry while the user's eye is anchored on the paragraph causes immediate visual disorientation.

### The Solution (`C-11`, `D2-10`, `D2-12`)
1. **Tighten Inline `replace` Length Guardrails in `C-11` (`packages/core/src/lens/guardrails.ts`):**
   - Keep `maxLengthRatio: 1.5` and `maxWords: 15` as the outer schema ceilings, but in `C-11`'s action resolution:
     - For `simplify`: only keep `action === 'replace'` if `rewrite.length <= Math.ceil(span.length * 1.15)` (and `spanWords <= 25`). If the rewrite is `1.15×–1.5×` longer, automatically **downgrade `action` from `'replace'` to `'gloss'`** so the original paragraph line breaks stay untouched.
     - For `define` / `expand`: only inline-replace when the appended parenthetical is **≤ 7 words** (`maxInlineReplaceWords = 7`). Longer 8–15 word definitions downgrade to `'gloss'`.
2. **Smooth Height Interpolation for Block Glosses in `D2-12` (`packages/lens-dom`):**
   - When rendering a block-level `gloss` beneath a paragraph or sentence, wrap the gloss container in a CSS grid row transition (`grid-template-rows: 0fr` → `1fr` over `180ms` with `var(--ease-spring)`, instant under `prefers-reduced-motion: reduce`) so surrounding content glides smoothly rather than snapping in a single frame.

---

## Finding 3: Zero-Flicker, Interruptible `Dot ↔ Pill ↔ Card` via Fixed-Canvas Windowing

### The Problem
On Windows 11, calling `BrowserWindow.setBounds()` on a transparent, frameless window before or after a renderer animation (`Dot ↔ Pill ↔ Card`) causes two subtle defects:
1. **DWM surface flash/stretch:** Windows DirectComposition briefly stretches or clips the transparent bitmap for 1 frame when window bounds resize.
2. **Uninterruptible transitions:** If a user hovers the Dot (`dot → pill`) and immediately clicks (`pill → card`) or moves the cursor away (`pill → dot`) 80ms later, waiting on `transitionDone(id)` before resizing the OS window creates input lockouts or race conditions.

### The Solution (`D1-14`, `D1-15`)
`d1`'s spike (`D1-00`) already verified two critical Windows 11 facts on Electron 44:
- Fully transparent pixels pass mouse clicks through to underlying windows natively.
- `C` already added `HootApi.buddy.setHitRegions(rects: Rect[])` in `packages/core/src/ipc/api.ts` so `main` toggles `setIgnoreMouseEvents` from polled cursor hit-testing.

**Architectural upgrade for `D1-14`:**
- Size the Buddy `BrowserWindow` once to the **Card dimensions** (anchored around `ModeLayout.owl`) whenever `mode` is `'dot' | 'pill' | 'card'`.
- **Never call `BrowserWindow.setBounds()` during `dot ↔ pill ↔ card` transitions** (only call `setBounds()` when dragging the owl or when monitor DPI/workArea changes).
- Inside the renderer (`D1-15`), `Dot`, `Pill`, and `Card` morph within the fixed transparent canvas using critically damped springs, calling `hoot.buddy.setHitRegions([currentSurfaceRect])` whenever the active surface bounds change.
- **Result:** Zero DWM resize flicker, 120fps GPU-composited morphing, and **true mid-flight interruptibility** (hovering and immediately clicking redirects the spring velocity straight from Dot to Card without waiting for an OS window resize).

---

## Finding 4: Sub-16ms Capture Freeze & Tactile Lasso-to-Card Morph

### The Problem
In `D1-00` §3, `d1` measured `desktopCapturer.getSources()` at `~2.9s` cold and `~500ms` warm. Pre-warming at idle eliminates the 2.9s hit, but a **500ms pause** between pressing `Ctrl+Alt+Space` and seeing the capture overlay still feels sluggish — the user's cursor has already moved before the crosshair appears.

### The Solution (`D1-20`)
1. **Immediate Crosshair Overlay (`<16ms`):**
   - On `Ctrl+Alt+Space`, show the pre-created fullscreen capture `BrowserWindow` immediately (`opacity: 1`, cursor set to crosshair, subtle dim veil transition) *while* `desktopCapturer.getSources()` runs in parallel.
   - As soon as the frame resolves (`OverlayInit`), lock the background bitmap into place and emit `capture:open`. Even if the user begins their drag 100ms after pressing the hotkey, pointer coordinates are already being recorded accurately.
2. **Tactile Lasso → Crop Card Spring Snap:**
   - While dragging in `'lasso'` mode, render a smoothed quadratic Bezier stroke (`2px` accent line + soft fill tint) that tracks the pointer 1:1.
   - On `pointerup`, instead of abruptly vanishing the overlay, animate the closed lasso polygon morphing into the resolved bounding rectangle (`140ms`, `var(--ease-spring)`) before handing focus to the Buddy Card with the new thumbnail in `AttachmentsRow`.

---

## Finding 5: Zero-Click *"Explain More"* Handoff & Cross-Surface Continuity

### The Problem
Three small seams currently make the Browser Extension (`d2`), Buddy Card (`d1`), and Studio (`d3`) feel like separate apps:
1. **Two-click friction on *"Explain more"*:** If clicking *"Explain more"* in the Lens popover only pre-fills the Buddy Card's `Composer` textarea (`D1-23`), the user has to look at a stuffed prompt and press `Enter` again.
2. **Prompt clutter in chat history:** Sending the full `LensContext` (`span` + 1,500-char `paragraph` + `headingPath` + `title`) as the visible user message clutters the chat transcript.
3. **Invisible bridge state:** When the user is reading in Chrome/Edge, there is no visual acknowledgment on the desktop buddy that Hoot is active, and Onboarding (`D3-13`) doesn't surface live extension pairing.

### The Solution (`C-14`, `C-20`, `D1-23`, `D3-13`, `D3-20`)
1. **Auto-Stream `lens.explain(ctx)` Using `Message.text` vs. `Message.sentText` (`D1-23` + `C-14`):**
   - `Message` in `packages/core/src/types/chat.ts` already supports both `text` (displayed in UI) and `sentText` (full prompt sent to Gemini)!
   - When `lens.explain(ctx)` is invoked (via IPC from Reader or over the bridge from the extension):
     - Summon the Buddy Card (`mode = 'card'`).
     - Immediately start streaming an answer in the active (or fresh) session.
     - Set the user `Message.text` to a clean, human-readable line: ``Explain “${ctx.span}”`` (with `ctx.title` or `ctx.site` as context).
     - Set `Message.sentText` to the structured prompt containing `ctx.span`, `ctx.paragraph`, `ctx.headingPath`, `ctx.title`, and the compact `ReaderProfile` summary (`C-12`).
   - No contract changes required — `Message.sentText` and `lens.explain(ctx)` already exist in `@hoot/core`.
2. **Subtle Owl Presence on Bridge Activity (`C-20` → `D1-14`):**
   - When the bridge (`C-20`) processes an active `rewrite` request from the browser while the Buddy is visible in `'dot'` or `'pill'` mode, briefly set `state.buddy.mood = 'thinking'` (during the call) → `'idle'` (on completion). The owl subtly perks/tilts on the desktop edge while helping you read in Chrome.
3. **Live Extension Connection Indicator in Studio (`D3-13` / `D3-20`):**
   - `StateSlices['lens']` in `packages/core/src/types/state.ts` already tracks `bridge: BridgeStatus` and `clients: number`.
   - In Studio Onboarding (`D3-13`) and Reading Settings (`D3-20`), bind directly to `state.lens.clients`: show a live status pill (*"Extension connected"* when `clients > 0`, transitioning the Onboarding owl to `mood="celebrate"` on first connection, or showing a one-click *"Load extension from `apps/extension/dist`"* helper when `clients === 0`).

---

## Checklist by Builder (No Contract Breakage)

- [ ] **C (`C-10`, `C-11`, `C-14`, `C-20`):**
  - `C-10`: Do not log `'shown'` or append `RecentChange` inside `engine.rewrite()`; record them when `feedback({ kind: 'shown' })` arrives from `lens-dom` so speculative prefetches that never render don't pollute the profile or audit log.
  - `C-11`: In `guardrails.ts`, downgrade `simplify` from `'replace'` to `'gloss'` when `rewrite.length > Math.ceil(span.length * 1.15)` or `spanWords > 25`; downgrade `define`/`expand` to `'gloss'` when the gloss exceeds 7 words.
  - `C-20`: Pulse `buddy.mood` (`'thinking'` → `'idle'`) during bridge `rewrite` calls when not already streaming chat.
- [ ] **d1 (`D1-14`, `D1-20`, `D1-23`):**
  - `D1-14`: Keep the Buddy `BrowserWindow` at fixed Card dimensions while visible (`dot`/`pill`/`card`) and use `buddy.setHitRegions` for click-through so `Dot ↔ Pill ↔ Card` morphs never call `setBounds()`.
  - `D1-20`: Show the capture overlay window in `<16ms` on hotkey press and fade in the `desktopCapturer` frame; animate lasso-to-rect snap on pointer release.
  - `D1-23`: On `lens.explain(ctx)`, open the Buddy Card and auto-stream immediately using `Message.text` (compact quote) + `Message.sentText` (full paragraph + profile context).
- [ ] **d2 (`D2-10`, `D2-12`, `D2-13`, `D2-30`):**
  - `D2-13` / `D2-30`: Start speculative `backend.rewrite(req, { signal })` prefetch at `350ms` settle (aborting on deselect/copy/scroll), committing the mark at `1,200ms` dwell or on Ask-first chip click, then firing `feedback({ kind: 'shown' })`.
  - `D2-12`: Animate block-level `gloss` insertions with `grid-template-rows: 0fr -> 1fr` (`180ms`, `var(--ease-spring)`).
- [ ] **d3 (`D3-13`, `D3-20`):**
  - `D3-13` / `D3-20`: Surface live `state.lens.bridge` and `state.lens.clients` connection status in Onboarding and Reading Settings, triggering `mood="celebrate"` on the Owl when the first browser extension client connects.
