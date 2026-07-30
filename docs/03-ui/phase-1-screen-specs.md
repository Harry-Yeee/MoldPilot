# MoldPilot Phase 1 Screen Specs

## UI Principle

Phase 1 screens should be simple operational tools, not a large ERP dashboard.

The interface should help users answer:

```text
What trial is planned?
Did it happen?
If not, why?
If yes, what issues remain?
If another trial is needed, why?
How many trials have we used?
Are we near or over the trial limit?
```

## Navigation

Recommended first navigation:

```text
Trial Dashboard
Mold Trial List
Mold Trial Detail
Admin, later/minimal
```

Most operational work should happen from the Mold Trial Detail page.

On desktop (lg and up) that page carries a sticky section rail whose entries are built from the sections actually rendered, each section repeating its rail swatch as a 4px left rule plus a tinted header band, above a six-step stage stepper that uses the training poster's stage names verbatim; below `lg` none of it renders and the phone layout is unchanged.

On the dashboard/header, Admin and My tasks should appear as sibling buttons in one nav/action group when both are visible. Desktop should show them in one horizontal row with consistent spacing; small screens may wrap when needed.

Manager/staff score navigation is role-aware:

- A user with `reports.management.view` sees a `Reports` button linking to `/reports`.
- Scored staff see `My Score` linking to `/score` only when the staff scoreboard is enabled.
- Admin/GM are not scored and should not be sent to an empty personal score page.
- The `Admin` configuration button remains separate from `Reports`; GM can view reports without receiving Admin configuration access.

## Shared Display Rules

### Language

MoldPilot Phase 1 supports English (`en`) and Simplified Chinese (`zh-CN`) from the same local app.

Rules:

- English is the default language.
- A visible language switcher appears in the main header/account area and on login.
- The selected language is remembered across reloads/navigation with a local cookie/storage setting.
- The `moldpilot_language` provider/cookie setting is the only UI-language source. No screen, including project detail and `/me`, may derive display language from `User.locale`.
- Server components use `getCurrentLanguage()`/the matching dictionary. Client components use `useI18n()`. Older bilingual-label components convert the active language with `localeFromLanguage()`.
- The standalone `/me` My Tasks page and the mobile My Tasks panel embedded on the dashboard use the same selected language and update together.
- `/me` includes the shared Language Switcher beside an always-available Dashboard link. At 360–430 px, these controls may wrap as one action group but must not overlap or create horizontal scrolling.
- Translate interface text, headings, tabs, labels, buttons, status labels, enum display labels, empty states, and common workflow messages.
- My Tasks translation includes trial and issue statuses, severity, missed-trial reasons, responsible areas, issue-status options, design-change requester labels, countdown/date-confirmation labels, bottom sheets, and generated trial titles such as `T0 trial` / `T0 试模`.
- Dashboard, project detail, Admin, Reports, Calendar, My Tasks, Score, attachments, lightbox/photo gallery, measurement reports, and Customer Files use the same active language. Dates, days-away text, trial-limit badges, system empty/error states, placeholders, and accessibility labels follow it.
- Dashboard next-trial and limit-basis display is built from stable kinds/codes plus sequence numbers, never by parsing completed English sentences.
- Translate protected/default role and responsibility-group names by stable code. Preserve custom role, group, and process-template section names exactly as entered.
- Trial display names are sequential: sequence 1 is T0, sequence 2 is T1, sequence 3 is T2, and sequence 4 is T3. Do not show the stored `EXTRA` enum as “Extra”.
- Do not translate user-entered business data: mold codes, project/client refs, client names, part codes, issue titles, notes, machine brands, uploaded/report content, or historical record payloads.
- Keep URLs simple; do not require `/en` or `/zh-CN` route prefixes in Phase 1.

### Identity Fields

Every project/mold header should show:

- Mold code first, once known
- Optional Project Code / Client Ref
- Internal tracking ID where useful for troubleshooting or blank-intake records
- Customer code
- Primary part code and part/cavity count
- Mold code
- PM
- Secondary PM, if assigned
- Status
- Priority

Customer display name may appear in authorized Customer Master views, customer lookup/select controls, and PM/Marketing/Admin/GM project context where helpful. Never show or collect customer country, customer contact person, customer email, customer phone, quote value, sales stage, customer portal data, or communication history in Phase 1.

