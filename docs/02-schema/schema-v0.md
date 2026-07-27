# MoldPilot Phase 1 Schema v0

## Schema Principle

Phase 1 models mold trial control, not the full project execution system.

The schema should make these things easy to query:

- Upcoming planned trials
- Intake projects waiting for PM T0 schedule
- Missed planned trials
- Reasons trials were missed
- Completed trial count
- Current trial limit
- Open trial issues
- Part/cavity records affected by trial issues
- Issues waiting for correction or verification
- Design changes that justify extra trial allowance
- Sequential extra-trial reasons and adjustment history
- New trial reasons by source area
- Trial result after each actual trial
- Assembly correction acknowledgement and estimated finish date on trial issues
- Assembly self-check status on trial issues
- Injection machine lookup by machine number or tonnage
- Process sheet values by trial and process parameter
- Horizontal process-sheet comparison across trial events
- Customer-safe process-sheet PDF exports
- Customer lookup by code, display name, abbreviation, or alias during project intake

Customer identity remains controlled. Phase 1 allows a small Admin-managed Customer Master for clean project intake, but trial core tables should store only a Customer reference and customer-code snapshot. Do not add customer contact, email, phone, quote, sales pipeline, or communication-history fields.

## Core Entities

```text
User
Role
Permission
RolePermission
UserPermissionOverride
LoginThrottleBucket
DepartmentGroup
Customer
InjectionMachine
ProcessSheetTemplate
ProcessSheetParameter
MoldTrialProject
MoldTrialPart
TrialEvent
TrialProcessValue
TrialIssue
DesignChangeEvent
TrialLimitAdjustment
MissedTrialEvent
FileAttachment
ActivityLog
KpiSnapshot
```

Entities intentionally deferred from Phase 1:

```text
Gate
Task
PurchasingItem
CustomerQuery
ReadinessChecklist
ReadinessChecklistItem
Full Project Timeline
```

## User

Stores internal account identity.

Phase 1 uses admin-assigned internal accounts with simple username/password login for the real pilot. Email remains optional, but password login is now required for normal pilot use.

| Field | Type | Notes |
| --- | --- | --- |
| id | uuid | Primary key. |
| username | text | Unique internal account code. Production uses the reviewed permanent format, such as `admin`, `long.shiyuan`, or `gong.jilin`. |
| display_name | text | English/internal display name used in current app UI. |
| chinese_name | text | Optional Chinese display name. Used for bilingual display and imported client-owner matching. |
| email | text | Optional internal contact email, not required for login and never a customer email. |
| password_hash | text | Required for login. Store a secure hash only; never store plaintext passwords. |
| force_password_change | boolean | True for seeded employee users and Admin-reset accounts until they change their temporary password. The clean production bootstrap also sets this true for protected Admin; only the demo-only local Admin may bypass it. |
| password_updated_at | datetime | Updated whenever password changes. |
| last_login_at | datetime | Optional audit/support field. |
| role_id | uuid | References Role. |
| department_group_id | uuid | Nullable. Repurposed 2026-07-11 as the user's KPI group membership (seed-assigned; e.g. zhong → assembly-a). Role remains the sole permission source; this field only feeds leader-bar aggregation and per-group KPI snapshots. Issue routing still uses TrialIssue.owner_group_id at the DEPARTMENT level, not this field. |
| status | enum | Active, inactive. Admin UI should expose Archive/Restore actions instead of a raw status dropdown. |
| locale | enum | Example: zh-CN, en-US. |
| is_default_admin | boolean | True only for the initial default admin account. |
| created_at | datetime |  |
| updated_at | datetime |  |

Seeded login rule:

- The default Admin may start as `admin` / `admin` for local setup.
- Seeded employee accounts may start with temporary password `123456` for testing.
- Seeded employee accounts must have `force_password_change = true`.
- The demo-only local Admin may have `force_password_change = false` for
  developer troubleshooting. The clean production bootstrap requires
  `force_password_change = true` for Admin.
- Users with `force_password_change = true` must change password after first login before accessing normal app pages.
- Admin can reset a user password by setting a new temporary password and forcing password change again.
- Users can change their own username/password after login.
- Admin can maintain both English display name and Chinese name.
- English/current app display names and role names remain the default UI labels for now.

Production roster rule:

- The reviewed roster fixture contains employee identity, active state, locale,
  role, KPI team membership, and optional permission exceptions. It never
  contains passwords or password hashes.
- Protected Admin is created by the application and is intentionally absent
  from workbook-assigned people.
- Role remains the permission source. `department_group_id` stores KPI
  membership only.
- The 2026-07-27 reviewed roster contains 18 active employees and zero
  individual permission exceptions.

User archive rule:

- Archive sets `status = INACTIVE`.
- Restore sets `status = ACTIVE`.
- Inactive users cannot log in.
- Inactive users should not appear in active assignment dropdowns.
- Inactive users remain referenced in historical records, ActivityLog, projects, and issues.
- Archive/restore must create ActivityLog records and must not break the last active Admin path.

## LoginThrottleBucket

Persists progressive login backoff across application restarts. This is an
internal security-control table, not user-facing business data.

| Field | Type | Notes |
| --- | --- | --- |
| id | uuid | Primary key. |
| scope | enum | Account or source. |
| key_hash | text | HMAC-derived bucket key. Raw username and source address are never stored in this table. |
| failure_count | integer | Consecutive failures inside the reset window. |
| first_failure_at | datetime | First failure in the current window. |
| last_failure_at | datetime | Most recent failure. |
| blocked_until | datetime | Optional progressive-backoff expiry. |
| updated_at | datetime |  |

Account and source buckets are both evaluated. Missing users still perform a
dummy password-hash verification and receive the same generic response.
Backoff is temporary, successful login clears the account bucket, and stale
buckets are eligible for bounded retention cleanup.

## Role

Defines permission group. Admin may create or edit roles during Phase 1 pilot setup.

| Field | Type | Notes |
| --- | --- | --- |
| id | uuid | Primary key. |
| code | text | Example: admin, pm, marketing, qc. |
| name | text | Human-readable role name. |
| description | text | Optional. |
| system_role | boolean | True for seeded default roles that should not be deleted casually. |
| active | boolean | Defaults true. |
| created_at | datetime |  |
| updated_at | datetime |  |

Role removal policy:

- The protected Admin role cannot be deleted, deactivated, renamed, or hidden.
- Hard delete is allowed only for roles with no assigned users and no preserved history dependency.
- If a role has assigned users or history, Admin should deactivate/archive the role instead of hard-deleting it.
- Deactivated roles are hidden from the active role permission matrix or clearly marked inactive.
- Role create/edit/delete/deactivate actions must create ActivityLog records.

