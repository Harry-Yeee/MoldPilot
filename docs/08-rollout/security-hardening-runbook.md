# Mac Mini Security Hardening Runbook

This runbook contains machine-level steps that are intentionally **not**
performed by the repository scripts. Review the commands, maintain a second
administrator session where noted, and obtain explicit approval before package
installation, service activation, certificate trust, firewall changes, shared
database recreation, backup scheduling, or moving the legacy workbook.

The preferred production shape is:

```text
factory client -- HTTPS :443 --> Caddy -- HTTP loopback --> Next 127.0.0.1:3000
                                         |
                                         +--> PostgreSQL 127.0.0.1:5432
```

Do not add router port forwarding. HSTS is intentionally disabled for the
initial internal-CA rollout.

Temporary exception: the current pilot may use direct HTTP on the isolated
factory LAN as documented in `mac-mini-intranet-server.md`. In that mode the
application binds only to the exact `MOLDPILOT_BASE_URL` hostname/IP, prints a
plaintext-credential warning, and uses non-Secure HttpOnly/SameSite=Lax
cookies. This exception is not an internet deployment and should be retired by
completing this HTTPS runbook.

## 1. Install Reviewed Prerequisites

Homebrew itself must be installed from a reviewed official `.pkg`. Do not pipe
a mutable remote installer into a shell. Record the package version, source
URL, expected SHA-256 from the release source, and the locally calculated
digest before opening it:

```bash
shasum -a 256 /path/to/reviewed-homebrew.pkg
sudo installer -pkg /path/to/reviewed-homebrew.pkg -target /
brew --version
```

After approval, install the application prerequisites:

```bash
brew update
brew install caddy clamav age pipx rclone
pipx install oletools
```

`rclone` is the off-site backup transport (section 7b). It is the only tool the
mini needs for the cloud leg; nothing new is added to `package.json`.

For the first deployment, passing `--install-prerequisites` to
`scripts/server-first-deploy-macos.sh` performs the `caddy`, `clamav`, and
`age` Homebrew installation after the operator has approved that flag.
Homebrew itself, `rclone`, and the separately used `oletools` review remain
outside the deployment script.

Impact: downloads and installs local executables. Nothing is LAN-facing until
Caddy is started. Rollback, only after confirming no other application depends
on these packages:

```bash
sudo brew services stop caddy
pipx uninstall oletools
brew uninstall caddy clamav age pipx
```

## 2. Configure And Verify ClamAV

Create a local FreshClam config when Homebrew has installed only its sample,
then update definitions:

```bash
BREW_PREFIX="$(brew --prefix)"
CLAM_ETC="$BREW_PREFIX/etc/clamav"
if [ ! -f "$CLAM_ETC/freshclam.conf" ]; then
  cp "$CLAM_ETC/freshclam.conf.sample" "$CLAM_ETC/freshclam.conf"
  sed -i '' 's/^Example/# Example/' "$CLAM_ETC/freshclam.conf"
fi
"$BREW_PREFIX/bin/freshclam"
MOLDPILOT_SCANNER_COMMAND="$BREW_PREFIX/bin/clamscan" \
  bash scripts/check-malware-scanner.sh
```

Set `MOLDPILOT_SCANNER_COMMAND` to that absolute `clamscan` path in the
mode-`0600` production `.env`. Upload release is fail-closed: scanner outage or
error leaves bytes in private quarantine and creates no downloadable
attachment.

Rollback: stop accepting uploads first, then remove the scanner path from the
environment. Do not leave the application running in production with a missing
scanner because its startup health check will intentionally fail.

## 3. Activate The TLS Reverse Proxy

Bootstrap renders:

```text
~/Library/Application Support/MoldPilot/Caddyfile
```

Validate and install the reviewed configuration:

```bash
BREW_PREFIX="$(brew --prefix)"
CADDY_SOURCE="$HOME/Library/Application Support/MoldPilot/Caddyfile"
"$BREW_PREFIX/bin/caddy" validate --config "$CADDY_SOURCE" --adapter caddyfile
sudo install -o root -g wheel -m 600 "$CADDY_SOURCE" "$BREW_PREFIX/etc/Caddyfile"
sudo brew services start caddy
sudo brew services list | grep caddy
```

Impact: Caddy begins listening on privileged HTTPS port 443. Its configuration
rejects sources outside `MOLDPILOT_TRUSTED_CIDR`, caps request bodies at 315 MB,
pins the configured site address/Host, and proxies only to
`127.0.0.1:3000`.

Validate from the server:

```bash
lsof -nP -iTCP:3000 -sTCP:LISTEN
lsof -nP -iTCP:443 -sTCP:LISTEN
curl -I http://127.0.0.1:3000/login
curl -kI "https://SERVER-IP/login"
```

When activating this HTTPS shape, the port-3000 listener must be
`127.0.0.1`, never `*` or the LAN address.

Rollback:

```bash
sudo brew services stop caddy
sudo rm -f "$(brew --prefix)/etc/Caddyfile"
```

Next remains available only from the Mac itself after rollback. Do not expose
port 3000 as a workaround.

## 4. Trust The Internal CA

