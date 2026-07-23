# MoldPilot Phase 1 Pilot Acceptance Checklist

Use this checklist after running:

```bash
pnpm pilot:preflight
pnpm pilot:db # or start/connect your local PostgreSQL and set DATABASE_URL
pnpm prisma:migrate
pnpm prisma:seed
pnpm pilot:check
pnpm dev
```

Open `http://localhost:3000`. With the dev server running, run `pnpm pilot:check` again in a second terminal to include the HTTP smoke checks.

## Bilingual UI Check

- Login page shows the language switcher.
- English is the default language when no preference exists.
- Switch to Simplified Chinese and reload/navigate.
- Dashboard, project detail, trial panels, Digital Process Sheet controls, Admin tabs, `/me`, the dashboard-embedded My Tasks panel, common buttons, and status labels remain usable in Chinese.
- On `/me`, confirm the Dashboard link and Language Switcher fit cleanly at 360–430 px without overlap or horizontal scrolling.
- Confirm My Tasks section headings, bottom sheets, trial/issue statuses, severity, missed-reason/responsible-area/issue-status options, requester labels, countdown/date-confirmation labels, and generated titles such as `T0 试模` are translated.
- Navigate from `/me` to the dashboard and confirm the embedded task panel keeps the same selected language.
- Switch back to English and confirm labels return to English.
- Mold codes, client/project refs, client names, part codes, issue titles, notes, machine brands, and generated/exported business data stay exactly as entered.

## Seed Readiness

- Customer Master seed records exist and active customers can be searched by customer code, display name, short name, or alias.
- Customer country is not visible in Admin Clients, project intake lookup, selected-client labels, exports, or search behavior.
- Injection Machine Master seed records are imported from `RAW/Injection-Machines-2026.07.02.xls`, not just a tiny hardcoded starter list.
- Admin Machines table shows only No., Clamping Force, Brand, Shot Weight, Save, and Delete.
- Machine No. values are numeric only and sorted numerically, such as 1 through 26.
- Active machines can be searched in trial/process-sheet selectors by numeric No. and clamping force.
- Default Process Sheet Template exists and is available for project/template snapshot.
- `MP-PILOT-001` appears on the dashboard.
- The dashboard can still show:
  - Delayed trials from projects with missed-trial history, including `MP-PILOT-001` and `MP-SEED-002`.
  - Open issues from `MP-PILOT-001`.
  - Near Limit state from `MP-SEED-006` (`2 / 3`).
  - At Limit state from `MP-SEED-007` (`3 / 3`).
  - Over Limit state from `MP-SEED-008` (`4 / 3`).

## Pilot Project Detail: MP-PILOT-001

Open `/projects/MP-PILOT-001`.

Expected:

- Project overview shows the customer code snapshot; authorized PM/GM/Admin context may show Customer Master display name.
- No customer contact person, email, phone, quote value, sales stage, portal data, or communication history is shown.
- Trial Panel shows:
  - Compact trial count badge, such as `1 / 4 Design Change Allowance`.
  - Default T0/T1/T2 collapsible panels.
  - Completed T0 expanded or easy to inspect.
  - Planned T1 visible as the next trial.
  - Record result and Add issue actions inside the relevant trial panel.
  - Record Result shows only actual date, result, injection machine, sample quantity, main issue summary, and optional outcome note.
  - Record Result does not show the legacy result-disposition field, follow-up owner/date, legacy machine note, or material.
  - Prior issues available for verification in later trial panels.
- Digital Process Sheet shows:
  - Process parameters as rows and visible trial stages as horizontal columns.
  - Trial columns use MoldPilot's strict sequence labels, such as T0/T1/T2/T3, with no `#1/#2/#3` suffixes.
  - Machine selector backed by Injection Machine Master.
  - Current trial column editable for permitted PM/Injection users.
  - Previous trial columns read-only by default.
  - Current editable trial label, unsaved-change count, and saved/error feedback visible inside the panel.
  - Enter moves to the next editable process value; Shift+Enter moves to the previous value; Enter does not submit the sheet.
  - Copy Previous Trial fills blank current-trial machine/process values from the immediate previous trial without copying result/issues/accountability fields.
  - Existing current-trial values are not overwritten unless explicitly confirmed.
  - No editable Trial Summary section or rows for trial result, major issue summary, correction summary, next action, or internal private note.
- Customer-safe Process Sheet PDF export is available to permitted Marketing/PM/Admin users. Clicking it starts one real non-empty Chrome `.pdf` download, stores one `CUSTOMER_SAFE` FileAttachment with correct MIME/size metadata, creates one ActivityLog, and surfaces the reusable download in Customer Files.
- As Marketing, download the generated PDF again from Customer Files and confirm protected file access works without creating a duplicate export record. Confirm a failed export does not start an empty download.
- Trial Issues show:
  - Technical mold design issue.
  - Injection process issue.
  - QC dimension issue.
  - Marketing client-feedback issue with sanitized source detail only.
  - Assembly self-check state where a correction item has been checked before the next trial.
  - Simple Add Trial Issue form is wide and shows only title, optional affected part, issue type, source, severity, status, owner, due date, and description.
  - Simple Add Trial Issue requires Owner and Due Date and does not offer Unassigned as the default owner.
  - Simple Add Trial Issue form hides source detail, responsibility area, lifecycle correction/verification fields, Assembly acknowledgement/self-check, PM readiness, and closed date.
  - Issues live inside the trial panel where they were introduced; no large global Update Issue panel appears below all trial panels.
  - Each issue row has Edit and Close Issue actions.
  - Close Issue asks for fix summary, approximate time spent, and closed date defaulting to today.
  - PM/GM closing another user's issue requires a reason explaining why the owner did not close it.
  - Closed issue rows gray/disable Edit and Close Issue for non-GM users; GM has an explicit closed-issue edit override with ActivityLog.
  - Open/In Progress/Waiting issue rows have subtle yellow warning styling; Closed issue rows have subtle green success styling, with visible status text retained.