## Permission

Defines a named workflow action that can be enabled for roles or individual users.

Permissions should describe business actions, not raw table access.

| Field | Type | Notes |
| --- | --- | --- |
| id | uuid | Primary key. |
| code | text | Unique code, such as `trial.schedule.reschedule`. |
| name | text | Human-readable name. |
| process_group | text | Current seeded groups: Project Intake, Trial Scheduling, Trial Execution, Trial Issues, Trial Limits, Design Changes, Project Closure, Administration. |
| description | text | Optional. |
| is_system_permission | boolean | True for seeded permissions. |
| created_at | datetime |  |
| updated_at | datetime |  |

Suggested Phase 1 permission codes:

```text
project.intake.create
project.basic.edit
trial.schedule.first_t0
trial.schedule.reschedule
trial.missed.record
trial.record.completed
trial.issue.create
trial.issue.edit_root_cause
trial.issue.assembly_acknowledge
trial.issue.qc_verify
trial.issue.close
trial.design_change.report
trial.design_change.approve_extra_trial
project.close
admin.manage_users
admin.manage_roles
admin.manage_customers
```

## RolePermission

Connects a Role to a Permission.

| Field | Type | Notes |
| --- | --- | --- |
| id | uuid | Primary key. |
| role_id | uuid | References Role. |
| permission_id | uuid | References Permission. |
| enabled | boolean | Defaults true. |
| updated_by_id | uuid | Admin user who last changed it. |
| updated_at | datetime |  |

Unique rule:

```text
role_id + permission_id must be unique
```

## UserPermissionOverride

Optional per-user permission override for exceptions.

Use this sparingly. Prefer role permissions unless a specific person needs temporary or special access.

| Field | Type | Notes |
| --- | --- | --- |
| id | uuid | Primary key. |
| user_id | uuid | References User. |
| permission_id | uuid | References Permission. |
| effect | enum | Allow, Deny. |
| reason | text | Required. |
| expires_at | datetime | Optional for temporary access. |
| updated_by_id | uuid | Admin user who set it. |
| updated_at | datetime |  |

Unique rule:

```text
user_id + permission_id must be unique
```

Permission changes must create ActivityLog records.

## DepartmentGroup

Represents internal responsibility areas for issue ownership and routing, not user account permissions.

Suggested initial groups:

- PM
- Planning
- Technical
- Injection
- QC
- Machining
- Assembly
- Purchasing
- Marketing
- Admin

Phase 1 account setup does not assign users to DepartmentGroups through the Admin user form. TrialIssues may still use an owner group / responsibility area such as Assembly, QC, Injection, Marketing, or PM.

| Field | Type | Notes |
| --- | --- | --- |
| id | uuid | Primary key. |
| code | text | Stable code. |
| name | text | Display name. |
| group_type | enum | Department, group, shift. |
| parent_group_id | uuid | Optional hierarchy. |
| kpi_leader_id | uuid | Optional. The user whose monthly KPI "leader bar" is this group's aggregate scorecard. FK users, ON DELETE SET NULL. Null on a group with no designated leader (e.g. the `pm` group, whose members are award-tier individuals, or the `assembly` parent, whose leaders live on its children). Added 2026-07-11. |
| active | boolean |  |

Parent/child KPI groups vs issue routing (2026-07-11 — KPI leader-designation layer): the same DepartmentGroup hierarchy now carries two concerns kept deliberately separate. **Issue routing** keys on `code` at the DEPARTMENT level — `ownerGroup.code === "assembly"`, the department inbox map (`ASSEMBLY → "assembly"`), and every `TrialIssue.owner_group_id` still point at the parent department groups only. **KPI aggregation** keys on `kpi_leader_id` + `department_group_id` membership: the `assembly` DEPARTMENT parent splits into two GROUP children `assembly-a` (钟组, leader Zhong) and `assembly-b` (裴组, leader Pei) so the two assembly leaders get SEPARATE 85% bars, while the parent keeps routing unchanged. Each scored user is assigned to exactly one KPI group via `department_group_id`; a leader's bar is the aggregate of their group's member scorecards. The `pm` group is intentionally left without a `kpi_leader_id` — PMs are award-tier individuals whose bar is their own user scorecard.

## Customer

Admin-managed customer master data used for clean project intake.

This is not CRM. Keep it limited to lookup and display fields needed to select the correct customer when creating a mold trial project.

| Field | Type | Notes |
| --- | --- | --- |
| id | uuid | Primary key. |
| code | text | Required unique client/customer code. Imported from 客户代码. |
| display_name | text | Required display/search name. For workbook import, mirror Client Short Name if no separate full name exists. |
| short_name | text | Required client abbreviation / 客户简称 for the compact Clients table. |
| owner_user_id | uuid | Optional active User responsible for this client. Imported from 负责人 mapping. |
| default_process_sheet_template_id | uuid | Optional fixed ProcessSheetTemplate used for new project snapshots. |
| aliases | text | Optional search keywords or alternate spellings, hidden from compact default table unless needed. |
| notes | text | Optional 备注/成交年份. No contacts, emails, phones, quote values, or sales pipeline data. |
| active | boolean | Defaults true. Archived customers are inactive. |
| created_by_id | uuid | Optional Admin user who created the record. |
| updated_by_id | uuid | Optional Admin user who last updated the record. |
| created_at | datetime |  |
| updated_at | datetime |  |

Rules:

- Customer `code` must be unique and stable.
- Admin can create/edit/archive customers with `admin.manage_customers`.
- PM and Marketing can search active customers during project creation if they can create intake/projects.
- Search should match active Customer code, display name, short name, owner English name, owner Chinese name, and aliases where practical. Do not search or display country.
- Client owner must be selected from current active users, not roles. The owner dropdown should show English name and Chinese name when available.
- Import owner mapping from `RAW/Clients-info.xlsx`: 刘婉霞 = Anna, 周娟娥 = Zoe, 彭利满 = Peng.
- Archived customers cannot be selected for new projects.
- If `default_process_sheet_template_id` is set, new projects for this Customer snapshot that template. If not set, use the default MoldPilot process-sheet template.
- Historical projects keep their `customer_id` reference and `customer_code` snapshot.
- Do not store contact person, customer email, customer phone, quote value, sales stage, or communication history in Customer.
- Customer country was removed in the Phase 1 privacy cleanup. Do not restore it in Customer Master UI, intake lookup, exports, or search.

## InjectionMachine

Admin-managed injection machine master used during trial record and process-sheet entry.

