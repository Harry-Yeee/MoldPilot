---
name: moldpilot-domain-guardian
description: Guard MoldPilot product scope, rollout strategy, privacy boundaries, MVP decisions, and documentation consistency. Use when discussing MoldPilot requirements, roadmap, module scope, feature requests, architecture direction, product tradeoffs, undocumented behavior changes, or whether a change belongs in Phase 1 Mold Trial Tracker versus later MoldPilot expansion.
---

# MoldPilot Domain Guardian

## Purpose

Keep MoldPilot aligned with its current product contract:

```text
Phase 1 = Mold Trial Tracker
Not full ERP, not full project control tower, not CRM, not RFQ tracking.
```

Use this skill to prevent accidental scope creep and to preserve the staged rollout strategy.

## Required References

Read these project documents before making or reviewing scope decisions:

- `docs/00-product/decision-log.md`
- `docs/00-product/mvp-definition.md`
- `docs/01-domain/workflow-stages.md`

Read this when reviewing current progress or writing the next Coder prompt:

- `docs/03-build/development.md`

Read these only when the decision touches data or access:

- `docs/02-schema/schema-v0.md`
- `docs/02-schema/permissions-matrix.md`

## Review Workflow

1. Identify the requested decision, feature, module, or architecture change.
2. Classify it as:
   - Phase 1 core
   - Phase 1 support
   - Later roadmap
   - Explicit non-scope
   - Needs product decision
3. Check whether it supports the Phase 1 control loop:

```text
Plan trial -> Trial happens or is missed -> Record reason/result -> Track open issues
-> Set next trial date -> Count trial against limit -> Continue until approved or closed
```

4. Protect these Phase 1 rules:
   - Start when planned mold trial date is known.
   - Track planned vs actual trial dates.
   - Record missed-trial reasons.
   - Track open trial issues and corrections.
   - Default trial limit is 3 completed trials.
   - Design change before first completed trial does not increase trial limit.
   - Design change after at least one completed trial may add 1 approved extra trial.
   - PM custom trial limits require a visible reason.
   - Delayed trials require a new planned date unless blocked/paused.
   - New planned trials after the first require reason, detail, requester, and date.
   - Actual trials require outcome disposition.
   - Marketing/Sales can add client-feedback issues and customer-driven new-trial reasons, but not own execution.
   - Customer identity stays out of core tables.
5. If the request belongs later, suggest the smallest Phase 1-compatible version.

## Documentation Sync Protocol

When the user requests or accepts a product, workflow, schema, permission, UI, or acceptance-rule change that is not already represented in `docs/`:

1. Restate the exact feature or rule change and confirm it with the user before implementation, unless the user already gave explicit confirmation in the same turn.
2. Update the relevant source-of-truth docs before or alongside code changes.
3. Add a short entry to `docs/00-product/decision-log.md` when the change explains why MoldPilot moved away from an earlier assumption.
4. Add a short entry to `docs/03-build/development.md` when a meaningful implementation attempt worked, failed, was removed, or revealed a test gap.
5. Treat docs as the product contract. If code, prompts, or older notes conflict with docs, prefer the decision log first, then source docs.
6. In review responses, flag code-only feature drift as a finding.

This is not ceremony for tiny bug fixes that do not change behavior. It is required for feature, workflow, permission, data, screen, and acceptance changes.

## Default Recommendation Bias

Prefer small Phase 1 features that improve trial visibility and adoption.

Defer features that require broad department behavior change, such as:

- Full daily task board
- Purchasing tracker
- Customer query center
- Full gate timeline
- Full T0 readiness checklist
- Supplier portal
- Customer portal
- Employee scoring
- Full ERP integration

Do not reject future-system ideas. Capture them as roadmap items or future expansion notes.

Marketing/Sales participation in Phase 1 is narrow: client-feedback issues and customer-driven new-trial reasons are allowed; full customer communication workflow remains later roadmap.

## Output Shape

For reviews, answer with:

- `Decision`: Phase 1 core/support, later roadmap, non-scope, or needs decision.
- `Reason`: Short explanation tied to source docs.
- `Recommended shape`: Smallest useful version for the current phase.
- `Later expansion`: How it can grow after Phase 1, if relevant.