The Caddy internal CA root certificate is public trust material; never
distribute its private key. Locate the root after Caddy starts:

```bash
sudo find "/var/root/Library/Application Support/Caddy" \
  -path '*/pki/authorities/local/root.crt' -print
```

Record its SHA-256 fingerprint with `openssl x509`, compare the fingerprint on
each managed client, and install only `root.crt` through the factory's managed
device/profile process. On the server itself:

```bash
ROOT_CERT="/actual/path/from-the-find-command/root.crt"
openssl x509 -in "$ROOT_CERT" -noout -subject -issuer -fingerprint -sha256
sudo security add-trusted-cert -d -r trustRoot \
  -k /Library/Keychains/System.keychain "$ROOT_CERT"
```

Impact: a trusted root can authenticate certificates issued by that CA. Limit
distribution to managed factory devices and protect the Caddy data directory.

Rollback on macOS:

```bash
ROOT_CERT="/same/root.crt"
CERT_SHA1="$(openssl x509 -in "$ROOT_CERT" -noout -fingerprint -sha1 |
  cut -d= -f2 | tr -d ':')"
sudo security delete-certificate -Z "$CERT_SHA1" \
  /Library/Keychains/System.keychain
```

Remove the corresponding managed profile from client devices as well.

## 5. Optional macOS Application Firewall

Enabling the firewall can affect SSH and other services. Keep a second
administrator/SSH session open and test it before closing the first.

After approval:

```bash
CADDY_BIN="$(brew --prefix)/bin/caddy"
sudo /usr/libexec/ApplicationFirewall/socketfilterfw --add "$CADDY_BIN"
sudo /usr/libexec/ApplicationFirewall/socketfilterfw --unblockapp "$CADDY_BIN"
sudo /usr/libexec/ApplicationFirewall/socketfilterfw --setglobalstate on
sudo /usr/libexec/ApplicationFirewall/socketfilterfw --getglobalstate
```

Verify HTTPS from an allowed client, rejection from an untrusted network, and
Remote Login access. Rollback:

```bash
sudo /usr/libexec/ApplicationFirewall/socketfilterfw --setglobalstate off
sudo /usr/libexec/ApplicationFirewall/socketfilterfw --remove \
  "$(brew --prefix)/bin/caddy"
```

## 6. Restrict The Shared Development PostgreSQL Listener

The LJ_ERP development Compose file is shared by MoldPilot and SupplyDesk.
Change its published port from:

```yaml
- "5432:5432"
```

to:

```yaml
- "127.0.0.1:5432:5432"
```

Applying this requires container recreation and briefly interrupts both apps:

```bash
cd /Users/ipwaikei/Documents/LJ_ERP
docker compose up -d --force-recreate postgres
docker compose ps
lsof -nP -iTCP:5432 -sTCP:LISTEN
```

Expected listener: `127.0.0.1:5432`, not `*:5432`. The named volume is retained;
do not add `--volumes`, run `docker compose down -v`, or reset either database.

Rollback:

```bash
# Restore "5432:5432" in the reviewed shared Compose file, then:
docker compose up -d --force-recreate postgres
```

Rollback re-exposes PostgreSQL and should be used only to diagnose a verified
loopback compatibility issue.

## 7. Encrypted Off-Machine Backups

Generate the age identity on a separate offline recovery device. Store its
private identity in protected recovery custody. Put only the public recipient
and mounted destination in the server `.env`:

```text
BACKUP_DIR="/Volumes/FactoryBackup/MoldPilot"
BACKUP_AGE_RECIPIENT="age1..."
```

Test one backup before scheduling:

```bash
bash scripts/backup.sh
ls -l "/Volumes/FactoryBackup/MoldPilot"/moldpilot-backup-*.tar.age
```

Render the per-user scheduler:

```bash
set -a
source .env
set +a
bash scripts/render-backup-launchagent.sh \
  "$BACKUP_DIR" "$BACKUP_AGE_RECIPIENT"
plutil -lint "$HOME/Library/LaunchAgents/com.moldpilot.backup.plist"
```

After approval, activate it:

```bash
launchctl bootout "gui/$UID/com.moldpilot.backup" 2>/dev/null || true
launchctl bootstrap "gui/$UID" \
  "$HOME/Library/LaunchAgents/com.moldpilot.backup.plist"
launchctl print "gui/$UID/com.moldpilot.backup"
```

Impact: a nightly 02:30 job reads the database, released uploads, and protected
recovery configuration, encrypts them locally, then writes a new versioned
archive to the mounted destination. This LaunchAgent runs only while the
dedicated account is logged in.

Rollback:

```bash
launchctl bootout "gui/$UID/com.moldpilot.backup"
```

Rollback does not delete existing archives. Never delete or overwrite the only
known-good backup.

Dev slices (`pnpm slice:export`) are sanitized, windowed subsets for development;
they are not backups and production must never be restored from one.

## 7a. Backup Key Escrow & Restore Drill 备份密钥托管与恢复演练

The `BACKUP_AGE_RECIPIENT` public key lives in the server `.env`. The matching
**age private identity is the only thing that can ever decrypt a backup.** It is
never on the Mac mini, never in Git, never in a password manager sync, and never
in email or chat.

