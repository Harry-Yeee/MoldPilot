# Deployment checklist — pilot go-live (2026-07-17 sweep)

Findings from the pre-deployment sweep (static audit + gates). Work top to bottom;
items marked ⛔ are blockers — do not put real users on the system until they're done.

## ⛔ Security blockers (minutes each, catastrophic if skipped)

1. **Session secret.** `src/server/auth-session.ts` falls back to a hardcoded string
   (`moldpilot-local-pilot-session-secret`). Anyone who has ever seen the repo can forge any
   user's login cookie. On the server set a real value:
   `MOLDPILOT_SESSION_SECRET="$(openssl rand -hex 32)"` in the env/launchd plist. Never commit it.
2. **admin/admin.** The seeded admin password is `admin` with no forced change. Change it before
   install day (Account → Change password). Also decide xie's (GM) real password.
3. **Database password.** `.env` uses `moldpilot:moldpilot`. Fine while Postgres listens on
   localhost only — so VERIFY it listens on localhost only (`listen_addresses`/docker port binding
   `127.0.0.1:5432:5432`). The app is what phones talk to, never the DB.
4. **.env must not be committed.** Confirm `.gitignore` covers `.env` before the big commit.

## ⛔ The commit + a tested backup

5. **Commit everything.** Still one commit in history (b75595d). Every feature since — KPI engine,
   guards, e2e, today's UI overhaul, posters, docs — is unprotected. Commit + push to the private
   remote BEFORE deployment, not after.
6. **Backups armed.** `scripts/backup.sh` is ready but `BACKUP_DIR` is not set anywhere. Point it
   at the NAS/external disk in `com.moldpilot.backup.plist`, load the plist, run one manual backup,
   and do one restore drill (`psql < dump` into a scratch DB + confirm uploads-mirror has bytes).
   A backup that has never restored is a hope, not a backup.

## Production run mode (the server is not `pnpm dev`)

7. **Build + start.** `pnpm build` then `pnpm start` (add `-H 0.0.0.0 -p 3000` so workshop phones
   can reach it via the LAN IP). Dev mode compiles on demand and will feel broken on first-tap.
8. **Migrations in prod:** use `pnpm exec prisma migrate deploy` (never `migrate dev` / `reset` on
   the production DB). The step-0 history repair in `migrate-and-verify.py` applies to dev only.
9. **Storage path.** Attachments default to `<cwd>/storage/uploads`. With launchd the cwd can
   surprise you — set `MOLDPILOT_STORAGE_DIR` to an absolute path (backup.sh already honors it).
10. **launchd for the app** (like the backup plist): KeepAlive so it survives reboots. Static LAN
    IP for the server, NTP on (hour-based deadlines need a truthful clock), power settings: never sleep.
11. **Fresh database for go-live.** Baseline month must not contain MP-SIM-*/MP-SEED-* simulator
    rows: create the prod DB empty → `migrate deploy` → `pnpm seed` → create real projects only.
    Keep the simulator strictly on the dev machine.

## Verification (run these, in order)

12. `pnpm typecheck && pnpm test` — sandbox run today: **clean, 546/546**. Re-run on the Mac (the
    authoritative Prisma-typed check).
13. **Scripted e2e** — two terminals from the NEW path:
    `cd ~/Documents/LJ_ERP/MoldPilot && pnpm dev` … then `pnpm e2e:smoke`.
    Sentinel audit (today): the script is compatible with the UI overhaul — all asserted strings
    ("Trial Dashboard", "My tasks", "Trial Panel", admin headings, "Admin unavailable.") survived.
    Expect all green; any red is a real find.
14. **Golden-path by hand (10 min, zh + en):** title-only issue → lands in the right department
    inbox with ~7-day due date → second user sees 我来处理 → claim → verify the loser message on a
    double-claim → close+verify path → /score shows the event. Phone width: pixel-check /me.
15. **First production smoke after `pnpm start`:** login page loads from a PHONE on workshop Wi-Fi
    via the LAN IP; add-to-home-screen works (no service worker in the app, so plain HTTP is fine).

## Install-day already covered elsewhere

Posters v2 printed (docs/07-training/README.md) · conversations 1–5 + week-1 claiming pact
(docs/08-rollout/conversations-workbook.md) · paired entry week · password-reset wave expected.

## Known non-blockers (accepted for pilot)

- Bundle E (phone one-list merge) deferred by choice.
- create-project / PDF-export / design-change-create double-tap windows unguarded (low traffic).
- Trial-list countdown chip skipped (no raw date in row model).
- KPI metric names still say "claimed" on /score — metric labels, not buttons.
