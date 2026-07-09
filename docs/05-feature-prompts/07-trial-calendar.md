# Feature 7 — Trial Calendar (month view + machine load)

> Owner decision (2026-07-05): a monthly calendar of planned trials for planning — Injection uses it to balance machine load per day (soft warning when one machine has ≥3 trials on a day, red at 4+, never a hard block); the whole team uses it to see what's coming. Desktop gets the month grid; PHONES GET AN AGENDA LIST (today + next 7 days), never a month grid. No drag-and-drop.

## Context (read first)

Repo: MoldPilot — Next.js 16 App Router, TypeScript strict, Prisma 7 + PostgreSQL, Tailwind v4, pnpm. Depends on Feature 6 (date confirmation) being merged: `TrialEvent.dateConfirmationStatus`, machine confirmed with date. Shared UI in `src/components/ui/`; status colors in `status-colors.ts`; bilingual labels via `pickLabel`; permissions via existing view permissions (calendar is read-mostly; any user who can see the dashboard can see the calendar).

## Requirements

1. **Route `/calendar`** (desktop-first, server component, force-dynamic):
   - Month grid Mon–Sun; prev / today / next controls (`?month=YYYY-MM` param, no client state lib).
   - Each day cell: trial count chip + up to 3 compact trial entries (project code · trial code), "+N more" beyond that; machine-overload indicator per day (amber dot ≥3 trials on the SAME machine, red dot ≥4) with a legend under the grid.
   - Clicking a day selects it (server round-trip via `?day=` is fine) and renders a detail panel BELOW the grid: that day's trials — project code, mold code, customer short name, trial code, machine, confirmation status badge, planned-vs-target hint. Each row links to the project page (desktop context, allowed).
   - Confirmation status colors the entry: confirmed=green tone, pending=amber, reschedule-proposed=violet, returned=red — reuse the status-colors map.
2. **Pure domain logic** in `src/domain/mold-trial/calendar.ts` (+ tests): month-matrix builder (weeks array for a YYYY-MM, Monday start), per-day grouping, per-day-per-machine load counter returning warning levels (none | amber ≥3 | red ≥4 on any single machine; trials without a machine count toward a "no machine yet" bucket that never warns).
3. **Phone**: on the mobile dashboard (`/` below the task sections) add a compact "This week's trials" agenda — today + next 7 days, ALL projects (not just mine), read-only rows (date, project, trial code, machine, confirmation badge), grouped by day, empty days skipped. `/calendar` on a phone viewport renders this same agenda instead of the grid.
4. **Reschedule from the calendar**: for users holding `trial.date.propose_change` (Injection), each detail-panel row gets a "Propose new date" action reusing Feature 6's flow verbatim (no bypass of Marketing approval). PMs get their normal re-date action. No drag-and-drop.
5. **Navigation**: desktop header gains a "Calendar / 日历" link next to My tasks; phone dashboard's agenda section title links to /calendar.

## Out of scope

Drag-and-drop rescheduling. Week/day zoom views. iCal export. Machine capacity configuration UI (the 3/4 thresholds are constants in the domain module). Editing anything other than the Feature-6 reschedule flow.

## Acceptance

- tsc + full suite pass; domain tests: month matrix edges (Feb, months starting Sunday, year rollover), machine-load warning levels, no-machine bucket never warns.
- Walkthrough: seed data shows trials on the grid with correct counts; a day with 3 trials on one machine shows amber, 4 shows red; clicking a day lists its trials with confirmation badges; wang proposes a new date from the panel and it lands in Marketing's approval queue; phone shows the 7-day agenda under the task sections.
