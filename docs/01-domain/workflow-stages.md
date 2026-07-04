# MoldPilot Phase 1 Workflow

## Workflow Principle

Phase 1 is trial-first, with a lightweight intake step for Marketing.

Instead of tracking the entire project from PO confirmation, Marketing may create a sanitized project shell before T0 is known. The active trial workflow begins when PM sets the planned T0 date. If that planned trial is missed, the system records the reason. If the trial happens, the system records the result, issues, corrective actions, and next planned trial.

The purpose is to create a simple control loop:

```text
Marketing intake -> PM schedules T0 -> Trial happens or is missed -> Record reason/result
-> Track open issues -> Assembly acknowledges correction estimate where relevant
-> Issue owner or PM/GM closes fixed issues -> authorized scheduler sets next trial date with reason
-> Count trial against limit -> Continue until approved or closed
```

## Standard Phase 1 Workflow

```text
1. Marketing or PM creates project/mold intake shell by selecting an active customer and adding one or more part/cavity records; Project Code / Client Ref and Mold Code can be added when known
2. PM confirms Mold Code and sets planned first T0 date
3. Monitor upcoming planned trial
4. If planned trial passes without result by next-day noon, system marks it Auto Missed - Reason Required
5. If trial happens, record actual trial result inside that trial panel
6. If the actual result is not Approved, record at least one TrialIssue linked to that same trial panel
7. Assign issue owner and due date for every new issue
8. Issue owner works the assigned issue
9. Issue owner or PM/GM closes the issue with fix summary and approximate time spent
10. If PM/GM closes someone else's issue, record why the owner did not close it
11. Authorized PM, Injection, or Admin sets next planned trial date with reason, if another trial is needed
12. Evaluate trial count against trial limit
13. Record extra-trial reason, including design change reason if applicable
14. Continue T1/T2/extra trial loop if required
15. Mark sample approved, production handed off, cancelled, or closed
```

## Trial Statuses

| Status | Meaning |
| --- | --- |
| Planned | Trial has a planned date and has not happened yet. |
| At Risk | Trial may miss the planned date. |
| Delayed | Planned date passed or trial was formally delayed. |
| Auto Missed - Reason Required | Planned trial has no result by 12:00 PM on the next calendar day and needs missed reason, blocked/paused explanation, or late completed-trial correction. |
| Completed | Trial happened and actual date is recorded. |
| Pending Follow-Up | Trial happened but final disposition needs QC result, customer feedback, or issue entry. |
| Aborted | Trial started but did not produce a valid trial result. |
| Cancelled | Trial was cancelled and no longer applies. |
| Skipped | Trial was intentionally skipped. |

## Mold Trial Project Statuses

| Status | Meaning |
| --- | --- |
| Intake | Project shell exists and is waiting for PM to set T0. |
| Active | Trial tracking is active. |
| Waiting Trial | Next planned trial date is set. |
| Trial Delayed | Planned trial did not happen on time. |
| In Correction | Trial happened and correction work is required. |
| Waiting Verification | Correction is complete and waiting for next trial or QC verification. |
| Approved | Sample or mold result is approved. |
| Over Limit | Completed trial count is greater than allowed trial limit. |
| Blocked | Next trial cannot be planned yet because a decision, material, customer feedback, or internal action is missing. |
| Paused | Work is intentionally paused. |
| Cancelled | Project/mold trial tracking is cancelled. |
| Closed | Trial cycle is complete and record is closed. |

## Part / Cavity Tracking

A MoldTrialProject represents one mold-level trial-control loop. It may contain one or more tracked part/cavity records for family molds or multi-cavity tools.

Phase 1 rules:

- Do not create separate mold trial projects for multiple part codes inside the same mold unless the tool is truly managed as a separate mold.
- Project intake should capture at least one part code row, with optional part name, cavity label, cavity count, and notes.
- Trial events, trial limits, and project status remain mold-level.
- Trial issues may optionally identify the affected part/cavity so PM, Assembly, Injection, QC, and Marketing can discuss the same defect clearly.
- Full BOM management, drawing revision control, and cavity-level sampling plans remain later roadmap items.

## Customer Selection During Intake

Project intake must select an active Customer from the Admin-managed Customer Master instead of storing free-typed customer text.

Phase 1 rules:

- Users with project intake/create permission can search customers by code, display name, short name/abbreviation, or aliases.
- The project stores the selected Customer reference and a customer-code snapshot.
- Archived customers cannot be selected for new projects.
- Customer Master is support data for clean intake, not CRM.
- Do not collect or show customer country, contact person, email, phone, quote value, sales stage, portal data, or communication history in Phase 1.

## Intake Identifiers

