# Hoot

**Hoot is your AI desktop buddy** — a little owl that lives in your Windows tray
and floats on screen. Summon it, circle anything on your screen, and ask Gemini
about it. It starts as a small dot, grows into a pill, then a chat card, and
unlocks into a full Studio workspace — one buddy, four sizes, shared state.

## Setup

```powershell
npm.cmd install
npm.cmd run dev
```

First run opens onboarding in Studio: add your Google Gemini API key there (or
later in Settings → API key). Get a key at https://aistudio.google.com/apikey.
Development fallback: the `GEMINI_API_KEY` environment variable.

## Hotkeys

| Hotkey            | Action                                                    |
| ----------------- | --------------------------------------------------------- |
| `Ctrl+Shift+Space` | Summon Hoot / hide it (locks Studio back to the card)    |
| `Ctrl+Alt+Space`   | Circle something — lasso / rectangle / full screen capture |
| `Ctrl+L`           | Card ↔ Studio                                             |
| `Ctrl+N`           | New chat                                                  |
| `Esc`              | Card → pill → hidden; cancels a capture                   |

Both global hotkeys are re-recordable in Settings.

## Features

- **Dot → Pill → Card → Studio.** The owl idles to a dot, grows on hover, opens
  a chat card on click, and unlocks into Studio (sessions sidebar, settings,
  onboarding). Drag it anywhere; it flicks, snaps to edges, and remembers.
- **Circle anything.** A desktop overlay dims the screen; lasso or drag a
  rectangle (Shift forces rect, F = full screen) — the crop is attached to your
  message. Up to 4 captures per message, with Explain / Extract text /
  Translate / Summarize / Fix-this quick actions.
- **Clipboard chip.** If you copied new text or an image since the last summon,
  a chip offers to include it — it never sends by itself.
- **Sticky pins.** Pin any answer to the desktop as a floating note; notes
  restore on launch (toggle in Settings or the tray).
- **Streaming Gemini** answers with Markdown, code copy, stop and regenerate.
  Models: Flash-Lite (fastest), Flash (default), Argon (smartest; paid tier only).
- **History.** Chats persist locally, grouped Today / Yesterday / Previous 7
  days / Older in the Studio sidebar, with rename and 5-second undo delete.

## Build the installer

```powershell
npm.cmd run build:win
```

Produces an NSIS installer under `dist/` (and an unpacked build in
`dist/win-unpacked`).

## Privacy

Chat history, captures, pins, and settings are stored **locally** under
`%APPDATA%\hoot`. Your API key is encrypted at rest with Windows DPAPI via
Electron `safeStorage`. Text and images are sent to Google's Gemini API **only** when you
send a message — captures and clipboard content are attached explicitly by you,
never silently.

## Dev note

If your IDE exports `ELECTRON_RUN_AS_NODE=1` (Windsurf/Devin hosts do),
`electron.exe` would run in plain Node mode. `npm.cmd run dev` and
`npm.cmd run start` go through `scripts/run-electron.mjs`, which strips it for
the child process. `npm.cmd run e2e` handles it too.