Initial records should be imported from `RAW/Injection-Machines-2026.07.02.xls` before the real local pilot is considered ready. A tiny hardcoded starter list is not enough for Phase 1 pilot use.

| Field | Type | Notes |
| --- | --- | --- |
| id | uuid | Primary key. |
| machine_no | integer or numeric text | Required unique machine No. from the real machine list. Must be numeric only, sorted numerically, such as 1 through 26. Do not use `12#`, letters, remarks, or generated `MACHINE-01` labels. |
| clamping_force | integer | Clamping force from the machine list. Existing code may temporarily map this to the legacy `tonnage` field, but UI copy should say Clamping Force. |
| brand | text | Machine brand. |
| shot_weight | decimal | Shot weight. Existing code may temporarily map this to the legacy `shot_capacity_g` field, but UI copy should say Shot Weight. |
| active | boolean | Internal safe-delete/archive compatibility flag if a historical TrialEvent references the machine. Do not expose as a normal status dropdown in the Machines panel. |
| created_at | datetime |  |
| updated_at | datetime |  |

Rules:

- Normal Admin Machines UI shows only `No.`, `Clamping Force`, `Brand`, `Shot Weight`, `Save`, and `Delete`.
- `No.` must validate as numeric-only on both client and server.
- Admin Machines rows sort by numeric `No.` ascending, not text order.
- Delete hard-deletes unused machine rows. If the machine is referenced by historical TrialEvents, the Delete button should safe-delete/hide it from selectors while preserving historical snapshots and ActivityLog.
- Machine selector search should match numeric No., clamping force, and brand.
- Historical TrialEvents should keep machine No./clamping-force snapshot fields so exported reports remain stable if the machine master is later edited or deleted.
- This is equipment master data for trial reporting, not a full maintenance module.

## ProcessSheetTemplate

Fixed process/report template assigned globally or to a Customer.

Phase 1 supports fixed templates only. Do not build a drag-and-drop template designer.

| Field | Type | Notes |
| --- | --- | --- |
| id | uuid | Primary key. |
| code | text | Unique template code, such as `default_process_setup`. |
| name | text | Display name. |
| description | text | Optional. |
| customer_id | uuid | Optional Customer-specific template owner. Null means global/default template. |
| active | boolean | Defaults true. |
| created_at | datetime |  |
| updated_at | datetime |  |

Rules:

- The default template should mirror the process-parameter sections from `RAW/PROCESS SET UP SHEET.xlsx`.
- Do not create normal editable `Trial Summary` parameters such as Trial Result, Major Issues, Correction Summary, Next Action, or Internal Private Note. Those values belong to TrialEvent and TrialIssue records.
- Project creation snapshots the chosen template id/version so historical reports remain stable.

## ProcessSheetParameter

Defines one row in a process-sheet template.

| Field | Type | Notes |
| --- | --- | --- |
| id | uuid | Primary key. |
| process_sheet_template_id | uuid | References ProcessSheetTemplate. |
| section | text | Example: Material Information, Machine Information, Barrel Settings. |
| parameter_key | text | Stable key, such as `barrel_zone_1_temp_c`. |
| label_en | text | English label. |
| label_zh | text | Chinese label, optional but preferred when present in the source sheet. |
| unit | text | Optional, such as `°C`, `sec`, `bar`, `mm`, `g`. |
| value_type | enum | Text, Number, Date, Boolean. |
| sort_order | integer | Display order within template. |
| customer_visible | boolean | Whether value can appear in customer-safe PDF. |
| active | boolean | Defaults true. |

Unique rule:

```text
process_sheet_template_id + parameter_key must be unique
```

## MoldTrialProject

One record per project/mold being tracked for trials.

Allowed customer fields are the selected Customer reference and customer-code snapshot only.

| Field | Type | Notes |
| --- | --- | --- |
| id | uuid | Primary key. |
| project_code | text | Required internal unique tracking code used for routing and stable records. May be system-generated for draft intake. |
| client_project_ref | text | Optional user-facing Project Code / Client Ref from the client or sales/PM team. Not required during intake. |
| customer_id | uuid | References Customer. Required for new projects after Customer Master is introduced. |
| customer_code | text | Snapshot copied from Customer.code at project creation for stable historical display/reporting. |
| part_code | text | Legacy/primary display field for migration compatibility. It should mirror the first/primary active MoldTrialPart, not replace MoldTrialPart records. |
| mold_code | text | Example: M-014-01. May be blank only while status is Intake/Draft. Required before active trial scheduling or trial activity. |
| planning_pm_id | uuid | Optional until PM is assigned; references User. Field name may remain for migration compatibility, but UI copy should say PM. |
| technical_pm_id | uuid | Optional, references User. |
| status | enum | Intake, Active, Waiting Trial, Trial Delayed, In Correction, Waiting Verification, Approved, Over Limit, Blocked, Paused, Cancelled, Closed. |
| priority | enum | Normal, High, Critical. |
| intake_note | text | Sanitized project/source note or customer request summary for intake. |
| customer_target_date | date | Optional customer target date, if known. |
| initial_customer_note | text | Optional sanitized initial customer feedback or design-change note. |
| process_sheet_template_id | uuid | Snapshot of ProcessSheetTemplate chosen at project creation. |
| process_sheet_template_code | text | Snapshot code/name for stable historical report display. |
| first_planned_trial_date | date | Initial planned mold trial date. Optional while status is Intake. |
| next_planned_trial_date | date | Current next target trial date. |
| base_trial_limit | integer | Default 3. |
| current_trial_limit | integer | Derived or stored snapshot. |
| custom_trial_limit | integer | Optional PM override. |
| custom_trial_limit_reason | text | Required if custom_trial_limit is set. |
| custom_trial_limit_set_by_id | uuid | References User. |
| custom_trial_limit_set_at | datetime | Optional. |
| final_trial_count | integer | Set on closure or derived. |
| close_reason | text | Required when closed/cancelled. |
| created_by_id | uuid | References User. |
| created_at | datetime |  |
| updated_at | datetime |  |

Not allowed in this table:

- customer_name
- customer_contact_name
- customer_email
- customer_phone
- quote_value
- sales_pipeline_stage

Rule: Project creation must select an active Customer. Do not accept free-typed customer text as the stored project customer.

Rule: Project Code / Client Ref is optional. If Client Project Ref and Mold Code are both blank during intake, the system must generate an internal `project_code` tracking value so the record remains reachable.

Rule: Mold Code can be blank only while the project is Intake/Draft. PM/Admin must enter Mold Code before setting first T0, adding or rescheduling planned trials, recording missed/completed trials, or creating/updating trial issues.