### Where the identity lives 私钥存放位置

It exists in **exactly two sealed physical copies**, no more and no fewer:

| Copy | Location | Custodian |
| --- | --- | --- |
| A | Office safe 办公室保险柜 | Company (CEO holds the safe key) |
| B | Off-site: Harry's home 场外：Harry 家中 | Harry |

Two copies is the deliberate balance: one copy is a single fire away from
permanent data loss, three or more copies is three or more ways to leak it.

Each sealed envelope contains:

- The identity file **printed on paper** (`age1...` secret key, readable by eye
  if every drive fails).
- The same identity file **on a USB stick**, so recovery does not depend on
  retyping a long key correctly.
- The **date** the envelope was sealed and the key fingerprint of the matching
  public recipient (so a copy can be identified without opening it).
- A visible note: **"MoldPilot 备份恢复密钥 — 除恢复外请勿开封 / Backup recovery
  key — do not open except for recovery."**

Rules:

- Opening an envelope is a logged event, even if nothing was used.
- After any opening, re-seal in a **new** envelope and record it below.
- If a copy is lost, missing, or found already open, treat the key as
  compromised: generate a new age identity, re-run one full backup with the new
  recipient, verify a scratch restore from the NEW archive, and only then destroy
  the old copies.
- Never photograph the printed key. Never type it into a chat, ticket, or AI
  assistant.

### Custody log 保管记录

Fill in a row for every seal, move, open, or replacement.

| Date | Copy (A/B) | Event (sealed / moved / opened / replaced / destroyed) | Reason | Handled by | Witness | New seal date |
| --- | --- | --- | --- | --- | --- | --- |
|  |  |  |  |  |  |  |
|  |  |  |  |  |  |  |
|  |  |  |  |  |  |  |

### Quarterly restore drill 季度恢复演练

Run every quarter, and additionally after any backup-related change (new disk,
new key, new server). Five steps:

1. **Pick the latest archive.** Take the newest
   `moldpilot-backup-*.tar.age` from `BACKUP_DIR` — not a hand-picked old one.
   Record its filename and size.
2. **Restore into a scratch database.** Follow section 8 exactly:
   `createdb moldpilot_restore_test` plus a separate scratch uploads directory,
   `RESTORE_CONFIRM=RESTORE_TO_EMPTY_SCRATCH`, and the escrowed identity from a
   copy you just opened. Never point the restore at production.
3. **Verify the manifest.** Confirm `manifest.sha256` inside the archive
   verifies, and that `backup-info.txt` shows the expected `createdAt`.
4. **Spot-check the uploads mirror.** Pick 3 attachments (one photo, one QC
   report, one CAD/video) and confirm the restored files exist and their SHA-256
   digests match the restored database rows.
5. **Log the drill.** Date, operator initials, archive filename, and PASS/FAIL in
   the table below. Then remove the scratch database and directory, and re-seal
   the opened key copy.

| Drill date | Archive used | Manifest | Uploads spot check | Result | Initials |
| --- | --- | --- | --- | --- | --- |
|  |  |  |  |  |  |
|  |  |  |  |  |  |

**A failed drill is a no-backup emergency.** Treat it exactly like discovering
there are no backups at all: stop non-essential work, find the cause the same
day, and do not accept the backup chain again until a drill passes end to end.
Do not delete or overwrite the last known-good archive while investigating.

### Weekly restart check 每周重启检查

During the baseline month, check `com.moldpilot.app` restart counts once a week so a
silent crash-loop surfaces before it eats a month of KPI data — `KeepAlive` hides
repeated crashes behind an app that looks up:

```bash
log show --predicate 'process == "launchd" AND eventMessage CONTAINS "com.moldpilot.app"' \
  --last 7d --style compact
```

## 7b. Cloud Leg Setup 云端备份配置

Backup v2 in one sentence: the mini writes an encrypted archive to the mounted
disk, copies it to an **immutable** Aliyun OSS bucket, restores last night's
archive into a scratch database to prove it can, and shows one health light on
the admin page. No recurring human step.

Owner decisions, 2026-07-29: **Aliyun OSS** · **30-day compliance retention
(WORM), locked** · **full restore verify nightly** · transport **rclone**.

> **Corrections 2026-07-30** (cross-review of the v2 build, findings 1–8). If
> you read an earlier copy of this section, four things changed: the lifecycle
> rule is now **four** rules and expires current versions too (A3 — the old
> noncurrent-only rule expired nothing, because every archive has a unique
> name); the mini's key is described honestly as **prefix-scoped, no-delete
> (Put/Get/List)**, not "put-only" (B); acceptance gains **G0** (verify WORM is
> LOCKED, from the owner's laptop) and **G2** (prove the exact rclone operations
> against the real policy); and the cloud drill is scheduled **by age**, not by
> a calendar day (F).

Everything in part A is done **once, from the owner's laptop, with admin
credentials**. The Mac mini never holds a credential that can delete, expire, or
reconfigure anything.

### The estate convention 集群约定

