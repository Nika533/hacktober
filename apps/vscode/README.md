# Hoot Lens for VS Code

Select text you don't understand and Hoot shows a clearer version right where it is,
or explains it in the Hoot chat. The Hoot desktop app does the work: it holds your
Claude key, the Lens engine and what Hoot knows about you. This extension only talks
to it, over the same local pipe the browser extension uses (`\\.\pipe\hoot-lens-<user>`,
authenticated with the per-launch token in `%LOCALAPPDATA%\Hoot\bridge\token`).

Lens never changes your files. A Lens change is a mark over the original text: a tint,
a dotted underline and the rewrite in italics after it. Hover it for the full rewrite,
the original and **Restore**, **I knew this**, **Explain more in Hoot** and
**Copy rewrite**. Editing the marked text drops the mark. Every reaction teaches Hoot.

## Commands

| Command | Keys | What |
| --- | --- | --- |
| Hoot: Make this clearer | `Ctrl+Alt+H` | Rewrite the selection (or the word under the cursor) |
| Hoot: Explain in Hoot chat | `Ctrl+Alt+J` | Open the Hoot chat and explain the selection (code too) |
| Hoot: Restore all | | Remove every mark in the editor |
| Hoot: Reconnect to the Hoot app | | Connect now instead of waiting for the next retry |

Both main commands are in the editor's context menu, and the **Hoot** status bar item
opens all of them.

## Automatic Lens

In Markdown, plain text, LaTeX, reStructuredText and AsciiDoc, keep a selection of 1 to
40 words still for about a second and Hoot offers a clearer version on its own, at most
three times a minute per file. It follows the app: nothing happens on its own while Lens
is off or in Ask first mode in Hoot settings, and terms Hoot knows you know are skipped.

| Setting | Default |
| --- | --- |
| `hoot.lens.auto` | `true` |
| `hoot.lens.autoLanguages` | `["markdown", "plaintext", "latex", "restructuredtext", "asciidoc"]` |

## Hoot reads your code (no screenshots)

While Hoot runs, each VS Code window connects to it over a second local pipe
(`\\.\pipe\hoot-code-<user>`, token in `%LOCALAPPDATA%\Hoot\bridge\code-token`).
When you circle something with VS Code in front, or chat with Hoot right after using
VS Code, every message carries the code you're looking at as text: the focused file
with line numbers (all of it when it fits, else a window around what's on screen),
your selection, the other editors on screen and the problems VS Code reports. Hoot
never grabs a picture of the editor for that, and later messages in the same chat
only send what changed.

- **Pointing out mistakes:** Hoot highlights the lines in amber, with its note at the
  end of the line and in a CodeLens above. The live overlay lists them; **Show** scrolls
  VS Code to the spot.
- **Changing, fixing or removing code:** Hoot proposes each change, highlighted in
  blue. Hover it for the new code. Nothing changes until you click **Apply** (in the
  CodeLens, the hover or the overlay). VS Code then checks that the lines are still
  what Hoot read (or finds them once elsewhere) and applies the change as one edit
  that **Ctrl+Z** undoes. If the code changed in the meantime, it refuses and asks you
  to ask again. Files are not saved for you.
- **Dismiss** removes one highlight; **Hoot: Clear highlights and proposed changes in
  code** removes them all. Editing a highlighted line drops its highlight.

| Setting | Default |
| --- | --- |
| `hoot.code.enabled` | `true` (reload the window after changing it) |
| `hoot.code.exclude` | `.env*`, `*.pem`, `*.key`, `*.pfx`, `*.p12`, `*.keystore`, `id_rsa*`, `secrets.*`: never read, even on screen |

## Install from the repo

```
npm.cmd run install-local -w hoot-lens
```

This builds `dist/extension.js`, copies the extension to
`%USERPROFILE%\.vscode\extensions\hoot.hoot-lens-0.1.0` and registers it. Then run
**Developer: Reload Window** in VS Code. Start Hoot; the status bar shows
**Hoot** when connected and **Hoot: offline** otherwise.