Rule: If an existing legacy project has only `customer_code`, migration should create or connect a Customer record and then set `customer_id`.

Rule: A mold trial project is the mold-level trial-control record. Do not create one MoldTrialProject per part code when multiple part codes belong to the same mold.

Rule: Project intake should create at least one active MoldTrialPart before active trial tracking. The legacy project `part_code` may be kept for list display and migration safety, but MoldTrialPart is the source of truth for multi-part/multi-cavity support.

Rule: Project creation snapshots the Customer default process-sheet template, or the global default if the Customer does not specify one. Template snapshot should not change historical process-sheet reports if Customer defaults are later edited.

## MoldTrialPart

Represents one tracked part code or cavity grouping inside a mold trial project.

Use one row per distinct part code in a family mold. For repeated cavities of the same part, use `cavity_count` when only the count matters, or `cavity_label` when the team needs to identify a specific cavity such as A, B, 1, 2, left, or right.

| Field | Type | Notes |
| --- | --- | --- |
| id | uuid | Primary key. |
| mold_trial_project_id | uuid | References MoldTrialProject. |
| part_code | text | Required. Example: P-014-A. |
| part_name | text | Optional internal description. |
| cavity_label | text | Optional specific cavity label, such as A, B, 1, 2, left, or right. |
| cavity_count | integer | Optional count when one part code covers multiple equivalent cavities. |
| notes | text | Optional internal note. No customer identity. |
| sort_order | integer | Display order in project forms and detail page. |
| active | boolean | Defaults true. Archived/removed part rows remain for history if referenced by issues. |
| created_at | datetime |  |
| updated_at | datetime |  |

Unique rule:

```text
Do not allow duplicate active rows with the same mold_trial_project_id, part_code, and cavity_label.
If cavity_label is blank and cavity_count is used, keep one active row per part_code.
```

Phase 1 rule:

- At least one active MoldTrialPart is required before PM schedules or completes T0.
- Dashboard/list display may show the first/primary part code plus a count, such as `P-014-A +2`.
- Full BOM, drawing revision control, and cavity-level QC sampling plans remain later roadmap items.

## TrialEvent

Represents a planned and/or completed mold trial.

| Field | Type | Notes |
| --- | --- | --- |
| id | uuid | Primary key. |
| mold_trial_project_id | uuid | References MoldTrialProject. |
| trial_code | enum | T0, T1, T2, Extra, Other. Normal UI maps these to visible stage labels T0, T1, T2, T3... |
| sequence_number | integer | Internal ordering. Do not expose as `#1/#2/#3` in normal trial labels. |
| planned_date | date | Required. |
| actual_date | date | Required when Completed. |
| status | enum | Planned, At Risk, Auto Missed - Reason Required, Delayed, Completed, Pending Follow-Up, Aborted, Cancelled, Skipped. |
| injection_machine_id | uuid | Optional reference to InjectionMachine selected during trial/process entry. |
| machine_no_snapshot | text | Optional snapshot of selected InjectionMachine.machine_no. |
| machine_tonnage_snapshot | text | Optional snapshot of selected InjectionMachine tonnage/display tonnage. |
| machine | text | Legacy/free-text machine field for migration compatibility only. Do not show in normal Record Result; prefer InjectionMachine selection for new records. |
| material | text | Legacy/simple text field. Do not show in normal Record Result when Digital Process Sheet is available; material belongs in process-sheet rows. |
| mold_status | text | Example: first trial, after correction. |
| sample_quantity | integer | Optional. |
| result | enum | Approved, Conditional, Not Approved / Rework Required, Pending QC, Pending Customer Feedback, Invalid Trial. This is the single visible trial-level outcome field. |
| outcome_disposition | enum | Legacy/deprecated. Do not show in normal Record Result. Kept temporarily only for migration/backward compatibility until code and data are fully cleaned. |
| outcome_note | text | Optional short trial-level note. Keep for approval reference, pending feedback note, invalid trial explanation, or other brief context. |
| follow_up_owner_id | uuid | Legacy/deprecated at TrialEvent level. Follow-up owner belongs on TrialIssue.owner_user_id. |
| follow_up_due_date | date | Legacy/deprecated at TrialEvent level. Follow-up due date belongs on TrialIssue.due_date. |
| main_issues_summary | text | Optional. |
| next_action | text | Optional. |
| next_planned_trial_date | date | Optional. |
| plan_reason_category | enum | Required for planned trials after the first trial. |
| plan_reason_detail | text | Optional detail note for planned trials after the first trial. Do not block planning when blank. |
| source_area | enum | Planning, Technical, Marketing, Injection, QC, Customer, Supplier, Other. |
| requested_by_id | uuid | User who requested/created this planned trial. |
| related_trial_event_id | uuid | Optional prior trial that caused this new planned trial. |
| related_trial_issue_id | uuid | Optional issue that caused this new planned trial. |
| related_design_change_event_id | uuid | Optional design change that caused this new planned trial. |
| counts_against_limit | boolean | True only for completed trials by default. |
| auto_missed_at | datetime | Optional timestamp when the system marked the trial auto-missed after the next-day noon cutoff. |
| auto_missed_resolved_at | datetime | Optional timestamp when the auto-missed state was resolved. |
| auto_missed_resolved_by_id | uuid | Optional User who resolved the auto-missed state. |
| auto_missed_resolution | enum | Optional: Missed Confirmed, Late Completed Trial Entered, Blocked, Paused, Admin Correction. |
| date_confirmation_status | enum | Pending Confirmation (default), Confirmed, Reschedule Proposed, Returned To PM. Added 2026-07-05 (date-confirmation handshake). |
| date_confirmed_by_id | uuid | Optional User (Injection) who confirmed date + machine. |
| date_confirmed_at | datetime | Optional. |
| proposed_date | date | Optional Injection counter-proposal date (must differ from planned_date). |
| proposed_by_id | uuid | Optional proposer. |
| proposed_reason | text | Required with a proposal. |
| reschedule_decision_by_id | uuid | Optional Marketing decider. |
| reschedule_decision_at | datetime | Optional. |
| reschedule_reject_reason | text | Required on rejection (Returned To PM). |
| created_by_id | uuid | References User. |
| created_at | datetime |  |
| updated_at | datetime |  |

Rule: Only valid completed trials count against the trial limit by default. Aborted or invalid trials require PM decision if they should count.

Rule: Planned trials after the first planned trial require `plan_reason_category`, `planned_date`, `requested_by_id`, and `source_area`. `plan_reason_detail` is optional.