| Shared once for the whole estate | Created per app |
| --- | --- |
| One bucket `lj-erp-backups` | One object prefix `<app>/` |
| One compliance-retention (WORM) policy, 30 days, locked | One RAM sub-user + a prefix-scoped, no-delete (Put/Get/List) AccessKey |
| One lifecycle policy — four rules, see A3 | One `backup-status.json` and one admin health widget |

MoldPilot is the only production app today, so the parameterised core lives in
this repo (`scripts/backup-app-config.sh`, `scripts/backup-lib.sh`). Onboarding
SupplyDesk / ClientView / Warehouse must be "copy the config block, create the
prefix and the key" — never "edit the logic". See H below.

### A. Bucket, immutability, lifecycle 存储桶、不可变、生命周期

Console: OSS → Buckets → Create Bucket.

| Setting | Value |
| --- | --- |
| Bucket name | `lj-erp-backups` |
| Region | the region closest to the factory (record it; rclone needs the endpoint) |
| Storage class | Standard |
| ACL | Private |
| Block public access | Enabled |
| Server-side encryption | OSS-managed (AES-256) |
| Versioning | **Enabled** — turn this on before the first upload |

Then, on the bucket:

1. **Versioning 版本控制** → Enabled. A tampered or truncated overwrite leaves
   the previous version intact.
2. **Compliance retention policy 合规保留策略** → create with a retention period
   of **30 days**, then **LOCK it**.
   Read this twice before locking: once locked, **no one — not Alibaba support,
   not the root account — can shorten or delete the policy**, and no object can
   be deleted or overwritten until it is 30 days old. Storage for those 30 days
   is unavoidable. That is the point: it is the wall between a ransomware
   operator (or a bad script) and the only copy of the factory's history.
   Locking is irreversible. Lock it anyway.
3. **Lifecycle policy 生命周期规则** → applies to prefix `` (whole bucket).
   **Four rules, not one.** Every archive this pipeline uploads has a unique
   name (`<app>-backup-<timestamp>.tar.age`), so an object is never overwritten
   and therefore **never becomes noncurrent**. A noncurrent-only rule — which is
   what this runbook said until 2026-07-30 — would expire nothing at all, and
   the bucket would grow forever at roughly one archive per app per night.

   | # | Rule | Value | Why |
   | --- | --- | --- | --- |
   | a | Expire **current** versions | `BACKUP_CLOUD_RETENTION_DAYS` = **180 days** after creation | The only rule that actually deletes our archives. 180 days of off-site history, then it goes. **It must be greater than the 30-day WORM period** — a lifecycle deletion of an object still inside its retention window fails, and the rule would retry, log errors and never converge. 180 ≫ 30 leaves a wide margin. |
   | b | Expire **noncurrent** versions | 30 days after becoming noncurrent | Only reached if something ever does overwrite a name (a hand-uploaded fix, a future tool). Bounded, not unbounded. |
   | c | Delete **expired object delete markers** | enabled | Versioned deletes leave markers behind; without this the bucket keeps a growing tail of empty tombstones. |
   | d | Abort **incomplete multipart uploads** | 7 days | A large archive interrupted mid-upload leaves paid-for fragments that no listing shows. |

   Set all four on the bucket from the laptop. No app key can touch them.

   **WORM interaction — expected, not an error:** rules (a)–(d) can only delete
   an object once its 30-day compliance retention has expired. Until then OSS
   refuses the deletion. That is the wall doing its job; do not "fix" it by
   shortening retention (you cannot — it is locked) or by lengthening it past
   `BACKUP_CLOUD_RETENTION_DAYS` (that would stall rule (a) permanently).

Confirm before continuing:

```text
Versioning:            Enabled
Retention policy:      Compliance, 30 days, Locked
Lifecycle rule a:      Current versions expire 180 days after creation
Lifecycle rule b:      Noncurrent versions expire 30 days after becoming noncurrent
Lifecycle rule c:      Expired object delete markers cleaned
Lifecycle rule d:      Incomplete multipart uploads aborted after 7 days
Public access:         Blocked
```

`BACKUP_CLOUD_RETENTION_DAYS` is a **bucket setting, not an app env var** — no
script reads it. It is named here so the number has one place to live.

### B. One prefix-scoped, no-delete RAM key per app 每个应用一个受限子账号

**Say what it is.** The key is **prefix-scoped and no-delete**: it may
`PutObject`, `GetObject` and `ListObjects` inside its own prefix and nothing
else. It is *not* "put-only" — earlier drafts of this runbook called it that,
and the word mattered: the mini's key can also **read every archive it has ever
uploaded**. It has to, because the monthly cloud drill downloads an archive and
restores it. Combined with the verify identity in section E, an attacker who
owns the mini can pull and decrypt the off-site history. What they still cannot
do is destroy it — no `Delete*`, no bucket administration, and a locked WORM
policy behind that.

RAM Console → Identities → Users → Create User (no console logon, AccessKey
only). Name it `lj-erp-backup-<app>`, e.g. `lj-erp-backup-moldpilot`.

