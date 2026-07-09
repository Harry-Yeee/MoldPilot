# MoldPilot Phase 1 Permissions Matrix

## Permission Principle

Phase 1 permissions should stay simple because the module is intentionally small.

Users should manage the trial records and issues they are responsible for. PM owns trial planning, trial-limit settings, final project control, root cause, corrective-action review, and technical trial issues. Injection records what happened at trial. QC records inspection and verification. Marketing can create a sanitized project intake shell and add client-feedback issues without becoming the project owner. Assembly can acknowledge correction work and provide an estimated correction finish date for assigned/relevant issues. GM sees the full picture.

Current pilot rule: Marketing can create an intake record before T0 is scheduled, but cannot reschedule trials by default. PM/Admin set the first T0 date. Trial rescheduling is allowed by default for PM, Injection, and Admin. Customer Master display names are allowed only for Admin-managed customer records and authorized lookup/display surfaces. Customer contacts, emails, phones, quote values, sales-pipeline fields, customer portal data, and communication history stay outside Phase 1.

## Phase 1 Account Model

Phase 1 uses admin-assigned internal accounts.

Rules:

- Admin creates users and assigns roles.
- Email is optional and not required for login.
- Passwords are required for normal pilot login and must be stored as hashes.
- A default admin account is allowed for first setup.
- For local testing, seeded employee accounts may start with temporary password `123456`.
- The default Admin may start with username `admin` and temporary password `admin`.
- Seeded employee users must be forced to change password after first login before using normal app pages.
- The default Admin is not forced through first-login password change in the local pilot, but must be changed or disabled before real deployment.
- Admin can reset a user's temporary password.
- Users can change their own username/password after login.
- Stronger authentication should be added before broader production deployment.

## Phase 1 Roles

```text
Admin
GM
PM
Marketing
Assembly
Injection
QC
Viewer
```

The real pilot intentionally uses a single PM role. It replaces the earlier Planning PM, Technical PM, and PM Assistant split for easier management. The PM role receives the combined Phase 1 PM permissions by default.

Seeded pilot users:

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

Optional later:

```text
Machining Leader
Purchasing
```

These later roles become more useful when Phase 2 adds correction tasks, readiness checklist, and department task boards.

## Admin-Managed Permission Model

Phase 1 should move from hardcoded role checks toward named permission checks.

Admin can manage:

- Users.
- Roles.
- Role permissions.
- Individual user permission overrides, when a person needs a temporary or exceptional edit right.

Preferred Admin view:

- A process x role permission matrix.
- Rows are permission definitions grouped by `process_group`.
- The first column shows the process group.
- The second column shows the subtask/permission name and permission code.
- Remaining columns are active roles.
- Each role/permission cell is a checkbox that enables or disables that permission for that role.

Role-focused editing can remain as supporting tooling, but the matrix is the preferred permission-management view because Admin needs to review one workflow step across all roles at once.

Current v0.1 implementation:

- `/admin` manages users and role-permission assignments.
- `/admin` should separate account setup from permission setup with distinct tabs or panels:
  - Users: create/edit internal users, assign roles, reset passwords, archive users, and restore archived users.
  - Roles & Permissions: create/edit/delete roles and manage the process x role permission matrix.
  - Clients: create/edit/archive customer/client master records used by project intake lookup.
- `/admin` should expose the process x role permission matrix as the primary role-permission editor.
- Role columns are generated from active Role records.
- The protected Admin role remains visible, preferably first.
- Deactivated roles should be hidden from the active matrix or clearly marked inactive.
- `UserPermissionOverride` exists in the schema and authorization helper path, but a user-specific override UI is still a later hardening task.

Permission changes must be enforced server-side. UI hiding is helpful but never enough.

User account setup does not assign DepartmentGroups in Phase 1. Role grants permissions. TrialIssue owner group / responsibility area remains separate and is used only for issue routing and Assembly/QC/Injection-style responsibility checks.

User archive behavior:

- The Users tab should show Active Users and Archived Users separately.
- The user form should not expose a raw status dropdown.
- Existing user rows should be staged and saved in a batch from a sticky action bar.
- Archive user sets `User.status = INACTIVE`.
- Restore user sets `User.status = ACTIVE`.
- Archived users cannot log in.
- Archived users should be hidden from active assignment/requester/owner dropdowns.
- Archived users remain visible in historical records.
- Archive and restore actions require `admin.manage_users`, create ActivityLog records, and must not break the last active Admin path.