### Account Display

Phase 1 uses admin-assigned internal accounts.

Show user display name and role in the account menu after login. Normal pilot use requires username/password login and forced first-password change for seeded/default accounts.

### Trial Limit Badge

Every list/detail view should show:

```text
completed trial count / current trial limit
```

Examples:

```text
0 / 3
1 / 3
2 / 3 Near Limit
3 / 3 At Limit
4 / 3 Over Limit
3 / 4 Design Change Allowance
4 / 3 Extra Trial
```

### Status Colors

Suggested statuses:

| Status | UI treatment |
| --- | --- |
| Waiting Trial | Neutral. |
| Trial Delayed | Warning. |
| In Correction | Active. |
| Waiting Verification | Attention. |
| Approved | Success. |
| Near Limit | Warning. |
| At Limit | Strong warning. |
| Over Limit | Critical. |
| Pending Follow-Up | Attention. |
| Blocked | Critical/attention. |
| Paused | Muted. |
| Closed | Muted/success depending final outcome. |

### Trial Issue Row Colors

Issue tables should use subtle status row treatments:

| Issue status | UI treatment |
| --- | --- |
| Open, In Progress, Waiting Internal, Waiting Customer, Waiting Supplier, Waiting Verification | Pale warning/yellow row background. |
| Closed | Pale success/green row background. |
| Other/unknown | Neutral. |

Keep the visible status text or chip in the row. Do not rely on color alone.

## Screen 1: Trial Dashboard

### Purpose

Give GM and PM a quick view of trial health.

### Primary Users

- GM
- Planning PM
- Technical PM
- PM Assistant
- Marketing / Sales for customer-feedback-related view

### Widgets

| Widget | Shows |
| --- | --- |
| Upcoming Trials | Trials planned in the next 7 or 14 days. |
| Delayed Trials | Planned trials that did not happen on time. |
| Near / At / Over Limit | Projects with trial-count risk. |
| Open Critical Issues | High and critical trial issues not closed. |
| Waiting Verification | Issues corrected but not verified. |
| Pending Follow-Up | Trials waiting for QC or customer feedback. |
| New Trial Reasons | Why new trials were added. |
| Missed-Trial Reasons | Top reason categories for missed trials. |

### Table Columns

The dashboard should include a compact list:

| Column | Notes |
| --- | --- |
| Mold Code | Link to detail. Show internal tracking ID if mold code is not set yet. |
| Project Code / Client Ref | Optional. |
| Customer Code | Code by default; display name optional for authorized PM/GM/Admin context. |
| Next Trial | T0/T1/T2/T3 and later, derived from sequence number. |
| Planned Date | Next planned date. |
| Trial Count | Example: 2 / 3. |
| Open Issues | Total open. |
| Critical | High/critical open count. |
| Status | Waiting Trial, Delayed, In Correction, etc. |

### Empty States

If there are no delayed trials:

```text
No delayed trials
```

If there are no upcoming trials:

```text
No upcoming trials scheduled
```

## Screen 2: Mold Trial List

### Purpose

Main working list for all tracked molds.

### Primary Users

- Planning PM
- PM Assistant
- GM
- Technical PM
- Marketing / Sales with customer-feedback issue access
- Injection Manager and QC with filtered/relevant view

### Filters

- Status
- Next planned trial date range
- Trial count state: Healthy, Near Limit, At Limit, Over Limit
- Open issue severity
- Planning PM
- Technical PM
- Customer code
- Customer display name / short name
- Project code
- Mold code

### Columns

| Column | Notes |
| --- | --- |
| Mold Code | Link to detail. Show internal tracking ID if mold code is not set yet. |
| Project Code / Client Ref | Optional. |
| Customer Code | Code by default; display name optional for authorized PM/GM/Admin context. |
| Parts | Primary part code plus count, such as P-014-A +2. |
| Mold Code |  |
| Status | Current mold trial project status. |
| Next Trial | T0/T1/T2/Extra. |
| Next Planned Date |  |
| Trial Count | Completed / limit. |
| Open Issues | Count. |
| Critical Issues | Count. |
| Last Trial Result | Approved, Not Approved, Conditional, Pending QC. |
| Last Update | Date/time or relative label. |