Rule: Design-change source/date/title fields are conditional. Default design change source to `No / None`; hide or ignore design-change fields unless the selected planned-trial reason is design-change related. Design change title is optional.

Rule: Creating or changing planned trials after the first T0 requires `trial.schedule.reschedule`.

Rule (2026-07-05, date-confirmation handshake): whenever a PM sets or changes a planned date (create, re-date, resolve auto-missed with a new date), `date_confirmation_status` resets to Pending Confirmation and all proposal fields clear. Injection confirms with a machine (`trial.date.confirm`) or proposes a new date with reason (`trial.date.propose_change`); Marketing approves or returns proposals (`trial.date.approve_change`). Approval writes `proposed_date` into `planned_date` in the same transaction. The handshake never blocks recording results, and auto-missed logic is unchanged.

Default roles with this permission are PM, Injection, and Admin.

Rule: A trial with actual activity must have a result before it is treated as complete. Do not require `outcome_disposition` in the normal Phase 1 workflow.

Rule: If a trial result is Conditional, Not Approved / Rework Required, Pending QC, Pending Customer Feedback, or Invalid Trial, it must have at least one TrialIssue linked to the same TrialEvent before the result can be saved or the next trial can be planned. Issues from other trials, project-level open issue counts, outcome notes, and new-trial reasons do not satisfy this rule.

Rule: If a planned trial has no completed/aborted/cancelled/skipped result by 12:00 PM on the next calendar day in the app business timezone, the system marks the TrialEvent as `Auto Missed - Reason Required`. This auto state should create ActivityLog history but should not create a final MissedTrialEvent until the user confirms the trial truly did not happen and enters reason/new-date fields.

Rule: If a trial was auto-missed but actually happened, an authorized user may enter the completed trial late from the trial panel. The system must preserve the auto-missed correction audit trail.

## TrialProcessValue

Stores one process-sheet value for one trial and one process parameter.

This powers both per-trial process entry and horizontal comparison across T0/T1/T2/extra trial columns.

| Field | Type | Notes |
| --- | --- | --- |
| id | uuid | Primary key. |
| mold_trial_project_id | uuid | References MoldTrialProject for efficient project-level comparison. |
| trial_event_id | uuid | References TrialEvent / trial column. |
| process_sheet_parameter_id | uuid | References ProcessSheetParameter / row definition. |
| parameter_key_snapshot | text | Snapshot of parameter key for historical stability. |
| label_en_snapshot | text | Snapshot English label. |
| label_zh_snapshot | text | Snapshot Chinese label. |
| unit_snapshot | text | Optional unit snapshot. |
| value_text | text | Text value, when value type is text or mixed. |
| value_number | decimal | Numeric value, when applicable. |
| value_date | date | Date value, when applicable. |
| customer_visible | boolean | Snapshot from parameter/customer-safe configuration. |
| entered_by_id | uuid | User who entered/last changed the value. |
| updated_at | datetime |  |
| created_at | datetime |  |

Unique rule:

```text
trial_event_id + process_sheet_parameter_id must be unique
```

Rules:

- Store process values as structured data, not only as uploaded spreadsheet files.
- TrialProcessValue rows are saved only for the current editable TrialEvent column.
- Saving process values must not create a new TrialEvent and must not change trial result/outcome.
- Copy Previous Trial may prefill the current editable trial from the immediate previous trial's machine selection and TrialProcessValue rows.
- Copy Previous Trial should fill blank current fields by default. Overwriting existing current values requires explicit user confirmation.
- Copy Previous Trial must not copy TrialIssue records, issue summaries, next action, Assembly self-check, PM/QC verification, or other accountability fields.
- Previous trial columns should be read-only by default in the comparison view.
- Customer-safe PDF exports include only customer-visible process values and approved/generated summaries from TrialEvent and TrialIssue records.
- Legacy saved TrialProcessValue records for old Trial Summary parameters should not be destructively deleted, but normal UI/export should hide or ignore them.

## MissedTrialEvent

Records why a planned trial did not happen as planned after the auto-missed state is resolved as truly missed.

| Field | Type | Notes |
| --- | --- | --- |
| id | uuid | Primary key. |
| mold_trial_project_id | uuid | References MoldTrialProject. |
| trial_event_id | uuid | Optional reference to delayed TrialEvent. |
| planned_date | date | Required. |
| new_planned_date | date | Required unless project is marked Blocked or Paused. |
| reason_category | enum | See missed-trial reason categories. |
| responsible_area | enum | Technical, Machining, Assembly, Injection, QC, Purchasing, Customer, Supplier, Planning, Other. |
| explanation | text | Required. |
| created_by_id | uuid | References User. |
| created_at | datetime |  |

## TrialIssue

Tracks issues found during a trial or preventing trial approval.

| Field | Type | Notes |
| --- | --- | --- |
| id | uuid | Primary key. |
| mold_trial_project_id | uuid | References MoldTrialProject. |
| found_at_trial_event_id | uuid | Optional reference to TrialEvent. |
| affected_scope | enum | Mold, Part, Multiple Parts. Defaults Mold. |
| affected_part_id | uuid | Optional reference to MoldTrialPart when one part/cavity is specifically affected. Optional in the simple Add Trial Issue form. |
| affected_cavity_note | text | Optional cavity detail, such as cavity 2, left side, insert A. |
| title | text | Required. |
| description | text | Optional. |
| issue_type | enum | See issue categories. |
| source | enum | Internal Trial, PM Review, Technical Review, QC Inspection, Injection Process, Marketing Client Feedback, Customer Design Change, Other. |
| source_detail | text | Optional advanced/lifecycle field. Hide from the simple Add Trial Issue create form unless a later specialized workflow needs it. Use sanitized customer/client feedback, no customer identity. |
| severity | enum | Low, Medium, High, Critical. |
| status | enum | Open, In Progress, Waiting Internal, Waiting Customer, Waiting Supplier, Waiting Verification, Verified, Closed. |
| owner_user_id | uuid | Required for new TrialIssue creation. Nullable in the database only for legacy/historical repair cases. |
| owner_group_id | uuid | Optional legacy/routing field. Hide Responsibility Area from the simple Add Trial Issue create form; use owner_user_id and due_date for normal follow-up accountability. |
| due_date | date | Required for new TrialIssue creation. Nullable in the database only for legacy/historical repair cases. |
| root_cause | text | Advanced/later QA field. Not required for normal Phase 1 closure. |
| corrective_action | text | Advanced/later QA field. Not required for normal Phase 1 closure. |
| verification_method | text | Required before closure unless verification_result is enough. |
| verified_at_trial_event_id | uuid | Optional reference to TrialEvent. |
| verification_result | text | Advanced/later QA field. Not required for normal Phase 1 closure. |
| fix_summary | text | Required for normal Phase 1 closure. Explains how the issue was fixed. |
| fix_time_minutes | integer | Required for normal Phase 1 closure. Approximate time spent fixing the issue, stored in minutes. |
| closed_by_id | uuid | User who closed the issue. Required when Closed. |
| non_owner_close_reason | text | Required when the closer is not the issue owner; explains why the owner did not close their own issue. |
| assembly_acknowledged_at | datetime | Optional Assembly correction acknowledgement date. |
| assembly_estimated_finish_date | date | Optional estimated correction finish date from Assembly. |
| assembly_acknowledged_by_id | uuid | Optional Assembly user who acknowledged correction item. |
| assembly_self_checked_at | datetime | Optional timestamp when Assembly marked correction self-checked before next trial. |
| assembly_self_checked_by_id | uuid | Optional Assembly user who marked self-check. |
| assembly_self_check_note | text | Optional short self-check note. |
| pm_ready_confirmed_at | datetime | Optional PM readiness confirmation timestamp before next trial scheduling. |
| pm_ready_confirmed_by_id | uuid | Optional PM/Admin user who confirmed correction readiness. |
| closed_at | datetime | Required when Closed. Default the close modal to today. |
| created_by_id | uuid | References User. |
| reported_by_id | uuid | User who reported the issue, such as PM, QC, Injection, or Marketing. |
| created_at | datetime |  |
| updated_at | datetime |  |

