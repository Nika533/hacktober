# Hoot Lens: store listing notes

What the Chrome Web Store and Edge Add-ons reviews ask for, kept next to the code so it
stays true. The package comes from `npm.cmd run zip -w @hoot/extension`
(`apps/extension/release/hoot-lens-<version>.zip`).

## Single purpose

Hoot Lens helps people read: when you select text you don't understand, it rewrites or
annotates that text in place, using the Hoot desktop app on the same computer. Every
change is marked and can be undone.

## Permissions

| Permission | Why |
|---|---|
| `host_permissions: <all_urls>` | The content script must run on the pages people read, to see a selection and show the rewrite in place. It also lets the PDF viewer load a PDF from the site that served it. |
| `nativeMessaging` | The extension has no model and no API key. It talks to the Hoot desktop app through its native messaging host (`com.hoot.lens`), which the Hoot installer registers. |
| `storage` | Lens settings (on/off, mode, per-site rules), the connection back-off, and a random per-install salt for hashed page addresses. |
| `webRequest` | Observes top-level responses (no blocking) to notice PDFs and open them in the Lens viewer. |
| `webNavigation` | Notices local `file://` PDFs, which `webRequest` doesn't see, to open them in the viewer. |
| `scripting` | Not used by the current code. Request: remove it from the manifest before submission. |

## Data

- **Sent to the Hoot app on this computer, only when Lens helps** (automatically above its
  threshold, or when you click "Make this clearer?"): the selected text, its paragraph
  (up to 1,500 characters), the page title and up to three headings, the page language,
  the site's registrable domain, and the selection signals Lens scored. The app sends the
  text on to Google Gemini with the user's own API key.
- **Never sent:** form fields, other page content, cookies, full URLs. Pages with a
  password field, deny-listed hosts (banking, email, chat, password managers, health
  portals) and private windows are skipped.
- **Kept in the browser:** Lens settings, which the app owns and the extension caches;
  the reader-profile snapshot, for the browser session only; and the salt. Nothing is
  sent to Hoot's makers.
- Lens is off until the user turns it on in Hoot Studio, which explains all of the above.

## Listing

- **Name:** Hoot Lens
- **Short description:** Select text you don't understand: Hoot rewrites it in place,
  marks the change, and undoes it with one click.
- **Icons:** `static/icons/icon-{16,32,48,128}.png` (regenerate with
  `node scripts/icons.ts`). Request: add them to the manifest's `icons` and
  `action.default_icon`.
- **Screenshots:** `screenshots/` (options page, Lens UI, PDF viewer; light and dark).
