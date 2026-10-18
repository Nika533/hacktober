# How to use Hoot

Hoot is a small owl that lives in your Windows tray and floats on your screen.
Summon it from any app, circle anything on screen and ask about it, pin answers
as sticky notes, and let **Hoot Lens** rewrite text you don't understand right
where you're reading it: on web pages, in PDFs, in any desktop app and in
VS Code. Hoot answers with Claude (Anthropic), using your own API key.

This guide covers every feature. For contributor rules see [`AGENTS.md`](../AGENTS.md);
for the design, see [`hoot-lens.md`](hoot-lens.md).

**Contents**

1. [Install and first run](#1-install-and-first-run)
2. [Shortcut cheat sheet](#2-shortcut-cheat-sheet)
3. [The owl](#3-the-owl)
4. [Chatting with Hoot](#4-chatting-with-hoot)
5. [Circle anything (live screen overlay)](#5-circle-anything-live-screen-overlay)
6. [Lens anywhere: any desktop app](#6-lens-anywhere-any-desktop-app)
7. [Sticky notes](#7-sticky-notes)
8. [Hoot Lens in the browser](#8-hoot-lens-in-the-browser)
9. [PDFs: browser viewer and Hoot Reader](#9-pdfs-browser-viewer-and-hoot-reader)
10. [Studio](#10-studio)
11. [VS Code extension](#11-vs-code-extension)
12. [Tray menu](#12-tray-menu)
13. [Privacy and your data](#13-privacy-and-your-data)
14. [Troubleshooting](#14-troubleshooting)
15. [Advanced: environment variables](#15-advanced-environment-variables)

---

## 1. Install and first run

### What you need

- Windows 11
- Node 24 (to run from source)
- Chrome or Edge, for Hoot Lens on the web (the native host is also registered for Chromium and Brave)
- A Claude API key (it starts with `sk-ant-`) from
  [console.anthropic.com](https://console.anthropic.com/settings/keys). Optional:
  without one, Hoot can run on built-in fakes (see [Offline mode](#try-it-without-a-key-offline-mode)).

> On Windows, use `npm.cmd` / `npx.cmd`. The PowerShell execution policy blocks the `.ps1` shims.

### Run from source

From a clean clone, in PowerShell:

```powershell
npm.cmd ci                                       # 1. install
npm.cmd run build                                # 2. build the app, the extension and every package
npm.cmd run register-host -w @hoot/bridge        # 3. let Chrome and Edge find the app
$env:ANTHROPIC_API_KEY = "<your key>"            # 4. optional: or paste it during setup
npm.cmd run dev                                  # 5. start Hoot
```

`npm.cmd run unregister-host -w @hoot/bridge` undoes step 3.

### Or use the installer

```powershell
npm.cmd run build:win
```

This writes `apps\desktop\dist\Hoot-<version>-setup.exe`: a per-user installer
(no admin prompt) that adds a desktop shortcut and registers the browser
extension's native host for you. It's unsigned, so **Smart App Control** may
block it. The dev build above always works.

With the installed app, the browser extension starts Hoot in the background on
its own when you use Lens and Hoot isn't running.

### Load the browser extension

1. Open `chrome://extensions` (or `edge://extensions`).
2. Turn on **Developer mode**.
3. Click **Load unpacked** and pick `apps\extension\dist`.

### First-run setup

On the first launch, Studio opens full-window with four short steps:

1. **Hi, I'm Hoot**: what Hoot can do. Click **Get started**.
2. **Connect Claude**: paste your key and click **Check and save**. Hoot checks
   it with Anthropic, then stores it encrypted with Windows DPAPI. **Skip for now**
   lets you go on without a key; Hoot can't answer until you add one in Settings.
3. **Your shortcuts**: keep or re-record the *Summon Hoot* and *Circle anything*
   shortcuts. Hoot won't let two shortcuts share keys, and tells you if another
   app already owns a combination.
4. **You're all set**: shows whether the browser extension is connected. Click
   **Start using Hoot** (or press the summon shortcut).

The owl then appears. Later launches go straight to the owl.

### Try it without a key (offline mode)

Everything runs with no key and no network on deterministic fakes:

```powershell
$env:HOOT_FAKE_AI = "1"; $env:HOOT_FAKE_LENS = "1"
npm.cmd run dev
```

Add `$env:HOOT_USER_DATA = "$env:TEMP\hoot-demo"` to start from a fresh profile
without touching your real data.

---

## 2. Shortcut cheat sheet

### Global (work from any app; change them in Studio → Settings → Shortcuts)

| Keys | What |
|---|---|
| `Ctrl+Shift+Space` | Summon Hoot, or hide it |
| `Ctrl+Alt+Space` | Circle anything on screen |
| `Ctrl+Alt+L` | Lens on a selection in any app |

### Owl and chat card

| Keys | What |
|---|---|
| Any letter (on the pill) | Opens the card with that letter already typed |
| `Enter` / `Shift+Enter` | Send / new line |
| `Esc` | End a voice chat; else stop a streaming answer; otherwise card → pill → hidden |
| `Ctrl+N` | New chat |
| `Ctrl+L` | Open the chat in Studio |

### Studio

| Keys | What |
|---|---|
| `Ctrl+N` | New chat |
| `Ctrl+L` | Back to the card (closes Studio) |
| `Ctrl+F` | Search chats |
| `Ctrl+,` | Settings |
| `↑` `↓` / `F2` / `Delete` | In the chat list: move, rename, delete (double-click also renames) |

### Circle anything overlay

| Keys | What |
|---|---|
| `L` / `R` | Lasso / Rectangle |
| `F` | Use the full screen |
| `Enter` / `Shift+Enter` | Send / new line, in the ask box |
| `Esc` | Close the overlay |

### Hoot Lens (web pages, the browser PDF viewer, Hoot Reader)

| Keys | What |
|---|---|
| `Alt+L` | "Make this clearer?" (while the chip is showing) |
| `Alt+Z` | Undo the most recent change on the page |
| `Alt+Shift+Z` | Restore everything on the page |
| `Alt+H` | Pause or resume Lens on this site |
| `Tab`, then `Enter` / `Esc` | Focus a marked change, open its options / close them |

### Elsewhere

| Where | Keys | What |
|---|---|---|
| Lens anywhere bubble | `Esc` | Close |
| Sticky note | `Esc` | Close (deletes the note) |
| Hoot Reader | `Ctrl+O` | Open a PDF |
| Hoot Reader (Pages view) | `Ctrl+=` / `Ctrl+-` / `Ctrl+0` | Zoom in / out / fit width |
| Chrome or Edge | `Alt+Shift+H` | Ask Hoot about this page (the toolbar popup: type or talk) |
| VS Code | `Ctrl+Alt+H` | Hoot: Make this clearer |
| VS Code | `Ctrl+Alt+J` | Hoot: Explain in Hoot chat |

---

## 3. The owl

### Four sizes

Hoot grows out of the owl and shrinks back into it:

| Size | What you see | How to get there |
|---|---|---|
| **Dot** | Just the owl | The pill shrinks to a dot after 5 s idle |
| **Pill** | The owl and a small toolbar: **Circle anything** (pencil) and **Chat** | Summon Hoot, or hover the dot |
| **Card** | A chat card next to the owl | Click the owl on the pill, click **Chat**, or start typing on the pill |
| **Studio** | A full window: chats, settings, Reading | `Ctrl+L` from the card, or tray → **Open Studio** |

Change the dot delay in Settings → Behaviour → **Shrink the pill to a dot after**
(5 s, 10 s, 30 s or Never).

### Summon and hide

- **Summon shortcut** (`Ctrl+Shift+Space`): hidden → pill, with a greeting. If
  Hoot is already showing and focused, it hides. If Studio is open, it focuses
  Studio, or sends it back to the card when Studio already has focus.
- **Tray icon, left click**: shows or hides the owl (focuses Studio if it's open).
- **Click the owl**: switches between the pill and the card.
- **`Esc`**: steps back one size.

The empty space around the owl is click-through: clicks go to the app underneath.

### Move it

Drag the owl anywhere. Let go with a flick and it glides; near a screen edge it
snaps to that edge. Hoot remembers the position. To put it back in its starting
corner: Settings → Data → **Reset position**.

### Greetings

When you summon Hoot it says hello for the time of day ("Good morning!", "Hi,
night owl!") with a suggestion you can click:

- **Want me to look at what you copied?**: you copied something new since Hoot
  last looked. Clicking opens the card with the copied item ready to send.
- **Continue "…"?** (with your last chat's title): that chat was less than two
  hours ago. Clicking opens it.

The greeting leaves after 6 seconds, or as soon as you click anything else.

### Moods and the answer badge

The owl's eyes follow your pointer. It listens while the empty ask box has
focus, thinks while Claude works, talks while an answer streams, celebrates
briefly when the answer is done, and looks upset when something fails. A **dot
badge** on the owl means an answer finished while the card was closed (for
example, after you minimized the live overlay into it).

With **Reduce motion** on in Windows, transitions become cross-fades and the owl
stays still.

---

## 4. Chatting with Hoot

### The chat card

- **Header**: the chat's title, **New chat** (`Ctrl+N`), **New agent** (see
  [Agents](#agents-more-chats-at-once)), **Open in Studio** (`Ctrl+L`) and
  **Close** (`Esc`).
- **Ask box**: `Enter` sends, `Shift+Enter` adds a line. While an answer streams,
  the send button becomes **Stop**. The mic button starts a voice chat (see
  [Talk to Hoot](#talk-to-hoot-voice)); the pencil button starts *Circle anything*.
- **Answers** stream in as formatted Markdown. Code blocks have their own
  **Copy** button; links open in your browser.
- **On each answer**: **Copy**, **Read aloud**, **Pin as note** (a sticky note,
  see [§7](#7-sticky-notes)), and **Regenerate** on the latest answer. **Jump to
  latest** appears when you scroll up during an answer.
- **Errors** say what went wrong and how to fix it (for example, an **Add key**
  button when no Claude key is set).
- **Changes to your code**: when the answer read your code in VS Code, it lists
  each change Hoot proposes under **In VS Code**, with **Apply** (make the change)
  and **Show** (jump there). See [§11](#hoot-reads-your-code).

### Agents: more chats at once

An agent is another Hoot with a chat of its own. Press **New agent** (the robot
button in the card's header, or in Studio's chat header) and its card opens next
to the owl. Ask it something and keep going: the agent answers while you chat
with Hoot or with other agents, all at the same time. Up to six agents can work
at once.

- **Each agent has its own colour**: blue, green, purple, pink, teal and slate.
  Its owl, its name (*Blue agent*, *Green agent*, …) and its card show it.
- **Minimize** (`Esc`, or the **–** button) shrinks the card into the agent's
  owl. Owls float on their own: drag one anywhere, click it to open the card
  again. A dot on an owl means an answer finished while it was minimized.
- **Close** (**×**) ends the agent. Its chat stays in Studio's list, like any chat.
- Agents read your code in VS Code the same way Hoot does (right after you were
  in VS Code), and their answers have the same **Apply** buttons.
- Drag a card by its header. `Esc` stops an answer that's still writing.

### Talk to Hoot (voice)

Press the **mic** in the card, in Studio or in the live overlay's chat, and just
talk. Windows speech recognition listens on your PC:

1. **Listening**: the mic glows with your voice and the line above the ask box
   shows what Hoot hears so far.
2. Pause for about a second and Hoot sends what you said (or press the mic,
   now **Done talking**, to send right away).
3. **Thinking**, then **speaking**: Hoot reads its answer aloud sentence by
   sentence while it writes it. Code isn't read out ("The code is in the chat").
4. Then it **listens again**, so you can keep talking hands-free.

| To | Do |
|---|---|
| Cut Hoot off and talk | Press the mic while it speaks |
| End the voice chat | **End** on the voice line, or `Esc` in the card. The answer keeps writing |
| Type instead | Type and send as usual: Hoot reads that answer aloud too, then listens |
| Hear an older answer | **Read aloud** under it |

The voice chat ends on its own if you say nothing for 8 seconds. Settings →
**Voice**: **Read answers aloud** (off: Hoot still listens but answers in writing
only) and **Speaking speed**. The voice is your Windows default voice
(Settings → Time & language → Speech).

If the mic says Windows speech isn't set up, add a speech language in Windows
settings (English works best). If it can't hear a microphone, check that one is
connected and that desktop apps may use it (Settings → Privacy & security →
Microphone).

### Hoot reads the web page you were on

With the browser extension loaded (see [§8](#8-hoot-lens-in-the-browser)), a
message you send right after reading a page in Chrome or Edge also carries that
page **as text**: what's on screen, what you selected, the main text and the
headings. Ask "what does this paragraph mean?" or "summarize this" without
copying anything. Hoot can point at passages: they light up on the page and it
scrolls to the first one. Later messages in the same chat only send what
changed.

"Right after" means the browser was the last app you were in (in the last two
minutes); if VS Code was more recent, Hoot reads your code instead. Banking,
email, chat and password-manager sites, pages with a password field and sites
set to **Never** are never read: Hoot is only told that the page is private.
Turn it off on the extension's options page (**Let Hoot read the page you're on**).

### Choose a model

Studio → Settings → **Model**:

| Model | Good for |
|---|---|
| Haiku | Fastest answers |
| Sonnet (default) | A good balance |
| Opus | The hardest questions |

### Captures and quick actions

Whenever a capture is waiting to be sent (up to 4 per message), its thumbnail
shows above the ask box with one-click actions:

| Action | What Hoot does |
|---|---|
| **Explain** | Explains what the capture shows, briefly |
| **Extract text** | Copies out every word, exactly as written, in a code block |
| **Translate** | Translates the text into your *Translate into* language (Settings → Behaviour; English by default) |
| **Summarize** | Three bullet points or fewer |
| **Fix this** | Finds errors, bugs, typos or wrong formulas and shows the corrected version |

Sending an empty message with a capture attached means **Explain**. Click a
thumbnail to open the image in your image viewer, or **×** to remove it.

### Use what you copied

Copy some text or an image, then summon Hoot: a chip offers **Use copied text
(N characters)** or **Use copied image**. Click it to include it with your next
message, or **×** to dismiss it. It never sends anything on its own, and whatever
was on the clipboard when Hoot started is never suggested. Turn it off in
Settings → Behaviour → **Suggest copied text**.

### Your chats in Studio

Every chat is saved on your PC (unless you turn off Settings → Behaviour →
**Save chat history**). In Studio's sidebar:

- **New chat**, and **Search chats** (`Ctrl+F`; `Esc` clears the search)
- Click a chat to open it. Rename with `F2` or a double-click. Delete with
  `Delete` or its delete button; a toast offers **Undo** for 5 seconds.

---

## 5. Circle anything (live screen overlay)

Ask about anything on your screen: a chart, an error dialog, a form, a slide, a
photo.

### Start

Press `Ctrl+Alt+Space`, or click the pencil on the pill or in the card, the
**Circle something on screen** chip in an empty card, or tray → **Circle
something**.

A soft light-blue glow around the screen edges means the overlay is live. Your
screen keeps moving underneath; nothing is frozen.

### Draw

| Control | What |
|---|---|
| **Lasso** (`L`) | Draw freely around what you mean (the default) |
| **Rectangle** (`R`) | Drag a box |
| **Full screen** (`F`) | Ask about the whole screen |
| **Use apps** | Let clicks reach your apps (scroll, switch windows, move things), then press **Draw** to get back to drawing |
| **×** or `Esc` | Close the overlay |

The toolbar can be dragged by its grip. Tiny shapes (a stray click) are ignored.

### Chat about it, in place

When you finish a shape, it stays on screen and a glass chat opens beside it
(never over it), ready for your question. Each new shape starts a fresh chat.

- **Quick actions**: **Explain**, **Summarize**, **Translate**, **Fix**.
- **Ask box**: "Ask about this, or where to click…". `Enter` sends; **Stop**
  ends an answer early.
- **Header buttons**: **Wider / Narrower**, **Open in Hoot chat** (continue in
  Studio; the overlay closes), **Redraw** (circle something new), **Minimize to
  Hoot**, and **Close**.
- **Move and resize**: drag the chat by its header and resize it from any edge;
  double-click an edge to go back to the default size.
- **On each answer**: **Copy**, **Pin** (keep it on screen as a sticky note) and
  **Open in chat**.

What goes with each message:

- The part you circled (as an image), plus any text Hoot could read under it
  from the app itself, so exact wording, code and numbers come through.
- A **fresh screenshot of your whole screen** at the moment you send, with the
  overlay left out of the picture, so follow-up questions see what's on screen now.

### Hoot points at things

Answers can mark spots on your real screen: glowing arrows, pulsing rings,
boxes and labels. For "how do I…" questions, Hoot shows one step at a time:

| Button | What |
|---|---|
| **Click for me** | Hoot moves the pointer to the highlighted spot and clicks it, then looks for the next step |
| **Auto-click** | Keeps clicking each step until the goal is reached (press again to turn off) |
| **Next step** | You clicked it yourself; show the next step |
| **Dismiss** | Hide this step |

Hoot only clicks when you press **Click for me** or turn on **Auto-click**.

### Minimize into the owl

**Minimize to Hoot** shrinks the chat into the owl; your shape and conversation
stay as they were. A badge on the owl tells you when an answer is ready. Press
`Ctrl+Alt+Space` again, or open the owl's chat, to bring it back.

### With VS Code in front

If you start the overlay with VS Code in front, or draw a shape (or press
**Full screen**) over a VS Code window (with the Hoot VS Code extension
installed, see [§11](#11-vs-code-extension)), the header says **Hoot reads your
code in VS Code**. Hoot then reads the code as text instead of taking
screenshots, and its answer can list places **In VS Code** with **Show** (jump
there) and **Apply** (make the proposed change) buttons.

Each new shape reads the app it's drawn on: open the overlay over the browser,
then circle your editor, and that chat is about your code. Bringing the overlay
back from the owl with `Ctrl+Alt+Space` reads whatever app is in front then.

### With a web page in front

If you start the overlay with Chrome or Edge in front (and the extension
loaded), the header says **Hoot sees your screen and reads this page**: each
message carries the screen and also the page as text, so quotes and numbers are
exact. Passages Hoot points at light up on the page.

The mic works here too: talk about what you circled.

---

## 6. Lens anywhere: any desktop app

Select text in **any** app (Word, Acrobat, Outlook, a chat app, a terminal) and
press `Ctrl+Alt+L`. A small glass bubble opens next to the selection with a
clearer version, without taking focus away from the app.

> Lens has to be turned on first: Studio → Reading → **Turn on Hoot Lens** (see [§8](#turn-lens-on)).

The bubble shows:

- What Hoot did (e.g. *Defined a term*, *Simplified a sentence*, *Translated*)
  and the clearer text, with **Copy** and **Pin as a note**
- Your original selection underneath
- **Explain more** (Hoot's chat explains it in depth), **Open in chat** (the
  same, in Studio) and **I knew this** (Hoot remembers you know this term)

Other states:

| You see | Meaning |
|---|---|
| "Select some text first, then press Ctrl+Alt+L." | Nothing was selected (closes on its own) |
| "Nothing to change here — it already reads clearly." | Lens left it alone; **Explain anyway** asks the chat instead |
| "That's more than Lens rewrites at once…" | Over 600 characters; select a sentence or a short paragraph, or **Explain anyway** |
| An error with **Open settings**, **Open Reading** or **Try again** | No key, Lens off, rate limit, no connection… The button fixes it |

The bubble closes with `Esc`, **×**, or after 45 seconds without the pointer
on it. Press `Ctrl+Alt+L` again to start over with a new selection.

How Hoot reads the selection: first through Windows UI Automation. If the app
doesn't expose it, Hoot sends `Ctrl+C` to the app and reads the clipboard,
always putting your clipboard back afterwards. In a terminal with nothing
selected it does nothing, because `Ctrl+C` there would interrupt the program.

---

## 7. Sticky notes

Pin anything Hoot says and it stays on your desktop as a small note.

**Create one** from:

- **Pin as note** on any chat answer (card or Studio)
- **Pin** on an answer in the live overlay
- **Pin as a note** in the Lens anywhere bubble
- **Pin as note** on a term in Studio → My glossary

**On a note**: **Copy**, **Open in Hoot** (reopens the chat it came from, when
there is one) and **Close** (`Esc`), which **deletes** the note. Drag a note to
move it; Hoot remembers where.

- Tray → **Hide pinned notes** / **Show pinned notes (N)** hides or shows them all.
- Settings → Behaviour → **Restore pinned notes** brings them back when Hoot starts.

---

## 8. Hoot Lens in the browser

Select text you don't understand on a web page and Hoot rewrites it in place.
Every change is marked, can be undone with one click, and teaches Hoot what you
already know.

### Turn Lens on

Lens is **off until you turn it on** in Studio:

1. Open Studio → **Reading** (the book icon at the bottom of the sidebar).
2. Read what Lens sends and when, then click **Turn on Hoot Lens**.
3. Check the status line: **Hoot Lens is connected** means the extension is talking
   to the app. **Waiting for the browser extension** means: open Chrome or Edge
   with the extension loaded.

Optional: **Teach Hoot what you already know** (about 30 seconds). Pick topics
you know well, rewrite length, plain words, and examples/analogies. Until you do
this, Lens starts cautiously and asks before changing anything for the first
few times.

### Modes

Pick one in Studio → Reading → **How Lens helps** (or on the extension's options page):

| Mode | What happens |
|---|---|
| **Auto** (default) | Hoot rewrites text when you seem stuck: you selected it and lingered (about 1.2 s) without copying |
| **Gloss only** | Hoot keeps the original text and adds a short note next to it |
| **Ask first** | A small **Make this clearer?** chip appears next to your selection; nothing changes until you click it (or press `Alt+L`) |

In Auto mode, a selection Hoot is unsure about gets a quick difficulty check
first, and Hoot still shows the chip instead of rewriting during your first few
uses (until it knows you) and on a page where you undid two changes in a row.
**How often Hoot steps in** (Fewer changes ↔ More changes) tunes how eager Auto is.

### What a change looks like

1. The selected text shimmers briefly while Hoot thinks.
2. It's replaced by the clearer version, tinted with a dotted underline. Or, for
   a gloss, the original stays and Hoot's note appears after it.

What Hoot can do with a selection:

| Change | Example |
|---|---|
| Defined a term | "heteroscedasticity (when the spread of errors changes across values)" |
| Expanded an acronym | "SLA" → "service-level agreement" |
| Simplified a sentence | A dense sentence in plainer words, same meaning |
| Translated | A sentence in a language you don't read, in your main language |
| Added an example | One short concrete example (as a note) |
| Put notation into words | A formula or dense list, spelled out (as a note) |

Hoot keeps numbers, units, dates, names, links and negations ("not", "never")
exactly. If a rewrite would lose one, it becomes a note instead.

### Hover a change

Hover or focus a mark (`Tab`, then `Enter`) to open its popover:

- **Original**: the exact text that was replaced (or **Hoot added**: the note)
- **Restore** (or **Remove note**): put the original back
- **I knew this**: restore it and remember you know this term; Hoot won't explain it again
- **Explain more**: opens the Hoot chat (the card, or Studio if it's open)
  and explains the passage in depth, with its paragraph as context
- **Copy rewritten**: copy Hoot's version
- The footer says what kind of change it was

### The page pill

After the first change on a page, a pill appears in the corner: **Hoot changed
N things · Undo all · Pause on this site**. Paused sites stay paused until you
press `Alt+H` there or click **Resume**.

### Medical, legal and money pages

On high-stakes pages (medical, legal, financial, government, safety) Hoot only
adds notes, never replaces the wording, and the popover says *"Reading aid — the
original wording is what applies."* To allow rewrites there too, set Studio →
Reading → **Medical, legal and money pages** to **Allow rewrites**.

### Copying changed text

By default, copying a changed passage copies the **original** text. Switch to
**Copy what I see** in Studio → Reading → **When you copy changed text**.

### Languages

Studio → Reading → **Languages**: set **Your main language** (what Hoot
translates into) and **Languages you read comfortably** (Hoot won't translate
these).

### Where Lens never acts

- Text boxes, editable areas and code blocks
- Pages with a password field, and private/incognito windows
- Banking and payments, health portals, email and chat web apps, and password
  managers (a built-in list)
- Sites you set to **Never** or paused
- When you copy what you selected: copying means you wanted the text, not help

It also limits itself to 3 automatic changes a minute and 12 per page, and if
you undo two changes in a row on a page, it switches that page to Ask first.

### Site rules

Studio → Reading → **Sites** (also on the extension's options page): add a site
like `example.com` and choose:

| Rule | Effect |
|---|---|
| **Always on** | Lens runs even on a site Hoot skips by default |
| **Paused** | Off until you press `Alt+H` on the page |
| **Never** | Lens stays off on this site |

### The extension's options page

Right-click the Hoot Lens toolbar icon → **Options** (or `chrome://extensions` →
Hoot Lens → **Details** → **Extension options**). It shows:

- **Hoot app** connection: *Connected to Hoot 1.0.0*, *Hoot isn't running*,
  *Hoot isn't installed* or *Hoot needs an update*, with **Try again**
- **Let Hoot read the page you're on** (see
  [Hoot reads the web page you were on](#hoot-reads-the-web-page-you-were-on))
- **Lens** on/off (available once you've turned Lens on in Studio) and **Mode**
- **Sites**: the same site rules as Studio

Deeper settings (languages, profile, glossary) live in Studio.

### Ask Hoot about the page (toolbar button)

Click the Hoot icon in the toolbar (or press `Alt+Shift+H`) to ask about the
page you're on:

- **Type** a question and press `Enter`, or
- press the **mic** and **talk**: the browser's speech recognition turns it into
  text, and the question goes as soon as you stop. Hoot then answers **aloud** on
  your desktop and keeps listening (Windows speech), like a voice chat.

The question opens in Hoot's chat on your desktop with the page attached as text
(a new chat, unless the open chat is already about this page). The first time you
press the mic, the extension opens a tab that asks for the microphone once; after
that the popup can listen. Brave has no speech recognition, so it shows only the
text box.

---

## 9. PDFs: browser viewer and Hoot Reader

Lens works in PDFs too, both in the browser and on your PC.

### PDFs in Chrome or Edge

PDFs you open in the browser open in the **Hoot Lens viewer** instead of the
browser's own viewer:

- **Page N of M**, **Pages / Reflow**, and zoom (**−** / **+**) in Pages view.
- **Pages** keeps the original layout; a rewrite is drawn over the original text.
- **Reflow** shows the PDF's text as one readable column, where changes work
  exactly like on a web page.
- **Open in the browser's viewer** hands this one PDF back to the browser.

**Local PDFs (`file://`)**: the first time, the viewer asks you to allow file
access. Click **Open extension details**, turn on **Allow access to file URLs**,
then open the PDF again. Or choose **Use the browser's viewer**.

The viewer detects a PDF's language, so Lens can translate passages in
languages you don't read.

### Hoot Reader (desktop)

Hoot Reader is a PDF window inside the app, with the same Lens marks, popover,
page pill and keyboard shortcuts as the browser.

Open a PDF:

- Tray → **Open in Hoot Reader…**
- **Drop a PDF on any Hoot window** (the owl, Studio or the Reader)
- In the Reader: **Open a PDF…** or `Ctrl+O`
- From the command line: `hoot path\to\file.pdf` (if Hoot is already running,
  it opens the file there)

In the Reader:

- **Pages / Text only** switches between the original layout and reflowed text.
- Zoom with the buttons or `Ctrl+=`, `Ctrl+-`, `Ctrl+0` (fit width).
- If Lens is off, a banner says so, with **Turn it on in Reading settings**.
- On local files the page pill offers **Pause for local files**.

Files up to 50 MB. Password-protected or damaged PDFs show an error.

---

## 10. Studio

Studio is Hoot's full window. Open it with `Ctrl+L` from the card, the
**Open in Studio** button, or tray → **Open Studio** / **Settings…**. Closing
Studio (or `Ctrl+L`) sends you back to the owl's card.

The sidebar holds **New chat**, **Search chats**, your chats, and at the bottom
**Settings** (`Ctrl+,`), **Reading (Hoot Lens)**, and a reminder of your summon
shortcut.

### Chat

The same chat as the card, with more room (see [§4](#4-chatting-with-hoot)).

### Settings

Every change saves at once.

| Group | Settings |
|---|---|
| **API key** | Paste a key and **Check and save**; **Remove key** (your chats stay) |
| **Model** | Haiku (fastest), Sonnet (balanced, default), Opus (smartest) |
| **Shortcuts** | **Summon Hoot**, **Circle anything**, **Lens on a selection**. Click a field and press the new keys; Hoot's own shortcuts pause while you record |
| **Behaviour** | **Launch at login** (starts hidden in the tray) · **Save chat history** · **Restore pinned notes** · **Suggest copied text** · **Shrink the pill to a dot after** (5 s / 10 s / 30 s / Never) · **Translate into** (for the Translate quick action) |
| **Data** | **Clear all chats…** (deletes every chat and capture; notes and settings stay) · **Reset position** (moves the owl back to its corner) |

### Reading

Studio → Reading holds every Hoot Lens setting:

- **Hoot Lens** on/off, the extension's connection status, the optional
  30-second setup, and **What Lens sends, and when**
- **How Lens helps**: Mode, **How often Hoot steps in**, **Medical, legal and
  money pages**, **When you copy changed text**
- **Languages**: your main language and the ones you read comfortably
- **Sites**: per-site rules
- **What Hoot remembers**: **Keep reading history for** 30, 90 (default) or 365
  days, plus links to the two pages below

### What Hoot knows about you

Everything Lens learned about you, all editable:

- **How Hoot describes you**: the short summary Hoot sends with each Lens request
- **How you like things explained**: **Shorter** or **About the same length**,
  **Plain words**, **Analogies**
- **Words**: add words you already know; set each word to **Known**, **Learning**
  or **New**; filter the list; **×** forgets a word (with Undo). Known words are
  never explained.
- **Topics**: how well you know each topic, from *New to me* to *Know it well*
- **Recent changes**: every change Lens made, with the original and Hoot's version
- **Your data**: **Export…** (profile, recent changes and glossary as JSON) and
  **Reset…** (forget everything Lens learned; your Reading settings stay)

Hoot learns from what you do: **I knew this** marks a word known, keeping a
change marks it as learning, and asking to **Explain more** tells Hoot to go deeper.

### My glossary

Every term Lens defined or expanded that you kept, with where you saw it.
Search it, **Pin as note**, or **I know this now** so Hoot stops explaining it.

---

## 11. VS Code extension

The Hoot Lens extension for VS Code brings Lens into the editor and lets Hoot
read the code you're looking at, as text, instead of screenshots.

### Install

```powershell
npm.cmd run install-local -w hoot-lens
```

Then run **Developer: Reload Window** in VS Code and start Hoot. The status bar
shows **Hoot** when connected and **Hoot: offline** otherwise; click it for all
Hoot commands.

### Lens in the editor

| Command | Keys | What |
|---|---|---|
| Hoot: Make this clearer | `Ctrl+Alt+H` | Rewrite the selection (or the word under the cursor) |
| Hoot: Explain in Hoot chat | `Ctrl+Alt+J` | Open the Hoot chat and explain the selection (code too) |
| Hoot: Restore all | | Remove every mark in the editor |
| Hoot: Reconnect to the Hoot app | | Connect now instead of waiting |

Both main commands are also in the editor's right-click menu. Lens never changes
your files: a change is a mark over the original (a tint, a dotted underline and
the rewrite in italics after it). Hover it for **Restore**, **I knew this**,
**Explain more in Hoot** and **Copy rewrite**. Editing the marked text removes
the mark.

**Automatic Lens**: in Markdown, plain text, LaTeX, reStructuredText and
AsciiDoc, keep a 1–40 word selection still for about a second and Hoot offers a
clearer version on its own (at most three times a minute per file). It follows
the app's Lens on/off and Ask first settings.

### Hoot reads your code

While Hoot runs, when you circle something over VS Code (or with it in front),
or chat with Hoot or an agent right after using VS Code, the message carries
the code you're looking at as text: the focused file with line numbers, your
selection, other visible editors and the problems VS Code reports.

- **Mistakes Hoot points out** are highlighted in amber, with Hoot's note at the
  end of the line and above it.
- **Changes Hoot proposes** are highlighted in blue; hover for the new code.
  Nothing changes until you click **Apply** (in the editor, the hover, under the
  answer in the card, Studio or an agent, or in the live overlay). VS Code first
  checks the lines are still what Hoot read, then applies the change as one edit
  that `Ctrl+Z` undoes. Files aren't saved for you.
- **Dismiss** removes one highlight; **Hoot: Clear highlights and proposed changes
  in code** removes them all.

### Settings

| Setting | Default | What |
|---|---|---|
| `hoot.lens.auto` | `true` | Automatic Lens on/off |
| `hoot.lens.autoLanguages` | Markdown, plain text, LaTeX, reStructuredText, AsciiDoc | Where automatic Lens runs |
| `hoot.code.enabled` | `true` | Let Hoot read code in this window (reload after changing) |
| `hoot.code.exclude` | `.env*`, `*.pem`, `*.key`, `*.pfx`, `*.p12`, `*.keystore`, `id_rsa*`, `secrets.*` | Files Hoot never reads, even on screen |

---

## 12. Tray menu

Right-click Hoot's tray icon:

| Item | What |
|---|---|
| **Show Hoot (Ctrl+Shift+Space)** | Summon the owl |
| **Circle something (Ctrl+Alt+Space)** | Start the screen overlay |
| **Hide pinned notes** / **Show pinned notes (N)** | Hide or show every sticky note |
| **Open Studio** | Open Studio on your chats |
| **Open in Hoot Reader…** | Pick a PDF to read with Lens |
| **Settings…** | Open Studio → Settings |
| **Quit** | Save everything and exit |

A left click shows or hides the owl. Closing every window doesn't quit Hoot; use
**Quit**.

---

## 13. Privacy and your data

**Stored only on your PC**, under `%APPDATA%\Hoot\hoot\`:

| What | Where |
|---|---|
| Settings | `settings.json` |
| Chats and captures | `sessions\`, `attachments\` |
| Sticky notes | `pins.json` |
| Lens profile, history, glossary, cache | `lens\` |
| Claude API key | `claude-key.bin`, encrypted with Windows DPAPI; it never leaves the app |

**Sent to Anthropic (Claude), with your key, only when:**

- You send a chat message: your text, any captures and copied items you included.
- You use the **live overlay**: each message also carries a fresh screenshot of
  your whole screen and any text Hoot read under your shape. When VS Code is in
  front, it carries your code as text instead (never files matching
  `hoot.code.exclude`).
- **Lens** helps with a selection: the selected text, its paragraph, the page
  title and headings, and a short summary of your reading profile. In Ask first
  mode, only after you click the chip; in Auto mode, also to check whether a
  selection needs help.
- You chat right after reading a web page, or ask from the toolbar popup: the
  page's address, title and text (on screen, selected, main text, headings), read
  at that moment. Never from private sites (see
  [§4](#hoot-reads-the-web-page-you-were-on)), never form fields.

**Voice**: what you say to Hoot on the desktop is recognized by Windows on your
PC; only the text is sent. The toolbar popup's mic uses the browser's speech
recognition, which sends your audio to the browser maker (Google for Chrome,
Microsoft for Edge) to turn it into text. Answers are read aloud by Windows,
on your PC.

**Never sent by Lens**: form fields, the rest of the page, cookies or full web
addresses (site rules keep only names like `example.com`). Lens skips the
deny-listed sites, password pages and private windows listed in [§8](#where-lens-never-acts).

Anthropic doesn't train its models on what Hoot sends with your API key, and
deletes it within 30 days (longer only if it's flagged under Anthropic's Usage
Policy). See [Anthropic's terms](https://www.anthropic.com/legal/commercial-terms).

**Deleting things**: Settings → Data → **Clear all chats…**; What Hoot knows about
you → **Reset…**; Settings → API key → **Remove key**; close a sticky note to
delete it.

---

## 14. Troubleshooting

| Problem | Fix |
|---|---|
| A shortcut does nothing | Another app owns it. Studio → Settings → Shortcuts shows the error on that row; record a different combination |
| "Add your Claude key…" / "Anthropic rejected your Claude key" | Studio → Settings → API key → paste a valid `sk-ant-…` key → **Check and save** |
| "Claude is busy" / rate limit reached | Wait a few seconds and **Try again** |
| The extension says *Hoot isn't running* | Start Hoot (`npm.cmd run dev` or the installed app), then **Try again** on the options page |
| The extension says *Hoot isn't installed* | Run `npm.cmd run register-host -w @hoot/bridge` (dev) or reinstall, then reload the extension |
| Studio says *Waiting for the browser extension* | Open Chrome or Edge with the extension loaded from `apps\extension\dist` |
| Studio says *Hoot Lens can't connect right now* | Another Hoot owns the connection. Quit Hoot from the tray (check Task Manager for a leftover one) and start it again |
| Nothing happens when I select text on a page | Lens is off (Studio → Reading), the site is paused (`Alt+H`) or set to Never, it's a skipped site or a private window, or you copied the selection |
| A local PDF doesn't open in the Lens viewer | Turn on **Allow access to file URLs** for Hoot Lens in `chrome://extensions` |
| "Hoot couldn't capture this screen" | Some apps block screen capture (DRM video, some password prompts). Try another area |
| "Up to 4 captures per message" | Send the message, or remove a capture |
| Lens anywhere says "Select some text first" | The app didn't expose the selection. Select again and press `Ctrl+Alt+L` while the app is focused |
| Windows blocks `hoot.exe` or the installer ("An Application Control policy has blocked this file") | That's Smart App Control blocking an unsigned build. Use `npm.cmd run dev` instead |
| Electron starts as plain Node / no window | Your shell exports `ELECTRON_RUN_AS_NODE=1`. Start through `npm.cmd run dev`, which strips it |
| The owl is off-screen | Studio → Settings → Data → **Reset position** |
| The key isn't remembered after a restart | Windows encryption wasn't available, so the key was kept for this session only. Set `ANTHROPIC_API_KEY` instead, or add it again |
| The mic says Windows speech isn't set up | Add a speech language in Windows: Settings → Time & language → Speech (English works best) |
| The mic says it can't hear a microphone | Connect one, and allow desktop apps to use it: Settings → Privacy & security → Microphone |
| Hoot mishears me | Speak close to the mic and pause briefly at the end; or press **Done talking** and fix it by typing next time |
| Hoot didn't read the page I was on | The browser must be the last app you were in (within two minutes), with the extension connected; private sites and sites set to Never aren't read; check **Let Hoot read the page you're on** on the extension's options page |
| The popup's mic asks for permission every time | Allow the microphone in the tab it opens; if you blocked it, click the icon at the right of that tab's address bar |

---

## 15. Advanced: environment variables

| Variable | Effect |
|---|---|
| `ANTHROPIC_API_KEY` | Used when no key is saved in the app |
| `HOOT_FAKE_AI=1` | Deterministic chat answers: no key, no network |
| `HOOT_FAKE_LENS=1` | Deterministic Lens rewrites |
| `HOOT_FAKE_VOICE=1` | A scripted voice chat: Hoot "hears" set phrases and says nothing aloud (offline demos, tests) |
| `HOOT_USER_DATA=<dir>` | Use another data folder (a fresh profile) |
| `HOOT_FAKE_CAPTURE=<png>` | Circle anything uses this image instead of the screen (offline demos) |
| `HOOT_NO_CAPTURE_EXCLUDE=1` | Keep the live overlay visible in screen recordings |
| `HOOT_DEV_BRIDGE=1` | Development only: a WebSocket bridge with a pairing code instead of native messaging (`HOOT_DEV_BRIDGE_PORT`, `HOOT_DEV_BRIDGE_CODE`) |
| `HOOT_BRIDGE_DIR=<dir>` | Where the bridge token and host manifest go (default `%LOCALAPPDATA%\Hoot\bridge`) |

`--hidden` starts Hoot in the tray without opening any window (that's what
**Launch at login** uses). For build, test and packaging commands, see
[`AGENTS.md`](../AGENTS.md) and the [README](../README.md).