Simple Add Trial Issue create form rule: show only Title, optional Affected Part, Issue Type, Source, Severity, Status, Owner, Due Date, and Description. Owner and Due Date are required; Affected Part remains optional.

Simple Add Trial Issue create form rule: hide Source Detail, Responsibility Area, root cause, corrective action, verification method/result, Assembly acknowledgement/self-check fields, PM readiness fields, and Closed Date. These fields can remain in lifecycle-specific edit, acknowledgement, verification, and closure workflows.

Rule: TrialIssue cannot be closed in the normal Phase 1 workflow unless fix summary, approximate fix time, closed date, and closed by user are present.

Rule: Issue owner may close their own issue. PM and GM may close any issue. If the closer is not the issue owner, `non_owner_close_reason` is required. Admin may retain a repair path only if it is server-authorized and audited.

Rule: Advanced root cause, corrective action, verification method/result, Assembly acknowledgement/self-check, and PM readiness fields are not required for normal issue closure and should not appear in the simple issue table/create/edit/close flow.

Rule: Once a TrialIssue is Closed, normal users cannot edit it or close it again. GM may edit a closed issue through an explicit override path. Every GM closed-issue edit must create ActivityLog history.

Rule: Marketing can create TrialIssues only as client-feedback, customer design-change, customer sample rejection, or customer requirement feedback sources unless explicitly granted broader permission.

Rule: Assembly can update only `assembly_acknowledged_at`, `assembly_estimated_finish_date`, `assembly_acknowledged_by_id`, `assembly_self_checked_at`, `assembly_self_checked_by_id`, and `assembly_self_check_note` for assigned/relevant correction items. PM/Admin confirms readiness with `pm_ready_confirmed_at` and owns next-trial scheduling.

Rule: Assembly self-check means Assembly claims the correction was completed and checked before the next trial. It does not close the issue and does not replace PM readiness confirmation, QC verification, or next-trial verification.

Rule: If an issue affects a specific part/cavity, set `affected_scope = Part` and reference `affected_part_id`. If it affects more than one part/cavity, set `affected_scope = Multiple Parts` and explain the affected set in the issue description or `affected_cavity_note`. A many-to-many affected-parts join table is deferred until real usage proves it is needed.

## DesignChangeEvent

Records design changes that may affect trial limit. Normal Phase 1 UI should not expose a standalone Add Design Change panel; these records may be created behind the scenes when a user selects design change as an extra-trial or customer-driven reason.

| Field | Type | Notes |
| --- | --- | --- |
| id | uuid | Primary key. |
| mold_trial_project_id | uuid | References MoldTrialProject. |
| change_date | date | Required. |
| requested_by | enum | Customer, Internal, Marketing, Supplier, Other. |
| title | text | Required. |
| description | text | Required. |
| first_completed_trial_already_done | boolean | Snapshot at time of event. |
| grants_extra_trial | boolean | True only if approved and after at least one completed trial. |
| extra_trial_count | integer | Usually 1. |
| approved_by_id | uuid | Required if grants_extra_trial is true. |
| approval_reason | text | Required if grants_extra_trial is true. |
| created_by_id | uuid | References User. |
| created_at | datetime |  |
| updated_at | datetime |  |

Rule: A design change before first completed trial does not increase the default trial limit.

## TrialLimitAdjustment

Records explicit trial-limit and extra-trial adjustment history.

This is used for approved design-change allowances, extra-trial reason history, or Admin correction. Normal Phase 1 UI should not expose arbitrary PM custom trial-limit setting.

| Field | Type | Notes |
| --- | --- | --- |
| id | uuid | Primary key. |
| mold_trial_project_id | uuid | References MoldTrialProject. |
| adjustment_type | enum | Design Change Extra Trial, Extra Trial Reason, Admin Correction. |
| delta_trials | integer | Example: +1 for design change. |
| new_limit | integer | Optional. Use only for Admin correction or migration support. |
| reason | text | Required. |
| related_design_change_event_id | uuid | Optional. |
| set_by_id | uuid | References User. |
| approved_by_id | uuid | Optional. |
| created_at | datetime |  |

## FileAttachment

Tracks trial photos, QC reports, CAD/drawings, video, and supporting documents.
Released files live outside Git under `MOLDPILOT_STORAGE_DIR`; incoming bytes
use a separate private `MOLDPILOT_QUARANTINE_DIR`. Files are soft-deleted only.

