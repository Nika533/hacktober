# Hoot Lens — Adaptive, Reversible Reading

> When you select text you don't understand, Hoot notices, quietly rewrites it
> in place so you can understand it, shows exactly what it changed, lets you
> undo it with one click, and learns from what you keep and what you undo.

Status: idea / design spec. Builds on the existing Hoot desktop app in this repo.

---

## 1. Summary

**Hoot Lens** is a reading aid that works where people actually read: web pages,
PDFs, and local documents. It watches for a lightweight signal — the user
selecting a piece of text and lingering on it — and estimates whether the user is
confused. When it's confident, it replaces (or annotates) the text with a version
tailored to that reader: a definition, a plainer sentence, an expanded acronym, a
translation, or a short example.

Every change is:

- **Visible** — marked with a subtle tint and underline; never silent.
- **Reversible** — hover shows the original; one click restores it.
- **Learning** — undo means "I already knew that"; keeping it means "that helped".
  Hoot builds a private reader profile and adapts what and when it changes.

### Decision: extension + desktop app, not a custom browser

Lens ships as a **Chromium browser extension** (Chrome, Edge, Brave, Arc; Firefox
later) that talks to the **Hoot desktop app**, plus a **Hoot Reader** window
inside the desktop app for local PDFs and HTML files. We do **not** build our own
browser. Rationale in [section 4](#4-platform-decision).

---

## 2. Problem

- People hit unfamiliar terms, acronyms, dense sentences, or foreign-language
  passages constantly — in articles, papers, contracts, docs, and course material.
- Today's fix is a context switch: copy, open a new tab or chat, paste, ask,
  read, come back, find your place. Most people just skip and keep reading with a
  gap in understanding.
- Chat-with-the-page tools still require the user to **notice** they're confused,
  **formulate** a question, and **leave** the text to read an answer.

**Insight:** the text itself is the best place for the answer. If the reader's
own behavior already tells us where they're stuck, we can fix the text where it
is, without them asking — as long as we're honest about it and they stay in
control.

## 3. Goals and non-goals

### Goals
1. Detect likely confusion from passive signals with a low false-positive rate.
2. Change text **in place** on HTML pages and PDFs, with a clear marker.
3. Make every change instantly reversible, individually and in bulk.
4. Personalize: fewer, better changes over time for each reader.
5. Keep reader data private and local by default.
6. Reuse the existing Hoot app (AI client, storage, settings, Studio UI).

### Non-goals (for now)
- Editing the source document on disk or on the server. Lens changes only what
  the user **sees**; the file/page is never modified.
- Rewriting editable content (inputs, text areas, docs editors, email compose).
- Summarizing whole pages or chatting with the page (Hoot's card already does this).
- Replacing text inside other desktop apps (Word, Acrobat). Those keep Hoot's
  existing "circle anything → explain in the card" flow.

---

## 4. Platform decision

| Requirement | Current Hoot app alone | Browser extension | Own browser |
|---|---|---|---|
| Read the selection + surrounding paragraph | Partial (Windows UI Automation works in some apps; circle-anything works everywhere) | Yes — full DOM access | Yes |
| Change text **in place** on web pages | No — only an overlay bubble that drifts on scroll/resize | Yes | Yes |
| Change text in **PDFs** | No | Yes, by opening PDFs in our own PDF.js viewer (the built-in browser PDF viewer can't be scripted by extensions) | Yes |
| Mark the change, revert in place | Overlay only | Yes | Yes |
| Personalization store | Yes (local persistence exists) | Yes, via the app | Yes |
| Adoption cost for users | Already installed | One click; works in the browser they already use | Must **switch browsers** — very hard |
| Maintenance cost | Low | Medium | Very high: tabs, history, passwords, sync, extension support, and weekly Chromium security patching |

**Why not our own browser:** a browser only makes sense when the browser itself
is the product (AI-first browsers already exist and compete on everything a
browser does). For one feature, we would inherit an enormous maintenance and
security burden and ask users to abandon the browser they live in. An extension
gets 95% of the capability at a fraction of the cost.

**Why not the desktop app alone:** a desktop overlay can't reliably rewrite text
inside another process. It can float a bubble on top, but the bubble can't reflow
with the page, scroll with it, or survive layout changes. The app is the right
**brain**, not the right **hands**.

**Result:**

- **Extension = eyes and hands** — watches selections, scores signals, rewrites
  the DOM / PDF text layer, draws markers, handles undo.
- **Hoot app = brain** — owns the API key, calls Claude, stores the reader
  profile and event log, provides settings and the "what Hoot knows about me" UI.
- **Hoot Reader (inside the app)** — a PDF.js-based reader window for local PDFs
  and HTML files, using the same engine in-process.

---

## 5. User experience

### 5.1 Core loop

```
 read ──> select text ──> (linger, don't copy) ──> Lens scores signals
                                                     │
                       low score: nothing happens ◄──┤
                                                     │ high score
                                                     ▼
                                  span shimmers briefly (thinking)
                                                     ▼
                         text swaps to the tailored version, marked
                                                     ▼
            hover/focus mark ──> popover: original · Restore · I knew this · Explain more
                                                     ▼
                         every reaction updates the reader profile
```

### 5.2 Scenarios

**Student reading a statistics article.** Selects "heteroscedasticity" and pauses.
The word becomes *"heteroscedasticity (when the spread of errors changes across
values)"* with a soft underline. They keep reading. Next week Lens no longer
glosses it — the term is in their "known" list because they never asked again
and spent normal time on later uses of it.

**Developer reading a legal ToS.** Selects a dense indemnification sentence.
Because the site is classified high-stakes (legal), Lens does **not** replace
it; it adds a plain-language gloss beneath it with a small note: "Plain-language
reading aid — the original wording is what applies."

**Reader on a foreign-language news site.** Selects a sentence in a language that
isn't in their profile's reading languages. Lens swaps in a translation; hover
shows the original. After three such reverts on the same site ("I'm practicing
this language"), Lens switches to gloss mode on that site.

**Expert on their own topic.** Selects "Kubernetes" to copy it. Copy event fires
→ strong negative signal → nothing happens. Even if Lens had triggered, "I knew
this" would add the term to their known list and nudge their threshold up.

### 5.3 Rendering modes

| Mode | What the user sees | When used |
|---|---|---|
| **Replace** | Original text swapped for the rewrite, tinted + underlined | Default for short spans (terms, single sentences) on normal-risk content |
| **Gloss** | Original kept; short annotation inline (after a term) or beneath (for a sentence) | Long spans, high-stakes domains, or user preference |
| **Ask first** | A small chip appears near the selection ("Make this clearer?"); nothing changes until clicked | Optional user setting; also the Phase 1 trigger |

### 5.4 Interaction details

- **Marker:** background tint `color-mix(in srgb, var(--accent) 12%, transparent)`,
  1.5px dotted underline in the accent at 60%, 3px radius. Under
  `prefers-contrast: more`, a solid 1px accent border instead of a tint.
- **Hover / focus a mark** → popover anchored to the mark:
  - Original text (the exact characters replaced)
  - **Restore** — revert this change
  - **I knew this** — revert + mark the term/pattern as known
  - **Explain more** — opens the Hoot card with the span and its paragraph as context
  - Small footer: transform type ("Defined a term", "Simplified a sentence")
- **Page pill** (bottom corner, appears after the first change on a page):
  "Hoot changed 3 things · Undo all · Pause on this site".
- **Keyboard:**
  - `Alt+Z` — undo the most recent change on the page
  - `Alt+Shift+Z` — restore everything on the page
  - `Alt+H` — pause / resume Lens on this site
  - Marks are focusable (`Tab`), popover opens on `Enter`, `Esc` closes it
- **Copy behavior:** copying a marked span copies the **original** text by default
  (the rewrite is a reading aid, not source content). The popover offers
  "Copy rewritten". Configurable.
- **Late results:** if the rewrite arrives after the user has scrolled away, apply
  it without animation (no motion outside the user's focus).
- **Never** change: inputs, text areas, `contenteditable`, code blocks (`pre`,
  `code`), quoted blocks marked as quotes, text inside links' accessible names
  only, or anything on a paused or deny-listed site.

### 5.5 Motion and materials (follows the apple-design skill)

- Text swap: cross-fade with a slight blur "materialize" (blur 2px → 0, opacity
  0 → 1, about 180ms, critically damped — no bounce). The original fades out along
  the same path the rewrite fades in.
- Thinking state: a faint shimmer on the selected span only — never a spinner
  over the page.
- Popover: originates from the mark (`transform-origin` at the mark), enters
  and exits along the same path; feedback on pointer-down.
- Reduced motion: instant swap with a 120ms opacity change; no shimmer.
- All Lens UI renders in a shadow DOM root so page CSS can't break it and our
  CSS can't break the page.

### 5.6 Settings (in Hoot Studio → Reading, mirrored minimally in the extension)

- Lens on/off (global)
- Mode: Auto · Gloss only · Ask first
- Sensitivity: Fewer changes ↔ More changes (shifts the user threshold)
- Per-site: always on / paused / never (deny list), with defaults below
- High-stakes content: Gloss only (default) · Allow replace
- Copy behavior: Original (default) · What I see
- Languages I read comfortably (skip translation for these)
- **What Hoot knows about me**: known terms, struggling areas, topic familiarity,
  style preferences — each editable; Export; Reset
- History retention: 30 / 90 (default) / 365 days

---

## 6. Confusion detection

Detection runs **locally in the content script**. Only uncertain cases make a
(cheap) model call. Most selections never leave the browser.

### 6.1 Signals

| # | Signal | Direction | Notes |
|---|---|---|---|
| s1 | Selection size class | term/phrase: +, sentence: +, multi-paragraph: strong − | Big drags are usually copying or highlighting |
| s2 | Copy (`Ctrl+C` / `copy` event) within 2.5s | strong − | The user wanted the text, not help |
| s3 | Selection held (dwell) > 1.2s without other action | + | Primary positive signal |
| s4 | Same span/term selected again this session | strong + | Repeated difficulty |
| s5 | Re-reading: scrolled back to this paragraph, or time on paragraph well above the user's reading pace | + | Uses a rolling per-user words-per-minute estimate |
| s6 | Term rarity / jargon score | + | Local word-frequency list per language; acronym and notation detectors |
| s7 | Profile: term in known list | strong − | Personalization short-circuit |
| s8 | Profile: topic familiarity low for this page | + | Topic from title/headings |
| s9 | Language not in the user's reading languages | strong + | Triggers the translate transform |
| s10 | Context: editable field, code, deny-listed site, typing, fast scrolling | block | Hard exclusions, never trigger |

### 6.2 Scoring

```
x  = feature vector from s1..s9 (normalized)
p  = sigmoid(w · x + b)          // probability the user is confused
θu = per-user threshold           // starts at 0.75

if p >= θu                → rewrite
if θu - 0.15 <= p < θu    → "gray zone": ask the model for a difficulty estimate,
                            then rewrite if difficulty >= 0.6
else                      → do nothing
```

- **Starting weights** are hand-set from the table above, then refit offline
  from (opt-in, aggregated) labeled events once there is data.
- **Adaptive threshold** per user (and optionally per site):
  - revert or "I knew this" within 5s → `θu += 0.03` (cap 0.95)
  - kept and read past → `θu -= 0.01` (floor 0.55)
  - "Explain more" → keep `θu`, raise the target depth for that topic
- **Rate limits:** at most 3 automatic changes per page per minute and 12 per
  page total; after 2 reverts in a row on a page, switch that page to Ask first.
- **Cooldown:** nothing triggers while the user is typing or within 1s of a
  fast scroll.

### 6.3 Context extraction

For each candidate span, the content script collects:

- `span` — the selected text, normalized whitespace, max 600 chars
- `paragraph` — the closest block-level ancestor's text, max 1,500 chars
- `headingPath` — nearest h1..h3 chain (gives topic)
- `title`, `lang` (from `<html lang>` or detection), `siteCategory`
- `signals` — the s1..s9 values (for logging and the gray-zone call)

No other page content is sent.

---

## 7. Rewrite engine

Runs in the Hoot app (`src/main/lens/engine.ts`, new). The extension never holds
the API key.

### 7.1 Transform types

| Transform | Input | Output | Default mode |
|---|---|---|---|
| `define` | A term | Short definition gloss (max 15 words) appended in parentheses | Replace (term + gloss) |
| `expand` | An acronym/initialism | Full form, optionally with a 6-word gloss | Replace |
| `simplify` | A sentence or short passage | Plainer wording, same meaning, max 1.5x length | Replace (short) / Gloss (long) |
| `translate` | Foreign-language span | Translation into the user's primary language | Replace |
| `example` | An abstract concept | One short concrete example | Gloss |
| `unpack` | Notation / formula / dense list | The same content in words | Gloss |

The model picks the transform; the client may restrict the allowed set (e.g.
high-stakes → only gloss-type output).

### 7.2 Models, latency, cost

- **Provider:** Anthropic Claude through the Messages API, called only from the
  app's main process with the user's own key.
- **Gray-zone difficulty check:** Claude Haiku 5.5 (`claude-haiku-5-5`; fastest,
  cheapest).
- **Rewrites:** Haiku 5.5 by default for `define`/`expand`/`translate`/`example`
  and short spans; Claude Sonnet 5.5 (`claude-sonnet-5-5`) for `simplify`/`unpack`
  on longer spans (`LENS_MODELS` and `STRONG_REWRITE_MIN_WORDS` in `@hoot/core`).
- **Thinking:** kept as low as the model allows; outputs are short and latency
  matters. Thinking tokens count against `max_tokens`, so caps must leave headroom.
- **Structured output:** a tool call. The schema from section 7.3 is the only
  tool's `input_schema` (forced with `tool_choice` on Haiku 5.5; Sonnet 5.5 rejects
  a forced choice, so the prompt names the tool), and the tool input is validated
  with the same zod schema, so replies parse without prompt-only coaxing.
- **Latency targets:** first visible change p50 under 700ms, p95 under 1.5s for
  spans of 40 words or fewer.
- **No streaming into the page.** Outputs are short; partial swaps would flicker.
  Wait for the complete JSON, validate, then render once.
- **Caching:** key = hash(span + paragraph + transform + profileVersion).
  Cache in the app (persisted) and the extension (session). Same page revisited
  → instant.
- **Cost:** a typical request is a few hundred input tokens and under 100 output
  tokens on Haiku 5.5 — a tiny fraction of a cent per change.

### 7.3 Prompts (draft)

**Difficulty check (gray zone):**

```
System:
You estimate whether a specific reader is likely to find a selected piece of text hard to
understand. You get the selection, its surrounding paragraph, the page topic, and a short
profile of the reader. Judge difficulty for THIS reader, not for an average person.
Reply with JSON only:
{"difficulty": number 0-1, "reason": "jargon"|"acronym"|"dense_sentence"|"foreign_language"|"notation"|"none", "term": string|null}
```

**Rewrite:**

```
System:
You are Hoot Lens, a reading aid. A reader selected a passage they probably don't understand.
Produce a version that is easier for THIS reader to understand while keeping the meaning exactly.

Rules:
- Preserve meaning, facts, numbers, units, names, dates, quotations, and negations exactly.
  If you cannot make it easier without changing the meaning, return action "skip".
- Keep the original language unless the transform is "translate".
- Be brief: "define" and "expand" glosses are at most 15 words; "simplify" is at most 1.5x
  the original length; "example" is one sentence.
- Do not add opinions, warnings, or facts that the context does not support.
- Use the reader profile: don't explain terms they know; follow their style preferences.
- If domain_risk is "high", return action "gloss" (never "replace").
- Reply with JSON only, matching the schema.

Schema:
{
  "action": "replace" | "gloss" | "skip",
  "transform": "define" | "expand" | "simplify" | "translate" | "example" | "unpack",
  "text": string,                    // the replacement (replace) or the annotation (gloss)
  "term": string | null,             // the key term, if any (feeds the profile)
  "meaning_preserved": boolean,
  "confidence": number               // 0-1
}

User:
<reader_profile>{compact profile summary}</reader_profile>
<page title="{title}" headings="{headingPath}" lang="{lang}" domain_risk="{normal|high}"/>
<paragraph>{paragraph}</paragraph>
<selection>{span}</selection>
<allowed_transforms>{list}</allowed_transforms>
```

### 7.4 Guardrails (applied in the app before anything renders)

1. JSON must parse and match the schema; otherwise drop silently.
2. Drop if `action == "skip"`, `meaning_preserved == false`, or `confidence < 0.6`.
3. **Local invariant check** for `replace`: every number, unit, date, URL, and
   negation token (`not`, `no`, `never`, `without`, and language equivalents) in
   the original must appear in the rewrite. Fail → downgrade to `gloss`.
4. Length check per transform (section 7.1); fail → downgrade to `gloss`.
5. High-stakes domain → force `gloss` regardless of model output.
6. Every rendered change is logged as an event (section 8) so it can be audited
   in Studio ("Recent changes").

### 7.5 High-stakes classification

Local and cheap: site category (medical, legal, financial, government, safety)
from a bundled domain list plus keyword heuristics on the title and headings.
Users can override per site. High-stakes pages get gloss-only output and a small
note in the popover: "Reading aid — the original wording is what applies."

---

## 8. Personalization

### 8.1 Event log (local, append-only, rolling retention)

```ts
interface LensEvent {
  id: string
  ts: number
  site: string                 // registrable domain only, e.g. "example.com"
  urlHash: string              // salted hash; no raw URLs stored
  kind: 'shown' | 'kept' | 'reverted' | 'knew_it' | 'explain_more' | 'reselected' | 'copied_original'
  transform: 'define' | 'expand' | 'simplify' | 'translate' | 'example' | 'unpack'
  mode: 'replace' | 'gloss' | 'ask'
  term: string | null
  topic: string | null
  lang: string
  spanWords: number
  p: number                    // local confusion score
  difficulty: number | null    // gray-zone model estimate, if any
  latencyMs: number
}
```

"Kept" is inferred: the change stayed visible, and the user read on (scrolled
past the paragraph or dwelled past it) without reverting within 30s.

### 8.2 Reader profile

```ts
interface ReaderProfile {
  version: number
  readingLevel: { estimate: number; confidence: number }        // grade-level style scale
  readingPaceWpm: number                                         // rolling median
  languages: { primary: string; comfortable: string[] }
  terms: Record<string, { state: 'known' | 'learning' | 'unknown'; seen: number; updatedAt: number }>
  topics: Record<string, { familiarity: number; updatedAt: number }>   // 0-1
  style: { length: 'shorter' | 'same'; analogies: boolean; plainWords: boolean }
  threshold: number                                               // θu
  perSite: Record<string, { threshold?: number; mode?: 'auto' | 'gloss' | 'ask' | 'off' }>
}
```

### 8.3 Update rules

| Event | Profile update |
|---|---|
| `knew_it` | term → `known`; topic familiarity +0.05; θu +0.03 |
| `reverted` (within 5s) | θu +0.03; if term present: `seen += 1`, two reverts → `known` |
| `kept` | term → `learning`; topic familiarity −0.02; θu −0.01 |
| `explain_more` | term → `unknown`; topic familiarity −0.05; style.length stays, depth for topic +1 |
| `reselected` (same term later) | term stays/returns to `learning`; θu −0.01 |
| `copied_original` | weak negative for that transform type on that site |
| A `learning` term seen 3+ times later with normal reading pace and no selection | term → `known` |

Familiarity values decay slowly toward 0.5 when a topic isn't seen for 60 days.

### 8.4 Cold start

- Optional 30-second setup in Studio: pick topics you know well, languages you
  read, and "I prefer: shorter / same length; plain words; examples".
- Without setup: conservative θu (0.80) and Ask-first mode for the first 10
  triggers, then Auto.

### 8.5 Profile in prompts

A compact summary (target under 150 tokens) is generated from the profile for
each request — only the parts relevant to the page topic:

```
Reader profile:
- Reading level: about grade 10 (moderate confidence)
- Already knows: API, latency, mortgage, compound interest
- Finds hard: statistical notation, legal Latin
- Topic familiarity: software high, finance low
- Prefers: shorter rewrites, plain words, no analogies
- Primary language: English
```

### 8.6 Side benefit: a personal glossary

Every `define`/`expand` the user kept becomes an entry in **My glossary** in
Studio (term, the gloss, where they saw it). Entries can be pinned as Hoot
sticky notes, reviewed, or marked known.

---

## 9. Content surfaces

### 9.1 HTML pages (extension content script)

Two rendering strategies, chosen per page:

1. **Inline swap (static content — articles, docs, blogs):** split the text
   nodes at the range boundaries, wrap the range in a `<hoot-lens-mark>` custom
   element, keep the original nodes in a `WeakMap` keyed by the mark, and render
   the rewrite as the mark's content. Restore = put the original nodes back.
2. **Overlay (dynamic apps — React/Vue/etc. pages that re-render):** don't touch
   the page's DOM. Dim the original range with the CSS Custom Highlight API and
   position the rewrite in a shadow-DOM box over it using `Range.getClientRects()`,
   re-positioned on scroll/resize (`ResizeObserver`, `IntersectionObserver`).

A `MutationObserver` watches marked regions: if the page re-renders a marked node,
the mark is dropped quietly (and re-applied from cache if the same text returns).
Detection of "dynamic" pages: framework root markers plus a mutation-rate
heuristic during the first seconds after load.

Iframes: same-origin iframes are handled; cross-origin frames get the content
script only where host permissions allow.

### 9.2 PDFs in the browser (extension viewer)

- The built-in browser PDF viewer can't be scripted by extensions, so Lens opens
  PDFs in its own viewer page (`viewer.html`, built on PDF.js).
- Interception: observe navigations / response headers (`content-type:
  application/pdf` or `.pdf` URLs) and redirect the tab to
  `chrome-extension://<id>/viewer.html?file=<url>`. A toolbar toggle lets users
  fall back to the browser's own viewer.
- Local `file://` PDFs require the user to enable "Allow access to file URLs" for
  the extension (prompted once, with an explanation).
- **Rendering changes:** PDF text is absolutely positioned glyph runs, so a
  rewrite of a different length can't reflow into the page. Lens covers the
  original run's box with a matching background and draws the rewrite in an
  anchored box (shrinking the font down to a minimum, then expanding the box
  downward with a subtle shadow if needed). Gloss mode attaches a side note in the
  margin instead.
- **Reflow mode** (toggle): renders the PDF's text as a single readable column
  (like reader view), where inline replacement works exactly like HTML.

### 9.3 Local files (Hoot Reader, inside the desktop app)

- New window type `reader.html` in the Electron app using `pdfjs-dist`.
- Opens via: dropping a PDF/HTML file on the owl, tray menu "Open in Hoot Reader",
  Studio, or (optionally) a file association.
- Uses the same Lens engine directly in the main process — no bridge needed.
- Same marks, popover, page pill, and keyboard shortcuts as the extension.

### 9.4 Other desktop apps (unchanged, plus a future path)

- Word, Acrobat, slides, images, etc. keep Hoot's existing flow: circle the text →
  quick action "Explain" in the card.
- Future exploration: Windows UI Automation `TextPattern` can report selected text
  and its bounding rectangles in many apps. Lens could detect confusion there and
  show an anchored Hoot bubble (no in-place replacement).

---

## 10. Architecture

```
┌──────────────────────── Browser (Chrome / Edge / Brave / Arc) ───────────────────────┐
│                                                                                       │
│  Page tab                                Extension (MV3)                              │
│  ┌──────────────────────────┐           ┌──────────────────────────────────────────┐ │
│  │ content script           │  runtime  │ service worker                           │ │
│  │ - selection watcher      │ messaging │ - bridge client (native messaging)       │ │
│  │ - signal collector       │◄─────────►│ - PDF interception                       │ │
│  │ - local scorer (p, θu)   │           │ - per-tab rate limits, session cache     │ │
│  │ - renderer (marks,       │           │ - site lists, quick settings             │ │
│  │   popover, page pill)    │           └───────────────────┬──────────────────────┘ │
│  │ - shadow-DOM UI          │           ┌──────────────────┐│                        │
│  └──────────────────────────┘           │ viewer.html      ││  (PDF.js + Lens layer) │
│                                          └──────────────────┘│                        │
└───────────────────────────────────────────────────────────────┼────────────────────────┘
                                                                │ stdio, length-prefixed JSON
                                                   ┌────────────▼───────────┐
                                                   │ hoot-bridge (native    │  tiny process the
                                                   │ messaging host)        │  browser launches
                                                   └────────────┬───────────┘
                                                                │ named pipe \\.\pipe\hoot-lens
┌───────────────────────────────── Hoot desktop app (Electron) ─┼────────────────────────┐
│  main process                                                 ▼                        │
│  ┌───────────────┐  ┌──────────────────┐  ┌───────────────────────┐  ┌───────────────┐ │
│  │ lens/engine   │  │ lens/profile     │  │ lens/events           │  │ bridge/pipe   │ │
│  │ assess,       │  │ update rules,    │  │ append-only log,      │  │ server, auth, │ │
│  │ rewrite,      │  │ summary for      │  │ retention             │  │ routing       │ │
│  │ guardrails    │  │ prompts          │  │                       │  │               │ │
│  └──────┬────────┘  └──────────────────┘  └───────────────────────┘  └───────────────┘ │
│         │ existing: ai/claude.ts (Claude), store/persistence.ts, prompts.ts, ipc.ts    │
│  renderer windows: Buddy (card) · Studio (Reading settings, profile, glossary) ·       │
│                    Reader (PDF.js, local files) · Notes                                │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

### 10.1 Why Native Messaging (and not a localhost server)

- The browser guarantees the caller: the host manifest lists the extension's
  exact `chrome-extension://<id>/` origin in `allowed_origins`, so arbitrary web
  pages and local processes can't impersonate it.
- No open ports, no firewall prompts.
- The host is registered per user under
  `HKCU\Software\Google\Chrome\NativeMessagingHosts\com.hoot.lens` (and the
  `Microsoft\Edge\NativeMessagingHosts` equivalent), written by the Hoot
  installer.
- Limits to respect: a single message from the host to the extension is capped
  at 1 MB — Lens messages are tiny.
- The browser starts a fresh host process per connection, so `hoot-bridge` is a
  thin relay to the running app over a named pipe. If the app isn't running, the
  bridge can launch it hidden (`--hidden`).

A localhost WebSocket with a pairing code is acceptable for development only.

### 10.2 Bridge protocol (JSON messages)

```
extension → app                              app → extension
─────────────────────────────────────        ─────────────────────────────────────────
hello { extVersion, browser }                welcome { appVersion, settings, profileVersion }
assess { reqId, span, paragraph,             assessed { reqId, difficulty, reason, term }
         headingPath, title, lang,
         signals, siteCategory }
rewrite { reqId, ...same context,            rewritten { reqId, action, transform, text,
          allowedTransforms, risk }                      term, confidence, cacheKey }
                                             skipped { reqId, reason }
cancel { reqId }
feedback { eventId, kind, ...LensEvent }     ack { eventId }
profile.get {}                               profile { summary, version }
settings.get {}                              settings { lens: {...} }
                                             settings.changed { lens: {...} }   (push)
```

All requests carry `reqId`; the app answers each exactly once (`rewritten`,
`skipped`, or an `error { reqId, code }`). `cancel` is sent when the user
deselects and moves on before a result arrives.

### 10.3 Extension package layout

```
extension/
  manifest.json          MV3; permissions: storage, nativeMessaging, scripting,
                         webNavigation, webRequest (observe only); host_permissions: <all_urls>
  src/sw.ts              service worker: bridge client, PDF interception, caches, limits
  src/content/
    selection.ts         selectionchange/copy/scroll/typing listeners
    signals.ts           s1..s10 feature extraction
    score.ts             sigmoid scorer, threshold, rate limits (pure, unit-tested)
    context.ts           paragraph/heading/lang extraction
    render/inline.ts     text-node split + <hoot-lens-mark>
    render/overlay.ts    Custom Highlight API + positioned shadow-DOM box
    ui/                  popover, page pill, ask-first chip (shadow DOM)
  src/viewer/            PDF.js viewer + Lens layer + reflow mode
  src/options/           site lists and quick toggles (deep settings live in Studio)
  data/wordfreq/         compact per-language frequency lists (permissive license)
```

### 10.4 Changes to the existing Hoot app

| Area | Change |
|---|---|
| `src/main/lens/engine.ts` (new) | assess + rewrite calls via the existing `src/main/ai/client.ts`; guardrails; cache |
| `src/main/lens/profile.ts`, `events.ts` (new) | profile model, update rules, summary; event log + retention |
| `src/main/bridge/` (new) | named-pipe server, auth handshake, message routing |
| `bridge/` (new package) | `hoot-bridge` native messaging host; installer writes the registry entries |
| `src/shared/prompts.ts` | Lens difficulty + rewrite prompts |
| `src/shared/types.ts` | `LensSettings`, `LensEvent`, `ReaderProfile` |
| `src/main/store/persistence.ts` | `lens/profile.json`, `lens/events-YYYY-MM.jsonl`, `lens/cache.json` |
| Studio | new **Reading** settings section, **What Hoot knows about me**, **My glossary**, **Recent changes** |
| Reader window (new) | `reader.html` + `src/renderer/src/reader/` with PDF.js and the Lens layer |
| Buddy card | "Explain more" opens the card pre-filled with span + paragraph context |
| Installer | registers the native messaging host; code-signing required (see risks) |

---

## 11. Privacy, safety, trust

- **Consent first.** Lens is off until the user turns it on in Studio, with a
  clear explanation of what is sent (the selected text, its paragraph, page title
  and headings) and when (only when Lens decides to help, or in Ask-first mode
  when the user clicks).
- **Default deny list:** banking, payments, health portals, email and chat web
  apps, password managers, and any page with a password field. Incognito/private
  windows: off.
- **Never sent:** form field values, page content outside the selected paragraph,
  cookies, full URLs (only the registrable domain for site rules).
- **Local by default:** profile, events, cache, and glossary live in `%APPDATA%\hoot`.
  The API key stays encrypted (DPAPI via `safeStorage`) in the app, never in the
  extension.
- **One provider: Anthropic (Claude).** What Lens sends goes from the app to
  Anthropic's Claude API with the user's own key, and nowhere else. Anthropic
  doesn't train its models on what Hoot sends with your API key, and deletes it
  within 30 days (longer only if it's flagged under Anthropic's Usage Policy). The
  consent screen says so and links to
  [Anthropic's terms](https://www.anthropic.com/legal/commercial-terms).
- **Transparency:** every change is marked; Studio shows "Recent changes" with
  the original and rewrite; the profile is fully viewable, editable, exportable,
  and resettable.
- **Accuracy:** guardrails in section 7.4; high-stakes pages are gloss-only with a
  disclaimer.
- **Accessibility:** marks expose `aria-describedby` pointing to visually hidden
  text: "Simplified by Hoot. Original: …". Screen readers can reach Restore via
  keyboard. Lens respects reduced motion, reduced transparency, and high contrast.
- **Display only:** Lens never modifies files, servers, or what other people see.

---

## 12. Success metrics

| Metric | Definition | Target (after personalization warms up) |
|---|---|---|
| Keep rate | changes kept / changes shown | > 70% |
| Fast-revert rate | reverts or "I knew this" within 5s / shown | < 15% |
| False-trigger rate | fast reverts + copy-right-after-change / shown | < 10% |
| Explain-more rate | "Explain more" / shown | tracked (signals under-explaining) |
| Latency | selection settle → visible change | p50 < 700ms, p95 < 1.5s |
| Pause rate | sites paused / sites where Lens triggered | < 10% |
| Retention | weekly active Lens users / installed | grows week over week |
| Comprehension | occasional 1-tap prompt "Did that help?" | > 80% yes |

---

## 13. Testing strategy

- **Unit (Vitest):** scorer and threshold updates, signal extraction from
  synthetic event sequences, profile update rules, guardrail invariant checks
  (numbers/negations/length), protocol message validation, cache keys.
- **Fixture pages:** a static article, a React app that re-renders, a page with
  iframes, a page with code blocks and inputs (must never change), a
  high-stakes page, a foreign-language page.
- **End-to-end (Playwright):** Chromium persistent context launched with the
  unpacked extension (`--disable-extensions-except` + `--load-extension`) against
  the fixture pages, with a fake engine mode in the app (like the existing
  `HOOT_FAKE_AI`) so tests are deterministic. Covers: select → change → mark →
  hover original → restore → event logged; copy → no change; rate limits; deny
  list; PDF viewer interception and overlay rendering; reduced motion.
- **Rewrite quality evals:** a fixed set of a few hundred spans across domains and
  languages, scored on meaning preserved, easier to read, length ratio, and
  invariants intact — by human review plus a model-graded rubric. Run on every
  prompt or model change; block regressions.

---

## 14. Risks and mitigations

| Risk | Mitigation |
|---|---|
| A rewrite changes the meaning | Meaning self-check + local invariant check + confidence floor; gloss-only on high-stakes; always reversible; "Recent changes" audit |
| Feels creepy / unwanted | Off by default; visible marks; page pill with Undo all and Pause; adaptive threshold; Ask-first mode |
| Breaks pages | Overlay mode for dynamic apps; shadow DOM UI; never touch editable or code content; MutationObserver fallback |
| Latency makes it jarring | Local-first detection; Haiku 5.5; caching; no animation for late results |
| Cost at scale | Most selections never call the model; gray-zone only; caching; short outputs |
| Privacy concerns | Minimal context, local storage, deny list, consent screen, no raw URLs |
| Store review / policy | No remote code; clear single purpose; permission justifications; privacy policy |
| MV3 service worker lifetime | Native port reconnects on demand; content script holds per-page state |
| Unsigned binaries blocked (Smart App Control on this dev machine already blocks the unsigned Hoot build) | Code-sign the app, the installer, and `hoot-bridge` before distribution |
| PDF layout can't fit rewrites | Overlay box with min font then expand; margin glosses; reflow mode |

---

## 15. Roadmap (phases and exit criteria)

**Phase 0 — Spike.** Content script on a static fixture page: select → swap a
hard-coded rewrite → mark → popover with original → restore.
*Exit:* swap/restore round-trips exactly, including whitespace, on the fixtures.

**Phase 1 — Ask-first MVP.** Selection shows the "Make this clearer?" chip;
bridge to Hoot; engine with prompts and guardrails; marks, popover, page pill;
event logging; Studio Reading settings.
*Exit:* end-to-end on real sites with the real API; latency targets met for short
spans; e2e suite green with the fake engine.

**Phase 2 — Implicit detection + personalization v1.** Local scorer with
adaptive threshold, gray-zone difficulty check, rate limits, profile update
rules, "What Hoot knows about me" panel, cold-start setup.
*Exit:* fast-revert rate under 20% across a week of internal use; no changes ever
on fixture inputs/code/deny-listed pages.

**Phase 3 — PDFs.** Extension PDF viewer with overlay rendering and reflow mode;
Hoot Reader window for local PDF/HTML files.
*Exit:* fixture PDFs (single/multi-column, scanned-with-OCR text layer) render
changes legibly; restore is exact.

**Phase 4 — Personalization v2 and release.** Topic familiarity decay, My
glossary, per-site learning, translate preferences, eval set and regression
gate, code signing, store listings (Chrome Web Store, Edge Add-ons), Firefox port.
*Exit:* public beta.

**Phase 5 — Exploration.** Windows UI Automation for selections in other desktop
apps (anchored Hoot bubble, no in-place change); optional "pre-gloss hard terms on
this page" for users who opt in.

---

## 16. Open questions

1. Copy default: original (current proposal) or "what I see"?
2. Should changes persist when the user revisits the same page (re-apply from
   cache), or start fresh each visit?
3. Standalone extension without the desktop app (extension-held key), or always
   require Hoot? (Current proposal: require Hoot — one key, one profile.)
4. Multi-device sync of the profile — never, or opt-in encrypted sync later?
5. Which languages ship in Phase 1 for word-frequency lists and invariant checks?
6. Should high-stakes replacement ever be allowed, even with explicit opt-in?
7. Team/enterprise policy controls (deny lists, logging off) — needed for v1?

---

## 17. Glossary

- **Lens** — the adaptive reading feature described here.
- **Mark** — the visual indicator around changed text.
- **Gloss** — an annotation added next to the original instead of replacing it.
- **Gray zone** — confusion scores just below the user's threshold, where a cheap
  model check decides.
- **θu (user threshold)** — the per-user score above which Lens acts; it moves
  with feedback.
- **Bridge** — the native messaging host plus named pipe connecting the extension
  to the Hoot app.
- **High-stakes** — medical, legal, financial, government, or safety content;
  gloss-only by default.