Project Code / Client Ref is optional during intake. Mold Code may also be blank while the record is Intake/Draft. If both are blank, the system generates an internal tracking code so the record is still reachable from the dashboard and detail page.

Once Mold Code is entered, it becomes the primary working identifier in list/detail screens. The optional Client Project Ref is shown after Mold Code. Mold Code is required before PM/Admin can set first T0, schedule or reschedule trials, record missed/completed trials, or create/update trial issues.

## Trial Limit Rules

### Default Limit

```text
base_trial_limit = 3
```

Completed trials count against the limit. Planned, cancelled, and skipped trials do not count.

### Design Change Before First Trial

If a design change happens before the first completed trial:

```text
extra_trial_allowance = 0
trial_limit remains 3
```

Reason: the mold has not consumed a trial yet, so the normal three-trial target still applies.

### Design Change After First Trial

If a design change happens after at least one completed trial:

```text
extra_trial_allowance = +1 for the approved design-change event
```

The design-change event must record:

- Date
- Description
- Requested by customer or internal
- Whether mold had already been trialed
- Whether it grants extra trial allowance
- Approver
- Reason

### Sequential Extra Trials

The normal Phase 1 UI uses the default three completed-trial target instead of asking PM to set an arbitrary custom limit.

Default visible trial panels:

- T0
- T1
- T2

The 4th trial panel may be added only after T0/T1/T2 are completed and a visible reason is recorded. The 5th trial panel may be added only after the 4th trial is completed and a visible reason is recorded.

Visible trial labels:

- Normal user-facing labels are `T0`, `T1`, `T2`, `T3`, etc.
- Do not show internal record suffixes such as `T0 #1`, `T0 #2`, or `T1 #3` in normal panels, process sheets, summaries, or exports.
- A missed or delayed planned stage that is replanned remains the same visible trial stage until that stage is completed, skipped, cancelled, or explicitly closed by a documented rule.

Valid extra-trial reasons include:

- Approved design change
- Unresolved correction verification
- Customer feedback or sample rejection
- QC failure
- Injection process retest
- Aborted or invalid previous trial
- Other documented PM reason

Extra-trial reasons and approved design-change allowances must remain auditable for GM/Admin review.

## Trial Limit Evaluation

For each mold trial project:

```text
completed_trial_count = count(completed trials)
current_trial_limit = default limit + approved extra allowances
```

Warning states:

| State | Rule |
| --- | --- |
| Healthy | Completed trials are below limit and no critical open issues block the next milestone. |
| Near Limit | Completed trials equal limit minus 1. |
| At Limit | Completed trials equal current limit. |
| Over Limit | Completed trials exceed current limit. |

## Auto-Missed Trial Workflow

The normal Phase 1 UI should not expose a separate Record Missed Trial panel.

If a planned trial has no result by 12:00 PM on the next calendar day in the app business timezone, the system marks that TrialEvent `Auto Missed - Reason Required`.

This state is not a final explanation. It means the planned trial record needs cleanup from the relevant trial panel.

Resolution paths:

- If the trial truly did not happen, record missed-trial reason fields and new planned date from the trial panel.
- If the next date is unknown, mark the project `Blocked` or `Paused` with explanation.
- If the trial actually happened but was entered late, record the completed trial result from the same trial panel and keep an audit trail that the auto-missed state was corrected by late entry.

When the user enters a new planned date for a missed T0/T1/T2, the visible panel stays on that same trial stage. The implementation may update the existing TrialEvent planned date with missed-history records, or keep internal reschedule history, but it must not create a second visible T0 panel or advance the project to T1 before T0 has a real completion/closure disposition.

When the trial truly did not happen, the user must record a missed-trial event.

Required fields:

- Planned trial date
- New planned trial date
- Reason category
- Explanation
- Responsible area
- Created by

If the new planned date is genuinely unknown, the project should be marked `Blocked` or `Paused` with an explanation instead of remaining as an open delayed trial with no next date.

If resolving the auto-missed trial creates or changes the next planned trial date, the user must have `trial.schedule.reschedule`.

Default roles with this permission:

- Admin
- PM
- Injection

Marketing, QC, Assembly, Viewer, and GM do not reschedule trials by default unless Admin explicitly grants that permission later.

Suggested responsible areas:

- Technical
- Machining
- Assembly
- Injection
- QC
- Marketing
- Purchasing
- Customer
- Supplier
- Planning
- Other

This lets the company see what previous step prevented trial without tracking every upstream task in Phase 1.

## Trial Record Workflow

When a trial happens, record:

- Trial code, such as T0, T1, T2
- Planned date
- Actual date
- Machine
- Mold status
- Sample quantity
- Result
- Outcome note, optional
- Main issues summary

The record/result action should live inside the relevant T0/T1/T2/extra trial panel rather than as a separate page-level panel.