Client management behavior:

- Existing client rows should be staged and saved in a batch from a sticky action bar.
- Normal Admin Clients UI should not show or edit customer country.
- Client create/edit/archive/restore requires `admin.manage_customers`.
- Each changed client row must create an ActivityLog record.

Matrix saves must:

- Require `admin.manage_roles`.
- Update `RolePermission` records for the submitted role/permission cells.
- Create ActivityLog records.
- Prevent removing the last active account path with both `admin.manage_users` and `admin.manage_roles`.
- Prevent deactivating or deleting the protected Admin role.

Role creation and removal must:

- Require `admin.manage_roles`.
- Allow Admin to create a new role with code, name, description, and active status.
- Allow Admin to edit role name/description for non-protected roles.
- Provide a delete/remove action for roles.
- Hard-delete a role only when it has no assigned users and no preserved history dependency.
- Deactivate/archive instead of hard-delete when a role has users or meaningful history, so the role disappears from the active matrix without breaking old records.
- Prevent deleting, deactivating, renaming, or hiding the protected Admin role.
- Prevent any role change that would break the last active admin path.
- Create ActivityLog records for role create, edit, delete, and deactivate/archive actions.

Business validation stays separate from permissions. A user with permission still cannot bypass required dates, reasons, closure fields, trial-limit rules, or customer privacy rules.

Phase 1 permission codes (updated 2026-07-07; source of truth is `src/domain/mold-trial/permission-policy.ts`):

| Permission | Meaning |
| --- | --- |
| `project.intake.create` | Create Marketing or PM intake shell. |
| `project.basic.edit` | Edit basic project, part, mold, and PM assignment fields. |
| `trial.schedule.first_t0` | Set first planned T0 date. |
| `trial.schedule.reschedule` | Add or change later planned trial date with reason. |
| `trial.date.confirm` | Injection confirms a planned trial date together with a machine. Defaults: Injection, Admin. |
| `trial.date.propose_change` | Injection proposes a different trial date with required reason. Defaults: Injection, Admin. |
| `trial.date.approve_change` | Marketing approves/returns a proposed date change against the customer target date. Defaults: Marketing, Admin. |
| `trial.missed.record` | Record missed-trial reason and responsible area. |
| `trial.record.completed` | Record actual trial result. |
| `trial.issue.create` | Create trial issue. |
| `trial.issue.edit_root_cause` | Edit root cause and corrective action fields. |
| `trial.issue.assembly_acknowledge` | Acknowledge assigned/relevant correction, enter estimated finish date, and mark Assembly self-check. |
| `trial.issue.qc_verify` | Enter QC verification/status fields. |
| `trial.issue.close` | Close own assigned issue, or close any issue as PM/GM oversight with required non-owner reason. |
| `trial.process_sheet.edit` | Enter or update process-sheet values for a trial. |
| `trial.process_sheet.export_pdf` | Export customer-safe process-sheet PDF. |
| `trial.design_change.report` | Record customer/internal design change event. |
| `trial.design_change.approve_extra_trial` | Approve eligible +1 design-change trial allowance. |
| `project.close` | Close or cancel mold trial project with reason. |
| `admin.manage_users` | Create/edit users and account status. |
| `admin.manage_roles` | Create/edit roles and permission assignments. |
| `admin.manage_customers` | Create/edit/archive Customer Master records used by project intake. |
| `admin.manage_machines` | Create/edit/delete or safe-delete Injection Machine Master records. |
| `admin.manage_report_templates` | Assign fixed process-sheet/report templates to customers or defaults. |
| `attachment.upload` | Upload files to projects/trials/issues within per-type allowlists and size caps. Defaults: PM, Injection, Assembly, QC, Marketing, Admin. |
| `attachment.delete` | Soft-delete any attachment. Defaults: Admin (the original uploader may always delete their own file — enforced in the action). |
| `attachment.download.internal` | Download Internal/Technical/Restricted files. Defaults: PM, Injection, Assembly, QC, GM, Viewer, Admin (not Marketing). |
| `attachment.download.customer_safe` | Download Customer-Safe files (the only tier Marketing can download). Defaults: Marketing, Admin. |
| `qc.measurement_report.upload` | Upload the measurement report on a completed trial (fileType QC Report, default Customer-Safe). Defaults: QC, Admin. |
| `qc.measurement_report.replace` | Replace an existing measurement report (soft-deletes the previous one, logged). Defaults: QC, Admin. |
| `kpi.rules.manage` | Edit KPI rule deadlines (hours) and active flags in the admin Rules tab; changes are logged and re-score the current month. Defaults: Admin. |
| `kpi.scores.view_all` | View every user's monthly scorecard in the admin Scores tab. Defaults: Admin, GM. |