Create a custom policy and attach it to that user only. **Template — replace
`REPLACE_APP_PREFIX` with the app's prefix (`moldpilot`, `supplydesk`, …) and
nothing else:**

```json
{
  "Version": "1",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["oss:PutObject", "oss:GetObject"],
      "Resource": ["acs:oss:*:*:lj-erp-backups/REPLACE_APP_PREFIX/*"]
    },
    {
      "Effect": "Allow",
      "Action": ["oss:ListObjects"],
      "Resource": ["acs:oss:*:*:lj-erp-backups"],
      "Condition": {
        "StringLike": {
          "oss:Prefix": ["REPLACE_APP_PREFIX/*"]
        }
      }
    }
  ]
}
```

What is deliberately absent, and must stay absent: `oss:DeleteObject`,
`oss:DeleteObjectVersion`, `oss:AbortMultipartUpload` on other prefixes, every
`oss:Put*Bucket*` / `oss:*Lifecycle*` / `oss:*Retention*` action, and any
resource outside this app's prefix. The RAM user must have **no** other policy
attached — not `AliyunOSSFullAccess`, not `AliyunOSSReadOnlyAccess`.

Record the AccessKey ID/secret **once**, hand them to the mini in step C, and
never put them in Git, chat, a ticket, or an AI assistant. The Aliyun **root**
account credentials never touch the mini.

### B2. Optional hardening: split the credential 可选加固（拆分凭证）

**Not required today. Do not do this before G0–G5 pass with the single key.**

The single key above needs `GetObject` only because the same machine performs
the monthly cloud drill. Those two jobs can hold different keys:

| Key | Actions | Used by |
| --- | --- | --- |
| `lj-erp-backup-<app>-upload` | `oss:PutObject` + `oss:ListObjects` on the prefix | `scripts/backup.sh` (nightly upload) |
| `lj-erp-backup-<app>-verify` | `oss:GetObject` + `oss:ListObjects` on the prefix | `scripts/backup-verify.sh --cloud-drill` |

Then a compromise of the *upload* path alone cannot read history. The cost is
two rclone remotes on one machine (`BACKUP_OSS_REMOTE` for the upload,
a second remote name for the drill), two keys to rotate, and one more thing to
get wrong at 2 a.m. On a single mini that runs both jobs as the same user the
security gain is small — an attacker with the mini has both files. Revisit this
when the drill moves off the mini, or when a second app shares the bucket with a
different operator.

### C. rclone on the mini 安装与配置

```bash
brew install rclone
rclone version
rclone config
```

Answer the interactive prompts:

| Prompt | Answer |
| --- | --- |
| n/s/q | `n` (new remote) |
| name | `ljerp-oss` |
| Storage | `s3` |
| provider | `Alibaba` (Alibaba Cloud Object Storage System) |
| env_auth | `false` (enter credentials) |
| access_key_id | the RAM user's AccessKey ID |
| secret_access_key | the RAM user's AccessKey Secret |
| endpoint | the bucket's region endpoint, e.g. `oss-cn-shenzhen.aliyuncs.com` |
| acl | `private` |
| storage_class | `Standard` |
| Edit advanced config | `n` |

Lock the config file down and smoke-test the key:

```bash
chmod 600 "$HOME/.config/rclone/rclone.conf"
ls -l "$HOME/.config/rclone/rclone.conf"          # expect -rw-------
rclone lsd ljerp-oss:lj-erp-backups/moldpilot/    # expect no error, empty is fine
```

**Endpoint note 域名说明.** If uploads fail with an endpoint/domain error on a
mainland region — typically for accounts created after 2025-03, where the
bucket's default public domain is restricted for API access — consult Aliyun's
current guidance on default-domain restrictions and use the documented
internal/region endpoint instead of the default domain. The G2 probe upload
surfaces this immediately, before the first nightly run.

### D. The mini's `.env` 服务器环境变量

Append to the server `.env` (mode 0600), following
`ops/config/production.env.example` conventions — replace every `REPLACE_`
value and leave the estate-wide values as-is:

```text
# Off-site backup leg (runbook 7b). No secret lives here: the AccessKey is in
# rclone.conf, and the age recipients are public keys.
BACKUP_OSS_REMOTE=ljerp-oss
BACKUP_OSS_BUCKET=lj-erp-backups
BACKUP_OSS_PREFIX=moldpilot
BACKUP_RCLONE_CONFIG=/Users/REPLACE_OPERATOR/.config/rclone/rclone.conf

# Nightly self-verify (section E). Public recipient here; the private identity
# is a file on this machine at mode 0600, and is NOT the escrowed recovery key.
BACKUP_VERIFY_RECIPIENT=age1REPLACE_VERIFY_RECIPIENT
BACKUP_VERIFY_IDENTITY_FILE=/Users/REPLACE_OPERATOR/.config/lj-erp/moldpilot-verify-identity

# This machine is EXPECTED to be running backups. With this set, a missing or
# corrupt backup-status.json turns the admin health line RED instead of showing
# the calm "no status yet" line a developer laptop shows. Set it on the mini,
# never in a developer .env.
BACKUP_EXPECTED=1
```

