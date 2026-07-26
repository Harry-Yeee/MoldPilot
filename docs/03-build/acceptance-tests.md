# MoldPilot Phase 1 Acceptance Tests

## Testing Principle

Acceptance tests should prove that the business loop works:

```text
Plan trial -> Trial happens or is missed -> Record reason/result -> Track open issues
-> Set next trial date -> Count trial against limit -> Continue until approved or closed
```

Tests should protect Phase 1 from becoming a vague project tracker.

## Test Layers

| Layer | Use for |
| --- | --- |
| Unit | Trial-limit calculation, warning state, validation rules. |
| Integration | Database writes, activity logs, server-side permissions. |
| Playwright | End-to-end user flows across screens. |

## Seed Roles

Use these roles in tests:

- Admin
- GM
- PM
- Marketing
- Assembly
- Injection
- QC
- Viewer

Seeded real pilot users:

| Role | Users |
| --- | --- |
| Admin | admin |
| GM | Xie |
| PM | Bill, Jun, Cheng |
| Marketing | Yvonne, Anna, Zoe, Peng, Juria, Sahara |
| Assembly | Zhong, Pei |
| Injection | Wang |
| QC | Gong, Shuang |
| Viewer | Viewer |

Legacy test text that still mentions Planning PM, Technical PM, or PM Assistant should be interpreted as the current `PM` role. Legacy text that mentions Marketing/Sales maps to `Marketing`; Injection Manager maps to `Injection`.

## Seed Projects

Seed Client / Customer Master records first:

| Customer Code | Client Short Name | Owner |
| --- | --- | --- |
| 001 | DAT | Anna / 刘婉霞 |
| 024 | BSB SZ | Zoe / 周娟娥 |
| imported workbook rows | from `RAW/Clients-info.xlsx` | Anna/Zoe/Peng mapping |

Client owner mapping from `RAW/Clients-info.xlsx`:

| Workbook owner | Active user |
| --- | --- |
| 刘婉霞 | Anna |
| 周娟娥 | Zoe |
| 彭利满 | Peng |

Create stable fixtures:

| Fixture | Description |
| --- | --- |
| Healthy T0 Planned | 0 / 3 trials used, T0 planned. |
| Multi-Part Family Mold | One mold trial project with multiple MoldTrialPart rows. |
| Delayed T0 | Planned trial missed, reason recorded. |
| T0 Correction | 1 / 3 trials used, open issues. |
| Client Feedback Issue | Marketing-created issue from customer/client feedback. |
| Pending Customer Feedback | Trial happened and is waiting for customer feedback. |
| Near Limit | 2 / 3 trials used. |
| At Limit | 3 / 3 trials used. |
| Over Limit | 4 / 3 trials used. |
| Design Change Allowance | 3 / 4 trials used after approved post-trial design change. |
| Extra Trial Sequence | T0/T1/T2 completed, 4th trial available only with a visible reason. |
| Injection Machine Master | Active machines seeded from `RAW/Injection-Machines-2026.07.02.xls`. |
| Digital Process Sheet | Process values for at least T0 and T1 using the default process setup template. |

## Core Acceptance Scenarios

### AT-000B: Bilingual UI Switch

Layer: Unit/source + Playwright smoke

Role: Any logged-in internal user

Steps:

1. Open MoldPilot with no language preference.
2. Confirm English UI is shown by default.
3. Use the language switcher to select Simplified Chinese.
4. Open `/me`, confirm its header includes Dashboard navigation and the shared Language Switcher, then inspect the mobile My Tasks panel embedded on the dashboard.
5. In Chinese mode, inspect task section headings, trial/issue status and severity badges, missed-reason/responsible-area/issue-status options, design-change requester labels, countdown/date-confirmation labels, and a generated trial title such as `T0 试模`.
6. Verify issue titles, client names, mold/project codes, notes, machine numbers/brands, and filenames remain exactly as entered.
7. Switch back to English and confirm `/me` plus the dashboard-embedded task panel return to English.
8. At 360 px and 430 px widths, confirm the `/me` Dashboard and language controls do not overlap and the page has no horizontal overflow.

Expected:

- The selected language persists across reload/navigation.
- Dashboard, project detail, trial panels, process-sheet controls, Admin tabs, `/me`, the dashboard-embedded My Tasks panel, common buttons, and enum/status display labels change language.
- `/me` uses the `moldpilot_language` cookie/provider setting rather than the user's database locale.
- My Tasks system labels, select options, generated trial titles, countdowns, date confirmations, and common action-success feedback are Chinese in Chinese mode and English after switching back.
- Stored enum values and server-action option values remain unchanged while their visible labels translate.
- Stored business data such as mold code, client/project reference, client name, part code, issue title, notes, and machine brand does not get translated or mutated.
- Permission codes remain unchanged; only display labels translate.
- At 360–430 px, `/me` header controls remain touch-friendly, non-overlapping, and free of horizontal scrolling.

### AT-000: Admin Manages Clients Master

Layer: Playwright + integration

Role: Admin

Preconditions:

- Admin user exists.

Steps:

1. Open Admin.
2. Open Clients tab.
3. Create client with client code, short name, owner selected from active users, and notes/deal year.
4. Edit at least two existing client rows.
5. Confirm Unsaved changes count matches changed rows.
6. Save changes from the sticky batch action bar.
7. Archive the client as a staged change and save.

Expected:

- Client is created with unique code.
- Multiple client edits can be saved in one server action.
- Discard changes reverts staged client edits.
- Owner dropdown uses current active users, not roles.
- User options show English display name and Chinese name when available.
- Archived client is inactive.
- Archived client does not appear in new project customer selector.
- Historical project references are not broken.
- ActivityLog records create/edit/archive client actions.
- Unauthorized batch edits are rejected server-side.
- No country, contact person, customer email, phone, quote value, sales stage, portal data, or communication-history fields exist in normal Client UI, lookup, or exports.

### AT-000A: User Accounts Support English And Chinese Names

Layer: Playwright + integration

Role: Admin

Preconditions:

- Admin user exists.

Steps:

1. Open Admin.
2. Open Users tab.
3. Create or edit a user with English display name and Chinese name.
4. Edit at least two existing user rows.
5. Confirm Unsaved changes count matches changed rows.
6. Save changes from the sticky batch action bar.

Expected:

- User stores English display name and optional Chinese name.
- Multiple user edits can be saved in one server action.
- Discard changes reverts staged user edits.
- ActivityLog records each changed user.
- Current user / role display can remain English.
- Active-user dropdowns can show both names, such as `Anna / 刘婉霞`.
- Seeded Anna, Zoe, and Peng users have Chinese names 刘婉霞, 周娟娥, and 彭利满.

### AT-001: Create Mold Trial Project

Layer: Playwright + integration

Role: PM

Preconditions:

- PM user exists.

Steps:

1. Open Create Mold Trial Project.
2. Search client by code, short name, owner English name, or owner Chinese name.
3. Select an active customer from the Customer Master lookup.
4. Enter optional Project Code / Client Ref, optional mold code, at least one part/cavity row, optional Planning PM, optional first planned trial date, and priority.
5. Save.

Expected:

- MoldTrialProject is created.
- If Project Code / Client Ref is blank, an internal tracking code is generated.
- If Mold Code is present, it appears as the primary identifier in list/detail.
- MoldTrialProject stores customer reference and customer code snapshot.
- At least one MoldTrialPart is created.
- Project list/detail shows the primary part code for display.
- Initial planned TrialEvent is created only when first planned T0 date is supplied by an authorized user.
- Base trial limit defaults to 3.
- Trial count shows 0 / 3.
- ActivityLog records project creation.
- No customer country or contact fields are present.
- The assigned PM account already exists as an internal login account.
- Free-typed customer text is not accepted as the stored project customer.
- If the selected customer has no customer-specific process-sheet template, the project snapshots the global default process-sheet template.
- A newly created project with a trial can show the Digital Process Sheet without relying on seed-only data.

### AT-001A: Reject Nonexistent Or Archived Customer During Project Creation

Layer: Unit + integration + Playwright

Role: PM

Preconditions:

- At least one active Customer exists.
- At least one archived Customer exists.

Steps:

1. Open Create Mold Trial Project.
2. Type a customer name/code that does not match an active Customer and attempt to save.
3. Select or submit an archived Customer id and attempt to save.

Expected:

- Save fails for nonexistent customer.
- Save fails for archived customer.
- No MoldTrialProject is created.
- User is prompted to select an active customer from Customer Master.

### AT-001B: Create Multi-Part / Multi-Cavity Mold Trial Project

Layer: Playwright + integration

Role: PM

Preconditions:

- PM user exists.

Steps:

1. Open Create Mold Trial Project.
2. Select one active customer.
3. Enter one project code and one mold code.
4. Add at least two part/cavity rows, such as P-014-A cavity A and P-014-B cavity B, or one part code with cavity count 2.
5. Save.

Expected:

- One MoldTrialProject is created for the mold.
- Multiple MoldTrialPart rows are created under that project.
- Dashboard/list shows primary part code plus count, such as `P-014-A +1`.
- Project detail shows all parts/cavities in the Parts / Cavities section.
- No comma-separated part code is stored as the source of truth.
- ActivityLog records project creation.

### AT-001C: Client Lookup Does Not Expose Country

Layer: Playwright + integration

Role: PM or Marketing

Steps:

1. Open Create Mold Trial Project.
2. Search for an active client by code and short name.
3. Inspect the result rows and selected-client label.
4. Search for a country value that exists in the raw workbook but is not imported into MoldPilot.

Expected:

- Client results show code, short name, and owner where useful.
- Country is not displayed in the intake selector, selected-client label, or Admin Clients table.
- Country search does not reveal matching customers.
- Selecting a client keeps the hidden customer id selected and does not show a contradictory "No active clients match this search" message.

### AT-002: Create Draft Intake Without Client Ref Or Mold Code

Layer: Unit + integration + Playwright

Role: Marketing

Steps:

1. Create an intake record with active customer and at least one part/cavity row.
2. Leave Project Code / Client Ref blank.
3. Leave Mold Code blank.
4. Save.

Expected:

- Save succeeds.
- The system generates an internal tracking code.
- The project remains Intake / Waiting T0.
- Mold Code shows Not set.

### AT-002A: Reject First T0 Scheduling Without Mold Code

Layer: Unit + integration + Playwright

Role: PM

Steps:

1. Open an Intake project with blank Mold Code.
2. Attempt to set first T0 planned date.

Expected:

- Save fails.
- User sees that Mold Code is required before setting first T0.
- No TrialEvent is created.

### AT-003: Show Upcoming Trial

Layer: Playwright

Role: Planning PM

Preconditions:

- Healthy T0 Planned fixture exists.

Steps:

1. Open Trial Dashboard.
2. Open Mold Trial List.

Expected:

- Project appears in upcoming trials.
- Trial count shows 0 / 3.
- Status shows Waiting Trial or equivalent planned state.

### AT-004: Auto-Missed Trial After Next-Day Noon

Layer: Playwright + integration

Role: Planning PM

Preconditions:

- Project has a planned T0 date.
- Current app business time is after 12:00 PM on the next calendar day.
- No result, actual date, cancellation, skipped status, or aborted status has been entered for the planned trial.

Steps:

1. Open project detail.
2. Inspect the T0 trial panel.

Expected:

- T0 shows `Auto Missed - Reason Required`.
- Project status becomes Trial Delayed.
- ActivityLog records the automatic missed/unreported classification.
- No final MissedTrialEvent is created until an authorized user enters a reason and new date or blocked/paused explanation.

### AT-005: Resolve Auto-Missed Trial As Truly Missed

Layer: Playwright + integration

Role: Planning PM

Preconditions:

- Project has a T0 panel in `Auto Missed - Reason Required`.

Steps:

1. Resolve the T0 panel as truly missed.
2. Enter reason category, responsible area, explanation, and new planned date.
3. Save.

Expected:

- MissedTrialEvent is created.
- Original TrialEvent becomes Delayed or equivalent resolved-missed state.
- New planned date is visible.
- ActivityLog records missed-trial resolution.
- The visible panel remains T0. The UI does not show `T0 #1`, `T0 #2`, or `T1 #3`.
- The project cannot advance to T1 until T0 has a real completion, skip, cancel, abort, or other documented closure disposition.

### AT-005A: Missed T0 Replan Does Not Create Duplicate Visible Trial Stage

Layer: Playwright + integration

Role: PM

Preconditions:

- Project has planned T0.
- T0 is auto-missed or manually resolved as missed with a new planned date.

Steps:

1. Resolve T0 as missed and enter a new planned date.
2. Reopen Mold Trial Detail.
3. Open Trial Panel and Digital Process Sheet.

Expected:

- Trial Panel shows one visible T0 stage, followed by collapsed T1/T2 placeholders as applicable.
- Digital Process Sheet columns show MoldPilot's strict stage sequence, not duplicate T0 columns.
- User-facing labels never include internal suffixes like `#1`, `#2`, or `#3`.
- T1 cannot be planned or edited while T0 is still only missed/replanned and not completed/closed.

### AT-005A: Reject Auto-Missed Resolution Without Required Fields

Layer: Unit + integration

Role: Planning PM

Preconditions:

- Project has a T0 panel in `Auto Missed - Reason Required`.

Steps:

1. Attempt to resolve as truly missed without reason category.
2. Attempt without responsible area.
3. Attempt without explanation.
4. Attempt without new planned trial date while project is not blocked or paused.

Expected:

- Each save fails.
- No incomplete MissedTrialEvent is created.

### AT-005B: Correct Auto-Missed Trial With Late Completed Entry

Layer: Playwright + integration

Role: Planning PM or Injection

Preconditions:

- Project has a T0 panel in `Auto Missed - Reason Required`.
- The trial actually happened but was not entered before the cutoff.

Steps:

1. Open the T0 panel.
2. Enter actual trial date and result.
3. Save as late completed trial.

Expected:

- TrialEvent becomes Completed.
- Completed trial count increments if the trial counts against the limit.
- Auto-missed state is resolved.
- ActivityLog records that the auto-missed state was corrected by late completed-trial entry.

### AT-006: Record Completed T0 Trial

Layer: Playwright + integration

Role: Injection Manager

Preconditions:

- Project has planned T0.

Steps:

1. Open project detail.
2. Record T0 trial with actual date and result Approved.
3. Save.

Expected:

- TrialEvent status becomes Completed.
- Completed trial count becomes 1.
- Trial count shows 1 / 3.
- Project status becomes Approved or equivalent completion status.
- Trial result is visible.
- ActivityLog records completed trial.

### AT-006A: Reject Actual Trial Without Result

