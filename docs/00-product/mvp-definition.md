# MoldPilot Phase 1 MVP Definition

## Product Positioning

Phase 1 is a focused Mold Trial Tracker.

It is not yet a full project control tower, task board, purchasing tracker, customer query center, or ERP module.

The first usable version should answer a narrow but valuable question:

```text
We planned a mold trial. Did it happen on time?
If not, why not?
If it happened, what issues remain?
How many trials have we used against the allowed trial limit?
```

This gives the team a simple adoption path. They do not need to change every department workflow overnight. The company gets useful visibility immediately, then MoldPilot can grow module by module from real trial data.

## Primary Business Goal

Reduce uncontrolled trial loops by making planned trial dates, missed-trial reasons, open trial issues, and trial-count limits visible.

The first phase should expose upstream problems without requiring the whole company to enter a full ERP-style process.

## Phase 1 Scope

Phase 1 can start with a sanitized Marketing intake shell before the first T0 date is known. Active trial tracking starts when PM sets the first planned T0 date.

Phase 1 tracks:

- Internal tracking code
- Optional Project Code / Client Ref
- Customer selected from Admin-managed Customer Master
- Customer code snapshot for project/trial display
- One or more part/cavity records inside the same mold project
- Mold code, required before active trial scheduling but optional while Intake/Draft
- Planned trial date
- Actual trial date
- Trial number, such as T0, T1, T2
- Trial result
- Open trial issues
- Corrective actions
- Next planned trial date
- Trial count used
- Trial limit
- Design changes that affect trial limit
- Sequential extra-trial reasons and adjustment history
- Auto-missed planned trials after the next-day noon cutoff
- Missed-trial reasons when an auto-missed trial is resolved as truly missed
- New trial reasons when another trial is added
- Trial result after a trial happens
- Client-feedback trial issues entered by Marketing
- Marketing intake records waiting for PM scheduling
- Assembly correction acknowledgement and estimated correction finish date
- Assembly self-check before the next trial
- Admin-managed Injection Machine Master for trial/process-sheet machine selection
- Digital Process Sheet values recorded per trial
- Horizontal process-sheet comparison across trial columns
- Customer-safe Process Sheet PDF export for Marketing
- Fixed customer report/process-sheet template mapping
- Admin-managed role and permission settings for Phase 1 workflow actions
- Admin-managed Customer Master for clean project intake

## Phase 1 Non-Scope

Phase 1 does not include:

- Full project timeline from PO confirmation
- Department daily task board
- Full issue tracker for all departments
- Full T0 readiness checklist
- Purchasing tracker
- Customer query center
- Supplier portal
- Customer portal
- Full custom report/template designer
- Full measurement report module
- CRM or RFQ tracking
- Inventory
- Accounting
- Employee scoring
- Automatic discipline workflow

These can be added later after the trial tracker is trusted and used.

Marketing can participate in Phase 1 only through narrow trial-tracker actions:

- Create a project intake shell with selected active customer, one or more part/cavity records, optional Project Code / Client Ref, optional mold code while in Intake/Draft, and sanitized request summary.
- Add client-feedback trial issues.
- Add client-feedback/customer-driven issues or feedback notes for PM review.
- View trial status needed to understand the feedback loop.

Admin Customer Master is allowed in Phase 1 only to keep customer codes, short names, owner assignment, aliases, and notes/deal-year lookup clean during intake. This is not the full Customer Query Center or CRM. Customer country, contacts, customer emails, phone numbers, quote values, sales pipeline stages, communication workflow, approved replies, and sales-safe external updates remain out of normal Phase 1 screens and exports.

Digital Process Sheet is allowed in Phase 1 because it directly reduces duplicate trial-report entry. It should be limited to machine selection, process values per trial, horizontal trial comparison, and customer-safe PDF export. Do not build a drag-and-drop template designer, full customer-specific report builder, measurement-report authoring module, customer portal, or email sending workflow in this phase.

Digital Process Sheet data entry should support PM's real trial-entry rhythm:

- Show the current editable trial clearly, such as `Editing: T1`.
- Pressing Enter in a process value moves to the next editable field; Shift+Enter moves to the previous editable field. Enter does not submit the whole form.
- Show unsaved-change count and clear saved/error feedback inside the sheet panel.
- Save is explicit in Phase 1. Avoid autosave.
- `Copy Previous Trial` copies the immediate previous trial's machine selection and process parameter values into blank current fields by default.
- Overwriting existing current-trial process values requires explicit confirmation.
- Copy/save process-sheet data must not create a new trial or copy trial result/issues/accountability fields.
- Do not show editable Trial Summary rows inside the Digital Process Sheet. Trial result, issue summary, correction summary, and next action are recorded in Trial Result / TrialIssue workflows and may be generated into exports from those records.