Everything else — app name, database name, storage dir, status-file path,
archive prefix, scratch-database name, cloud-drill cadence
(`BACKUP_DRILL_MAX_AGE_DAYS`, default 30) — is already correct in
`scripts/backup-app-config.sh` and needs no entry here.

### E. The nightly verify identity — a deliberate trade-off 每夜验证私钥

Section 7a is emphatic that the recovery identity is never on the mini. That
rule does not change. But an **unattended** nightly restore has to decrypt an
archive, so Backup v2 enrols a **second, lower-value reader**:

- `scripts/backup.sh` encrypts to `BACKUP_AGE_RECIPIENT` (escrowed, offline)
  **and**, when set, to `BACKUP_VERIFY_RECIPIENT`.
- The verify identity lives only on the mini at mode 0600 and is used only by
  `scripts/backup-verify.sh`.

The honest cost: anyone who compromises the mini can decrypt every archive on
the mounted disk, not just today's data. The honest benefit: every archive is
proven restorable within 24 hours instead of once a quarter. An attacker with
the mini already has the live database and `.env`; a silently broken backup
chain is the failure that actually loses the company its history. If you decline
this trade, leave `BACKUP_VERIFY_RECIPIENT` unset — the nightly verify then
records `skipped`, the admin light goes amber, and the quarterly manual drill in
7a stays your only proof.

```bash
mkdir -p "$HOME/.config/lj-erp"
age-keygen -o "$HOME/.config/lj-erp/moldpilot-verify-identity"
chmod 600 "$HOME/.config/lj-erp/moldpilot-verify-identity"
# The printed "Public key: age1..." goes in .env as BACKUP_VERIFY_RECIPIENT.
```

This identity is **not** escrowed and **not** sealed in an envelope. If it is
lost, generate a new one; only the 7a recovery key matters for real recovery.

### F. Schedulers 定时任务

```bash
set -a; source .env; set +a
bash scripts/render-backup-launchagent.sh "$BACKUP_DIR" "$BACKUP_AGE_RECIPIENT"
plutil -lint "$HOME/Library/LaunchAgents/com.moldpilot.backup.plist"
plutil -lint "$HOME/Library/LaunchAgents/com.moldpilot.backup-verify.plist"
```

After approval, activate both:

```bash
for AGENT in com.moldpilot.backup com.moldpilot.backup-verify; do
  launchctl bootout "gui/$UID/$AGENT" 2>/dev/null || true
  launchctl bootstrap "gui/$UID" "$HOME/Library/LaunchAgents/$AGENT.plist"
  launchctl print "gui/$UID/$AGENT" | head -5
done
```

Backup runs 02:30; verify runs 03:30 and also performs the **cloud drill
whenever the last successful drill is more than `BACKUP_DRILL_MAX_AGE_DAYS`
(default 30) old, or has never run** — checked every night, so a drill that
fails or finds the mini offline is retried the next night instead of waiting a
month. (It used to fire on a fixed day of the month compared against the **UTC**
date: at 03:30 Beijing time that is the *previous* UTC day, so the trigger could
mis-fire or never fire, and one offline night cost a whole month. Fixed
2026-07-30.) **Both LaunchAgents run only while the dedicated account is logged
in** — the same caveat as section 7. A reboot that lands on the login window
silently stops backups; the admin health light turns red 26 hours later, which
is how you find out.

Rollback:

```bash
launchctl bootout "gui/$UID/com.moldpilot.backup-verify"
launchctl bootout "gui/$UID/com.moldpilot.backup"
```

### G. Acceptance 验收

These tests are the definition of "Backup v2 is working". **G0 runs from the
OWNER'S laptop** with the root/admin credential; **G1–G5 run on the Mac mini**.
They need a real database, a mounted disk, a network and the live bucket, so
they are run by hand and their results recorded in the log at the end of this
section. None of them has been executed by the engineer who wrote this section.

Before them, a dry rehearsal that needs none of those things — it runs the whole
pipeline against fake `rclone`/`age`/`psql` binaries in a temp directory and
proves the control flow (copy-not-sync, status transitions, exit codes, the
scratch-name refusal, age-based drill scheduling, concurrent status writes) and
asserts it wrote nothing outside its own temp tree:

```bash
pnpm backup:rehearse            # = bash scripts/backup-rehearsal.sh
# expect the final line: passed 93 / failed 0
```

**G0. WORM is LOCKED 合规保留策略已锁定 — from the OWNER'S laptop, before G1.**

G1 proves the mini's *key* cannot delete. G0 proves the *bucket* will not let
anyone delete — including someone holding a broader key. Both walls, or you only
think you have two. The mini cannot run this: it has no credential that can read
bucket configuration, and it must never be given one.

