# Feature 2 — Mobile "My Plate" page (/me) + PWA

## Context (read first)

Repo: MoldPilot — internal mold trial tracker. Next.js 16 App Router, TypeScript strict, Prisma 7 + PostgreSQL, Tailwind v4. Path alias `@/`. Pure domain logic in `src/domain/mold-trial/`, server actions in `src/server/`, tests in `tests/domain/` (node --test). Auth: cookie session, `getCurrentUser()` in `src/server/current-user.ts`. Permissions via `getEffectivePermissionCodes`. Shared UI in `src/components/ui/` (Button, Card, StatusBadge, BottomSheet, FormField — see its README). Bilingual labels via `pickLabel` in `src/domain/mold-trial/labels.ts` and `user.locale`.

Existing server actions in `src/server/mold-trial-actions.ts` already implement: resolving auto-missed trials (with reason category from `MissedTrialReasonCategory`), updating issue status/closing issues, assembly acknowledgement (ack + estimated finish date), assembly self-check, PM readiness confirmation, recording trial results. **Reuse these actions — do not duplicate their logic.** If an action needs a redirect-target parameter to return to /me instead of the project page, refactor it minimally to accept one.

## Goal

A phone-first `/me` page: everything waiting on the logged-in user, actionable in a few taps, installable to the home screen (PWA).

**Philosophy — read this before designing anything**: `/me` IS the phone app. On a phone, a user should never need the dashboard, project pages, or any other part of the system. The page is a personal, role-scoped todo list: what's on my plate, tap to complete, fill in the minimum required fields, done. The full system stays a desktop tool. Do not build phone navigation into the rest of the system; do not make /me feel like a portal into it.

## Requirements

1. **Route `src/app/me/page.tsx`** (server component, `force-dynamic`), sections in this order, each with a count badge and collapsed when empty:
   - **Needs a reason** — trials with status `AUTO_MISSED_REASON_REQUIRED` on projects where I am planningPm or technicalPm. Action: resolve (reason category select + explanation + optional new planned date) via existing action, in a BottomSheet.
   - **My open issues** — TrialIssue where ownerUserId = me and status not in (VERIFIED, CLOSED). Primary action: "Done" — a BottomSheet that collects fix summary + time spent in minutes (`fixTimeMinutes`, already in the schema) and closes the issue via the existing close action. Secondary action: update status only. Time spent should be quick to enter: preset chips (15 / 30 / 60 / 120 min) plus a free number field.
   - **Assembly: acknowledge** — if my department group is assembly: issues awaiting `assemblyAcknowledgedAt` that I can acknowledge. Action: acknowledge + estimated finish date.
   - **Assembly: self-check** — same, for pending self-check before next trial.
   - **PM: confirm ready** — if I'm a PM: issues awaiting `pmReadyConfirmedAt`.
   - **Coming up** — trials with plannedDate within next 7 days on my projects (read-only list: project code, customer, trial code, date).
   - All-empty state: friendly "You're all caught up" EmptyState.
2. **Row design**: project code + customer short name, item title, StatusBadge, severity where relevant, due/planned date (highlight red when overdue), one primary action button (≥44px). Tapping the row expands it inline (accordion) to show details — description, dates, part/cavity — with the action button repeated inside. Do NOT navigate to the project detail page from a row; at most, the expanded view may include a small "Open full project (desktop)" text link at the bottom.
3. **Queries** in `src/server/my-plate.ts`; keep "which items belong to this user" decisions as pure functions in `src/domain/mold-trial/my-plate.ts` with unit tests (input: user id/role/department + plain item records; output: section membership).
4. **PWA (no service worker)**:
   - `src/app/manifest.ts` (name MoldPilot, standalone display, theme color from design tokens, start_url `/me`), app icons 192/512 + apple-touch-icon (generate a simple monogram icon), correct viewport meta in `src/app/layout.tsx`.
   - Deliberately no offline caching — stale factory data is worse than an error page.
5. **Navigation**: header link "My tasks / 我的任务" (bilingual via pickLabel) visible on all pages. On viewport < md, the dashboard shows a prominent banner at the top: "On your phone? Your tasks are here →" linking to /me — the dashboard is not the phone experience, steer people out of it.
6. **Auto-missed freshness**: opening /me must reflect reality — run the auto-missed sweep the same way the dashboard does (see `src/server/auto-missed-trials.ts`; if a global throttled sweep exists from a prior fix, call it).
7. **Docs**: add a "Phone access" section to README.md — run with `next start` on a fixed LAN IP, `MOLDPILOT_BASE_URL` env, how staff add to home screen (iOS Safari / Android Chrome).

## UI quality bar

- Design for 375px first; desktop just centers the column (max-w-lg).
- Thumb reach: primary actions bottom-right of each card; BottomSheet submit button full-width at the bottom.
- Every form: big inputs, native date picker, one screen, no scrolling inside the sheet if avoidable.
- Show the result immediately after an action (revalidate + success banner), returning to /me, not the project page.
- Completing an item should feel like checking off a todo: the item leaves the list, the section count drops, a brief success banner confirms it. The user's mental model is a checklist, not a database.

## Out of scope

- Photo capture (feature 3), push notifications, offline mode, native app, desktop dashboard changes beyond the nav link.

## Acceptance

- `pnpm typecheck && pnpm test` pass; domain tests for section-membership logic.
- Walkthrough on a phone-sized viewport: as PM resolve an auto-missed trial from /me end-to-end; as Assembly acknowledge an issue with a finish date; both write ActivityLog entries and land back on /me with a success banner.
- Lighthouse "installable" check passes; app opens standalone from home screen to /me (login redirect works).