Note: ADMIN, GM, and VIEWER roles are never scored by the KPI engine regardless of permissions (see `docs/06-kpi/kpi-system-design.md`).

Default `trial.schedule.reschedule` roles:

- Admin
- PM
- Injection

Roles without default reschedule permission:

- GM
- Marketing
- QC
- Assembly
- Viewer

Admin may explicitly grant `trial.schedule.reschedule` later through the permission matrix.

## Data Visibility

| Data | GM | PM | Marketing | Assembly | Injection | QC | Viewer | Admin |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Mold trial project list | All | All | Relevant/all active codes | Assigned/relevant | Assigned/relevant | Assigned/relevant | Limited | All |
| Project/mold codes | All | All | Yes | Relevant | Relevant | Relevant | Limited | All |
| Customer codes | Yes | Yes | Yes | Yes | Yes | Yes | Yes | Yes |
| Customer display names | View where helpful | Project/create lookup | Intake/create lookup | No default | No default | No default | No default | Manage all |
| Customer contacts/emails/phones | No | No | No | No | No | No | No | No |
| Planned trial dates | All | All | Yes | Relevant | Relevant | Relevant | Limited | All |
| Actual trial records | All | All | View | Relevant | Relevant/edit own | Relevant | Limited | All |
| Trial result | All | All | View approved/general status | Relevant | Relevant/edit own | Relevant | Limited | All |
| Missed-trial reasons | All | All | View | Relevant | Relevant | Relevant | Limited | All |
| New-trial reasons | All | All | View/report customer-driven | View relevant | Relevant/create with reschedule permission | View/suggest relevant | Limited | All |
| Trial issues | All | All | View/create client feedback | Assigned/relevant | Relevant | Relevant | Limited | All |
| Root cause/corrective action | All | All/edit | View limited/no edit | View assigned/relevant | Relevant process notes | Relevant QC notes | Limited | All |
| Trial progress / limit badge | All | All/edit | View | View relevant | View relevant | View relevant | Limited | All |
| Design change events | All | All/edit | Create customer-driven/update limited | Relevant | Relevant | Relevant | Limited | All |
| Files | All subject to restriction | Most | Customer-feedback relevant only | Assigned/relevant | Relevant trial files | Relevant QC files | Limited | All |
| Activity log | All | All | Own/relevant | Own/relevant | Own/relevant | Own/relevant | Limited | All |
| KPI dashboard | All | Trial dashboard | Client-feedback/new-trial view | Correction readiness | Trial execution | QC/verification | Limited | All |

## Edit Permissions