### Primary Actions

- Create mold trial project.
- Open detail.
- Record trial, if trial is due or completed.
- Resolve auto-missed trial, if planned date passed with no result by next-day noon.
- Add new planned trial with reason.
- Add client-feedback issue, for Marketing/Sales.

## Screen 3: Create Mold Trial Project

### Purpose

Start tracking one mold trial cycle.

### Primary User

- Planning PM
- PM Assistant with PM direction
- Admin for setup/testing

### Required Fields

- Customer selected from searchable Customer Master lookup
- At least one part/cavity row
- Priority

### Optional Fields

- Project Code / Client Ref
- Mold code while status remains Intake/Draft
- Planning PM
- First planned trial date, for PM/Admin users who can schedule T0
- Additional part/cavity rows
- Part name, cavity label, cavity count, and part notes
- Inserts 嵌件, a multi-select checkbox group in the main grid (IML, IMD, threaded nut, magnet, metal terminal, stamped metal, glass/lens, other). Nothing checked means no inserts. Correctable later in the project Identifiers form.
- Base trial limit, default 3
- Notes
- Initial feedback/design-change note

### Validation

- Internal tracking code must be unique. If no Project Code / Client Ref is entered, the system generates an internal tracking code.
- Customer must be selected from active Customer Master records.
- Free-typed customer text must not be accepted as the stored project customer.
- At least one part code is required before active trial tracking.
- Mold code is required before first T0 scheduling, later scheduling, missed/completed trial recording, and trial issue activity.
- First planned trial date is optional during intake and required only when PM/Admin schedules T0.
- Base trial limit defaults to 3.
- Customer country, contact, email, phone, quote, sales-stage, portal, and communication-history fields must not exist in the create-project UI.
- Secondary PM is not shown on the project creation page.

### Result

After creation:

- MoldTrialProject is created.
- MoldTrialProject stores selected customer reference and customer code snapshot.
- One or more MoldTrialPart records are created.
- Initial planned TrialEvent is created only when first planned T0 date is supplied by an authorized user.
- ActivityLog entry is created.
- User lands on Mold Trial Detail.

## Screen 4: Mold Trial Detail

### Purpose

Single source of truth for one mold trial cycle.

### Header

Show:

- Mold code, once known
- Optional Project Code / Client Ref
- Customer code
- Primary part code and part/cavity count
- Inserts 嵌件 as neutral chips, only when the project has any; no row at all when it has none
- Status
- Priority
- PM
- Trial count badge
- Next planned trial date with days away, such as `+5 days`, `0 days`, or `-2 days overdue`

Hide Internal Tracking ID unless Mold Code and Project Code / Client Ref are both blank, or Admin/support context needs it for troubleshooting.

Show Intake Note and Initial Customer Note side by side when screen width allows.

### Sections

| Section | Purpose |
| --- | --- |
| Trial Panel | Shows T0/T1/T2 and extra trial panels, trial results, trial issue entry, auto-missed resolution, prior issue verification, and compact trial-limit badge. |
| Digital Process Sheet | Shows process parameters as rows and trial events as comparison columns, with current trial editable by permitted users. |
| Parts / Cavities | Shows all part codes, optional cavity labels/counts, notes, and active/archived state. |
| Open Trial Issues | Avoid a large global update panel. Normal issue work happens inside the trial panel where the issue was found. |
| Planning & Change History | Shows resolved missed trials, auto-missed corrections, new-trial reasons, design-change reasons, and extra-trial/limit adjustment history. |
| Activity Log | Shows operational history. |

Trial Panel behavior:

- Show default collapsed panels for T0, T1, and T2.
- If no trials have happened, keep trial panels collapsed but show the next planned trial summary.
- Record completed trial/result inside the relevant T panel.
- Add trial issues inside the relevant T panel.
- If a planned trial has no result by 12:00 PM on the next calendar day, show `Auto Missed - Reason Required` inside that T panel.
- Auto-missed panels can be resolved by entering missed reason/new planned date, marking blocked/paused with explanation, or entering a late completed-trial result if the trial actually happened.
- Late completed-trial entry after auto-miss must keep visible audit history.
- T0 can create trial issues from inside the T0 panel.
- T1 and later show prior unresolved issues as a verification list with Addressed, Pending, Not Verified, or Closed status.
- Each trial panel shows issues found in that trial as a compact table with Edit and Close Issue actions.
- Add Trial Issue uses the full available trial-panel width, not a half-width column.
- TrialIssue owner selectors show active users as `Role / Display Name / Chinese Name`, such as `PM / Bill / 王比尔`; if Chinese name is blank, show `-` in that position and do not show username unless duplicate disambiguation is intentionally added.
- Edit opens a modal/popup for the simple issue fields.
- Close Issue opens a focused modal requiring fix summary, approximate fix time, and closed date defaulting to today.
- If the closer is not the issue owner, the close modal requires a non-owner close reason explaining why the owner did not close it.
- Trial issues should also appear as correction checklist items before the next trial. Assembly self-check is separate from issue closure.
- A 4th trial panel can appear only after T0/T1/T2 are completed and a visible extra-trial reason is recorded.
- A 5th trial panel can appear only after the 4th trial is completed and a visible extra-trial reason is recorded.
- Design change is an extra-trial/customer-driven reason option, not a standalone page-level panel. When selected, collect notes and customer/internal source as needed.

### Primary Actions

- Add new planned trial with reason.
- Export customer-safe Process Sheet PDF.
- Close project.

Most trial actions should appear inside the relevant trial panel. Actions should appear only if the user has permission, but server-side permission checks remain required.

## Screen 4A: Digital Process Sheet

### Purpose

Replace paper process setup sheet entry with structured web entry and horizontal trial comparison.

### Primary Users

- PM
- Injection
- Marketing for customer-safe PDF export
- GM/Admin for view/review

### Layout

- Left frozen column: process parameter label, bilingual where available.
- Trial columns: T0, T1, T2, and extra trials, using MoldPilot's strict visible sequence.
- Do not show labels such as `T0 #1`, `T0 #2`, or `T1 #3`.
- Current trial column is editable for permitted users.
- Previous trial columns are read-only by default.
- Section bands should follow the source template shape:
  - Material Information
  - Machine Information
  - Process Information
  - Barrel Settings
  - Velocity Profile
  - Hold Pressure
  - Other Settings
  - Tool Data
  - Hot Runner Settings
  - Six Consecutive Shots Part Weight
- Do not show an editable Trial Summary section in normal Phase 1 use.

### Required Behaviors

- Machine field uses Injection Machine Master selector, not free text.
- Search machine selector by numeric No. and clamping force.
- Selecting a machine fills machine No./clamping-force snapshot fields for the trial report.
- Show the current editable trial in the sheet toolbar, such as `Editing: T1`.
- Show unsaved-change count, saving state, saved timestamp, and saved/error feedback inside the sheet panel.
- Pressing Enter in an editable process value moves to the next editable value. Shift+Enter moves to the previous editable value. Enter should not submit the form.
- `Copy Previous Trial` copies the immediate previous trial's machine selection and process parameter values into blank current-trial fields by default.
- If the current trial already has process values, overwriting them requires an explicit confirmation path.
- Copy Previous Trial must not copy trial result, issue records, major issue summary, correction summary, next action, Assembly self-check, or accountability fields.
- Saving or copying process-sheet values must not create a new trial panel.
- Keep explicit Save in Phase 1; do not autosave.
- Trial result, major issues, correction summary, and next action do not appear as editable process-sheet rows. They are recorded in the Trial Result panel and TrialIssue records.
- Full issue details remain below the sheet grouped by trial.
- Customer-safe PDF export omits internal accountability fields unless explicitly customer-visible.
- `Export Customer PDF` shows an exporting/downloading state, creates one reusable `CUSTOMER_SAFE` Process Sheet attachment, downloads it through the protected attachment route in the current browser, and reports success or failure inside the panel.
- A successful export refreshes project data so the generated PDF appears in Customer Files and can be downloaded again. Export must not merely redirect, open a blank tab, or trigger a zero-byte download after failure.

### Validation

