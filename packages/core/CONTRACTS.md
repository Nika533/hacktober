# @hoot/core contracts

Everything two builders both touch is defined here. If you need something
that isn't, open a `contract: …` PR (additive; C reviews it first).

## Entry points

| Import               | Contains                                                                                                                                                                                                                                                                        | zod? |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- |
| `@hoot/core`         | Types, `CHAT_MODELS` / `LENS_MODELS`, chat helpers (`buildMessages`, `titleFrom`, prompts, `groupSessions`), utils (geometry, accelerator, clipboard), lens helpers (`TRANSFORM_RULES`, `lensCacheKey`), IPC routes + `createHootApi`, framing, `LensBackend`, bridge constants | no   |
| `@hoot/core/schemas` | zod schemas for every boundary; `migrateSettings`, `applySettingsPatch`, `migrateMessageError`; bridge message schemas; `INVOKE_ARGS` / `SEND_ARGS` + `parseInvokeArgs` / `parseSendArgs`                                                                                       | yes  |
| `@hoot/core/testing` | `createFakeLensBackend`, `fakeRewrite`, `fakeAssess`, `FAKE_PROFILE_SNAPSHOT`                                                                                                                                                                                                   | yes  |

## Map

| Contract | File | Notes |
|---|---|---|
| Settings v2 | `src/types/settings.ts`, `src/schemas/settings.ts` | `migrateSettings` reads any version and salvages valid fields one by one. `SettingsPatch` is what renderers may change: `pillAnchor`, `studioBounds`, `onboardingDone` and `schemaVersion` are main-only |
| Chat | `src/types/chat.ts`, `src/schemas/chat.ts` | `Attachment` has no path: main derives `attachments/<id>.png`. Ids match `IdSchema` (no dots or slashes). Errors are `AiErrorCode`; `migrateMessageError` maps legacy `'401'`, `'429'`, `'529'`, `'no-key'` |
| App vocabulary | `src/types/app.ts` | Modes, moods, capture, pins (`sessionId`/`messageId` are null for glossary pins) |
| State slices | `src/types/state.ts` | `settings`, `system`, `buddy`, `studio`, `chat`, `sessions`, `pins`, `lens`; `DEFAULT_SUBSCRIPTIONS` per window |
| `window.hoot` | `src/ipc/api.ts` (`HootApi`), `src/ipc/routes.ts`, `src/ipc/schemas.ts` | Preload is `createHootApi(transport)`. Main validates with `parseInvokeArgs(channel, args)`. Handler types: `ApiFn<C>`, `InvokeResult<C>`, `EventPayload<C>` |
| Lens types | `src/types/lens.ts`, `src/schemas/lens.ts` | `LensContext` is everything that leaves the page (limits in `LENS_LIMITS`). Model output schemas for §7.3 are `AssessModelOutputSchema` and `RewriteModelOutputSchema` |
| Lens backend | `src/protocol/backend.ts` | What lens-dom needs. Implemented by the extension (SW → bridge), the Reader (IPC) and the fake. Methods reject with `LensBackendError(code)` |
| Bridge protocol | `src/protocol/bridge.ts`, `framing.ts`, `constants.ts` | 4-byte LE length + UTF-8 JSON, 1 MB cap. Exactly one reply per `reqId`. `cancel` names the request to cancel. The first pipe frame from hoot-bridge is `bridge.auth`. Dev extension id `DEV_EXTENSION_ID`; pipe path `bridgePipePath()` |
| Models | `src/models.ts` | Chat: Flash-Lite, Flash (default), Argon (paid). Lens: assess and rewriteFast on Flash-Lite, rewriteStrong on Flash for long simplify/unpack |

## Fake Lens rules (for tests)

`createFakeLensBackend()` / `HOOT_FAKE_LENS=1`:

- A span containing `SKIP` is skipped; `ERROR` fails with code `busy`.
- An all-caps 2–6 letter span is expanded; one word is defined; a foreign-language span (`signals.foreignLanguage`) is translated; anything else is simplified.
- High risk, or a span over 40 words, renders as a gloss.
- `createFakeLensBackend({ delayMs })` honours `AbortSignal` (rewrite resolves `skipped: cancelled`). `.events` and `.explained` record calls.

## State subscription ordering (d1 implements, renderers rely on it)

- Main answers `state:subscribe` with a snapshot of the requested slices and **registers the window for those slices in the same tick, after taking the snapshot**. The invoke reply is then sent before any `state:patch` for those slices. Electron delivers a window's IPC in send order, so the renderer never sees a patch older than its snapshot.
- A delta is broadcast before any snapshot or patch that contains it (`mutate → chat:delta → patch`). Renderers ignore deltas until they hold a snapshot, because the snapshot already includes earlier ones.
- Each patch replaces whole slices. Renderers keep only the slices they subscribed to.