Layer: Unit + integration

Role: Injection Manager

Preconditions:

- Project has planned T0.

Steps:

1. Record actual trial date.
2. Leave result blank.
3. Save.

Expected:

- Save fails.
- Trial is not finalized.

### AT-006B: Non-Approved Trial Requires Same-Trial Issue

Layer: Unit + integration

Role: Planning PM

Preconditions:

- Project has planned T0.

Steps:

1. Record T0 as Not Approved / Rework Required, Conditional, Pending QC, Pending Customer Feedback, or Invalid Trial.
2. Do not add a TrialIssue linked to T0.
3. Attempt to finalize.
4. Add an unrelated issue linked to another trial or not linked to T0.
5. Attempt to finalize again.
6. Add a TrialIssue linked to T0 with owner and due date.
7. Finalize again.

Expected:

- Finalization fails until T0 has at least one linked TrialIssue.
- Issues from other trials do not satisfy the rule.
- Outcome notes and new-trial reasons do not replace the same-trial TrialIssue.
- Approved trial results can finalize without issues.

### AT-007: Completed Trials Count, Planned Trials Do Not

Layer: Unit

Steps:

1. Create project with one completed trial.
2. Add one planned T1 trial.
3. Add one cancelled trial.
4. Add one skipped trial.

Expected:

- Completed trial count is 1.
- Planned, cancelled, and skipped trials do not count against the limit.

### AT-008: Add Trial Issue

Layer: Playwright + integration

Role: Technical PM

Preconditions:

- T0 completed.

Steps:

1. Open project detail.
2. Add Trial Issue with title, found-at trial, optional affected part, issue type, source, severity, status, owner, due date, and description.
3. Save.

Expected:

- TrialIssue is created.
- If an affected part/cavity was selected, TrialIssue references that MoldTrialPart.
- Issue appears inside the same trial panel where it was added.
- Open issue count increases.
- ActivityLog records issue creation.
- Simple Add Trial Issue form does not show Source Detail, Responsibility Area, root cause, corrective action, verification method/result, Assembly acknowledgement/self-check, PM readiness, or Closed Date.
- Simple Add Trial Issue form uses the full available trial-panel width, not a half-width layout.
- Owner and Due Date are required. The create form does not offer Unassigned as the default owner.
- Issue row shows Edit and Close Issue actions.

### AT-008A: Marketing Adds Client-Feedback Trial Issue

Layer: Playwright + integration

Role: Marketing / Sales

Preconditions:

- Trial project exists.

Steps:

1. Open project detail.
2. Add Trial Issue with source Marketing Client Feedback.
3. Use issue type Bad Customer Feedback or Customer Sample Rejection.
4. Save.

Expected:

- TrialIssue is created.
- Issue source is Marketing Client Feedback.
- No customer full name/contact is required or stored.
- ActivityLog records issue creation.

### AT-008B: Marketing Cannot Edit Advanced Internal Fields

Layer: Integration + Playwright

Role: Marketing / Sales

Preconditions:

- Marketing-created TrialIssue exists.

Steps:

1. Attempt to edit root cause or corrective action through direct form/API payload.
2. Attempt to close a feedback issue not assigned to the Marketing user.

Expected:

- Actions are blocked server-side.
- Marketing can edit/close only their own assigned feedback issue unless Admin grants broader permission later.

### AT-009: Prevent Trial Issue Closure Without Required Fields

Layer: Unit + integration

Role: Technical PM

Preconditions:

- Open TrialIssue exists.

Steps:

1. Try to close without fix summary.
2. Try to close without approximate fix time.
3. Try to close without closed date.

Expected:

- Each closure fails.
- Issue remains open.

### AT-010: Close Trial Issue

Layer: Playwright + integration

Role: Technical PM

Preconditions:

- Open TrialIssue exists and is assigned to the current user.

Steps:

1. Open the issue row's Close Issue action.
2. Enter fix summary.
3. Enter approximate time spent.
4. Keep closed date defaulted to today.
5. Close issue.

Expected:

- Issue status becomes Closed.
- Closed date is recorded.
- Closed by user is recorded.
- Fix summary and fix time are recorded.
- Open issue count decreases.
- ActivityLog records issue closure.

### AT-010A: PM Or GM Closing Someone Else's Issue Requires Reason

Layer: Unit + integration + Playwright

Role: PM or GM

Preconditions:

- Open TrialIssue exists and is assigned to another active user.

Steps:

1. Open the issue row's Close Issue action.
2. Enter fix summary and approximate time spent.
3. Leave non-owner close reason blank.
4. Attempt to close.
5. Add non-owner close reason and close again.

Expected:

- First close attempt fails.
- Second close attempt succeeds.
- Issue stores closed by user, closed date, fix summary, fix time, and non-owner close reason.
- ActivityLog records that PM/GM closed an issue owned by another user.

### AT-010B: Closed Issue Locks For Non-GM Users

Layer: Integration + Playwright

Role: PM, owner user, GM

Preconditions:

- TrialIssue is Closed.

Steps:

1. Log in as the issue owner or PM.
2. View the issue row.
3. Try to edit or close the issue again.
4. Log in as GM.
5. Edit the closed issue through the GM override path.

Expected:

- Non-GM users see Edit and Close Issue disabled/gray; Close Issue may show as Closed.
- Non-GM server action attempts to edit a closed issue are blocked.
- GM can edit the closed issue through an explicit override path.
- GM edit creates ActivityLog history.

### AT-011: Trial Limit Warning States

Layer: Unit

Cases:

| Completed | Limit | Expected |
| --- | --- | --- |
| 0 | 3 | Healthy |
| 1 | 3 | Healthy |
| 2 | 3 | Near Limit |
| 3 | 3 | At Limit |
| 4 | 3 | Over Limit |

Expected:

- Warning state matches table.

### AT-012: Design Change Reason Before Extra-Trial Eligibility Does Not Add Allowance

Layer: Unit + integration

Role: Planning PM

Preconditions:

- Project has fewer than three completed trial panels.

Steps:

1. Attempt to create an extra trial panel using design change as the reason.

Expected:

- Extra trial allowance is not granted.
- Current trial limit remains 3.
- User sees that T0/T1/T2 must be completed before a 4th trial panel can be added.

### AT-013: Design Change Reason Can Create Fourth Trial Audit

Layer: Playwright + integration

Role: Planning PM

Preconditions:

- Project has T0/T1/T2 completed.

Steps:

1. Add a 4th trial panel.
2. Select design change as the extra-trial reason.
3. Enter notes and customer/internal source.
4. Save.

Expected:

- The 4th trial panel is created.
- DesignChangeEvent may be created behind the scenes for audit/reporting.
- TrialLimitAdjustment or equivalent extra-trial history is created.
- Current trial limit becomes 4.
- ActivityLog records the design-change extra-trial reason.

### AT-014: Fourth Trial Requires Prior Completed Trials And Reason

Layer: Unit + integration

Role: Planning PM

Steps:

1. Open a project with fewer than three completed trial panels.
2. Attempt to add a 4th trial panel.
3. Open a project with T0/T1/T2 completed.
4. Attempt to add a 4th trial panel without reason.

Expected:

- Save fails.
- The 4th trial panel is not created.
- The user is prompted to complete prior trials and provide an extra-trial reason.

### AT-015: Fourth Trial Panel Can Be Added With Valid Reason

Layer: Playwright + integration

Role: Planning PM

Preconditions:

- Project has T0/T1/T2 completed.

Steps:

1. Add a 4th trial panel with a valid reason, such as approved design change, customer feedback, QC failure, correction verification, or invalid previous trial.

Expected:

- The 4th trial panel is created.
- Compact trial count/limit badge updates.
- The reason is visible in Planning & Change History.
- ActivityLog records the extra-trial reason.

### AT-015A: Add New Planned Trial With Reason

Layer: Playwright + integration

Role: Planning PM

Preconditions:

- Project has completed T0 and needs another trial.

Steps:

1. Open Add New Planned Trial.
2. Enter trial code T1, new planned trial date, reason category, reason detail, requested by, and source area.
3. Save.

Expected:

- Planned TrialEvent is created.
- Trial count does not increase yet.
- New-trial reason is visible.
- ActivityLog records new planned trial.

### AT-015B: Reject New Planned Trial Without Date Or Reason

Layer: Unit + integration

Role: Planning PM

Steps:

1. Attempt to add new planned trial without planned date.
2. Attempt without reason category.
3. Add a valid planned date, reason category, requester, and source area with blank reason detail.

Expected:

- Missing planned date and missing reason category fail.
- Blank reason detail does not fail.
- No incomplete planned TrialEvent is created.

### AT-015F: New Planned Trial Design Change Fields Are Conditional

Layer: Playwright + integration

Role: PM or Injection with reschedule permission

Preconditions:

- Project can add a next planned trial.

Steps:

1. Open Add Next Planned Trial.
2. Confirm design change source defaults to No / None.
3. Select a non-design-change reason such as Trial Issue Verification.
4. Confirm design change source/date/title are hidden or disabled.
5. Save with planned date, reason, requester, source, and blank reason detail.
6. Select a design-change reason.

Expected:

- Non-design-change planned trial saves without design-change fields and without reason detail.
- Design-change fields appear only for design-change related reason.
- Design change title is optional.
- Add Next Planned Trial is blocked if the previous completed actual trial has a non-approved result and no TrialIssue linked to that same previous trial.
- Add Next Planned Trial succeeds after the previous non-approved trial has a linked issue with owner and due date.
- Add Next Planned Trial succeeds after an approved previous trial without issues.
- ActivityLog records the new planned trial.

### AT-015C: Authorized Roles Can Reschedule Planned Trial

Layer: Playwright + integration

Roles: PM, Injection, Admin

Preconditions:

- Project has trial history and another trial is needed.
- Each tested role has `trial.schedule.reschedule`.

Steps:

1. Open Add New Planned Trial.
2. Choose a valid reason category.
3. Enter new planned trial date and reason detail.
4. Save.

Expected:

- Planned TrialEvent is created.
- Source area and requester are recorded.
- Trial count does not increase until trial is completed.
- ActivityLog records the new planned trial.

### AT-015D: GM, Marketing, QC, Assembly, And Viewer Cannot Reschedule By Default

Layer: Integration

Roles: GM, Marketing, QC, Assembly, Viewer

Steps:

1. Attempt to add a new planned trial or reschedule a missed trial.

Expected:

- Request is rejected unless Admin explicitly grants `trial.schedule.reschedule`.
- No planned TrialEvent is created.
- No next planned trial date is changed.

### AT-015E: Marketing Reports Customer-Driven Reason Without Scheduling

Layer: Playwright + integration

Role: Marketing / Sales

Preconditions:

- Project has trial history and customer feedback may require another trial.

Steps:

1. Add a client-feedback TrialIssue or customer-driven DesignChangeEvent.
2. Use customer-driven reason category or source.
3. Save.

Expected:

- Customer-driven reason is visible to PM.
- Marketing/Sales does not create a planned TrialEvent.
- ActivityLog records the customer feedback or design change.

### AT-016: Viewer Cannot Edit Trial Data

Layer: Integration + Playwright

Role: Viewer

Steps:

1. Log in as Viewer.
2. Attempt to create project.
3. Attempt to record trial.
4. Attempt to close issue.

Expected:

- All write actions are blocked server-side.
- UI does not show primary edit actions where practical.

### AT-017: Injection Manager Cannot Approve Extra Trial Allowance

Layer: Integration

Role: Injection Manager

Steps:

1. Attempt to approve a design-change extra trial allowance.

Expected:

- Request is rejected.
- No unauthorized TrialLimitAdjustment is created.
- ActivityLog does not falsely record success.

### AT-018: QC Can Record Verification But Not Process Fields

Layer: Integration + Playwright

Role: QC

Preconditions:

- TrialIssue waiting verification exists.

Steps:

1. QC adds verification result.
2. QC attempts to edit trial process machine/material fields.

Expected:

- Verification update succeeds.
- Process-field edit is blocked unless explicitly permitted.

### AT-019: Activity Log Is Append-Only

Layer: Integration

Steps:

1. Create project.
2. Record trial.
3. Create issue.
4. Close issue.

Expected:

- ActivityLog entries exist for each action.
- Existing entries are not overwritten.

### AT-020: Dashboard Counts Match Records

Layer: Integration + Playwright

Preconditions:

- Seed projects exist.

Steps:

1. Open Trial Dashboard.

Expected:

- Upcoming trial count matches planned records.
- Delayed count matches delayed/missed records.
- Near-limit count matches 2 / 3 projects.
- At-limit count matches 3 / 3 projects.
- Over-limit count matches 4 / 3 projects.
- Open critical issue count matches TrialIssue records.
- Pending follow-up count matches pending QC/customer feedback records.

### AT-020A: Management Report Access And Navigation

Layer: Domain + Integration + Playwright

Steps:

1. Log in as Admin and GM.
2. Open the dashboard header and `/reports` directly.
3. Log in as a scored staff user with the staff scoreboard enabled.
4. Log in as a user without `reports.management.view` and request `/reports` plus any supporting report loader/action directly.
5. Grant `reports.management.view` without `kpi.scores.view_all` to a test role and open Reports.

Expected:

- Admin/GM see `Reports`, not a manager-facing `My Score` button, and can open Overview/Issues.
- The separate Admin configuration button remains visible only when its own Admin permissions allow it.
- Scored staff keep `My Score` and `/score`; report navigation does not replace their personal scorecard.
- A user without `reports.management.view` is blocked server-side, not merely hidden by the UI.
- A user with report permission but without `kpi.scores.view_all` cannot load the Scorecards tab or individual score data.

### AT-020B: Management Report Monthly Metrics Match Locked Definitions

Layer: Domain + Integration

Preconditions:

- Deterministic fixtures exist on both sides of an `Asia/Shanghai` month boundary, including planned-only, completed, missed/delayed, approved, invalid completed, terminal-project, target-date, and trial-limit examples.

Expected:

- Selected month and previous month use half-open `Asia/Shanghai` calendar boundaries without UTC edge drift.
- Completed trial workload counts actual Completed TrialEvents in the month, includes a completed Invalid Trial run, and excludes planned/missed/cancelled/skipped records.
- New molds reaching T0 count each project only when its first actual completed trial is T0 in the month.
- Unique molds trialed de-duplicates multiple completed trial runs for one mold.
- Every month comparison shows the selected value and previous-month absolute delta; percentage change handles a zero previous denominator without Infinity/NaN.
- On-time trial rate shows numerator and denominator. Due delayed/missed trials stay in the denominator; future, Cancelled, and Skipped trials do not.
- Approval date is the earliest actual Approved trial date.
- Target performance shows approved on/before target as `n / eligible` and separately counts approved projects missing target dates.
- Low-loop approval counts only first approvals within the first two counted completed trials (T0/T1).
- Current over-limit attention derives from counted completed trials greater than current limit and excludes Approved, Cancelled, and Closed projects.
- Open Critical counts Critical issues whose current status is neither Closed nor Verified.

