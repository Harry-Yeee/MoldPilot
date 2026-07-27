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
brew install caddy clamav age pipx
pipx install oletools
```

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
