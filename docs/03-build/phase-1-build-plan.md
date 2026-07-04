# MoldPilot Phase 1 Build Plan

## Build Target

Build the first usable MoldPilot module:

```text
Mold Trial Tracker v0.1
```

This release should support the core loop:

```text
Create mold trial project
-> set planned trial date
-> trial happens or is missed
-> record result or missed-trial reason
-> add open trial issues or completion/pending disposition
-> set next trial date with reason when another trial is needed
-> show trial count used vs trial limit
```

The goal is not to build a full ERP. The goal is to make mold trial control visible and useful quickly.

## Source Documents

Use these as the product contract:

- `docs/00-product/mvp-definition.md`
- `docs/00-product/decision-log.md`
- `docs/01-domain/workflow-stages.md`
- `docs/02-schema/schema-v0.md`
- `docs/02-schema/permissions-matrix.md`

Use this as the build-history companion:

- `docs/03-build/development.md`

Use these skills during development reviews:

- `$moldpilot-domain-guardian`
- `$moldpilot-schema-reviewer`
- `$moldpilot-permission-reviewer`
- `$moldpilot-workflow-tester`

## Recommended Stack

Recommended default:

```text
Next.js
TypeScript
PostgreSQL
Prisma
Tailwind CSS
shadcn/ui or equivalent component primitives
Admin-assigned role accounts
Object storage later for files
```

For first local development, SQLite can be used only if it does not distort the final PostgreSQL schema. Prefer PostgreSQL if setup cost is acceptable.

## v0.1 Product Definition

v0.1 is complete when a Planning PM can:

1. Create a mold trial project.
2. Add one or more part/cavity records under the same mold project.
3. Set the first planned trial date.
4. See the project in an upcoming trial list.
5. Record that the planned trial was missed and why.
6. Record that a trial happened.
7. Record the trial result.
8. Add trial issues or complete/approve the trial path.
9. Set the next planned trial date with reason when another trial is needed.
10. See completed trial count against the trial limit.
11. See near-limit, at-limit, and over-limit states.
12. Record design-change allowance or documented extra-trial reason when justified.

v0.1 is also complete when Marketing/Sales can:

1. Add client-feedback trial issues.
2. Add customer-driven design change events or feedback notes for PM review.
3. Do this without gaining control over trial scheduling, internal root cause, corrective action, trial-limit approval, or project ownership.

v0.1 is also complete when Admin can:

1. Create and edit internal users.
2. Create and edit roles.
3. Assign named permissions to roles by process.
4. Create, edit, and archive Customer Master records for intake lookup.
5. See that permission changes are enforced server-side and logged.

## Build Sequence

### Step 0: Repository Setup

Create basic project infrastructure:

- Initialize git if not already initialized.
- Add app framework.
- Add formatter and linter.
- Add test runner.
- Add environment config.
- Add database schema tooling.
- Add seed data.

Minimum setup decisions:

| Decision | Recommendation |
| --- | --- |
| App | Next.js TypeScript |
| Database | PostgreSQL |
| ORM | Prisma |
| Styling | Tailwind CSS |
| Auth | Admin-assigned role accounts; no email/password required for v0.1 |
| Tests | Unit + integration first, Playwright after UI exists |

### Step 1: Domain Logic

Implement pure business logic before UI:

- Completed trial count.
- Current trial limit.
- Remaining trial allowance.
- Near-limit, at-limit, over-limit states.
- Design-change extra-trial rule.
- Sequential extra-trial reason rule.
- Trial issue closure validation.
- Missed-trial required fields.
- New planned trial reason/date required fields.
- Trial result validation.
- Non-approved trial finalization rule.

These functions should be testable without a browser.

### Step 2: Database Models

Implement Phase 1 entities:

```text
User
Role
DepartmentGroup
Customer
MoldTrialProject
MoldTrialPart
TrialEvent
TrialIssue
DesignChangeEvent
TrialLimitAdjustment
MissedTrialEvent
ActivityLog
FileAttachment, optional shell only
KpiSnapshot, optional shell only
```

For v0.1, `FileAttachment` and `KpiSnapshot` can be schema-ready but not fully featured.

### Step 3: Seed Data

Create stable demo records:

- Planning PM
- Technical PM
- Injection Manager
- QC
- Marketing / Sales
- GM
- Admin
- Viewer
- Customer Master records for customer lookup
- Healthy project with T0 planned
- Delayed project with missed trial
- T0 correction project with open issues
- Client-feedback project with Marketing-created issue
- Pending customer feedback project
- Near-limit project, 2 of 3 trials used
- At-limit project, 3 of 3 trials used
- Over-limit project, 4 of 3 trials used
- Design-change project with +1 allowance
- Custom-limit project with PM reason
- Multi-part family mold project with multiple MoldTrialPart records

### Step 4: Core Screens

Build screens in this order:

1. Admin Customer Master tab
2. Mold Trial List
3. Mold Trial Detail
4. Create Mold Trial Project with customer selector
5. Record Trial
6. Record Missed Trial
7. Add New Planned Trial
8. Trial Issue Form
9. Trial Panel and compact limit badge
10. Trial Dashboard

The dashboard comes after the underlying data loop works.

### Step 5: Permissions

Implement server-side permission checks for:

- Project creation.
- Setting planned trial dates.
- Adding new planned trials with reason.
- Recording missed trials.
- Recording completed trials.
- Creating and closing trial issues.
- Marketing-created client-feedback issues.
- Approving design-change extra trial.
- Viewing restricted data.
- Managing Customer Master records.

UI hiding is not enough. Unsafe actions must be blocked server-side.

Default `trial.schedule.reschedule` roles:

- Planning PM
- Technical PM
- PM Assistant
- Injection Manager
- Admin

Marketing/Sales, QC, Assembly, Viewer, and GM do not reschedule trials by default unless Admin explicitly grants permission later.

### Step 6: Activity Log

Create activity log entries for:

- Mold trial project created.
- Planned trial date set or changed.
- New planned trial added with reason.
- Trial marked missed.
- Trial completed.
- Trial result changed.
- Trial issue created.
- Trial issue closed.
- Design change recorded.
- Extra trial allowance approved.
- Extra-trial reason recorded.
- Project closed or cancelled.

### Step 7: Dashboard Metrics

Compute:

- Upcoming trials.
- Delayed trials.
- Completed trials.
- Near-limit projects.
- At-limit projects.
- Over-limit projects.
- Open high/critical trial issues.
- Issues waiting verification.
- Missed-trial reasons by category.

For v0.1, live queries are enough. Stored KPI snapshots can wait.

## Deferred From v0.1

Do not build these yet:

- Full stage-gate timeline.
- Daily department task board.
- Purchasing tracker.
- Customer query center.
- Supplier portal.
- Customer portal.
- Full file manager.
- AI summaries.
- Employee scoring.

Keep references to later expansion in docs, not in active UI.

## Implementation Guardrails

- Use Admin-managed Customer Master for lookup and customer-code snapshots.
- Show customer code by default in trial views; show Customer Master display name only in authorized lookup/display contexts.
- Do not add customer contact person, customer email, phone, quote value, sales pipeline, customer portal, or communication-history fields.
- Use admin-assigned internal accounts for v0.1; email/password auth can wait.
- Treat trial limit as a control signal, not a punishment system.
- Do not make T2 feel normal or automatic.
- Extra trial panels after T0/T1/T2 must show reason.
- Design change before first completed trial does not add trial allowance.
- Design change after at least one completed trial can add one extra trial if approved.
- Delayed trials require a new planned date unless the project is blocked or paused.
- New planned trials after the first require a reason and requester.
- Marketing/Sales can add client-feedback issues and customer-driven design-change/feedback reasons, but cannot schedule trials by default.
- Admin-managed permission changes must be server-enforced and logged.
- Every actual trial requires a result.
- Non-approved trials require open issues, pending QC/customer feedback, documented new-trial reason, or aborted/invalid trial reason.
- Trial issue cannot close without fix summary, approximate fix time, closed date, and non-owner close reason when applicable.

## Definition of Done

v0.1 is done when:

- Core loop works with seeded and manually created data.
- Trial counts and warning states are correct.
- Missed trial requires reason and new planned date.
- New planned trial requires reason and requester.
- Trial result validation works.
- Trial issue closure validation works.
- Marketing/Sales can add client-feedback issues but cannot edit root cause/correction/limits.
- Design-change and custom-limit rules work.
- Role checks block unsafe edits.
- Permission checks use named permission codes where implemented.
- Activity logs are created for important state changes.
- Acceptance tests in `docs/03-build/acceptance-tests.md` have implementation coverage or are clearly marked deferred.

## Recommended First Coding Task

After this planning layer is accepted, the first coding task should be:

```text
Initialize the web app and implement domain logic tests for trial-limit calculation.
```

This gives the project a reliable business-rule core before UI work begins.