## Trial Limit Policy

Default rule:

```text
Default trial limit = 3 total completed mold trials
Typical sequence = T0 + T1 + T2
```

Visible trial stage rule:

```text
Normal stage labels = T0, T1, T2, T3...
Do not display internal sequence suffixes such as T0 #1, T0 #2, or T1 #3.
```

If a planned T0 is missed or delayed and then replanned, it remains the same visible T0 stage with updated planned-date/history. It does not create a second visible T0 panel, and it does not allow the project to move to T1 until T0 is completed or explicitly closed/skipped by a documented rule.

Design change rule:

```text
If design change happens before the first completed trial:
  trial limit remains 3

If design change happens after at least one completed trial:
  one extra trial may be added for that approved design-change event
```

Extra-trial UI rule:

```text
Normal working limit = 3 completed trials.
The detail screen shows default T0, T1, and T2 trial panels.
The 4th trial panel can be added only after T0/T1/T2 are completed and a reason is recorded.
The 5th trial panel can be added only after the 4th trial is completed and a reason is recorded.
```

Normal Phase 1 use should not ask PM to set an arbitrary custom trial limit. Extra trials should be justified by visible reasons such as an approved design change, unresolved correction verification, customer feedback, QC failure, invalid/aborted trial, or another documented PM reason.

Normal Phase 1 use should not expose separate page-level Record Missed Trial or Add Design Change panels. Each trial panel should contain the actions for recording its result and adding issues. Design change is captured as a reason/source when planning an extra trial or customer-driven follow-up, with notes and customer/internal source where needed.

Auto-missed rule:

```text
If planned trial date passes and no result is entered by 12:00 PM on the next calendar day:
  mark the trial as Auto Missed - Reason Required

If the trial truly did not happen:
  user enters missed reason, responsible area, explanation, and new planned date
  or marks the project Blocked/Paused with explanation

If the trial actually happened:
  authorized user enters the completed trial late
  system keeps an audit trail that the auto-missed state was corrected by late entry
```

Trial limit should not be treated as punishment by itself. It is a control signal that asks:

- Why did we need more trials?
- Was the extra trial caused by customer design change?
- Was it caused by missed technical review?
- Was it caused by tooling, fitting, machining, injection process, material, or QC?
- Could the issue have been found before the first trial?

## Core Users for Phase 1

| Role | Main purpose |
| --- | --- |
| GM | View delayed trials, over-limit tools, open critical issues, and repeat causes. |
| PM | Own planned trial dates, trial limit settings, next trial targets, root cause, corrective action review, technical trial issues, and escalation. |
| Marketing | Create sanitized intake records and add client-feedback issues without owning project execution. |
| Assembly | Acknowledge assigned correction items and enter estimated correction finish date. |
| Injection | Record trial execution, process notes, machine/material information, and trial result. |
| QC | Record sample inspection result, QC issues, verification result, and approval status. |
| Viewer | Read-only/limited visibility for pilot review. |
| Admin | Manage users, roles, permission settings, categories, and system settings. |

## Phase 1 Account Model

Phase 1 now uses a simple internal username/password login for the real pilot.

Use admin-assigned internal accounts:

- Admin creates users and assigns roles.
- Users can be identified by username/account code, English display name, and optional Chinese name.
- Email is optional and not required for login.
- Passwords are required for normal pilot login and must be stored as hashes.
- A default admin account is allowed for initial setup.
- For local testing, seeded employee accounts may use temporary password `123456`.
- The initial default admin may use username `admin` and temporary password `admin`.
- Seeded employee accounts must be forced to change password after first login before using normal app pages.
- The initial default admin is not forced through first-login password change in the local pilot so setup is not blocked; change or reset it before any real deployment.
- Admin can reset a user's temporary password.
- Users can change their own username/password after login.

The old current-user selector is dev-only after this milestone and should not appear in normal pilot use. Stronger authentication can be added later before broader deployment.

Seeded real pilot accounts:

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

## Phase 1 Permission Management

Phase 1 should not depend forever on hardcoded role assumptions.

Admin should be able to manage internal accounts, roles, and named workflow permissions. This is a Phase 1 support feature because the real team will clarify who can do what during pilot use.

Use named permissions rather than arbitrary table access.

Core permission examples:

- `project.intake.create`
- `trial.schedule.first_t0`
- `trial.schedule.reschedule`
- `trial.record.completed`
- `trial.issue.create`
- `trial.issue.edit_root_cause`
- `trial.issue.assembly_acknowledge`
- `trial.issue.qc_verify`
- `trial.issue.close`
- `trial.design_change.report`
- `trial.design_change.approve_extra_trial`
- `admin.manage_users`
- `admin.manage_roles`
- `admin.manage_customers`

Default reschedule permission:

```text
Can reschedule trials:
PM, Injection, Admin

Cannot reschedule trials by default:
GM, Marketing, QC, Assembly, Viewer
```

Admin may later tune these permissions. Business rules still apply even when permission is granted.

Admin setup should be split into distinct areas so account management and permission design do not blur together:

- Users: create/edit internal accounts, assign roles, reset passwords, archive users, and restore archived users.
- Roles & Permissions: create/edit/delete roles and manage the process x role permission matrix.
- Clients: create/edit/archive customer/client master records used by project intake.

Existing Admin Clients rows should be batch-edited from the Clients tab. Admin stages edits to client code, short name, owner, notes/deal year, and archive/restore state, then saves changed rows from a sticky bottom action bar. Country should not be shown or edited in the normal Clients tab.

User account setup does not ask for a department group in Phase 1. Role defines what an account can do. TrialIssue responsibility area / owner group defines where an issue belongs.

User setup should support both English and Chinese names. English display names and role names remain the default UI labels for now. Chinese names support client-owner import/matching and future bilingual display.

Known Marketing Chinese-name mappings:

| English name | Chinese name |
| --- | --- |
| Anna | 刘婉霞 |
| Zoe | 周娟娥 |
| Peng | 彭利满 |

User account setup should not expose a raw status dropdown. Active users and archived users should be split into separate tables. Archiving a user sets the stored status to Inactive, blocks login, and removes the user from active assignment choices while preserving historical records.

Existing Admin user rows should be batch-edited from the Users tab. Admin stages edits to username, English display name, Chinese name, role, and archive/restore state, then saves changed rows from a sticky bottom action bar. Reset Password remains a separate explicit action.

Role deletion is supported only when safe. The protected Admin role cannot be deleted or deactivated. Roles with users or preserved history should be deactivated/archived instead of hard-deleted so they disappear from active setup without breaking old records.

## Phase 1 Screens

### 1. Trial Dashboard

Shows:

- Intake projects waiting for PM T0 schedule
- Upcoming planned trials
- Delayed trials
- Completed trials
- Projects over trial limit
- Projects close to trial limit
- Open high/critical trial issues
- Assembly estimated ready date
- Next trial dates
- Trial count used vs trial limit

### 2. Mold Trial List

Shows one row per project/mold:

| Field | Example |
| --- | --- |
| Mold Code | M-014-01 |
| Project Code / Client Ref | MP-2026-014 |
| Customer Code | C-027 |
| Customer | C-027 / ABC Molding |
| Parts | P-014-A +2 |
| Current Trial | T1 planned |
| Next Planned Trial | 2026-03-28 |
| Trial Count | 1 / 3 |
| Open Issues | 8 |
| Critical Issues | 1 |
| Status | At Risk |

### 3. Trial Detail Page

Shows:

- Basic project/mold identity
- Parts / cavities tracked in this mold project
- Intake note and customer target date, if provided
- Trial limit policy
- Trial history
- Planned vs actual trial dates
- Missed-trial reason log
- Open trial issues
- Assembly acknowledgement and estimated correction finish date
- Corrective actions
- Next target trial
- Attachments and photos
- Activity log

### 4. Trial Record Form

Used after a trial occurs.

Captures:

- Trial code
- Planned date
- Actual date
- Machine
- Mold status
- Sample quantity
- Result
- Outcome note
- Main issues

### 5. Trial Issue List

Tracks each issue found during trial:

- Defect or issue title
- Found at trial
- Severity
- Issue type
- Owner
- Due date
- Status
- Source, such as internal trial finding, QC finding, PM observation, or client feedback
- Optional affected part
- Description
- Fix summary and approximate time spent when closed

Issue checklist rule:

- Each open TrialIssue can appear as a correction checklist item before the next trial.
- Trial issues live inside the trial panel where they were introduced.
- Issue rows expose Edit and Close Issue actions.
- Issue owner may close their own issue.
- PM and GM may close any issue; if they close someone else's issue, they must record why the owner did not close it.
- Assembly self-check records who checked it, when, and optional note.
- Assembly self-check does not close the issue.
- PM readiness confirmation, QC verification, and next-trial verification remain separate steps.

### 6. Trial Panel And Compact Limit Badge

Shows:

- Default T0/T1/T2 collapsible trial panels
- Compact completed-trial count / allowed-trial count badge
- Near-limit, at-limit, and over-limit warning state
- Design-change and extra-trial reason history
- Prior open issues that need verification in later trials

The user should normally work inside the trial panels instead of a separate trial-limit management panel.

### 7. Digital Process Sheet

Lives inside or directly below the Trial Panel.

Process entry:

- PM or permitted Injection user selects an active injection machine from Injection Machine Master.
- Machine selector search matches numeric machine No. and clamping force.
- PM or permitted Injection user enters process values for the current trial column.
- Previous trial columns are read-only by default for comparison.

Comparison view:

- Rows are process parameters.
- Columns are trial runs such as T0, T1, T2, and extra trials.
- The first template should mirror `RAW/PROCESS SET UP SHEET.xlsx`:
  - project/tool/part header values
  - material information
  - machine information
  - process information
  - barrel settings
  - velocity profile
  - hold pressure
  - other settings
  - tool data
  - hot runner settings
  - six consecutive shot weights

Do not include editable trial result, major issues, correction summary, next action, or internal private note rows in the normal Digital Process Sheet template.

Customer-safe PDF export:

- Marketing can export a Process Sheet PDF for the customer.
- PDF should omit internal accountability fields such as internal owner, Assembly self-check, private notes, and root-cause details that are not approved for customer view.
- PDF can include customer-safe trial result, process values, issue summary, correction summary, and next step.
- PDF export should create an ActivityLog entry and a FileAttachment record.

Template rule:

- Customer Master can have a default fixed process-sheet/report template.
- Project creation snapshots the selected template so historical project reports remain stable.
- If no customer template is set, use the default MoldPilot process-sheet template.
- This rule applies to every real intake/project creation path, not only seed fixtures. Newly created projects with a trial should show the Digital Process Sheet automatically.

### 8. Add New Planned Trial

Allows authorized Phase 1 users with `trial.schedule.reschedule` to add another planned trial.

Required:

- New planned trial date
- Reason category
- Reason detail
- Requested by
- Source role or area

Marketing should normally report customer-driven reasons through intake notes or client-feedback trial issues, not schedule the trial directly.

PM and Injection should normally use internal rework, unresolved trial issue, QC failure, process retest, correction verification, or other documented reasons when scheduling another trial.

## Missed-Trial Reason Categories

When a planned trial does not have a result by 12:00 PM on the next calendar day, the system marks it `Auto Missed - Reason Required`.

The user should not need a separate Record Missed Trial panel. The relevant trial panel should show the auto-missed state and let an authorized user resolve it.

When the trial truly did not happen, the user must record why.

A delayed trial must also get a new planned trial date. If the new date is truly unknown, the project should be marked as blocked or paused instead of leaving the trial delayed without a next date.

If the trial actually happened and was entered late, the user should record the completed trial inside the same trial panel and the system should keep an audit trail that an auto-missed state was corrected.

Suggested categories:

- Design not ready
- Design change pending
- Steel or component not ready
- CNC not complete
- EDM not complete
- Fitting not complete
- Mold correction not complete
- Injection machine not available
- Material not available
- QC plan not ready
- Customer requirement change
- Supplier or outsourcing delay
- Internal decision pending
- Other

This is how Phase 1 reveals upstream process problems without forcing a full upstream workflow into the first build.

## Success Metrics

Phase 1 is successful if the company can reliably see:

- Planned trials due this week
- Trials missed against plan
- Reasons planned trials were missed
- Number of completed trials per mold
- Molds over or close to trial limit
- Open trial issues by severity
- Trial issues waiting for correction or verification
- Design changes that justify extra trials
- Extra-trial reasons and adjustment history
- New trial reasons by source: customer feedback, design change, internal rework, QC failure, process retest, or other
- Trial records missing final disposition, if any

## Rollout Philosophy

Start small and make the first module useful.

The team should only need to learn one behavior first:

```text
Every planned trial must have a date.
Every missed trial must have a reason and a new planned date, unless the project is blocked or paused.
Every completed trial must have a clear result.
Every failed, conditional, pending, or invalid actual trial must have at least one TrialIssue linked to that same trial before the result is saved or the next trial is planned. Issues from other trials, project-level issue counts, trial result notes, and new-trial reasons do not replace same-trial accountability.
Every mold must show trial count used vs trial limit.
```

After this habit is stable, MoldPilot can add:

1. T0 readiness checklist
2. Daily task board
3. Department correction tasks
4. Purchasing tracker
5. Customer query center
6. GM and department KPI dashboards
7. AI summaries and customer-update drafting
