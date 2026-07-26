# Deployment checklist — pilot go-live (2026-07-17 sweep)

Findings from the pre-deployment sweep (static audit + gates). Work top to bottom;
items marked ⛔ are blockers — do not put real users on the system until they're done.

## ⛔ Security blockers

1. **Secrets and cookies.** Production now refuses the development session
   fallback. Confirm `.env` mode is `0600`, contains a strong generated
   `MOLDPILOT_SESSION_SECRET`, sets `MOLDPILOT_DEPLOYMENT_MODE=production`, uses
   the exact browser-facing `MOLDPILOT_BASE_URL`, and sets
   `MOLDPILOT_SESSION_COOKIE_SECURE=auto`. `auto` must resolve Secure=true for
   HTTPS and Secure=false for temporary HTTP. Confirm `.env` remains ignored
   and absent from Git history.
2. **Passwords.** Change bootstrap credentials before staff access. Seeded
   operational users must complete the first-login password change.
3. **Database loopback.** Native production PostgreSQL and the shared
   development Compose listener must be loopback-only. For Compose use
   `127.0.0.1:5432:5432`; never publish `5432:5432`. Confirm with
   `lsof -nP -iTCP:5432 -sTCP:LISTEN`.
4. **Network containment.** Preferred mode keeps Next.js on
   `127.0.0.1:3000`; Caddy is the only LAN-facing listener, pins the expected
   host, and limits access to the approved factory CIDR. During the explicitly
   accepted temporary HTTP pilot, Next.js may bind only to the stable LAN
   hostname/IP configured in `MOLDPILOT_BASE_URL`, never `0.0.0.0`; router port
   forwarding must remain disabled. HTTP leaves credentials and cookies
   unencrypted. Keep HSTS disabled during this transition.
5. **Scanner health.** ClamAV definitions must be current and
   `scripts/check-malware-scanner.sh` must pass. Scanner failure keeps uploads
   quarantined; do not bypass this fail-closed behavior.

## ⛔ The commit + a tested backup

6. **Private remote + clean release.** Push the reviewed release to the private GitHub repository.
   The production Mac mini should pull with its repository-specific read-only deploy key. Never
   deploy an uncommitted or dirty production checkout.
7. **Backups armed.** Configure a mounted off-machine `BACKUP_DIR` and public
   `BACKUP_AGE_RECIPIENT`; keep the private age identity offline. Run one
   encrypted backup, complete the manifest-verified scratch restore, then load
   the reviewed LaunchAgent. It runs only while the dedicated account is logged
   in. A backup that has never restored is a hope, not a backup. Escrow the
   private age identity in the two sealed copies and schedule the quarterly
   restore drill: `security-hardening-runbook.md` §7a "Backup key escrow &
   restore drill".
   Before any future native-to-container cutover, also require the parent
   platform's non-mutating native inventory and encrypted cutover format v2.
   Native backup v1 remains a routine recovery archive but is not an accepted
   cutover source because it omits retained quarantine and D3 source metadata.
   The v2 production wrapper must prove native `/api/health/ready` before
   freezing `com.moldpilot.app` and again within the bounded recovery timeout
   after bootstrap/kickstart. Launchctl success without application readiness
   is a failed capture and the recovered agent must remain loaded for diagnosis.

## Production run mode (the server is not `pnpm dev`)

8. **Build + start.** Use `scripts/server-bootstrap-macos.sh --production` for
   the first Mac mini installation and `scripts/server-deploy-macos.sh` for
   updates. They validate deployment mode, base URL, and cookie security before
   stopping/restarting the service. HTTPS runs Next on `127.0.0.1:3000` behind
   approved Caddy; temporary HTTP binds the exact configured LAN address.
   Never use `pnpm dev` for workshop users.
9. **Migrations in prod:** use `pnpm exec prisma migrate deploy` (never `migrate dev` / `reset` on
   the production DB). The step-0 history repair in `migrate-and-verify.py` applies to dev only.
10. **Storage paths.** Set absolute, separate
   `MOLDPILOT_STORAGE_DIR` and `MOLDPILOT_QUARANTINE_DIR` paths outside Git
   with mode `0700`.
11. **launchd + stable LAN address.** Bootstrap installs `com.moldpilot.app` with KeepAlive. Use
    wired Ethernet plus a router DHCP reservation, keep NTP on, prevent automatic sleep, and keep
    the dedicated server account logged in because Homebrew services and the app are user agents.
12. **Fresh database for go-live.** Baseline month must not contain MP-SIM-*/MP-SEED-* simulator
    rows. Use `pnpm prisma:bootstrap` only on a fresh database; it installs production master data
    without demo projects and refuses to overwrite users/projects/activity. Never run `prisma:seed`
    or `pilot:reset` on production. Both `run-moldpilot.command` and
    `scripts/local-pilot.mjs` must refuse production deployment mode before
    migration or seed. Seed upserts preserve existing password and login
    lifecycle fields as defense in depth.

## Verification (run these, in order)

13. Run `pnpm exec prisma validate`, `pnpm lint`, `pnpm typecheck`,
    `pnpm test`, and `pnpm build` from the exact release checkout.
14. **Scripted e2e** — two terminals from the NEW path:
    `cd ~/Documents/LJ_ERP/MoldPilot && pnpm dev` … then `pnpm e2e:smoke`.
    Sentinel audit (today): the script is compatible with the UI overhaul — all asserted strings
    ("Trial Dashboard", "My tasks", "Trial Panel", admin headings, "Admin unavailable.") survived.
    Expect all green; any red is a real find.
15. **Golden-path by hand (10 min, zh + en):** title-only issue → lands in the right department
    inbox with ~7-day due date → second user sees 我来处理 → claim → verify the loser message on a
    double-claim → close+verify path → /score shows the event. Phone width: pixel-check /me.
16. **Security smoke:** verify the effective Next.js version is at least
    `16.2.11`; the production configuration checker passes; cookies are
    HttpOnly and SameSite=Lax; and Secure matches the configured scheme.
    Preferred HTTPS must be trusted from an allowed device and reject direct
    LAN port 3000. Temporary HTTP must bind only the configured LAN address,
    print the plaintext warning, and remain unreachable from the internet.
    Repeated login failures receive progressive backoff; scanner-unavailable
    uploads remain quarantined; downloads use `nosniff` and attachment
    disposition where required.
17. **First production smoke:** `/login`, forced password change, and `/me`
    load from a managed phone at the exact `MOLDPILOT_BASE_URL`. Confirm the
    session persists after password change, and verify other devices' sessions
    are logged out after password change (second browser signed in as the same
    user must land on `/login` on its next click). For HTTP, document the temporary
    risk acceptance; for HTTPS, verify the trusted certificate and that direct
    LAN access to port 3000 fails.

Follow the approval and rollback details in
`docs/08-rollout/security-hardening-runbook.md`.

## Install-day already covered elsewhere

Posters v2 printed (docs/07-training/README.md) · conversations 1–5 + week-1 claiming pact
(docs/08-rollout/conversations-workbook.md) · paired entry week · password-reset wave expected.

## Known non-blockers (accepted for pilot)

- Bundle E (phone one-list merge) deferred by choice.
- create-project / PDF-export / design-change-create double-tap windows unguarded (low traffic).
- Trial-list countdown chip skipped (no raw date in row model).
- KPI metric names still say "claimed" on /score — metric labels, not buttons.