| Field | Type | Notes |
| --- | --- | --- |
| id | uuid | Primary key. |
| mold_trial_project_id | uuid | Required. |
| entity_type | enum | MoldTrialProject, TrialEvent, TrialIssue, DesignChangeEvent, MissedTrialEvent, ProcessSheetExport. |
| entity_id | uuid | Target record ID. |
| file_name | text | Required. Sanitized for display; measurement reports are stored as `<projectCode>_<trialCode>_measurement-report.<ext>`. |
| file_type | enum | Trial Photo, QC Report, Process Sheet PDF, Customer Report PDF, Design Change, Drawing, Video, Other. Per-type extension allowlists and size caps live in `src/domain/mold-trial/attachments.ts` (photos ≤10 MB; docs ≤25 MB; CAD/video ≤300 MB; Other ≤100 MB). |
| content_type | text | Stored MIME type; served on download. Backfill default `application/octet-stream`. |
| size_bytes | integer | Backfill default 0 for pre-existing rows. |
| storage_key | text | Disk key (uuid + validated extension). Never derived from the client filename; resolved paths must stay inside the storage root. |
| visibility | enum | Internal, Technical, Restricted, Customer Safe. Customer Safe is the only tier Marketing can download and is never a default — CAD/drawings/video default to Technical (IP protection). |
| uploaded_by_id | uuid | References User. |
| uploaded_at | datetime |  |
| deleted_at | datetime | Optional soft delete (files are never hard-deleted). Deleted files 404 on download. |
| deleted_by_id | uuid | Optional User who soft-deleted. |

Upload rule: authenticated clients use the dedicated `/api/uploads` endpoint,
not large Server Action bodies. Authorization is checked before the request
body is consumed. Streaming byte counts enforce the file-type-specific limit.
The server validates extension, declared MIME, detected signature, and
archive/container safety before invoking the configured local malware scanner.
Only an explicit clean result can move opaque server-named bytes from
quarantine to released storage and create the FileAttachment row. Scanner
outage/error remains fail-closed in quarantine; rejected, partial, and
abandoned files are cleaned without becoming downloadable.

Download rule: `/api/attachments/[id]` enforces auth + visibility
(`attachment.download.internal` vs `attachment.download.customer_safe`),
returns private/no-store responses with `X-Content-Type-Options: nosniff`, and
uses attachment disposition for potentially active content. Authorized images
and video retain their intended inline/range behavior.

## ActivityLog

Records who changed what and when.

| Field | Type | Notes |
| --- | --- | --- |
| id | uuid | Primary key. |
| actor_user_id | uuid | References User. |
| entity_type | enum | MoldTrialProject, TrialEvent, TrialIssue, DesignChangeEvent, TrialLimitAdjustment, MissedTrialEvent. |
| entity_id | uuid | Target record. |
| action | text | Example: created_trial, delayed_trial, closed_issue, exported_process_sheet_pdf. |
| before_json | json | Optional. |
| after_json | json | Optional. |
| note | text | Optional. |
| created_at | datetime |  |

ActivityLog should be append-only.

## KpiSnapshot

Stores periodic metrics for dashboards.

| Field | Type | Notes |
| --- | --- | --- |
| id | uuid | Primary key. |
| snapshot_date | date | Required. |
| scope_type | enum | Company, DepartmentGroup, MoldTrialProject, User. |
| scope_id | uuid | Optional. |
| metrics_json | json | Flexible metrics payload. |
| created_at | datetime |  |

In use since 2026-07-07: `scripts/run-kpi-snapshot.mjs` writes one row per day per scope (User, DepartmentGroup, Company) with the monthly scorecard payload from the KPI scoring engine.

Management Reports do not add a new persistence entity in Phase 1. `/reports` is a permission-protected read model composed from existing MoldTrialProject, TrialEvent, TrialIssue, MissedTrialEvent, FileAttachment, and KpiSnapshot records. Do not write duplicate report rows or a generic Report table unless measured query performance later proves it necessary.

## KpiRule

Admin-editable KPI habit-rule registry (added 2026-07-07). Seeded from `src/domain/mold-trial/kpi-rules.ts`; edited in the admin Rules tab; every change is ActivityLogged. Changing a rule re-scores the entire current month (no per-month rule versioning yet).

| Field | Type | Notes |
| --- | --- | --- |
| id | uuid | Primary key. |
| code | text | Unique stable code, e.g. `pm.missed_reason`, `inj.date_confirm`, `all.inbox_claim`. |
| label_en | text | Required. |
| label_zh | text | Required. |
| hours | integer | Deadline in literal clock hours (1–336; weekends count). Null for boolean rules (`inj.process_values`, `asm.self_check`, `all.photo_on_defect`). |
| role_scope | text | Which role's bar the rule feeds: pm, injection, assembly, qc, marketing, design, all. |
| active | boolean | Design rules are seeded inactive ("role pending") until the Design role exists. |
| sort_order | integer |  |
| updated_by_id | uuid | Optional; null means never edited since seeding. |
| updated_at | datetime |  |

## SystemSetting

Simple key/value feature flags (added 2026-07-07).

| Field | Type | Notes |
| --- | --- | --- |
| id | uuid | Primary key (use this uuid, not the key, as ActivityLog entity_id). |
| key | text | Unique. Current keys: `scoreboard_enabled` (default "false" — staff scoreboard hidden for quiet baseline gathering; admins always preview). |
| value | text |  |
| updated_by_id | uuid | Optional. |
| updated_at | datetime |  |

## Important Enums

### Trial Date Confirmation Status (added 2026-07-05)

```text
Pending Confirmation
Confirmed
Reschedule Proposed
Returned To PM
```

### File Visibility (updated 2026-07-04)

```text
Internal
Technical
Restricted
Customer Safe
```

Customer Safe is the only tier Marketing can download and is never a default.

### Missed-Trial Reason Category

```text
Design Not Ready
Design Change Pending
Steel Or Component Not Ready
CNC Not Complete
EDM Not Complete
Fitting Not Complete
Mold Correction Not Complete
Injection Machine Not Available
Material Not Available
QC Plan Not Ready
Customer Requirement Change
Supplier Or Outsourcing Delay
Internal Decision Pending
Other
```

### Trial Issue Type

```text
Design Change
Bad Customer Feedback
Customer Sample Rejection
DFM / Part Design Issue
Mold Design Issue
Machining Issue
Assembly / Fitting Issue
Injection Process Issue
Material Issue
QC / Dimension Issue
Appearance Issue
Supplier / Outsourcing Issue
Customer Requirement Change
Aborted / Invalid Trial
Other
```

### Trial Outcome Disposition

```text
Approved / Complete
Approved With Minor Items
Rework Required
Pending QC
Pending Customer Feedback
Aborted / Invalid Trial
```

### New Trial Reason Category

```text
Planned Next Trial After Correction
Customer Design Change
Bad Customer Feedback
Customer Sample Rejection
Customer Requirement Clarification
Internal Rework
Trial Issue Verification
QC Failure
Mold Correction Verification
Injection Process Retest
Aborted Or Invalid Previous Trial
Other
```

### Trial Issue Source

```text
Internal Trial
PM Review
Technical Review
QC Inspection
Injection Process
Marketing Client Feedback
Customer Design Change
Other
```