- Process values save as structured TrialProcessValue records.
- PDF export stores bytes under the attachment storage root with a server-generated attachment UUID and records `application/pdf`, actual byte size, `CUSTOMER_SAFE` visibility, one FileAttachment, and one ActivityLog.
- The protected attachment route remains the download boundary and returns attachment `Content-Disposition`; export permission does not bypass attachment download permissions.
- Customer-safe export must not include internal owner, private notes, Assembly self-check, or unapproved root-cause details.

## Screen 5: Record Trial Form

### Purpose

Capture what happened when a mold trial occurs.

### Primary Users

- Injection Manager
- Planning PM
- Technical PM
- QC for QC fields

### Required Fields

- Trial code
- Planned date
- Actual date
- Result

### Optional Fields

- Machine
- Mold status
- Sample quantity
- Main issues summary
- Outcome note

### Validation

- Actual date is required for completed trial.
- Completed trial counts against limit by default.
- Result is required.
- Result options are Approved, Conditional, Not Approved / Rework Required, Pending QC, Pending Customer Feedback, and Invalid Trial.
- The legacy result-disposition field is not shown or required in the normal Record Result panel.
- Follow-up owner and follow-up due date are not shown on Record Result. Follow-up belongs on TrialIssue rows.
- Legacy machine note is not shown. Material is not shown because material belongs in the Digital Process Sheet.
- If result is Conditional, Not Approved / Rework Required, Pending QC, Pending Customer Feedback, or Invalid Trial, the trial must have at least one TrialIssue linked to that same trial before saving.
- Add Next Planned Trial must block when the previous actual trial is non-approved and has no same-trial TrialIssue. Issues from other trials do not count.

### Result

After save:

- TrialEvent status becomes Completed.
- Trial count recalculates.
- Project status updates.
- Result and optional outcome note are visible in the completed trial panel.
- ActivityLog entry is created.
- User can add trial issues.

## Screen 6: Auto-Missed Resolution

### Purpose

Resolve a planned trial that reached the next-day noon cutoff without a recorded result.

### Primary Users

- PM
- Injection Manager or QC for relevant cases

### Resolution Paths

- Confirm truly missed and enter reason/new planned date.
- Mark project Blocked or Paused with explanation if the next date is unknown.
- Enter late completed-trial result if the trial actually happened.

### Required Fields When Truly Missed

- Planned trial date
- New planned trial date
- Reason category
- Responsible area
- Explanation

### Validation

- New planned trial date is required unless the project is marked Blocked or Paused.
- Reason category is required.
- Responsible area is required.
- Explanation is required.
- Late completed-trial correction requires actual date and result.
- Every resolution path creates ActivityLog history.

### Result

After save:

- MissedTrialEvent is created.
- Linked TrialEvent becomes Delayed, if applicable.
- Project status becomes Trial Delayed.
- New planned trial date creates or updates next TrialEvent.
- ActivityLog entry is created.

If resolved by late completed-trial entry:

- Linked TrialEvent becomes Completed.
- Auto-missed state is marked resolved.
- ActivityLog records the late-entry correction.

## Screen 7: Add New Planned Trial Form

### Purpose

Allow another planned trial to be added with a clear reason and date by users who have `trial.schedule.reschedule`.

### Primary Users

- Planning PM
- Technical PM
- PM Assistant
- Injection Manager for process retest reasons
- Admin

Marketing/Sales reports customer-driven reasons through intake notes or client-feedback TrialIssues. QC records QC findings and verification status, and can suggest follow-up, but QC does not schedule trials by default.

### Required Fields

- Trial code or sequence
- New planned trial date
- Reason category
- Requested by
- Source area

### Optional Fields

- Reason detail
- Design change source/date/title, only when reason is design-change related

### Optional Links

- Related prior trial
- Related trial issue
- Related design change
- Related missed-trial event

### Marketing / Sales Reason Categories

These categories can appear as customer-driven reasons, but Marketing/Sales should not create the planned trial directly unless Admin explicitly grants `trial.schedule.reschedule`.

- Customer design change
- Bad customer feedback
- Customer sample rejection
- Customer requirement clarification

### Internal Reason Categories

- Internal rework
- Trial issue verification
- QC failure
- Mold correction verification
- Injection process retest
- Aborted or invalid previous trial
- Other documented reason

