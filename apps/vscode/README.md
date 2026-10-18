# Hoot Lens for VS Code

Select text you don't understand and Hoot shows a clearer version right where it is,
or explains it in the Hoot chat. The Hoot desktop app does the work: it holds your
Claude key, the Lens engine and what Hoot knows about you. This extension only talks
to it, over the same local pipe the browser extension uses (`\\.\pipe\hoot-lens-<user>`,
authenticated with the per-launch token in `%LOCALAPPDATA%\Hoot\bridge\token`).

Your files are never changed. A Lens change is a mark over the original text: a tint,
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

## Install from the repo

```
npm.cmd run install-local -w hoot-lens
```

This builds `dist/extension.js`, copies the extension to
`%USERPROFILE%\.vscode\extensions\hoot.hoot-lens-0.1.0` and registers it. Then run
**Developer: Reload Window** in VS Code. Start Hoot; the status bar shows
**Hoot** when connected and **Hoot: offline** otherwise.