### Severity

```text
Low
Medium
High
Critical
```

### Priority

```text
Normal
High
Critical
```

## Derived Metrics

These can be computed from records:

```text
completed_trial_count
open_trial_issue_count
critical_open_trial_issue_count
days_from_planned_to_actual_trial
missed_trial_count
current_trial_limit
remaining_trial_allowance
over_limit_flag
design_change_extra_trial_count
completed_trial_run_count
new_mold_t0_count
unique_molds_trialed_count
on_time_trial_numerator
on_time_trial_denominator
approved_project_count
approved_on_or_before_target_count
approved_with_target_eligible_count
approved_missing_target_count
low_loop_approval_count
current_near_limit_mold_count
current_at_limit_mold_count
current_over_limit_mold_count
current_open_critical_issue_count
issues_created_in_month_count
issues_closed_in_month_count
current_open_issue_age_buckets
planned_trial_next_30_days_count
missing_trial_result_count
missing_process_sheet_count
missing_qc_report_count
```

Management Reports metric contract (2026-07-14):

- Every selected calendar month uses a half-open `[monthStart, nextMonthStart)` interval in the `Asia/Shanghai` business timezone. The previous comparison is the immediately preceding calendar month calculated with the same rule.
- `completed_trial_run_count` includes TrialEvents with `status = COMPLETED`, a non-null `actualDate`, and actualDate inside the selected month. It does not require `countsAgainstLimit = true`, because an invalid completed run still consumed trial capacity. Planned, delayed, missed, cancelled, and skipped records are not completed workload.
- `new_mold_t0_count` counts a project once when its first actual completed TrialEvent is T0 and that event's actualDate is inside the selected month.
- `unique_molds_trialed_count` is the distinct MoldTrialProject count represented by completed trial runs in the selected month.
- `on_time_trial_denominator` includes non-cancelled/non-skipped trial stages with plannedDate inside the selected month and due on or before the report as-of date. The numerator includes denominator trials completed with actualDate on or before plannedDate. Missed/delayed due trials remain denominator misses. Show numerator and denominator with the percentage.
- A project's approval date is the earliest actualDate of a completed TrialEvent with `result = APPROVED`.
- `approved_on_or_before_target_count` includes projects whose approval date is in the selected month and on/before `customerTargetDate`. Only approved projects with a target date enter `approved_with_target_eligible_count`; approved projects without one enter `approved_missing_target_count`, not the failure count.
- `low_loop_approval_count` includes projects whose approval date is in the selected month and whose first approval occurs within the first two counted completed trials (T0 or T1).
- Current near/at/over-limit counts derive from counted completed TrialEvents versus `currentTrialLimit`. Current attention excludes projects with Approved, Cancelled, or Closed status.
- `current_open_critical_issue_count` includes severity Critical where current status is neither Closed nor Verified.
- Issues created/closed in a selected month use `createdAt`/`closedAt`. Current backlog and age buckets are labeled current-state metrics; Phase 1 does not infer historical month-end status from the current issue row.
- `planned_trial_next_30_days_count` is a forward-looking current workload measure anchored to report as-of time, not a selected-month historical measure.
- Missing-data counts must be visible because incomplete Trial Result, Process Sheet, or QC Report records can make apparently good operational results misleading.
- TrialIssue `ownerUserId` is reported as the fix owner. Reports must not reinterpret it as fault attribution or generate personal culprit counts.

## Schema Rules for Development

- No customer contact, customer email, customer phone, quote value, sales pipeline, customer portal, or communication-history fields may be added to Phase 1 core tables.
- Customer display names belong only in the Admin-managed Customer Master and authorized lookup/display surfaces, not as duplicated free text on MoldTrialProject.
- Every MoldTrialProject must have an internal tracking code, selected Customer/customer code snapshot, and at least one active MoldTrialPart. Mold Code is required before active trial tracking, but may be blank while status is Intake/Draft.
- The project-level `part_code` field is a temporary primary/display/migration field. Do not use comma-separated part codes.
- Intake MoldTrialProjects may omit first planned trial date until PM sets T0.
- Every planned trial must have a planned date.
- Every completed trial must have an actual date.
- Every actual trial must have a result.
- Every planned trial with no result by 12:00 PM on the next calendar day must become `Auto Missed - Reason Required`.
- Every auto-missed trial resolved as truly missed must have a reason category, responsible area, explanation, and new planned date unless the project is blocked or paused.
- Auto-missed trials later corrected by late completed-trial entry must preserve an audit trail.
- Every planned trial after the first planned trial must have reason category, requester, source area, and planned date. Reason detail is optional.
- Every planned trial after the first planned trial must be created by a user with `trial.schedule.reschedule`.
- Permissions should be checked by permission code server-side; role names are defaults, not the final source of truth.
- Admin role/permission changes must be auditable.
- Only completed trials count against the trial limit by default.
- Design changes before first completed trial do not increase the trial limit.
- Design changes after at least one completed trial may add one extra trial if approved.
- Normal Phase 1 UI does not expose arbitrary PM custom trial limits. Extra trial panels after T0/T1/T2 require all prior trial panels to be completed and a visible reason to be recorded.
- New trial records should select an active InjectionMachine instead of relying on free-typed machine text when process-sheet entry is used.
- InjectionMachine search must match numeric machine No. and clamping force.
- InjectionMachine seed/import must use the real `RAW/Injection-Machines-2026.07.02.xls` list for the local pilot; starter/sample machines are not enough.
- Trial process values should be stored as structured TrialProcessValue rows, not only as spreadsheet/PDF blobs.
- Project creation snapshots the selected process-sheet template from Customer Master or global default on every normal creation path, not only seed fixtures.
- Customer-safe Process Sheet PDF exports must omit internal accountability fields unless explicitly approved for customer visibility.
- Assembly self-check on an issue does not close the issue or replace PM/QC/next-trial verification.
- Missed/delayed current-stage replanning must not create a second visible T0/T1/T2 or advance to the next stage before the current stage has a completion, skip, cancel, abort, or other explicit closure rule.
- User-facing trial labels should be generated from the visible stage sequence, such as `T0`, `T1`, `T2`, `T3`; internal `sequence_number` should not appear as `T0 #1` in normal UI or exports.
- TrialIssue closure requires fix summary, approximate fix time, closed date, closed by user, and non-owner close reason when the closer is not the issue owner.
- A non-approved trial cannot be finalized or followed by a next planned trial without at least one TrialIssue linked to that same TrialEvent.
- Any status or limit change should create an ActivityLog record.
