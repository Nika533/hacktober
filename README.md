# Hoot

**Hoot is an AI desktop buddy for Windows**: a little owl in your tray that
floats on screen. Summon it, circle anything on your screen, and ask Gemini
about it. It grows from a dot to a pill, a chat card and a full Studio.

**Hoot Lens** is Hoot's reading aid. Select text you don't understand on a web
page or in a PDF, and Hoot rewrites it in place so you can understand it. It
marks every change, undoes it with one click, and learns from what you keep.

> The repo is mid-rebuild. The design is in [`docs/hoot-lens.md`](docs/hoot-lens.md),
> the team plan in [`docs/rebuild-plan.md`](docs/rebuild-plan.md), and the rules
> for contributors in [`AGENTS.md`](AGENTS.md). The pre-rebuild app is tagged
> `legacy-v0`.

## Quick start (Windows, Node 24)

```powershell
npm.cmd install
npm.cmd run dev
```

Add a Google Gemini API key in Studio (get one at
https://aistudio.google.com/apikey), or set `GEMINI_API_KEY` for development.
To run without a key, set `HOOT_FAKE_AI=1` and `HOOT_FAKE_LENS=1`.

The browser extension builds into `apps/extension/dist`
(`npm.cmd run build -w @hoot/extension`). Load it unpacked from
`chrome://extensions` with Developer mode on.

## Repository

| Path | What |
|---|---|
| `apps/desktop` | The Electron app |
| `apps/extension` | The Hoot Lens browser extension (Chrome, Edge) |
| `packages/core` | Shared contracts and pure logic ([CONTRACTS.md](packages/core/CONTRACTS.md)) |
| `packages/ui` | Design system and shared chat UI |
| `packages/lens-dom` | In-page Lens: selection, rendering, marks |
| `packages/pdf-view` | PDF view used by the extension and the Reader |
| `packages/bridge` | hoot-bridge, the native messaging host linking the extension to the app |

## Privacy

Chats, captures, pins, settings and the Lens reading profile are stored
**locally** under `%APPDATA%\hoot`. The Gemini API key is encrypted at rest
with Windows DPAPI (Electron `safeStorage`) and never leaves the app. Text
and images go to Google's Gemini API **only** when you send a message, or,
with Lens turned on, when Lens rewrites a selection. Lens sends only the
selected text, its paragraph, the page title and headings.