### Validation

- New planned trial date is required.
- Reason category is required.
- Reason detail is optional.
- User must have `trial.schedule.reschedule`.
- Marketing/Sales and QC are blocked from scheduling by default.
- Adding a new planned trial creates ActivityLog.
- Design change source defaults to `No / None`.
- Hide or disable design-change source, design-change date, and design-change title unless the reason is design-change related.
- Design change title is optional and should not block adding a new planned trial by itself.

### Result

After save:

- Planned TrialEvent is created.
- Next planned trial date updates.
- Reason appears in New Trial Reasons.
- Trial count does not increase until the trial is completed.

## Screen 8: Trial Issue Table And Modals

### Purpose

Record, edit, and close issues inside the trial panel where they were introduced.

### Primary Users

- Technical PM
- Planning PM
- Marketing / Sales for client-feedback issues
- Injection Manager
- QC

### Create Required Fields

- Title
- Found at trial
- Severity
- Issue type
- Source
- Status
- Owner
- Due date

### Row Actions

- Edit
- Close Issue

### Edit Modal Fields

- Title
- Affected part, optional
- Issue type
- Source
- Severity
- Status
- Owner
- Due date
- Description

### Close Issue Modal Fields

- Fix summary / how it was fixed
- Approximate time spent
- Closed date, default today
- Non-owner close reason, required only when the closer is not the owner

### Optional Fields

- Affected part, optional
- Description
- Advanced QA fields, later

### Validation

- Marketing/Sales-created issues must use a customer/client feedback source.
- Marketing/Sales can clarify feedback and may close only their own assigned feedback issue unless permissions are changed later.
- Issue owner can close their own issue.
- PM and GM can close any issue.
- When the closer is not the issue owner, non-owner close reason is required.
- Cannot close issue without fix summary.
- Cannot close issue without approximate time spent.
- Cannot close issue without closed date.
- Closed issue rows disable/gray Edit and Close Issue for all non-GM users. Close Issue may display as `Closed`.
- GM can edit a closed issue through an explicit GM override path, and the override creates ActivityLog history.
- The simple Add Trial Issue form is full-width within the trial panel and shows only Title, optional Affected Part, Issue Type, Source, Severity, Status, Owner, Due Date, and Description.
- Owner and Due Date are required. The create form does not offer `Unassigned` as the default owner.
- Source Detail, Responsibility Area, root cause, corrective action, verification method/result, Assembly acknowledgement/self-check, PM readiness, and Closed Date are hidden from the simple create form.
- Do not show a large global Update Issue panel in the normal detail view.

## Screen 9: Trial Panel And Compact Limit Badge

### Purpose

Make trial progress and trial-limit discipline visible without turning the page into a limit-management screen.

### Shows

- Default T0/T1/T2 collapsible trial panels
- Extra trial panels only after prerequisites are met
- Completed trial count / current allowed count badge
- Warning state: Healthy, Near Limit, At Limit, or Over Limit
- Trial result for completed panels
- Auto Missed - Reason Required state when planned trial has no result by next-day noon
- Prior issue verification checklist for T1 and later
- Design-change reason and extra-trial reason links in Planning & Change History

### Actions

- Record trial result inside the relevant panel.
- Add issue from a trial panel.
- Resolve auto-missed trial from the relevant panel.
- Mark prior issues addressed, pending, not verified, or closed.
- Add extra-trial reason when the first three completed trial panels are filled.

### Validation

- Design change is captured as a reason/source in the trial-panel flow, not as a standalone page-level panel.
- Extra trial panels require all prior trial panels to be completed and a visible reason to be recorded.
- Auto-missed trials require missed reason/new date, blocked/paused explanation, or late completed-trial correction before the workflow can move forward cleanly.
- Closed issues require fix summary, approximate fix time, closed date, closed by user, and non-owner close reason when the closer is not the issue owner.
- Trial-limit and extra-trial changes create ActivityLog records.

## Screen 10: Minimal Admin

### Purpose

Support setup, users, roles, and Phase 1 permission tuning without becoming a full enterprise admin system.

### v0.1 Needs