Trial result values:

| Result | Meaning |
| --- | --- |
| Approved | Trial result is acceptable. |
| Conditional | Accepted with conditions or minor open items. |
| Not Approved / Rework Required | Issues require correction before approval or the next trial. |
| Pending QC | Trial completed but QC result is not final. |
| Pending Customer Feedback | Trial completed but customer/client feedback is needed before final decision. |
| Invalid Trial | Trial started but did not produce a valid result. |

Every trial that happened must have a clear result. This prevents vague trial records without asking users to classify the same outcome twice.

If the result is `Not Approved / Rework Required`, `Conditional`, `Pending QC`, `Pending Customer Feedback`, or `Invalid Trial`, the trial must have at least one TrialIssue linked to that same TrialEvent before the result can be saved and before the next planned trial can be added.

Same-trial issue rule:

- An issue from T0 cannot satisfy a failed T1.
- A project-level open issue count cannot satisfy this rule.
- Outcome notes and new-trial reasons are useful context, but they do not replace the same-trial TrialIssue.
- Approved results can be saved and moved forward without issues.

## New Planned Trial Workflow

If another trial is needed, a user with `trial.schedule.reschedule` adds the new planned trial and lists the reason and new planned date.

This workflow is for moving from a completed/closed current stage to the next stage, such as completed T0 -> planned T1. It is not the same as replanning a missed current stage. Replanning a missed current stage keeps the same visible stage label.

Default scheduling roles are PM, Injection, and Admin.

Required fields:

- New planned trial date
- Trial code or sequence, such as T1, T2, Extra
- Reason category
- Requested by
- Source area

Optional fields:

- Reason detail
- Design change source/date/title, only when the selected reason is design-change related

Design change fields:

- Default design change source to `No / None`.
- Hide or disable design-change source/date/title when no design change is involved.
- Internal rework, QC failure, injection retest, unresolved issue verification, and other non-design-change reasons should not require design-change fields.

Marketing should enter customer-driven reasons as intake notes or client-feedback TrialIssues:

- Customer design change
- Bad customer feedback
- Customer sample rejection
- Customer requirement clarification

Standalone Add Design Change is not part of normal Phase 1 detail-page UI. When design change is the reason for an extra trial or customer-driven follow-up, select the design-change reason/source in the trial panel flow and enter notes. The backend may still create DesignChangeEvent and TrialLimitAdjustment records for audit/reporting.

PM and Injection should normally use these reason categories when scheduling the next trial:

- Internal rework
- Trial issue verification
- QC failure
- Mold correction verification
- Injection process retest
- Aborted or invalid previous trial
- Other documented reason

QC can record QC issues, inspection results, and verification status, and can suggest that another trial is needed. QC does not schedule the trial by default.

New planned trials created after the initial planned trial should be traceable back to one or more of:

- Prior TrialEvent
- TrialIssue
- DesignChangeEvent
- MissedTrialEvent
- Customer/client feedback note

## Trial Issue Workflow

Every important issue found at trial should become a Trial Issue.

Issues can come from internal trial observation, PM review, QC inspection, injection process review, or Marketing entering customer/client feedback.

Trial issues should live inside the trial panel where they were found. Normal Phase 1 detail pages should not show a large global Update Issue panel below all trials.

Required fields:

- Title
- Found at trial
- Affected part/cavity, optional
- Severity
- Issue type
- Source
- Owner
- Status

Normal issue row actions:

- Edit
- Close Issue

Edit opens a modal/popup for the simple issue fields:

- Title
- Affected part, optional
- Issue type
- Source
- Severity
- Status
- Owner
- Due date
- Description

Close Issue opens a focused modal and requires:

- Fix summary / how it was fixed
- Approximate time spent fixing the issue
- Closed date, defaulting to today

Issue closure rule:

- The issue owner may close their own issue.
- PM and GM may close any issue because they oversee the project.
- If the closer is not the issue owner, the system must require a short override reason explaining why the owner did not close their own issue.
- Closure stores who closed the issue, when it was closed, how it was fixed, approximate time spent, and override reason when applicable.
- Advanced root-cause/corrective-action/verification fields are not required for normal Phase 1 issue closure.
- After an issue is closed, normal users cannot edit or close it again. Edit and Close Issue should be disabled/gray for everyone except GM.
- GM may edit a closed issue through an explicit override path, and that edit must create ActivityLog history.

Assembly correction acknowledgement is intentionally small in Phase 1. Assembly can acknowledge an assigned/relevant correction item and provide an estimated correction finish date. Assembly cannot edit root cause, corrective action, verification, closure, trial limits, or planned trial dates. PM confirms correction readiness before scheduling the next trial.

