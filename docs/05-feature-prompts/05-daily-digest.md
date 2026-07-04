# Feature 5 — Daily Email Digest

## Context (read first)

Repo: MoldPilot — internal mold trial tracker running on a single Mac on the factory LAN. Next.js 16 App Router, TypeScript strict, Prisma 7 + PostgreSQL. Path alias `@/`. Domain logic in `src/domain/mold-trial/`, server code in `src/server/`, tests in `tests/domain/` (node --test). Users have optional `email` and `locale` (EN_US | ZH_CN). Bilingual labels via `pickLabel` in `src/domain/mold-trial/labels.ts`.

**Depends on**: `/me` page (digest links point there). The "what's on this user's plate" logic already exists as pure functions in `src/domain/mold-trial/my-plate.ts` — **reuse it**; the digest is the same data in email form.

## Goal

Every workday morning each user with an email gets one short email: what's waiting on them. Users with nothing pending get no email. This drives adoption — people act without remembering to open the site.

## Requirements

1. **Schema migration**: `NotificationLog` table — id, userId, channel (enum, EMAIL only for now), digestDate (Date), sentAt, itemCount Int, summaryJson Json. Unique on (userId, channel, digestDate) — the dedupe guard.
2. **Digest assembly** (pure, `src/domain/mold-trial/digest.ts`, unit-tested): takes the same inputs as my-plate sections and produces a digest model: sections (needs-reason, my open issues, assembly acks, PM confirmations, QC reports missing, trials next 3 days), each with items (project code, customer short name, title, date, overdue flag) and the /me link. Empty digest → null (no email).
3. **Rendering** (`src/server/digest-email.ts`): simple inline-styled HTML + plain-text alternative. Subject like `MoldPilot: 3 items need you today / 今日有3项待处理` per user locale. Item lines link to `${MOLDPILOT_BASE_URL}/me`. Keep it phone-readable: single column, no images.
4. **Sending** (`src/server/digest-sender.ts`): nodemailer via env `SMTP_HOST/SMTP_PORT/SMTP_USER/SMTP_PASS/SMTP_FROM` (+ `.env.example` entries). For each ACTIVE user with email: build digest → skip if null or NotificationLog row exists for today → send → write NotificationLog. Failures: log per-user, continue with the rest, exit non-zero if any failed.
5. **Runner** `scripts/send-daily-digest.mjs`: standalone (loads env + Prisma like existing scripts in `scripts/`), runs the global auto-missed sweep first so the digest reflects reality, then sends. Add npm script `digest:send`.
6. **Scheduling docs**: README section with a macOS `launchd` plist example (weekdays 07:30) and the equivalent cron line, plus how to test with `pnpm digest:send`.
7. **Admin test hook**: button on the admin page "Send my digest now" — builds and sends only the current admin's digest ignoring the dedupe row (mark summaryJson `{test:true}`, don't write a dedupe-blocking row). This is how you verify SMTP works without waiting for the schedule.

## Quality bar

- One email per user per day, ever — the unique constraint enforces it even if the script double-fires.
- Never leak across users: digest for user X built only from X's items (the my-plate functions already scope this; test it).
- Email content is internal-facing but avoid customer-sensitive text: item titles + project codes only, no issue descriptions.

## Out of scope

- Real-time/push notifications, WeChat/SMS, per-user notification preferences, unsubscribe flows (internal tool), HTML template frameworks.

## Acceptance

- `pnpm typecheck && pnpm test` pass; domain tests: digest assembly (sections, empty→null, overdue flagging), dedupe decision logic.
- With a local SMTP catcher (e.g. `npx maildev` — dev-only, do not add as dependency): `pnpm digest:send` sends correct digests to seeded users with pending items, skips users with none, second run sends nothing.
- Admin "Send my digest now" delivers a well-rendered email on a phone-width mail client.