- Users
- Roles
- Role permissions
- Customers
- Injection Machines
- Fixed process-sheet/report templates
- Optional user-specific permission overrides
- Issue responsibility areas / owner groups
- Issue categories
- Missed-trial reason categories
- New-trial reason categories

User setup fields:

- Username/account code
- English display name
- Chinese name, optional
- Role
- Active/inactive
- Temporary password/reset password state

User setup does not ask for department group in Phase 1. Role defines account permissions; issue responsibility area / owner group is selected on TrialIssue forms.

Existing user rows use staged batch editing. The Users tab should show a sticky bottom action bar with Unsaved changes count, Save changes, and Discard changes. Edited rows/cells should be visually highlighted, and Admin should be warned before leaving with unsaved changes. Reset Password remains a separate explicit action.

Email remains optional. Passwords are required for login, stored only as hashes, and Admin can reset a user to a temporary password.

Client setup fields:

- Client code, required and unique
- Client short name / abbreviation, required
- Owner, optional active-user dropdown
- Notes / deal year, optional
- Active/archive state

Customer setup must not include country, contact person, customer email, customer phone, quote value, sales stage, portal access, or communication history.

Admin should see Clients as a separate tab from Users and Roles & Permissions. Active and archived clients may be split into separate tables, similar to user archive behavior.

The Clients table should match the real workbook shape and avoid unnecessary fields:

| Column | Source |
| --- | --- |
| No. | 序号 |
| Client Code | 客户代码 |
| Client Short Name | 客户简称 |
| Owner | 负责人, selected from active users |
| Notes / Deal Year | 备注/成交年份 |
| Actions | Save, archive, restore where applicable |

Owner assignment should use a dropdown of current active users, not roles. Show English name by default and Chinese name when available, such as `Anna / 刘婉霞`.

Injection Machine setup fields:

- No., required, unique, numeric only
- Clamping Force
- Brand
- Shot Weight
- Row actions: Save and Delete

Do not show display name, model, nozzle/orifice, notes, or active/archive status in the normal Admin Machines panel.

Machine setup should import or seed from `RAW/Injection-Machines-2026.07.02.xls` for the real local pilot. Rows should sort by numeric No. ascending, such as 1 through 26. Active/selectable machines appear in trial/process-sheet machine selectors. Deleted machines remain visible on historical trials through snapshots when needed, but should not be selectable for new trial entries.

Fixed template setup:

- Admin may assign an active fixed process-sheet/report template to a Customer.
- A global default process-sheet template must exist.
- Phase 1 does not include a drag-and-drop template designer.
- Customer template choice is snapshotted onto a project when the project is created.

Existing client rows use staged batch editing. The Clients tab should show a sticky bottom action bar with Unsaved changes count, Save changes, and Discard changes. Edited rows/cells should be visually highlighted, and Admin should be warned before leaving with unsaved changes.

Project creation should use a searchable Customer selector:

- Search by client code, client short name, owner English name, owner Chinese name, or aliases if present.
- Show active customers only.
- Store the selected Customer reference and customer code snapshot.
- Do not allow free-text customer creation from the project form by default.
- After a customer is selected, the selector should not show a contradictory empty-results message while the hidden selected customer id remains set.
- Project creation must snapshot the customer/default process-sheet template so user-created projects show the Digital Process Sheet when a trial exists.

Permission management should support two practical views:

- By role: Admin selects a role and checks the workflow actions that role can perform.
- By process: Admin selects a process step and checks which roles/users can edit.

Suggested permission groups:

- Project Intake
- Trial Scheduling
- Trial Execution
- Trial Issues
- Assembly Correction
- QC Verification
- Trial Limit / Design Change
- Project Closure
- Admin

Permission changes must be server-enforced and logged. Business validation still applies even if permission is granted.

This screen can be very basic in early development, but it should not remain seeded-only once permissions begin to replace hardcoded role checks.

## Screen 11: Management Reports

### Purpose

Give Admin and GM an honest monthly view of mold-trial workload, workflow health, issue resolution, trial-loop pressure, and existing KPI scorecards without turning operational counts into automatic employee judgment.

### Access And Route

- Route: `/reports`.
- `Overview` and `Issues` require `reports.management.view` on the server.
- `Scorecards` and every individual score drilldown additionally require `kpi.scores.view_all`.
- Defaults: Admin and GM. Other roles have no default Management Reports access.
- The page is read-only in Phase 1. It links to source project/trial/issue records for action instead of mutating business state from a report.

