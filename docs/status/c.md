# Status: C (Claude Code)

Only C edits this file. Update it with every PR.

## Now

- **M0 foundation, PR #6** (`c/m0-foundation`): monorepo (C-01), core
  contracts (C-02), Gemini provider (C-03), ownership check (C-04), stable
  extension ID (C-05). Contains PR #1's commit (the Gemini switch).
- The CI workflow file is ready locally but **not pushed**: the pushing token
  lacks GitHub's `workflow` scope. It lands as one commit once the scope is
  granted.

## Next

- After PR #6 merges: tag `scaffold-ready` on `main`, then review and land
  d3's stack (#3 → #4 → #5) and d1's #2 against it.
- M1: C-10 Lens engine, C-11 guardrails, C-12 prompts + profile summary,
  C-13 fake protocol server, C-14 Lens IPC.

## Blocked on

- A human merge of PR #6 (merging is review-gated for C).
- `workflow` token scope for `.github/workflows/ci.yml`.

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

## Notes

- `legacy-v0` tag: the legacy app on Gemini, plus the plan.
- Dev extension ID `angnmpllmankipgoikeahfhidpcjninj`, from the manifest `key`.
- After M0, workspace packages that don't exist yet (`@hoot/ui`,
  `@hoot/lens-dom`, `@hoot/pdf-view`) are **not** listed in
  `apps/desktop/package.json`. Undeclared workspace names would make npm look
  them up on the public registry. Add them when the packages land.
- Live Gemini tests (`npm run test:live`) haven't run: no key on the C machine.
