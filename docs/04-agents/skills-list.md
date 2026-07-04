# MoldPilot Project Skills

## Installation Scope

These skills are installed as project-scoped Codex skills:

```text
.agents/skills/
```

They are intended to apply to Codex conversations opened from the MoldPilot project folder. If a newly created skill does not appear in the skill list, restart Codex.

## Installed Skills

| Skill | Purpose | Use when |
| --- | --- | --- |
| `moldpilot-domain-guardian` | Protect product scope and rollout strategy. | Discussing requirements, modules, architecture, roadmap, or whether something belongs in Phase 1. |
| `moldpilot-schema-reviewer` | Review data models against Phase 1 schema rules. | Creating or changing database schema, migrations, seed data, API payloads, enums, or trial-limit logic. |
| `moldpilot-permission-reviewer` | Review role permissions and access control. | Adding screens, APIs, file access, role checks, issue closure, trial-limit approval, or viewer access. |
| `moldpilot-workflow-tester` | Design workflow tests and acceptance scenarios. | Writing unit, integration, Playwright, QA, or seed scenarios for the mold trial workflow. |

## Skill Files

```text
.agents/skills/moldpilot-domain-guardian/SKILL.md
.agents/skills/moldpilot-schema-reviewer/SKILL.md
.agents/skills/moldpilot-permission-reviewer/SKILL.md
.agents/skills/moldpilot-workflow-tester/SKILL.md
```

## Source Documents

The skills intentionally reference the source-of-truth docs instead of duplicating the full product rules:

```text
docs/00-product/decision-log.md
docs/00-product/mvp-definition.md
docs/01-domain/workflow-stages.md
docs/02-schema/schema-v0.md
docs/02-schema/permissions-matrix.md
docs/03-build/development.md
```

When the source docs change, review whether the skill instructions still point to the right sections and assumptions.

## Documentation Sync Rule

When the user requests or confirms a product, workflow, schema, permission, UI, or acceptance-rule change that is not already represented in `docs/`, Codex should:

1. Confirm the exact requested feature/rule before implementation, unless the user already confirmed it in the same turn.
2. Update the relevant source-of-truth docs before or alongside code.
3. Add to `docs/00-product/decision-log.md` when the change explains why MoldPilot moved away from an earlier assumption.
4. Add to `docs/03-build/development.md` after meaningful implementation attempts, failed approaches, removals, test gaps, or milestone reviews.
5. Treat docs as the contract when future coder prompts, generated code, and older conversation notes conflict.

## Recommended Usage

Use explicit skill invocation when the decision matters:

```text
Use $moldpilot-domain-guardian to review whether this feature belongs in Phase 1.
Use $moldpilot-schema-reviewer to review this Prisma schema.
Use $moldpilot-permission-reviewer to review this API route.
Use $moldpilot-workflow-tester to design acceptance tests for trial limits.
```

Codex may also invoke these skills implicitly when the task matches the skill descriptions.

## Future Agents

Custom agents are not installed yet.

Create project-scoped custom agents later under:

```text
.codex/agents/
```

Use agents when the project has enough code to justify explicit parallel work, such as separate schema, security, UI, and test reviewers.
