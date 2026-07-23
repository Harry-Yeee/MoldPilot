# Feature 09: Management Reports

Build the next MoldPilot Phase 1 support milestone: a bilingual, read-only `/reports` management surface for Admin and GM. It must combine operational monthly reporting with the existing KPI scorecards without duplicating score logic or turning issue/workload counts into personal blame.

## Read Before Coding

- `docs/00-product/decision-log.md` - especially the 2026-07-14 Reports decision and KPI owner-is-fixer rule
- `docs/00-product/mvp-definition.md`
- `docs/01-domain/workflow-stages.md`
- `docs/02-schema/schema-v0.md` - Management Reports metric contract
- `docs/02-schema/permissions-matrix.md`
- `docs/03-ui/phase-1-screen-specs.md` - Screen 11
- `docs/03-build/acceptance-tests.md` - AT-020A through AT-020D
- `docs/03-build/pilot-acceptance-checklist.md`
- `docs/03-build/development.md` - including the generated Prisma client rule
- `docs/06-kpi/kpi-system-design.md`

Inspect the current implementation before editing:

- `src/app/page.tsx`
- `src/app/score/page.tsx`
- `src/app/admin/page.tsx`
- `src/app/admin/kpi-scores-panel.tsx`
- `src/server/kpi-scores.ts`
- `src/server/kpi-events.ts`
- `src/domain/mold-trial/permission-policy.ts`
- `src/i18n/locales/en.ts`
- `src/i18n/locales/zh-CN.ts`
- `prisma/schema.prisma`
- `prisma/seed.ts`

## Scope And Guardrails

This is a Phase 1 management read model, not a full BI system.

- Add `/reports` with `Overview`, `Issues`, and `Scorecards` tabs.
- Keep `/score` as the personal scored-staff page.
- Reuse existing score calculation and scorecard components/services.
- Do not add a generic Report table, duplicate report rows, or a second KPI engine.
- No Prisma schema change or migration is expected. Use existing records and KpiSnapshot.
- Never edit `node_modules` or the generated Prisma client.
- Do not add a charting dependency for this milestone. Use accessible compact metrics, tables, and simple CSS bars only where they improve scanning.
- Reports are read-only. Link to source records for action; do not add workflow mutation forms to Reports.
- Keep unrelated Admin, dashboard, trial, issue, process-sheet, and scoring behavior intact.

## 1. Permission And Navigation

Add named permission `reports.management.view` to `permissionDefinitions` under process group `Reports`.

Defaults:

- Admin: granted through the existing all-permissions default.
- GM: granted explicitly.
- PM, Marketing, Assembly, Injection, QC, Design, Viewer: not granted by default.

Seed/upsert the permission and default RolePermission assignments idempotently. Do not hardcode route access by role name.

Enforce access server-side:

- `/reports`, Overview data, and Issues data require `reports.management.view`.
- Scorecards data additionally requires `kpi.scores.view_all`.
- Do not load/serialize individual score data when the second permission is missing.
- UI hiding alone is insufficient.

Dashboard navigation:

- Admin/GM with report permission see `Reports` linking to `/reports`.
- Non-scored Admin/GM do not see a manager-facing `My Score` button.
- Scored staff retain `My Score` when `scoreboard_enabled` is true.
- A scored user exceptionally granted report permission may see both links.
- Keep `Admin`, `Calendar`, `My Tasks`, account, language, and logout behavior intact.
- Add bilingual labels for Reports and all report UI through the existing i18n source.

## 2. Report Query Architecture

Create a focused server-side report query/service and pure metric helpers. Keep date-range/math logic testable without Prisma.

- Accept a validated `YYYY-MM` selected month, default current month.
- Build selected and previous half-open calendar-month ranges in `Asia/Shanghai`.
- Include a report `asOf` timestamp.
- Use batched Prisma queries and in-memory aggregation where appropriate; avoid per-row N+1 queries.
- Return explicit numerator/denominator/count fields rather than preformatted strings.
- Handle empty data, missing optional fields, zero previous-month values, and database errors without NaN/Infinity or page crashes.
- For current-state measures, label them `Current` rather than pretending they are historical month-end snapshots.

Locked definitions:

1. **Completed trial runs**: TrialEvent `status = COMPLETED`, non-null actualDate inside the selected month. Do not require `countsAgainstLimit = true`; a completed Invalid Trial still consumed trial workload. Exclude planned, missed/delayed, cancelled, and skipped records.
2. **New molds reaching T0**: projects whose first actual completed TrialEvent is T0 and falls in the selected month. Count each project once.
3. **Unique molds trialed**: distinct project ids among selected-month completed trial runs.
4. **Previous-month comparison**: selected absolute value plus absolute delta and percent where meaningful. If previous is zero, render a clear `No prior baseline` state instead of Infinity/NaN.
5. **On-time trial rate**: denominator is non-Cancelled/non-Skipped stages with plannedDate in the selected month and due on/before asOf. Numerator is denominator trials completed with actualDate on/before plannedDate. Due delayed/missed trials remain denominator misses. Always display `numerator / denominator`.
6. **Approval date**: earliest actualDate of a Completed TrialEvent whose result is Approved.
7. **Approved on/before target**: approval date in selected month and on/before customerTargetDate. Show `n / eligible`; approved projects without a target are excluded from eligibility and shown as a separate missing-target count.
8. **Low-loop approval**: first approval in the selected month within the project's first two counted completed trials, corresponding to T0/T1.
9. **Near/at/over limit**: derive counted completed trials against currentTrialLimit. Current attention excludes Approved, Cancelled, and Closed projects.
10. **Open Critical**: severity Critical and current status is neither Closed nor Verified.
11. **Issue month events**: created count uses createdAt; closed count uses closedAt. Current open backlog/aging uses current status and is clearly labeled current.
12. **Forward workload**: planned trials in the next 30 days are anchored to asOf and labeled forward-looking, not as a selected-month historical value.

