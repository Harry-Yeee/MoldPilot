# Feature 6 — Trial Date Confirmation Handshake

> Owner decision (2026-07-05): PM proposes a trial date → Injection confirms it (with a machine) or counter-proposes → a counter-proposal needs Marketing approval (they own the customer target date) → Marketing rejection returns it to the PM, who coordinates. Confirmation is a one-tap phone action. The workflow NEVER blocks reality: an unconfirmed trial can still happen and be recorded; auto-missed rules are unchanged.

## Context (read first)

Repo: MoldPilot — Next.js 16 App Router, TypeScript strict, Prisma 7 + PostgreSQL, Tailwind v4, pnpm. Domain logic (pure) in `src/domain/mold-trial/`, server actions in `src/server/`, tests in `tests/domain/` (node --test). Phone task list: pure membership rules in `src/domain/mold-trial/my-plate.ts`, queries in `src/server/my-plate.ts`, UI in `src/app/me/my-plate-sections.tsx` (BottomSheet forms, rendered on `/` mobile + `/me`). Permissions in `permission-policy.ts` + seed. ActivityLog on every mutation. Bilingual labels via `pickLabel`. Trial panels on the project detail page; `TrialEvent` already has `injectionMachineId` + machine snapshots and `plannedDate`; projects have `customerTargetDate`.

## Schema (migration required — hand-author SQL if DB unreachable, matching repo conventions)

On `TrialEvent`:
- `dateConfirmationStatus` enum `TrialDateConfirmationStatus`: `PENDING_CONFIRMATION` (default) | `CONFIRMED` | `RESCHEDULE_PROPOSED` | `RETURNED_TO_PM`
- `dateConfirmedById` / `dateConfirmedAt`
- `proposedDate` (date), `proposedById`, `proposedReason` (text)
- `rescheduleDecisionById` / `rescheduleDecisionAt` / `rescheduleRejectReason`
Backfill existing PLANNED/AT_RISK trials to PENDING_CONFIRMATION; completed/terminal trials to CONFIRMED (history shouldn't nag).

## State rules (pure, in a new `src/domain/mold-trial/date-confirmation.ts`, fully unit-tested)

- PM sets or edits a planned date (create trial, resolve auto-missed with new date, any reschedule by PM) → status resets to PENDING_CONFIRMATION, proposal fields cleared.
- Injection confirms → CONFIRMED; requires choosing an injection machine (machine + date confirmed together); stamps confirmedBy/At.
- Injection proposes a different date → RESCHEDULE_PROPOSED with proposedDate (≠ current), required reason.
- Marketing approves → plannedDate := proposedDate, status CONFIRMED, decision stamped; old date recorded in ActivityLog beforeJson. Auto-missed cutoff now keys off the new plannedDate automatically.
- Marketing rejects (required reason) → RETURNED_TO_PM; PM re-dates it → PENDING_CONFIRMATION again.
- Only trials in PLANNED / AT_RISK states participate; recording a result works regardless of confirmation status.

## Permissions (add + seed)

`trial.date.confirm` (INJECTION, ADMIN) · `trial.date.propose_change` (INJECTION, ADMIN) · `trial.date.approve_change` (MARKETING, ADMIN). PM re-dating uses existing scheduling permissions.

## Phone task list (three new sections, same patterns as existing ones)

- Injection — "Confirm trial dates": PLANNED/AT_RISK + PENDING_CONFIRMATION. Sheet: machine select (active machines) + Confirm button, plus a "Propose different date" secondary flow (date + reason).
- Marketing — "Approve date changes": RESCHEDULE_PROPOSED. The card MUST show: current planned date, proposed date, customer target date, and the day-gap between proposed and target (red if proposed > target). Approve / Reject (reason) buttons.
- PM — "Returned dates": RETURNED_TO_PM on my projects, showing the rejection reason; action = set new date (resets the loop).
Sections sort by the existing date comparator; section order after "Needs a reason".

## Desktop

Trial panel shows a confirmation badge per planned trial: "Date pending confirmation" (amber) / "Confirmed · Wang · machine 12" (green) / "Change awaiting Marketing" (amber) / "Returned to PM" (red), with the same actions available inline for permitted roles.

## Out of scope

Calendar view (next feature). Notifications. Hard-blocking trials on unconfirmed dates. Changing auto-missed logic.

## Acceptance

- tsc + full test suite pass; domain tests cover every transition incl. illegal ones (confirm without machine rejected; propose same date rejected; approve/reject only from RESCHEDULE_PROPOSED; PM re-date clears proposal fields).
- Walkthrough: bill plans a trial → wang sees it in "Confirm trial dates", proposes +3 days with reason → yvonne sees both dates + customer target gap, rejects with reason → bill sees it in "Returned dates", re-dates → wang confirms with machine → project page shows the green confirmed badge. Every step in ActivityLog.
