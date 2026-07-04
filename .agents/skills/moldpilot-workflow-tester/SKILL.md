---
name: moldpilot-workflow-tester
description: Design and review tests for MoldPilot Phase 1 mold trial workflows and keep acceptance documentation synchronized, including planned vs actual trial dates, missed-trial reasons, trial issue closure, design-change extra-trial rules, PM custom trial limits, dashboards, role-based workflow behavior, undocumented workflow changes, Playwright tests, unit tests, integration tests, seed scenarios, or QA checklists.
---

# MoldPilot Workflow Tester

## Purpose

Make the Phase 1 Mold Trial Tracker testable as a business workflow, not just as isolated screens.

## Required References

Read before designing tests:

- `docs/00-product/decision-log.md`
- `docs/01-domain/workflow-stages.md`
- `docs/00-product/mvp-definition.md`

Read this before reviewing current progress or proposing the next Coder prompt:

- `docs/03-build/development.md`

Read when data rules are involved:

- `docs/02-schema/schema-v0.md`

Read when role behavior is involved:

- `docs/02-schema/permissions-matrix.md`

## Core Workflow to Test

The main Phase 1 loop is:

```text
Plan trial -> Trial happens or is missed -> Record reason/result -> Track open issues
-> Set next trial date -> Count trial against limit -> Continue until approved or closed
```

## Required Acceptance Scenarios

Cover these scenarios before considering Phase 1 stable:

1. Create mold trial project with project code, customer code, part code, mold code, and planned first trial date.
2. Show upcoming planned trials on dashboard/list.
3. Mark a planned trial as missed and require reason category, responsible area, and explanation.
4. Mark a planned trial as missed and require a new planned date unless blocked/paused.
5. Record completed T0 trial with outcome disposition and increment completed trial count.
6. Reject non-approved trial finalization without open issue, pending QC/customer feedback, new-trial reason, or abort reason.
7. Create trial issue from T0 with severity, source, owner, and status.
8. Allow Marketing/Sales to create client-feedback issues but not edit root cause/correction/closure.
9. Prevent TrialIssue closure without root cause, corrective action, and verification result.
10. Set next planned trial date after failed trial with reason and requester.
11. Complete T1 and update trial count.
12. Show Near Limit, At Limit, and Over Limit states.
13. Record design change before first completed trial and verify limit remains 3.
14. Record design change after first completed trial and verify approved +1 allowance.
15. Set PM custom trial limit with required reason and activity log.
16. Verify Viewer cannot edit trial data.
17. Verify Injection Manager can record trial execution but cannot set PM custom limit.
18. Verify QC can record QC verification but cannot silently alter process data.

## Test Design Guidance

Prefer tests around business outcomes:

- Acceptance tests and pilot checklists must match the current documented workflow.
- Trial count is correct.
- Limit warnings are correct.
- Required reasons are enforced.
- Trial outcome disposition is enforced.
- Marketing/Sales issue and new-trial permissions are enforced.
- Closure rules are enforced.
- Role permissions block unsafe actions.
- Dashboard counts match underlying records.

## Documentation Sync Protocol

When the user requests a workflow, acceptance criterion, seed scenario, test expectation, or pilot-run behavior that is not already in `docs/`:

1. Confirm the exact expected behavior before implementation, unless the user already confirmed it in the same turn.
2. Update `docs/03-build/acceptance-tests.md`, `docs/03-build/pilot-acceptance-checklist.md`, or `docs/01-domain/workflow-stages.md` before or alongside tests/code.
3. Update `docs/00-product/decision-log.md` when the change explains why a prior workflow assumption changed.
4. Update `docs/03-build/development.md` after meaningful pilot runs, failed approaches, removed tests, or gaps where tests pass but the workflow is not truly covered.
5. Make tests follow the docs, not stale prompts or code behavior.
6. Flag passing tests that prove obsolete behavior as a review finding.

Use unit tests for pure logic:

- Trial limit calculation
- Design-change allowance
- Warning state calculation
- Required closure fields

Use integration tests for server behavior:

- Permission checks
- ActivityLog creation
- Validation errors
- File visibility

Use Playwright for end-to-end workflows:

- PM creates project and planned trial.
- Injection records trial.
- Technical PM adds root cause/correction.
- QC verifies.
- GM views over-limit dashboard.

## Seed Data Recommendations

Create stable fixtures for:

- Healthy project: 0 trials completed, T0 planned.
- T0 correction project: 1 of 3 trials used, open issues.
- Client-feedback project: Marketing-created issue.
- Pending feedback project: trial waiting for customer feedback.
- Near-limit project: 2 of 3 trials used.
- At-limit project: 3 of 3 trials used.
- Over-limit project: 4 of 3 trials used.
- Design-change project: +1 trial allowed after T0.
- Custom-limit project: PM custom limit with reason.

## Output Shape

When asked for tests, return:

- Test scenario name
- User role
- Preconditions/seed data
- Steps
- Expected result
- Suggested test layer: unit, integration, or Playwright