Use the wording `Mold-trial workload` / `试模工作量`, never `Factory utilization`.

## 3. `/reports` UI

Use a work-focused, dense but calm management layout consistent with current MoldPilot. Do not build a marketing hero or decorative dashboard.

Shared controls:

- Page title and Dashboard navigation.
- Month selector.
- Previous-month comparison context.
- As-of timestamp.
- Data completeness warning when records are missing.
- Tabs for Overview, Issues, Scorecards, represented in the URL so refresh/back navigation works.

Overview first pulse:

- Completed trial runs and prior-month delta.
- New molds reaching T0 and prior-month delta.
- Unique molds trialed.
- On-time rate with numerator/denominator.
- Projects first approved in selected month.
- Current Open Critical issues.

Overview supporting sections:

- Completed workload by week and result distribution.
- Trials planned next 30 days.
- Approved on/before target with eligible/missing-target counts.
- Low-loop approvals within T0/T1.
- Current near/at/over-limit molds.
- Issues created/closed in month.
- Current open issue aging buckets: 0-7, 8-14, 15-30, 31+ days.
- Severity and issue-type breakdown.
- Missing Trial Result, Digital Process Sheet, QC Report, and unresolved auto-missed counts.

Add one prominent `Management Attention` list with source links for:

- Overdue High/Critical issues.
- Active over-limit molds.
- Broken/legacy non-approved trials lacking same-trial issue accountability.
- Non-approved trials/projects that need a next planned trial.
- Unresolved auto-missed records.
- Missing Trial Result, Process Sheet, or QC Report records.

Do not add report-side edit/close/reschedule controls.

## 4. Issues Tab

Default to issues created in the selected month. Support filters for:

- Severity.
- Current status.
- Issue type.
- Fix-owner role/group where available.
- Current open backlog toggle.

Show:

- Created date.
- Mold code and found-at trial label.
- Title and issue type.
- Severity and current status.
- Fix owner formatted with role, English display name, and Chinese name where available.
- Due date and overdue state.
- Fix summary and approximate fix time.
- Closed date/by and verification state when present.
- Source link to the project/trial issue.

For open issues show `Not resolved yet` / `尚未解决`. Never invent a resolution. Label the owner as the fixer/responsible follow-up person; never calculate or display personal culprit/fault rankings.

## 5. Scorecards Tab

Reuse the existing Admin Scores implementation:

- Extract shared components/services if needed instead of copying large JSX or scoring math.
- Keep one source for month parsing, KPI computation, leader/group bars, individual rows, sorting, and audit drilldowns.
- Preserve the Admin Rules and scoreboard-enabled controls in Admin; Reports is not a configuration page.
- Staff scoreboard visibility remains controlled by `scoreboard_enabled` and does not change merely because Reports exists.
- If only report permission is present, block Scorecards and do not leak its payload.

## 6. Privacy, Language, And Layout

- Translate all report-owned interface text, statuses, filters, tabs, empty/error states, and metric labels in English and Simplified Chinese.
- Do not translate user-entered mold codes, client names, issue titles, notes, or fix summaries.
- Do not expose customer country, contact person, email, phone, quote value, sales pipeline, or communication history in UI, serialized props, query results, logs, or tests.
- Prefer mold code/customer code in dense rows; use Customer display name only where existing internal visibility already permits it.
- Preserve text labels in addition to color.
- Verify desktop and 360-430 px widths. No overlapping header actions/tabs, clipped metric text, or page-wide accidental overflow. A deliberate horizontally scrollable issue table is acceptable if its controls remain reachable.

## 7. Tests

Add focused tests matching AT-020A through AT-020D:

- Permission definition/defaults and server authorization.
- Admin/GM Reports navigation versus scored-staff My Score navigation.
- `Asia/Shanghai` month boundary edges and previous-month calculation, including year rollover.
- Completed workload inclusion/exclusion, Invalid Trial inclusion, new-T0 de-duplication, unique molds, and zero-baseline delta.
- On-time numerator/denominator with due missed/delayed and future/cancelled/skipped records.
- Earliest approval, target eligibility/missing target, and low-loop T0/T1 calculation.
- Near/at/over-limit terminal-project exclusion.
- Critical open status exclusion for Closed/Verified.
- Issue created/closed timestamps, current aging buckets, filters, resolution rendering, and source links.
- No individual score payload without `kpi.scores.view_all`.
- English/Chinese labels and preservation of user-entered text.
- Privacy assertions and responsive browser checks.

Use deterministic fixtures on both sides of a month boundary. Make the normal pilot seed show enough current/previous-month report data for a useful manual review without corrupting existing acceptance fixtures.

## 8. Documentation And Verification

After implementation:

- Add a completion entry to `docs/03-build/development.md` with the actual files, approach, failures/fixes, and verification results.
- Mark Feature 09 built in `docs/05-feature-prompts/README.md` only after all required checks pass.
- Update `docs/06-kpi/kpi-system-design.md` build status without changing the locked metric meanings.
- Keep source-of-truth docs synchronized if implementation reveals a real constraint. Do not silently redefine a metric in code.

Run:

```bash
CI=true node --test tests/domain/*.test.ts
pnpm exec prisma validate
pnpm exec next typegen
pnpm exec tsc --noEmit
pnpm prisma:seed
pnpm pilot:check
pnpm pilot:e2e
pnpm pilot:workflow:e2e
```

Start/reuse the local dev server and perform the browser walkthrough as Admin, GM, a scored staff user, and a user without report permission. Report the exact checks run, results, remaining gaps, and local URL.