Console click-path (owner's laptop, logged in as root/admin):

1. OSS Console → Buckets → `lj-erp-backups` → **Redundancy/Version Control
   版本控制** → confirm `Versioning: Enabled`.
2. Same bucket → **Compliance Retention Policy 合规保留策略** → confirm the
   policy exists, `Retention period: 30 days`, and `Status: Locked 已锁定`.

CLI equivalent — **documented, not executed** by the engineer who wrote this:

```bash
# ossutil (owner's laptop, configured with the root/admin credential)
ossutil bucket-versioning --method get oss://lj-erp-backups
ossutil worm --method get oss://lj-erp-backups

# or the Aliyun CLI
aliyun oss GetBucketVersioning --bucket lj-erp-backups
aliyun oss GetBucketWorm       --bucket lj-erp-backups
```

Expected: versioning `Enabled`, and a WORM policy whose **`State` is `Locked`**
with `RetentionPeriodInDays: 30`.

**A policy in `InProgress` state is NOT protection.** An unlocked
(`InProgress`) compliance policy can be deleted by its creator **within 24 hours
of creation** — during that window an attacker with admin credentials, or an
operator with a slipped finger, simply removes it and every archive becomes
deletable. If G0 shows `InProgress`, lock it now and re-run G0; do not proceed
to G1 and do not retire manual rotation.

Record the state string you saw in the log below.

**G1. Immutability proof 不可变性验证 — the delete MUST fail (proves the RAM
policy, the FIRST wall).**

```bash
set -a; source .env; set +a
OBJECT="$(rclone lsf --files-only ljerp-oss:lj-erp-backups/moldpilot/ | tail -1)"
echo "$OBJECT"
rclone deletefile "ljerp-oss:lj-erp-backups/moldpilot/$OBJECT"; echo "exit=$?"
```

Expected — the command FAILS, with the RAM policy as the first wall:

```text
ERROR : Failed to deletefile with 1 error(s): last error was:
        AccessDenied: You have no right to access this object because of bucket acl.
exit=1
```

If your key were ever broadened by accident, the locked compliance policy
verified in G0 is the SECOND wall and the error becomes:

```text
ERROR : ... InvalidRequest: Object protected by object lock / worm.
```

**If the delete succeeds, stop.** The build is wrong: the RAM policy has a
`Delete*` action or the retention policy is not locked. Fix A/B before
continuing, and treat every object uploaded so far as deletable.

Record the exact error text you saw in the log below.

**G2. The key can do exactly what rclone needs 凭证与操作对齐.**

A policy that looks right in the console can still be missing an operation the
transport uses (rclone issues `HeadObject` for existence checks, and multipart
calls for large files). Prove the three operations the pipeline actually
performs, with the mini's own credential:

```bash
set -a; source .env; set +a
PROBE="$(mktemp -d)/probe-$(date -u +%Y%m%dT%H%M%SZ).txt"
printf 'backup v2 probe\n' > "$PROBE"

# (1) upload — the nightly leg
rclone copy "$PROBE" ljerp-oss:lj-erp-backups/moldpilot/ --no-traverse; echo "copy exit=$?"

# (2) list — how the drill finds the newest archive
rclone lsf --files-only ljerp-oss:lj-erp-backups/moldpilot/ | tail -3; echo "lsf exit=$?"

# (3) download — the drill's own read path
rclone copyto "ljerp-oss:lj-erp-backups/moldpilot/$(basename "$PROBE")" \
  "$(dirname "$PROBE")/roundtrip.txt"; echo "copyto exit=$?"
diff "$PROBE" "$(dirname "$PROBE")/roundtrip.txt" && echo "bytes match"
```

Expected: all three `exit=0` and `bytes match`. The probe object stays in the
bucket — nobody can delete it for 30 days, which is the point, and it is a few
bytes.

If one of them fails, read the error before changing anything:

- `AccessDenied ... because of bucket acl` on **copy** → the policy is missing
  `oss:PutObject` for this prefix, or the prefix in the policy does not match
  the prefix in the command.
- `AccessDenied` on **lsf** → the `oss:ListObjects` statement is missing, or its
  `oss:Prefix` condition does not cover `moldpilot/*`.
- `AccessDenied`/`404` on **copyto** while copy and lsf pass → the policy grants
  `PutObject` but not `GetObject` (rclone also needs `HeadObject`, which Aliyun
  authorises under `oss:GetObject`).
- An endpoint/domain error on any of them → see the endpoint note in section C.

The fix is always "add the missing action to the part-B policy for this prefix",
never "attach `AliyunOSSFullAccess`".

**G3. Nightly verify proves a restore 每夜恢复验证.**

```bash
set -a; source .env; set +a
bash scripts/backup-verify.sh --local; echo "exit=$?"
node scripts/backup-status.mjs --print \
  --file "${BACKUP_STATUS_FILE:-$MOLDPILOT_STORAGE_DIR/backup-status.json}" \
  | python3 -c 'import json,sys; print(json.load(sys.stdin)["stages"]["nightlyVerify"])'
psql "$DATABASE_URL" -Atc \
  "SELECT COUNT(*) FROM pg_database WHERE datname='moldpilot_verify_scratch';"
```

Expected: `exit=0`; the stage shows `status: ok` with `userCount` and
`projectCount` both greater than zero and `manifest: verified`; the last query
prints `0` — the scratch database was dropped.

**G4. Cloud drill restores from OSS bytes 云端演练.**

```bash
bash scripts/backup-verify.sh --cloud-drill; echo "exit=$?"
```

Expected: `exit=0`, and the log line `cloud drill: restoring
moldpilot-backup-…tar.age pulled from lj-erp-backups/moldpilot`. The status
stage `cloudDrill` shows `status: ok` and `source: oss`. The script downloads
into a fresh `mktemp -d` directory and refuses to proceed if the drill archive
ever resolves under `BACKUP_DIR`, so a pass cannot come from a local cache. To
see that for yourself, run it with the backup drive ejected — it still passes.

**G5. Kill-switch honesty 断电/断网诚实性.**

```bash
# (a) unplug or eject the backup drive, then:
bash scripts/backup.sh; echo "exit=$?"
#     expect exit=1 and "[backup FAIL] BACKUP_DIR ..."
#     admin page: red, "The last local backup failed."

# (b) reconnect the drive, disable Wi-Fi/Ethernet, then:
bash scripts/backup.sh; echo "exit=$?"
#     expect exit=0, "[backup] off-site copy skipped: this machine appears to be offline."
#     admin page: amber immediately; red once the last successful upload is >26h old.

# (c) restore both, run once more, confirm the admin page returns to green.
```

Open `/admin` as an administrator between each step; the health line is the
thing being tested.

| Date | G0 WORM state (verbatim) | G1 delete error (verbatim) | G2 | G3 | G4 | G5 | Operator |
| --- | --- | --- | --- | --- | --- | --- | --- |
|  |  |  |  |  |  |  |  |

Manual USB rotation is retired only after G0–G5 pass **and** the first scheduled
cloud drill passes on its own (the nightly verify runs it when the last
successful drill is more than 30 days old). Until then, keep rotating.

### H. Onboarding the next app 新应用接入（5 步）

1. Copy `scripts/backup-app-config.sh` into the new app and change only the App
   identity block: `BACKUP_APP_NAME`, `BACKUP_APP_DISPLAY_NAME`,
   `BACKUP_APP_DB_NAME`, `BACKUP_APP_STORAGE_DIR`, `BACKUP_OSS_PREFIX`, plus
   `BACKUP_VERIFY_TABLES` for that app's two "must not be empty" tables.
   Copy `backup.sh`, `backup-verify.sh`, `backup-lib.sh`, `backup-status.mjs`
   unchanged.
2. Create the object prefix by uploading the app's first archive; create its RAM
   user and attach the part-B policy with `REPLACE_APP_PREFIX` set to the new
   prefix. No bucket, WORM or lifecycle work — those already exist and apply to
   the whole bucket, the new prefix included.
3. `rclone config` on that app's host (or a second remote name if it shares the
   mini), `chmod 600` the config.