### AT-020C: Management Issues And Attention Are Auditable

Layer: Integration + Playwright

Steps:

1. Open Reports > Issues for a selected month containing open and closed issues.
2. Filter by severity, current status, type, and fix-owner group/role.
3. Enable current open backlog.
4. Open source links from the Issues and Management Attention rows.

Expected:

- Default issue rows are selected by `createdAt` in the selected month; issues closed in the month are counted by `closedAt`.
- Current status and aging are labeled as current-state values, not reconstructed historical month-end state.
- Closed rows show fix summary, approximate fix time, closer/date, and verification when present.
- Open rows show `Not resolved yet` / `尚未解决`, never invented resolution text.
- Fix owner is labeled as responsibility for solving the issue, not fault attribution.
- Management Attention links to overdue High/Critical issues, active over-limit molds, unresolved auto-missed records, missing follow-up plans, and missing Trial Result/Process Sheet/QC records.
- Report rows link back to source records and do not mutate workflow state from the report.

### AT-020D: Reports Are Bilingual, Private, And Responsive

Layer: Playwright

Expected:

- Overview, Issues, Scorecards, month controls, metric labels, filters, empty/error states, and Management Attention switch between English and Simplified Chinese through the shared language source.
- User-entered mold codes, client names, issue titles, notes, and fix summaries are not translated.
- No report payload or visible UI exposes customer country, contacts, email, phone, quote value, sales pipeline, or communication history.
- `Mold-trial workload` / `试模工作量` is used instead of factory utilization.
- At desktop and 360-430 px widths, header actions, tabs, metric text, filters, and issue rows do not overlap or clip; dense tables use a deliberate compact/scroll treatment.
- Existing Admin Scores and personal `/score` calculations agree with the reused Reports Scorecards view.

## Privacy Acceptance Tests

### AT-021: No CRM Or Customer Contact Fields In Core Create Form

Layer: Playwright

Role: Planning PM

Steps:

1. Open Create Mold Trial Project.

Expected:

- Form has searchable Customer selector backed by Customer Master.
- Form does not have customer contact person, customer email, customer phone, quote value, sales pipeline, customer portal, or communication-history fields.

### AT-022: API Rejects CRM Or Customer Contact Fields

Layer: Integration

Steps:

1. Submit create/update payload with customer_contact_name, customer_email, customer_phone, quote_value, or sales_pipeline_stage.

Expected:

- Payload is rejected or fields are ignored according to chosen API policy.
- No CRM/contact data is persisted on MoldTrialProject or Customer.

## Account Acceptance Tests

### AT-023: Default Admin Account Exists For Initial Setup

Layer: Integration

Steps:

1. Seed initial data.

Expected:

- Default admin account exists.
- Default admin has Admin role.
- The account is clearly marked as initial/default admin.
- Default admin has a hashed temporary password.
- Default admin is not forced through first-login password change in the local pilot.
- Default admin password must be changed or disabled before real deployment.

### AT-023A: Seeded Real Pilot Users Exist

Layer: Integration

Steps:

1. Seed initial data.

Expected:

- Roles exist: Admin, GM, PM, Marketing, Assembly, Injection, QC, Viewer.
- Seeded users exist: admin, Xie, Bill, Jun, Cheng, Yvonne, Anna, Zoe, Peng, Juria, Sahara, Zhong, Pei, Wang, Gong, Shuang, Viewer.
- Seeded employee accounts have temporary password `123456` stored only as a hash.
- Seeded employee accounts have `force_password_change = true`.

### AT-023B: First Login Forces Password Change

Layer: Playwright + integration

Role: Seeded employee user

Steps:

1. Open the login page.
2. Log in as a seeded employee with password `123456`.
3. Attempt to navigate to the dashboard before changing password.
4. Change password to a non-temporary value.
5. Log out and log in with the new password.

Expected:

- Login succeeds with the temporary password.
- User is redirected to password-change screen before normal app access.
- Dashboard and workflow pages are blocked until password is changed.
- New password is stored as a hash.
- Temporary password no longer works after password change.
- ActivityLog or auth audit record captures the password change without storing the password.

Admin local-pilot exception:

- Default Admin can log in with `admin` / `admin` and open normal app pages without first-login password change.
- Admin can still use Change Password manually.

### AT-023C: Reseeding Preserves Existing Credentials

Layer: Unit + disposable-database integration

Preconditions:

- Use a disposable database that is not the live Mac mini database.
- Change one seeded employee's password and password lifecycle timestamps.

Steps:

1. Run the normal demo seed against the disposable database.
2. Change the employee's password hash, clear `forcePasswordChange`, and set
   `passwordUpdatedAt` plus `lastLoginAt`.
3. Run the same seed again.

Expected:

- Seed-managed display name, Chinese name, role, and active profile data may be
  refreshed.
- `passwordHash`, `forcePasswordChange`, `passwordUpdatedAt`, and `lastLoginAt`
  remain byte-for-byte/value-for-value unchanged for the existing account.
- A newly created seeded employee still receives a hashed temporary password
  and `forcePasswordChange = true`.
- No password or password hash is printed in seed output or ActivityLog.

### AT-024: Admin Can Create User Without Email

Layer: Playwright + integration

Role: Admin

Steps:

1. Open Admin.
2. Select the Users tab or panel.
3. Create user with username/account code, English display name, optional Chinese name, role, and temporary password.
4. Do not enter email.
5. Save.

Expected:

- User is created.
- Role is assigned.
- No department group assignment is required for the account.
- Email remains optional.
- Temporary password is stored only as a hash.
- New user must change password after first login.

### AT-024A: Admin Archives And Restores Users

Layer: Playwright + integration

Role: Admin

Steps:

1. Open Admin.
2. Select the Users tab or panel.
3. Confirm Active Users and Archived Users are shown separately.
4. Archive an active non-Admin user from the Active Users table.
5. Attempt to log in as the archived user.
6. Restore the user from the Archived Users table.
7. Log in as the restored user.

Expected:

- User create/edit form does not expose a raw status dropdown.
- Archive/restore can be staged and saved from the sticky batch action bar.
- Archive action sets `User.status = INACTIVE`.
- Archived user moves from Active Users to Archived Users.
- Archived user cannot log in.
- Archived user is hidden from active assignment/requester/owner dropdowns.
- Archived user remains visible in historical records by display name.
- Restore action sets `User.status = ACTIVE`.
- Restored user moves back to Active Users and can log in, subject to password state.
- Archive and restore actions create ActivityLog records.

### AT-024C: Admin Users Batch Save And Discard

Layer: Playwright + integration

Role: Admin

Steps:

1. Open Admin Users tab.
2. Edit two active user rows.
3. Confirm Unsaved changes count is 2.
4. Discard changes.
5. Confirm fields revert.
6. Edit two rows again and Save changes.

Expected:

- Discard restores original row values.
- Save updates both users in one server action.
- Unauthorized batch save is rejected server-side.
- ActivityLog records each changed user row.

### AT-024B: Admin Archive Guardrail

Layer: Integration

Role: Admin

Steps:

1. Attempt to archive the last active user with both `admin.manage_users` and `admin.manage_roles`.

Expected:

- Request is rejected.
- At least one active Admin path remains.
- No unsafe user status change is persisted.

### AT-025: Admin Can Manage Role Permissions

Layer: Playwright + integration

Role: Admin

Steps:

1. Open Admin.
2. Select the Roles & Permissions tab or panel.
3. Find the process x role permission matrix.
4. Enable or disable a named workflow permission, such as `trial.schedule.reschedule`, for a role column.
5. Save.

Expected:

- Role permission is saved.
- Change creates ActivityLog.
- Server-side authorization uses the changed permission.
- UI visibility may update, but server-side enforcement is the source of truth.

### AT-025A: Admin Can Create And Remove Roles Safely

Layer: Playwright + integration

Role: Admin

Steps:

1. Open Admin.
2. Select the Roles & Permissions tab or panel.
3. Create a temporary role.
4. Confirm the role appears as a column in the process x role matrix.
5. Delete the temporary role while no users are assigned.
6. Create another temporary role and assign a user to it.
7. Attempt to delete the assigned role.

Expected:

- Unused temporary role is hard-deleted or fully removed from active role setup.
- Assigned role is not hard-deleted.
- Assigned role is either blocked with a clear message or deactivated/archived according to the implementation policy.
- Removed/deactivated role disappears from the active matrix or is clearly marked inactive.
- ActivityLog records role create and delete/deactivate actions.

### AT-025B: Protected Admin Role Cannot Be Removed

Layer: Playwright + integration

Role: Admin

Steps:

1. Open Admin.
2. Select the Roles & Permissions tab or panel.
3. Attempt to delete, deactivate, hide, or remove critical permissions from the Admin role.

Expected:

- Admin role cannot be deleted, deactivated, renamed into a different business role, or hidden from the active matrix.
- System prevents breaking the last active admin path with both `admin.manage_users` and `admin.manage_roles`.
- Error message is clear.
- No unsafe permission change is persisted.

### AT-026: Business Rules Still Apply After Permission Grant

Layer: Integration

Role: Any role granted `trial.schedule.reschedule`

Steps:

1. Attempt to reschedule without planned date.
2. Attempt to reschedule without reason detail.

Expected:

- Requests fail.
- No invalid TrialEvent is created.
- Permission does not bypass workflow validation.

### AT-027: Admin Manages Injection Machine Master

Layer: Playwright + integration

Role: Admin

Steps:

1. Open Admin.
2. Select Injection Machines.
3. Confirm seeded machines from `RAW/Injection-Machines-2026.07.02.xls` are visible.
4. Create or edit a machine with No., Clamping Force, Brand, and Shot Weight.
5. Try entering a No. with letters or `#`.
6. Delete a machine.

Expected:

- The visible table columns are only No., Clamping Force, Brand, Shot Weight, and Actions.
- No. is required, unique, and numeric only.
- Invalid No. values are rejected server-side as well as in the UI.
- Rows are sorted by numeric No. ascending, such as 1 through 26, not text order.
- The real RAW workbook drives the machine seed/import; a tiny hardcoded starter list fails this acceptance check.
- Active machines are selectable during trial/process-sheet entry.
- Deleted machines are not selectable for new trials. If a machine is used by historical trials, Delete safe-deletes/hides it instead of breaking history.
- ActivityLog records create/edit/delete or safe-delete actions.

### AT-028: Machine Selector Searches By No. And Clamping Force

Layer: Playwright + integration

Role: PM or Injection

Steps:

1. Open a trial panel process sheet.
2. Search the machine selector by numeric No.
3. Search the machine selector by clamping force.
4. Select a machine.

Expected:

- Matching active machines appear for both searches.
- Selected machine stores `injection_machine_id` and machine No./clamping-force snapshots on the trial record.
- Free-typed machine text is not required for new process-sheet trial records.

### AT-029: Digital Process Sheet Saves Structured Values And Compares Trials

Layer: Playwright + integration

Role: PM or Injection

Preconditions:

- Project has at least two trial events, such as T0 and T1.
- Project has a process-sheet template snapshot.

Steps:

1. Open Mold Trial Detail.
2. Open Digital Process Sheet.
3. Enter values in the current trial column for several parameters.
4. Save.
5. Open the comparison view.

Expected:

- TrialProcessValue rows are created or updated.
- Process parameters are shown as rows.
- Trial stages are shown as horizontal columns using MoldPilot's strict sequence, such as T0, T1, T2, T3.
- The UI does not copy mistaken trial jumps from the source spreadsheet template.
- The Digital Process Sheet does not show editable Trial Summary rows for trial result, major issues, correction summary, next action, or internal private note.
- Previous completed trial columns are read-only by default.
- Values are not stored only as uploaded spreadsheet/PDF blobs.

### AT-029A: Digital Process Sheet Provides Save Feedback And Keeps Context

Layer: Playwright + integration

Role: PM or Injection

Preconditions:

- Project has a current editable trial column and a process-sheet template snapshot.

Steps:

1. Open Mold Trial Detail.
2. Open Digital Process Sheet.
3. Enter or change multiple process values.
4. Confirm the unsaved-change count updates.
5. Save the process sheet.
6. Reload or revisit the project detail page.

Expected:

- The sheet shows the current editable trial, such as `Editing: T1`.
- Save feedback appears inside the Digital Process Sheet panel with saved state, timestamp, and saved/changed field count.
- The user remains at or returns to the Digital Process Sheet panel after save.
- Saved values persist after reload.
- ActivityLog records `saved_trial_process_sheet`.
- Saving process values does not create a new TrialEvent or advance the visible trial stage.

### AT-029B: Digital Process Sheet Keyboard And Copy Previous Trial

Layer: Playwright + integration

Role: PM or Injection

Preconditions:

- Project has at least two trial columns.
- Previous trial has machine selection and process parameter values.
- Current editable trial has at least one blank process value.

Steps:

1. Focus an editable process value field.
2. Press Enter.
3. Press Shift+Enter.
4. Click `Copy Previous Trial`.
5. Save the copied current-trial values.
6. Add a current-trial value, then attempt overwrite copy.

Expected:

- Enter moves to the next editable process value and does not submit the form.
- Shift+Enter moves to the previous editable process value.
- Copy Previous Trial fills blank current-trial machine/process fields from the immediate previous trial.
- Copy Previous Trial does not copy trial result, issue records, issue summaries, next action, Assembly self-check, or accountability fields.
- Existing current-trial values are not overwritten unless the user explicitly confirms overwrite.
- The copied values save as TrialProcessValue rows for the current trial only.

### AT-030: Assembly Self-Check Does Not Close Issue

Layer: Playwright + integration

Role: Assembly

Preconditions:

- TrialIssue is open and assigned/relevant to Assembly.

Steps:

1. Open the next-trial checklist.
2. Mark the issue as Assembly self-checked.
3. Add an optional self-check note.

Expected:

- `assembly_self_checked_at`, `assembly_self_checked_by_id`, and optional note are stored.
- TrialIssue remains open or waiting verification.
- PM/QC/next-trial verification is still required before closure.
- ActivityLog records the self-check.

### AT-031: Customer-Safe Process Sheet PDF Export

Layer: Playwright + integration

Role: Marketing or PM

Preconditions:

- Project has process-sheet values and at least one trial issue.

Steps:

1. Click `Export Customer PDF` and wait for the browser download event.
2. Verify the suggested filename ends in `.pdf`, the downloaded file is non-empty, and its first bytes are `%PDF-`.
3. Inspect the generated FileAttachment and ActivityLog records.
4. Request `/api/attachments/{id}` as Marketing and inspect the response headers/body.
5. Confirm the new export appears in Customer Files, then download it again from that section.

Expected:

- One click creates exactly one FileAttachment and one `exported_process_sheet_pdf` ActivityLog record.
- FileAttachment uses the generated attachment UUID, attachment storage root, `PROCESS_SHEET_EXPORT`, `PROCESS_SHEET_PDF`, `application/pdf`, the actual non-zero byte size, and `CUSTOMER_SAFE` visibility.
- The ActivityLog payload includes attachment id, filename, size, and visibility.
- Chrome receives a real, non-empty `.pdf` download rather than only a redirect message or blank tab.
- The protected attachment GET returns `200`, `application/pdf`, non-zero `Content-Length`, and attachment `Content-Disposition` for Marketing with `attachment.download.customer_safe`.
- The export appears in Customer Files after refresh and can be downloaded again without creating another attachment/export log.
- A failed export or invalid/empty protected response does not trigger a browser download.
- PDF includes customer-safe process values and may include generated trial result, issue summary, correction summary, and next step from TrialEvent/TrialIssue records.
- PDF does not include duplicated/manual process-sheet Trial Summary rows.
- PDF does not include internal owner, private notes, Assembly self-check, or unapproved root-cause details.

### AT-032: Security-Control Regression

Layer: Domain + integration + deployment inspection

Preconditions:

- Production environment has `MOLDPILOT_DEPLOYMENT_MODE=production`, a valid
  HTTP or HTTPS `MOLDPILOT_BASE_URL`, `MOLDPILOT_SESSION_COOKIE_SECURE=auto`
  (or an explicit matching value), a strong session secret, private
  release/quarantine paths, and a healthy local malware scanner.
- For the preferred HTTPS path, approval-gated Caddy, certificate, network,
  and backup steps have been completed on the target Mac mini.
- Temporary HTTP mode is restricted to the trusted factory LAN, is not exposed
  through router port forwarding, and has an explicit plaintext-credential
  risk acceptance.

Steps:

1. Verify the effective Next.js runtime version is at least `16.2.11`.
2. Submit repeated invalid logins for one account and from one source, restart
   the app during the backoff window, then try again.
3. Submit unauthorized, oversized, signature-mismatched, double-extension,
   archive-traversal, archive-bomb, and scanner-error upload fixtures.
4. Inspect released and quarantined storage plus FileAttachment rows.
5. Download an authorized attachment and inspect security/cache headers.
6. Inspect listeners for Next.js, PostgreSQL, and Caddy.
7. Create an encrypted off-machine backup and restore it to an empty scratch
   database and separate scratch upload directory.
8. Verify the production configuration checker accepts HTTP + auto as
   `Secure=false`, accepts HTTPS + auto as `Secure=true`, and rejects either
   scheme with the opposite explicit cookie value.
9. Attempt to run the local pilot launcher with
   `MOLDPILOT_DEPLOYMENT_MODE=production`.

Expected:

- Login errors remain generic. Account and source buckets apply temporary
  progressive backoff that survives app restart and recovers after expiry.
- Authorization occurs before upload body processing. Streaming size,
  allowlist, signature, and archive checks reject unsafe fixtures.
- Scanner failure never creates a downloadable FileAttachment; bytes remain in
  private quarantine until cleanup or explicit security review.
- Released files use opaque names outside executable/public paths.
- Attachment responses enforce visibility, private/no-store caching,
  `nosniff`, and attachment disposition where appropriate.
- In preferred HTTPS mode, Next.js listens only on `127.0.0.1:3000` and Caddy
  exposes HTTPS to the approved factory CIDR. In temporary HTTP mode, Next.js
  binds only to the hostname/IP in `MOLDPILOT_BASE_URL`, never `0.0.0.0`, and
  prints that credentials and cookies are not encrypted.
- HTTPS resolves to Secure cookies; HTTP resolves to non-Secure cookies while
  retaining HttpOnly, SameSite=Lax, path, and expiration controls.
- The local pilot launcher exits before migration or seed in production mode
  and directs the operator to `scripts/server-deploy-macos.sh`.
- The backup is versioned, encrypted, off-machine, non-overwriting, and the
  manifest-verified scratch restore succeeds.
- No secrets, business uploads, dumps, certificates, scanner output, or the
  quarantined legacy workbook are committed.

### AT-033: Docker D1 Standalone Runtime Foundation

Layer: Domain + deployment inspection + disposable container smoke

Preconditions:

- Docker Desktop is running on a development machine.
- No inherited database URL or Compose project name is marked as production.
- The native Mac mini service and live PostgreSQL database remain untouched.

Steps:

1. Inspect the immutable D1 checkpoint
   `f4af0e7 Docker D1: add standalone container runtime foundation`.
2. Build and inspect the default production image user, environment,
   filesystem, health check, and architecture metadata.
3. Run `pnpm docker:d1:smoke`, which is retained after D2.1 as a compatibility
   alias to the hardened disposable runtime proof.
4. Observe the one-time migration target, application health, scanner
   readiness, and scoped cleanup.

Expected:

- The final image uses the pinned Node 24 Debian-slim multi-architecture base,
  contains Next standalone/static/public assets plus the generated Prisma
  runtime and CJK PDF font, and runs as UID/GID `10001:10001`.
- `/api/health/live` returns `200` with `{ "status": "ok" }` without querying
  PostgreSQL. `/api/health/ready` returns `200` only when PostgreSQL and both
  persistent directories plus the configured scanner are ready; failure
  returns `503` with component states and no path, URL, credential, scanner
  output, SQL error, or stack trace.
- Startup rejects missing production configuration or unwritable persistent
  directories before Next starts. Container startup requires explicit private
  clamd configuration and never invokes or falls back to Homebrew ClamAV.
- The normal runtime entrypoint never migrates, seeds, or resets data. The
  disposable migrator applies migrations only to an internal PostgreSQL 16
  service with no published port.
- The smoke project name is unique; `/login`, liveness, and readiness return
  `200`; Docker reports the app healthy; and the process is non-root.
- Success and failure both remove only uniquely named disposable smoke
  containers, networks, volumes, and temporary images. Production scripts never
  use `docker compose down -v`.
- No `.env`, secret, upload, backup, RAW, generated export, browser artifact,
  or offline package cache exists in the final image.
- D1 remains the immutable runtime-foundation checkpoint. The compatibility
  smoke includes D2.1 hardening but is not a production-cutover acceptance.

### AT-034: Docker D2.1 Private Scanner And Persistent Attachment Proof

Layer: Domain + deployment inspection + disposable real-container smoke

Preconditions:

- Docker Desktop is running with at least 4 GiB available to the Linux VM.
- The native Mac mini service, live PostgreSQL database, parent production
  Compose/Caddy topology, and production data remain untouched.
- The exact pinned ClamAV image supports the host architecture.

Steps:

1. Run `CI=true node --test tests/domain/clamd-scanner.test.ts`.
2. Run `pnpm docker:d2:smoke`.
3. Observe scanner startup and readiness.
4. Observe clean PDF, EICAR, scanner-outage, recovery, and app-replacement
   checks.
5. Inspect the final cleanup inventory.