### Shared Controls

- Calendar-month selector, defaulting to the current `Asia/Shanghai` month.
- Automatic comparison against the immediately previous calendar month.
- Visible selected period, as-of time, and data-completeness warning.
- English/Simplified Chinese labels through the shared i18n provider. User-entered issue titles, notes, mold codes, client names, and fix summaries remain untranslated.
- Tabs: `Overview`, `Issues`, and `Scorecards`.

### Overview

Keep the first viewport focused. Use a restrained summary strip or compact metric cards for:

- Completed trial runs, with absolute and percentage/count change from previous month.
- New molds reaching their first actual T0, with previous-month change.
- Unique molds trialed.
- On-time trial rate, always showing numerator and denominator.
- Projects first approved during the month.
- Open Critical issues now.

Below the pulse, show:

- Mold-trial workload: completed runs by week, trial result distribution, and trials planned for the next 30 days.
- Approval efficiency: approved on/before customer target (`n / eligible`, plus missing-target count) and low-loop approvals within T0/T1.
- Trial-limit pressure: current near-, at-, and over-limit active molds. Approved, Cancelled, and Closed projects are not current attention rows.
- Issue health: issues created/closed during the month, current open aging buckets (`0-7`, `8-14`, `15-30`, `31+` days), and severity/type breakdowns.
- Workflow/data completeness: missing Trial Results, missing Digital Process Sheets, missing QC reports, and unresolved auto-missed records.

Use `Mold-trial workload`, never `Factory utilization`: the system does not track normal production capacity.

### Management Attention

Show one actionable list near the top of Overview:

- Overdue High/Critical issues.
- Active molds over the trial limit.
- Failed/conditional/pending/invalid trials without valid same-trial issue accountability, if legacy or broken data exists.
- Projects needing a next planned trial after a non-approved result.
- Unresolved auto-missed trials.
- Missing Trial Result, Process Sheet, or QC Report records.

Each row links to the source project or trial. Do not add edit controls to the report itself.

### Issues Tab

Default the table to issues created in the selected month, with filters for severity, current status, issue type, fix-owner group/role, and a toggle for current open backlog.

Columns/details:

- Created date.
- Mold code and source trial stage.
- Title and issue type.
- Severity and current status.
- Fix owner (owner means fixer, not culprit).
- Due date and overdue state.
- Fix summary, approximate fix time, closed date/by, and verification state when available.

Open issues show `Not resolved yet` / `尚未解决`; they must not receive invented resolution text. Cause/reason summaries may aggregate by category, process, or department, but never show personal culprit counts.

### Scorecards Tab

- Reuse the existing monthly KPI scoring service, leader/group bars, and individual audit components from the Admin Scores implementation.
- Do not duplicate KPI calculation or create a second score table.
- Keep `scoreboard_enabled` behavior for staff `/score`; manager report access does not publish staff scorecards.
- If the viewer lacks `kpi.scores.view_all`, hide/disable the tab and block its data loader server-side.

### Privacy And Responsive Rules

- No customer country, contact, email, phone, quote value, sales pipeline, or communication history.
- Customer identity remains limited to the already-authorized internal project context; prefer mold code/customer code in dense tables.
- Desktop is the primary management surface. At 360-430 px, summary metrics stack, tab labels fit, tables use a controlled horizontal scroll or compact rows, and no header/control overlaps.
- Color may support severity/status, but every state remains readable in text.

## Mobile / Tablet Expectation

Phase 1 should work on desktop first.

Tablet/mobile support should be acceptable for quick updates:

- Review and act on `/me` My Tasks or the dashboard-embedded task panel in English or Simplified Chinese.
- Switch language from the `/me` header without overlapping Dashboard navigation or causing horizontal overflow at 360–430 px.
- Resolve auto-missed trial.
- Record trial result inside a trial panel.
- Add issue or issue photo later from a trial panel.
- Update issue status.
- Open Management Reports as Admin/GM, switch tabs/month/language, and reach source records without header overlap or clipped metric text.

No complex mobile optimization is required for the first build.