Assembly self-check is part of the trial issue checklist before the next trial:

- Each open TrialIssue can appear as a checklist item for the next trial.
- Assembly can mark assigned/relevant issues as self-checked when they believe correction is complete before the tool is loaded for the next trial.
- Self-check records user, timestamp, and optional note.
- Self-check does not close the issue.
- PM readiness confirmation, QC verification, and next-trial verification remain separate.

## Digital Process Sheet Workflow

The Digital Process Sheet is the online version of the trial process setup report. It should reduce duplicate PM entry and support customer-safe export.

Phase 1 shape:

- Process Sheet lives inside or directly below each Trial Panel.
- Rows are process parameters.
- Columns are trial events such as T0, T1, T2, and extra trials.
- Columns must follow MoldPilot's strict visible trial sequence, not any mistaken sequence shown in a legacy spreadsheet example.
- Current trial column is editable by permitted PM/Injection users.
- Previous trial columns are read-only by default for comparison.
- Process values are stored as structured values, not as a spreadsheet blob.
- Digital Process Sheet does not contain editable Trial Summary rows in normal Phase 1 use.
- Trial result, major issues, correction summary, next action, and outcome notes are recorded through TrialEvent and TrialIssue workflows.
- Full issue details remain in TrialIssue lists below the sheet.
- The sheet saves only the current editable trial column. Saving values does not create a new trial and does not change trial result/outcome.
- The sheet shows which trial is currently editable and tracks unsaved changes before save.
- Enter key navigation should move down to the next editable process value. Shift+Enter moves to the previous editable value. Enter should not submit the whole sheet.
- Save feedback should stay inside the Digital Process Sheet panel with saved/error state, timestamp, and changed/saved field count.
- Copy Previous Trial copies the immediate previous trial's selected machine and process parameter values into blank fields in the current editable trial by default.
- If current values already exist, overwriting them requires explicit confirmation.
- Copy Previous Trial never copies trial result, issue records, issue summaries, next action, Assembly self-check, PM/QC verification, or other accountability fields.
- Autosave is not part of Phase 1.

Injection machine selection:

- Trial process entry uses Injection Machine Master instead of free-typed machine text.
- Search should match numeric machine No. and clamping force.
- Selected trial records should keep enough machine snapshot data that historical reports remain stable if the machine master is later edited.

Template rule:

- Start with fixed templates only.
- The default template should mirror `RAW/PROCESS SET UP SHEET.xlsx`.
- Do not copy the source workbook's Trial Summary section into normal editable process-sheet templates. Customer-facing summaries should be generated from TrialEvent and TrialIssue records.
- Customer Master may point to a default fixed process-sheet/report template.
- Project creation snapshots the selected template for every real intake/project creation path. Seed fixtures and user-created projects should behave the same way.
- A full drag-and-drop template designer is later roadmap, not Phase 1.

PDF export:

- Marketing may export a customer-safe Process Sheet PDF.
- The export should include process comparison and may include customer-safe trial result, issue summary, correction summary, and next step generated from TrialEvent and TrialIssue records.
- The export must omit internal accountability fields such as internal owner, Assembly self-check, private notes, and unapproved root-cause details.
- Export creates ActivityLog and FileAttachment records.

Trial Issue statuses:

| Status | Meaning |
| --- | --- |
| Open | Issue is recorded but correction has not started. |
| In Progress | Correction or analysis is underway. |
| Waiting Internal | Waiting on internal department or decision. |
| Waiting Customer | Waiting on customer information or approval. |
| Waiting Supplier | Waiting on supplier or outsourced work. |
| Waiting Verification | Corrective action is done and needs verification. |
| Verified | Verification succeeded but final closure may still be pending. |
| Closed | Issue is fully closed. |

## Issue Type Categories

Suggested Phase 1 categories:

- Design change
- Bad customer feedback
- Customer sample rejection
- DFM / part design issue
- Mold design issue
- Machining issue
- Assembly / fitting issue
- Injection process issue
- Material issue
- QC / dimension issue
- Appearance issue
- Supplier / outsourcing issue
- Customer requirement change
- Aborted / invalid trial
- Other

## Phase 1 Closure

A mold trial project can be closed when one of these outcomes is recorded:

- Sample approved
- Production handoff complete
- Project cancelled
- Trial tracking moved to another record

Closure should capture:

- Final trial count
- Final trial limit
- Whether over limit occurred
- Main delay reason, if any
- Main rework reason, if any
- Lessons learned note, if useful

## Future Workflow Modules

Phase 1 should leave room for later modules:

- T0 readiness checklist
- Daily task board
- Department correction tasks
- Purchasing tracker
- Customer query workflow
- Full project stage-gate tracker

These modules should connect to the trial tracker instead of replacing it.