| Action | GM | PM | Marketing | Assembly | Injection | QC | Viewer | Admin |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Create mold trial project | No | Yes | Intake only | No | No | No | No | Yes |
| Edit basic project/mold codes | Comment/escalate | Yes | No | No | No | No | No | Yes |
| Set first planned trial date | No | Yes | No | No | No | No | No | Yes |
| Set next planned trial date | Comment | Yes | No | No | Yes with permission | Suggest only | No | Yes |
| Add new planned trial with reason | Comment | Yes | No | No | Yes with permission | Suggest only | No | Yes |
| Mark trial at risk | Yes/comment | Yes | Add feedback note | Relevant | Yes relevant | Yes relevant | No | Yes |
| Record missed-trial event | Yes/comment | Yes | No, unless customer-caused with PM review | No | Yes relevant | Yes relevant | No | Yes |
| Create trial record | No | Yes | No | No | Yes | Yes limited | No | Yes |
| Edit trial process data | No | Yes | No | No | Yes | QC fields only | No | Yes |
| Edit process-sheet values | View | Yes | No | No | Yes | QC fields only | No | Yes |
| Export customer-safe process-sheet PDF | View | Yes | Yes | No | Yes if permitted | Yes if permitted | No | Yes |
| Edit QC result/verification | No | Yes | No | No | No | Yes | No | Yes |
| Create trial issue | Yes | Yes | Yes, client-feedback/customer-driven only | Assigned/relevant acknowledgement only | Yes | Yes | No | Yes |
| Assign trial issue owner | No | Yes | No | No | Own area only | Own area only | No | Yes |
| Edit root cause | Comment | Yes | No | No | Process-related | QC-related | No | Yes |
| Edit corrective action | Comment | Yes | No | No | Process-related | QC-related | No | Yes |
| Mark issue waiting verification | No | Yes | No | Relevant acknowledgement only | Relevant | Relevant | No | Yes |
| Mark Assembly self-check | No | View | No | Assigned/relevant only | No | No | No | Yes |
| Close trial issue | Yes, with non-owner reason when not owner | Yes, with non-owner reason when not owner | Own client-feedback issue only if owner | Own assigned issue only | Own assigned issue only | Own assigned issue only | No | Repair path only, audited |
| Create design change event | Comment | Yes | Yes, customer-driven only | No | No | No | No | Yes |
| Approve extra trial from design change | Comment/escalate | Yes | No | No | No | No | No | Yes |
| Cancel trial | Approve/comment | Yes | No | No | No | No | No | Yes |
| Close mold trial project | Approve/comment | Yes | No | No | No | Verify trial data | No | Yes |
| Upload file | Yes | Yes | Client-feedback files only | Assigned/relevant files | Yes | Yes | No | Yes |
| Change file visibility | Yes | Yes | No | No | No | No | No | Yes |
| Manage users/roles/permissions/categories | No | No | No | No | No | No | No | Yes |
| Manage Customer Master | No | No | No | No | No | No | No | Yes |
| Manage Injection Machine Master | No | No | No | No | No | No | No | Yes |
| Manage fixed report templates | No | No | No | No | No | No | No | Yes |

Marketing may create a mold trial project intake shell before T0 is known.

Required intake fields:

- Active customer selected from Customer Master lookup
- Customer code snapshot copied from selected Customer
- At least one part/cavity row
- Created by

Optional intake fields:

- Project Code / Client Ref
- Mold code, while the project remains Intake/Draft
- Sanitized project/source note or customer request summary
- Additional part/cavity rows
- Assigned PM
- Customer target date if known
- Sanitized initial customer feedback or design-change note

PM/Admin must set the first T0 planned date.

PM/Admin must enter Mold Code before setting first T0. Mold Code is also required before scheduling/rescheduling trials, recording missed/completed trials, or creating/updating trial issues.

Customer lookup rules:

- Users with project intake/create permission can search active clients by code, client short name, owner English name, owner Chinese name, or aliases if present.
- Users cannot create a new Customer from the project creation form by default.
- Admin manages Customer Master records from the Clients tab in `/admin`.
- Client owner assignment uses current active users, not roles.
- Owner dropdown should show English display name and Chinese name when available.
- Archived customers cannot be selected for new projects, but historical projects keep their customer reference and customer code snapshot.
- No customer country, contact person, email, phone, quote value, sales stage, or communication history should appear in Phase 1 permissions or screens.

Later planned trials and reschedules require `trial.schedule.reschedule`.

Default allowed roles:

- Admin
- PM
- Injection

Marketing should report customer-driven reasons through intake notes, design change events, or client-feedback TrialIssues. QC should record QC issues/verification and suggest follow-up, but QC does not schedule trials by default.

## New Planned Trial Permissions

Users with `trial.schedule.reschedule` can add a new planned trial. The action must include:

- New planned trial date
- Trial code or sequence
- Reason category
- Requested by
- Source area

Reason detail is optional. Design-change source/date/title fields are optional and should appear only when the reason is design-change related. Default design change source is `No / None`.

Marketing should report customer-driven reasons through intake notes, design change events, or client-feedback TrialIssues, such as:

- Customer design change
- Bad customer feedback
- Customer sample rejection
- Customer requirement clarification

PM and Injection can add a new planned trial for documented internal or process reasons, such as:

- Internal rework
- Trial issue verification
- QC failure
- Mold correction verification
- Injection process retest
- Aborted or invalid previous trial
- Other documented reason

PM remains responsible for keeping the trial plan clean and resolving conflicts, even when Injection has reschedule permission.

## Assembly Correction Acknowledgement

Assembly can update only correction acknowledgement fields on assigned/relevant TrialIssues:

- Assembly acknowledged date
- Assembly estimated correction finish date

Assembly cannot edit trial limits, planned trial dates, internal root cause, corrective action, QC verification, closure, or customer-feedback content. PM confirms correction readiness and schedules the next trial.

## Trial Limit Permissions

### Default Limit

The system default is three completed trials.

### Sequential Extra Trials

Normal Phase 1 use does not expose an arbitrary PM custom trial-limit control.

Required:

- Reason
- Timestamp
- Activity log

GM must be able to see extra-trial reasons and adjustment history clearly.

### Design Change Extra Trial

PM can approve one extra trial when:

- At least one trial was already completed before the design change.
- The design change is recorded.
- The reason is documented.

PM can validate the technical reason.

Marketing can report customer-driven design changes, but cannot approve the extra trial allowance.

In the current Phase 1 pilot implementation, extra-trial approval is server-enforced for PM and Admin only. GM can see the exception, comment, and escalate business-sensitive cases; direct GM override remains a later policy decision unless the pilot scope changes.

## Trial Result Rules

A trial that happened must have a result.

If the result is not fully approved, the record must include at least one of:

- TrialIssue linked to that same TrialEvent, with owner and due date.

Issues from a different trial, project-level open issue counts, trial result notes, and new-trial reasons do not satisfy this gate. Approved trial results can move forward without issues.

## Issue Closure Rules

A Trial Issue can be closed by:

- The issue owner.
- PM.
- GM.
- Admin only through an audited repair path if the implementation keeps one.

A Trial Issue cannot be closed unless it has:

- Fix summary / how it was fixed.
- Approximate fix time.
- Closed date, defaulting to today in the UI.
- Closed by user.
- Non-owner close reason when the closer is not the issue owner.

High and critical issues should normally be visible to PM/GM before or after closure.

Marketing-created issues should be treated as customer-feedback inputs. Marketing can clarify the client feedback and may close only their own assigned feedback issue. PM/GM can close with a non-owner reason.

After an issue is Closed:

- Normal users cannot edit it or close it again.
- Edit and Close Issue controls should be disabled/gray for non-GM users.
- GM may edit a closed issue through an explicit override path.
- GM closed-issue edits must be server-authorized and recorded in ActivityLog.

## Missed-Trial Rules

If a planned trial is missed, the record must include:

- Planned trial date
- New planned trial date
- Reason category
- Explanation
- Responsible area
- Created by

If the new date is unknown, PM should mark the project as Blocked or Paused with explanation rather than leaving an open delayed trial without a new date.

PM owns final responsibility for keeping missed-trial reasons clean.

## File Visibility

| Visibility | Meaning |
| --- | --- |
| Internal | Visible to operational Phase 1 roles. |
| Technical | Visible to PM, QC, Injection, GM, and Admin. |
| Restricted | Visible only to GM, PM, Admin, and explicitly granted users. |

Phase 1 does not need a full Sales Approved file workflow unless Sales read-only/customer update access is added.

## Admin Role

Admin exists for system configuration and data repair, not business decision-making.

Admin can:

- Manage users
- Manage roles
- Manage role permissions
- Manage user-specific permission overrides
- Manage categories
- Fix data problems with audit logs
- Configure default trial limit
- Use the default admin account for initial setup

Admin should not silently change business status, trial count, trial limit, or issue closure without an ActivityLog reason.

## Development Rules

- Permission checks must exist in server-side logic, not only the UI.
- Server actions should check named permission codes instead of relying only on hardcoded role names.
- Admin permission changes must create ActivityLog records.
- Any new planned trial after the first planned trial must include a date and reason.
- Any trial-limit change must be logged.
- Any missed-trial event must be logged and must include a new planned date unless project is blocked/paused.
- Any trial issue closure must be logged.
- Any Marketing issue creation must be source-labeled as customer/client feedback.
- Any new screen must state which Phase 1 roles can view and edit it.
- Customer identity fields remain prohibited in Phase 1 core tables.