Expected:

- Every clamd socket has meaningful `error`, `end`, and `close` handling from
  before connection through actual socket close, including before the first
  write, between 64 KiB chunks, between the terminator and response reader, and
  after response completion before destruction. Listeners and operation waiters
  are removed exactly once without `MaxListeners` warnings.
- `ECONNRESET`, `EPIPE`, refusal, write failure, premature end/close, and
  connect/response/total timeout return scanner unavailable. Malformed or
  oversized responses, daemon `ERROR`, and invalid or oversized input remain
  scanner error.
- Deterministic reset tests cover idle-socket failure, reset after `INSTREAM`,
  reset between chunks, and PING reset. A strict child process with no
  process-level exception handlers survives 30/30 injected resets, returns
  `unavailable` for every scan, exits 0, and emits no uncaught exception,
  unhandled rejection, transport error, or listener warning.
- The disposable clamd service derives from
  `clamav/clamav:1.4.5-debian13-slim` pinned by exact digest, runs through
  `/init-unprivileged` as the image's `clamav` UID/GID, and shares a private
  internal scanner network only with MoldPilot. Port 3310 is never published.
- Virus definitions persist in a named disposable volume. Clamd accepts at
  least the current 300 MiB MoldPilot upload limit. The preflight rejects a
  Docker VM with less than 4 GiB available memory.
- Readiness returns `200` only when PostgreSQL, released-file storage,
  quarantine storage, and exact scanner `PONG` checks pass. Scanner outage
  produces a non-sensitive `503`, liveness remains `200`, and readiness returns
  to `200` when clamd recovers.
- A runtime-generated valid PDF returns clean, creates one released
  `FileAttachment` and one activity record, and downloads with identical
  SHA-256 before and after force-replacing only the app container.
- A runtime-assembled EICAR fixture is rejected as infected and creates no
  released file, quarantine residue, attachment row, or activity record. The
  EICAR signature is not stored contiguously in the repository.
- During scanner outage, upload fails with `503`, creates no released file,
  attachment row, or activity record, and retains the private quarantined file
  according to the existing unavailable-scanner retention rule. That file and
  its SHA-256 survive app-container replacement.
- Protocol unit tests cover framing, chunking, backpressure, exact response
  parsing, clean, infected, unavailable, malformed, timeout, oversized input
  and response, PING, and local-command compatibility.
- Success, failure, interruption, and termination remove only the unique
  disposable containers, two internal networks, four named volumes, fixtures,
  and temporary images created by the run.
- Passing AT-034 does not claim production readiness. D2.2 platform
  integration, backup/restore, deploy, migration, and rollback remain open.

### AT-035: Docker D2.2.1 Production Package Rehearsal

Layer: Domain + deployment inspection + disposable real-container rehearsal

Preconditions:

- D2.1 is preserved in commit `8680d63`.
- Docker Desktop is running with at least 4 GiB available to its Linux VM.
- The MoldPilot worktree is clean and identifies the exact local checkpoint to
  rehearse.
- No inherited Compose project, database URL, or environment is marked as
  production.
- Native Caddy, native MoldPilot/PostgreSQL, live data, and the parent
  development Compose file remain untouched.

Steps:

1. Run `CI=true node --test tests/domain/platform-production-package.test.ts`.
2. Render `../ops/compose.production.yml` with disposable values.
3. Run `bash ../ops/scripts/moldpilot-production-smoke.sh`.
4. Observe initialization, runtime identities, synthetic workflow checks,
   backup, isolated restore, and final cleanup.

Expected:

- The rehearsal refuses a dirty MoldPilot worktree. App, migrator, and ClamAV
  images build from one exact committed source export; app/migrator tags contain
  that full commit SHA.
- `moldpilot-clamav-volume-init` runs once with no network, a read-only root
  filesystem, all capabilities dropped except `CHOWN`, normalizes the dedicated
  signature volume, and exits 0.
- `moldpilot-clamav-signature-seed` runs once as `1000:1000` with no network or
  capabilities, copies bundled definitions only for an empty volume, verifies a
  non-empty signature database, and exits 0.
- Long-running FreshClam and clamd run directly as UID/GID `1000:1000`, with
  read-only roots and all capabilities dropped. FreshClam uses only its
  signature volume and `/tmp` as writable storage. It does not use `setpriv`,
  `SETUID`, `SETGID`, `SYS_ADMIN`, or broad capabilities.
- FreshClam remains healthy after stop/start against the existing signature
  volume. clamd mounts that volume read-only and retains `SelfCheck` reload.
- Only MoldPilot publishes a port, and only on `127.0.0.1`. PostgreSQL 5432 and
  clamd 3310 have no host binding.
- Explicit migrations run once; normal app startup does not migrate, seed, or
  reset. Real login to synthetic `MP-D22-REHEARSAL-001` succeeds.
- A runtime-generated clean PDF scans, releases, records, downloads, and keeps
  the same SHA-256 after app replacement.
- A runtime-fragmented EICAR fixture returns 422 and creates no released file,
  quarantine residue, FileAttachment, or ActivityLog.
- With clamd stopped, liveness stays 200, readiness and upload return 503, no
  FileAttachment/ActivityLog is created, and one quarantine file is retained.
- App-only restart and force-replacement leave PostgreSQL, clamd, and FreshClam
  container IDs unchanged.
- The helper container creates a non-empty encrypted backup covering database,
  uploads, quarantine, signatures, release metadata, protected environment
  recovery material, and rendered Caddy recovery configuration. Plaintext work
  is removed.
- A second uniquely named scratch stack verifies archive paths and SHA-256
  manifest, restores into non-production volumes, starts, authenticates, shows
  the synthetic project, and downloads the attachment with the same SHA-256.
- Success, failure, and interruption remove only unique rehearsal/scratch
  containers, networks, volumes, fixtures, archives, and temporary images.
- Passing AT-035 accepts the package for independent D3 planning only. It does
  not activate native Caddy, deploy containers, import live data, or authorize
  cutover. The parent platform package still needs a version-control/release
  strategy before D3.

Verified 2026-07-26 from clean commit
`853f04e2e3e4aa53c50ff89e5e1e6d2614449730`: all AT-035 runtime steps passed.
The scratch restore contained one synthetic project and one attachment; the
attachment SHA-256 before app replacement and after restore was
`171320f8998c508c92d99f78d87054bc793c1219e6dee56de29af0a40a94880a`.
The encrypted archive was `175659064` bytes. Success cleanup left no
rehearsal/scratch containers, networks, volumes, fixtures, archives, or
temporary images. This evidence accepts the D2.2 package rehearsal only; it
does not change the production deployment state.

## Exit Criteria

Before Phase 1 v0.1 is accepted:

- AT-001 through AT-015E should pass.
- AT-016 through AT-031, including AT-020A through AT-020D, should pass before any real internal pilot, including AT-001C and AT-005A.
- Deferred tests must be clearly marked with reason and owner.

## First Tests To Implement

Implement these first because they protect the core business logic:

1. AT-007: Completed trials count, planned trials do not.
2. AT-011: Trial limit warning states.
3. AT-012: Design change before first trial does not add allowance.
4. AT-013: Design change after first trial adds one approved allowance.
5. AT-014: Fourth trial requires prior completed trials and reason.
6. AT-009: Prevent TrialIssue closure without required fields.
7. AT-006A: Reject actual trial without result.
8. AT-015B: Reject new planned trial without date or reason.