4. Add the `BACKUP_OSS_*` and `BACKUP_VERIFY_*` block to that app's `.env`;
   render and load its two LaunchAgents.
5. Render its admin health widget from its own `backup-status.json`
   (`src/server/backup-health.ts` + `src/app/admin/backup-health-panel.tsx` are
   app-agnostic apart from the storage-dir env read), set `BACKUP_EXPECTED=1` in
   its production `.env`, and run **G1–G5** for it. G0 is estate-wide: the
   bucket's WORM state is already proven and does not need re-locking per app.

Estate-wide health — every app's light on one screen — is a platform D3 concern
and is deliberately out of scope. Each app shows its own light.

### I. Planned migration to the platform repo 后续迁移

When a second app reaches production, the parameterised core (`backup-lib.sh`,
`backup-status.mjs`, `backup-verify.sh`) lifts into the platform repo's `ops/`,
where backup infrastructure already lives, and apps consume it with only their
config block. That move is aligned with the platform's D-milestone versioning
and the `scripts/platform-required-files.txt` manifest. **Do not move it now** —
one production app does not justify a cross-repo dependency.

## 8. Scratch Restore Drill

Create an empty scratch database and a separate scratch upload directory. Never
point the restore script at production:

```bash
createdb moldpilot_restore_test
RESTORE_CONFIRM=RESTORE_TO_EMPTY_SCRATCH \
AGE_IDENTITY_FILE="/path/to/offline-recovery-identity" \
RESTORE_DATABASE_URL="postgresql://moldpilot@127.0.0.1:5432/moldpilot_restore_test" \
bash scripts/restore-backup-to-scratch.sh \
  "/Volumes/FactoryBackup/MoldPilot/moldpilot-backup-TIMESTAMP.tar.age" \
  "$HOME/MoldPilotRestoreTest/uploads"
```

Verify records and attachment hashes, record the date/operator, then remove the
scratch database and directory only after explicit confirmation. A backup is
not accepted until this drill succeeds.

## 9. Legacy Workbook Quarantine

The active seed no longer consumes the legacy `.xls`. Moving the original is
destructive and requires approval:

```bash
bash scripts/quarantine-legacy-workbook.sh --plan
bash scripts/quarantine-legacy-workbook.sh --move
```

The move stores the workbook outside the repository with mode `0600`, records a
SHA-256 digest, and runs ClamAV plus `olevba`. It remains
`QUARANTINED_PENDING_SECURITY_REVIEW` even if both tools complete without a
detection. Do not upload it to VirusTotal or any other public service.
