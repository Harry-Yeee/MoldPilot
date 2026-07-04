---
name: moldpilot-schema-reviewer
description: Review MoldPilot database schemas, Prisma/Drizzle models, migrations, seed data, API payloads, TypeScript types, data model decisions, and schema documentation against the Phase 1 Mold Trial Tracker schema. Use when creating or editing entities, fields, enums, relations, validation rules, trial-limit logic, customer-code privacy, activity logs, reporting metrics, or undocumented data model changes.
---

# MoldPilot Schema Reviewer

## Purpose

Keep MoldPilot data structures faithful to Phase 1:

```text
Mold trial control first.
Full project ERP later.
```

## Required References

Read before reviewing or changing schema:

- `docs/00-product/decision-log.md`
- `docs/02-schema/schema-v0.md`
- `docs/00-product/mvp-definition.md`

Read this when reviewing implementation progress or schema migration lessons:

- `docs/03-build/development.md`

Read when workflow logic is involved:

- `docs/01-domain/workflow-stages.md`

Read when role access is involved:

- `docs/02-schema/permissions-matrix.md`

## Core Phase 1 Entities

The schema should center on:

```text
User
Role
DepartmentGroup
MoldTrialProject
TrialEvent
TrialIssue
DesignChangeEvent
TrialLimitAdjustment
MissedTrialEvent
FileAttachment
ActivityLog
KpiSnapshot
```

These are intentionally deferred from Phase 1 unless the user explicitly changes the product scope:

```text
Gate
Task
PurchasingItem
CustomerQuery
ReadinessChecklist
ReadinessChecklistItem
Full Project Timeline
```

## Review Checklist

Check every schema change for:

- New or changed entities, fields, enums, relations, seed fixtures, and payload contracts are represented in `docs/02-schema/schema-v0.md`.
- No customer full name, contact person, customer email, customer phone, quote value, or sales pipeline field in Phase 1 core tables.
- Every mold trial project has project code, customer code, part code, and mold code.
- Every planned trial has a planned date.
- Every completed trial has an actual date.
- Only completed trials count against the trial limit by default.
- Default base trial limit is 3.
- Design change before first completed trial grants no extra trial.
- Design change after at least one completed trial may grant +1 if approved.
- PM custom trial limit includes reason, setter, timestamp, and GM-visible audit trail.
- Missed-trial event includes planned date, new planned date, reason category, responsible area, and explanation unless project is blocked/paused.
- New planned trials after the first include planned date, reason category, reason detail, requester, and source area.
- Actual trials include outcome disposition.
- Non-approved trials cannot be finalized without open issues, pending QC/customer feedback, documented new-trial reason, or aborted/invalid trial reason.
- Marketing/Sales-created TrialIssues are source-labeled as client/customer feedback and do not include customer identity.
- TrialIssue closure requires root cause, corrective action, verification result, and closed date.
- Operational state changes create ActivityLog entries.

## Documentation Sync Protocol

When the user requests a data model, validation, enum, seed, reporting, or API payload change that is not already in `docs/`:

1. Confirm the exact data/behavior change before implementation, unless the user already confirmed it in the same turn.
2. Update `docs/02-schema/schema-v0.md` before or alongside schema/code changes.
3. Update `docs/00-product/decision-log.md` when the change alters the product direction or resolves a prior ambiguity.
4. Update `docs/03-build/development.md` when schema implementation attempts, failed migrations, removals, or test gaps affect future work.
5. Verify acceptance tests or seed checks match the updated docs.
6. Flag any schema/code drift from docs as a review finding.

## Preferred Modeling

Use explicit entities for business events:

- Use `TrialEvent` for planned/completed trials.
- Use `MissedTrialEvent` for trial delays or missed planned trials.
- Use `DesignChangeEvent` for customer/internal design changes.
- Use `TrialLimitAdjustment` for explicit limit changes.

Avoid hiding these as unstructured notes because the dashboard needs to count and explain them.

## Output Shape

For schema reviews, lead with issues:

- `P0`: Data loss, privacy leak, broken trial-limit logic, impossible workflow.
- `P1`: Missing auditability, weak validation, bad relation shape.
- `P2`: Naming, ergonomics, future maintainability.

Then provide:

- Suggested schema adjustment
- Migration or seed implication
- Tests or validation needed
