---
name: moldpilot-permission-reviewer
description: Review MoldPilot roles, permissions, screens, APIs, server actions, file visibility, activity logs, access-control decisions, and permission documentation against the Phase 1 permissions matrix. Use when adding or changing auth, role checks, edit permissions, viewer access, trial-limit approvals, issue closure rules, Sales/customer visibility, undocumented permission behavior, or Admin role management.
---

# MoldPilot Permission Reviewer

## Purpose

Keep Phase 1 access control simple, server-enforced, and aligned with real responsibility.

## Required References

Read before reviewing permissions:

- `docs/00-product/decision-log.md`
- `docs/02-schema/permissions-matrix.md`
- `docs/00-product/mvp-definition.md`

Read this when reviewing current implementation progress or permission test gaps:

- `docs/03-build/development.md`

Read when workflow actions are involved:

- `docs/01-domain/workflow-stages.md`

Read when data fields or files are involved:

- `docs/02-schema/schema-v0.md`

## Phase 1 Roles

Use these roles unless product scope changes:

```text
GM
Planning PM
Technical PM
PM Assistant
Marketing / Sales
Injection Manager
QC
Viewer
Admin
```

Later roles:

```text
Machining Leader
Assembly Leader
Purchasing
```

## Permission Principles

- Planning PM owns trial planning, next planned trial dates, and trial-limit settings.
- Technical PM owns root cause quality and technical corrective-action review.
- Injection Manager records trial execution and process notes.
- QC records inspection, verification, and approval status.
- Marketing/Sales can add client-feedback issues and customer-driven new-trial reasons, but cannot edit internal root cause, corrective action, trial-limit approval, or project ownership.
- GM sees full picture and exceptions.
- Admin configures system and repairs data, but should not silently make business decisions.
- Viewer is read-only and limited.

## Review Checklist

Check every screen or API for:

- Permission changes are represented in `docs/02-schema/permissions-matrix.md` and, when they change prior assumptions, `docs/00-product/decision-log.md`.
- Server-side permission enforcement, not UI-only hiding.
- No customer identity exposure.
- Trial-limit changes require permission, reason, timestamp, and activity log.
- Design-change extra trial approval is limited to authorized roles.
- PM custom trial limit is GM-visible.
- Missed-trial events require reason and responsible area.
- Missed-trial events require a new planned date unless the project is blocked/paused.
- New planned trials require reason, detail, requester, source area, and date.
- Actual trials require outcome disposition.
- Trial issue closure requires root cause, corrective action, verification result, and closed date.
- File visibility is respected: Internal, Technical, Restricted.
- ActivityLog records meaningful operational state changes.
- Admin actions that alter business state include a reason.

## Common Red Flags

- Marketing/Sales or Viewer can edit internal trial records beyond their permitted narrow lane.
- Marketing/Sales can edit root cause, corrective action, verification, closure, or trial limits.
- Injection Manager can change PM custom trial limits.
- QC can edit process data outside QC fields without permission.
- Admin can silently alter trial count, trial limit, or issue closure.
- Client-side-only checks protect sensitive actions.
- File downloads bypass role checks.
- Customer names or contacts appear in Phase 1 screens or payloads.

## Documentation Sync Protocol

When the user requests a permission, role, login, Admin, file visibility, or access-control change that is not already in `docs/`:

1. Confirm the exact access rule before implementation, unless the user already confirmed it in the same turn.
2. Update `docs/02-schema/permissions-matrix.md` before or alongside code.
3. Update `docs/00-product/decision-log.md` when the change explains why the permission model changed.
4. Update `docs/03-build/development.md` when permission implementation attempts, removals, or test gaps affect future work.
5. Ensure server-side authorization and acceptance tests match the docs.
6. Flag any code-only access behavior as a review finding.

## Output Shape

For permission reviews, report:

- `Finding`: The access risk or missing rule.
- `Role/action`: Who can do what incorrectly, or who is blocked incorrectly.
- `Expected rule`: What the permissions matrix says.
- `Fix`: Server-side enforcement or UI/API change.
- `Test`: Minimal permission test to add.