- Planning & Change History shows:
  - Delayed T0 planned for `2026-06-20`.
  - New planned T1 on `2026-07-18` with a correction-verification reason.
  - Missed trial reason category `Mold Correction Not Complete` and responsible area `Technical`.
  - Customer-requested design change captured as an extra-trial/customer-driven reason, not a standalone page-level action.
  - `Design Change Extra Trial`.
  - Delta `1`.
  - Reason for the post-T0 design change.
  - Add Next Planned Trial defaults design change source to No / None.
  - Non-design-change planned trials do not require design-change fields or reason detail.
- A project with a planned trial older than next-day noon and no result shows `Auto Missed - Reason Required`.
- The auto-missed trial can be resolved from its trial panel by entering missed reason/new planned date, marking blocked/paused with explanation, or entering a late completed-trial result with audit history.
- Resolving a missed T0 with a new planned date keeps the visible stage as T0 and does not create a duplicate visible T0 or jump ahead to T1.
- A failed, conditional, pending, or invalid T0/T1/T2 cannot save its non-approved result or move to the next planned trial until at least one TrialIssue is added under that same trial panel. An unrelated issue from another trial must not satisfy this rule.
- Activity Timeline shows seeded project, trial, missed-trial, issue, design-change, and limit-adjustment events in chronological order.

## New Intake Smoke Check

Create a new project intake from the dashboard.

Expected:

- Selecting a client does not show "No active clients match this search" while the hidden selected client is set.
- Client lookup does not show country.
- Newly created projects snapshot a process-sheet template from the selected customer or global default.
- Once T0 exists, the new project's Digital Process Sheet appears with editable current-trial values for permitted PM/Injection users.

## Role Restriction Smoke Checks

Use the Current user selector in the page header, then submit the detail page forms.

Expected server-side behavior:

- Marketing/Sales (`yvonne`):
  - Can create client-feedback/customer-driven issue or feedback reason where permitted.
  - Can export customer-safe Process Sheet PDF if `trial.process_sheet.export_pdf` is granted.
  - Cannot reschedule trials by default.
  - Cannot approve extra trial allowance.
  - Cannot update root cause, corrective action, verification, or closure.
- Viewer (`viewer`):
  - Cannot create or update trial workflow records.
- Injection Manager (`wang`):
  - Can record trial execution or process-related issue/status where permitted.
  - Can edit process-sheet values where permitted.
  - Can reschedule when `trial.schedule.reschedule` is enabled.
  - Cannot approve design-change extra trial allowance.
- QC (`gong`):
  - Can add QC verification/status where permitted.
  - Cannot reschedule trials by default.
  - Cannot approve design-change extra trial allowance.
- Planning PM (`bill`):
  - Can set first T0 date and reschedule trials with required reason.
  - Can record extra-trial reasons after the first three completed trial panels are filled.
  - Can approve one design-change extra trial after at least one counted completed trial.
  - Cannot bypass required reason fields.
- Admin (`admin`):
  - Can perform repair/configuration actions that are allowed in Phase 1.
  - Can manage users, roles, permission assignments, Customer Master records, Injection Machine Master records, and fixed report-template assignments.
  - Business-state changes must still produce ActivityLog records and require reasons where the workflow requires them.

## Management Reports Smoke Check

Use Admin and GM accounts, then repeat direct-route checks with a normal role.

- Admin/GM dashboard navigation shows `Reports`; their non-scored accounts are not directed to an empty `My Score` page.
- Scored staff retain `My Score` when the staff scoreboard is enabled.
- `/reports` opens `Overview`, `Issues`, and `Scorecards`; Overview/Issues require `reports.management.view`, while Scorecards additionally require `kpi.scores.view_all`.
- A user without report permission is blocked by the server when requesting the route/data directly.
- Select the current month and compare key values with the immediately previous month.
- Completed trial runs count actual Completed trials, not planned records; unique molds de-duplicate repeat trials; new molds reaching T0 count first actual T0 only.
- On-time rate visibly includes numerator/denominator and keeps due missed/delayed trials in the denominator.
- Target performance separates approved-with-target eligibility from missing target dates; low-loop approval means first approval within T0/T1.
- Current over-limit attention excludes Approved, Cancelled, and Closed projects. Open Critical excludes Closed and Verified issues.
- Issues tab shows severity, current status, fix owner, due/overdue state, fix summary/time, closure, verification, and `Not resolved yet` for open issues.
- Management Attention links back to source projects/trials/issues and contains no report-side business-state mutation controls.
- Switch English/Chinese and check desktop plus 360-430 px layouts for overlap/clipping.
- Confirm no customer country, contacts, email, phone, quote value, sales pipeline, or communication history appears in UI or report payloads.

## Non-Scope Guardrail

Do not validate full ERP, purchasing, customer portal, full file-manager, full department task-board, BI report-designer, or factory-utilization behavior in this pilot run. Phase 1 acceptance is limited to the mold trial tracking loop and its approved support surfaces.
