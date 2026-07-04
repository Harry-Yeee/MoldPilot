# MoldPilot Feature Prompts

One prompt = one Codex session = one branch. Do not mix features.

## Order (dependencies matter)

| # | Prompt | Depends on |
|---|--------|-----------|
| 0 | `00-ui-foundation.md` — shared components + design tokens | — |
| 1 | `01-file-attachments.md` — upload/storage/download infrastructure | 0 |
| 2 | `02-mobile-me-pwa.md` — mobile "My Plate" page + PWA | 0 |
| 3 | `03-trial-photos.md` — camera photo capture on issues | 1, 2 |
| 4 | `04-qc-measurement-report.md` — QC report upload, Marketing download | 1 |
| 5 | `05-daily-digest.md` — daily email digest | 2 (links to /me) |

Prompts 3 and 4 can run in parallel after 1 and 2 are merged.

## Review checklist before merging each feature

1. `pnpm typecheck` and `pnpm test` pass.
2. Open the feature on a real phone (375px width) — every action reachable with a thumb.
3. Log in as `viewer` and as a role that should NOT have the new permission — confirm the action is blocked, not just hidden.
4. Check ActivityLog entries were written for every new mutation.
5. Diff review: no changes outside the files the prompt scopes.

## Rules for every session

- Give Codex exactly one prompt file per session.
- Commit the previous feature before starting the next.
- If Codex proposes schema changes beyond what the prompt lists, stop and review manually.
