# MoldPilot Feature Prompts

One prompt = one Codex session = one branch. Do not mix features.

## Order (dependencies matter)

| # | Prompt | Depends on | Status |
|---|--------|-----------|--------|
| 0 | `00-ui-foundation.md` — shared components + design tokens | — | Done |
| 1 | `01-file-attachments.md` — upload/storage/download infrastructure | 0 | Done (+ lightbox, CAD/video/ppt/zip types, video Range streaming, 320mb action bodies) |
| 2 | `02-mobile-me-pwa.md` — mobile task list + PWA | 0 | Done (tasks inline on `/` mobile; department inbox with claim flow added) |
| 3 | `03-trial-photos.md` — photos on issues (desktop forms) | 1 | Done (client-side downscale, count chips, shared lightbox galleries) |
| 4 | `04-qc-measurement-report.md` — QC report upload, Marketing download | 1 | Done (report state per trial, Customer files section, dashboard missing-report count) |
| 6 | `06-trial-date-confirmation.md` — PM→Injection→Marketing date handshake | 2 | Done (state machine, 3 phone sections, trial panel badges) |
| 7 | `07-trial-calendar.md` — month view + machine load + phone agenda | 6 | Done (/calendar grid, amber/red machine load, 7-day phone agenda) |
| — | KPI phase-1 data layer (no prompt file; specced by `docs/06-kpi/`) | 6, 7 | Done (rule registry Rules tab, scoring engine, admin Scores tab, flag-gated /score, simulator + snapshot scripts) |
| 8 | Design role onboarding (prompt not yet written) | — | Done 2026-07-08 (DESIGN role + group + users, design inbox, "Design: revisions" section, two design KPI rules activated) |
| 9 | `09-management-reports.md` — Admin/GM monthly Overview, Issues, reused Scorecards | KPI data layer + 8 | Done 2026-07-14 |
| 10 | Lessons library (`docs/06-kpi/lessons-library-design.md`) | 9 + monthly meeting ritual | Design locked, build in phase 2 |
| 5 | `05-daily-digest.md` — daily email digest | 2 | Pilot week (needs SMTP) |

All original roadmap prompts (0–7), prompt 8 (Design role onboarding), and prompt 9 (Management Reports) are built. Remaining roadmap: 10 Lessons library in phase 2, with digest during pilot week.

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
