# Status: C (Claude Code)

Only C edits this file. Update it with every PR.

## Now

- M0 foundation PR: monorepo (C-01), core contracts (C-02), Gemini provider (C-03),
  CI + ownership check (C-04), stable extension ID (C-05).

## Next

- C-10 Lens engine, C-11 guardrails, C-12 prompts + profile summary,
  C-13 fake protocol server, C-14 Lens IPC.

## Blocked on

- Merging PR #1 (Gemini switch) and the M0 PR needs a human review/merge.

## Requests

-

## Notes

- `scaffold-ready` tag goes on `main` right after the M0 PR merges; d1–d3 start
  their M1 tasks from it. Until then: D1-00, D2-00, D3-00.
- Extension dev ID: `angnmpllmankipgoikeahfhidpcjninj` (from the manifest `key`).
- Live Gemini tests (`npm run test:live`) have not run yet: no key on the C machine.
