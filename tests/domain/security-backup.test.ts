import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

function source(relativePath: string): string {
  return readFileSync(new URL(`../../${relativePath}`, import.meta.url), "utf8");
}

describe("backup security", () => {
  // Backup v2 parameterised the archive name so the next estate app can reuse
  // the logic (scripts/backup-app-config.sh). The names these tests used to
  // pin are now the CONFIG defaults, asserted here so the rendered filenames
  // and the recovery-config entry cannot drift.
  it("creates encrypted versioned archives without an overwrite mirror", () => {
    const backup = source("scripts/backup.sh");
    const config = source("scripts/backup-app-config.sh");
    assert.match(backup, /BACKUP_AGE_RECIPIENT/);
    assert.match(backup, /age "\$\{AGE_RECIPIENT_ARGS\[@\]\}"/);
    assert.match(backup, /--recipient "\$BACKUP_AGE_RECIPIENT"/);
    assert.match(backup, /ARCHIVE_NAME="\$\{BACKUP_ARCHIVE_PREFIX\}\$\{STAMP\}\$\{BACKUP_ARCHIVE_SUFFIX\}"/);
    assert.match(config, /BACKUP_APP_NAME:-moldpilot/);
    assert.match(config, /BACKUP_ARCHIVE_PREFIX:-\$BACKUP_APP_NAME-backup-/);
    assert.match(config, /BACKUP_ARCHIVE_SUFFIX:-\.tar\.age/);
    assert.match(backup, /\[ ! -e "\$DESTINATION" \]/);
    assert.doesNotMatch(backup, /uploads-mirror/);
    assert.doesNotMatch(backup, /rsync -a --delete/);
  });

  it("includes encrypted recovery configuration and requires off-machine storage", () => {
    const backup = source("scripts/backup.sh");
    assert.match(backup, /\/Volumes\/\*/);
    assert.match(backup, /recovery\/\$\{BACKUP_APP_NAME\}\.env/);
    assert.match(backup, /manifest\.sha256/);
  });

  it("keeps scheduler activation and restore as explicit guarded steps", () => {
    const renderer = source("scripts/render-backup-launchagent.sh");
    const restore = source("scripts/restore-backup-to-scratch.sh");
    assert.match(renderer, /Not activated/);
    assert.doesNotMatch(renderer, /launchctl (?:load|bootstrap|kickstart)/);
    assert.match(restore, /RESTORE_CONFIRM/);
    assert.match(restore, /Scratch database is not empty/);
    assert.doesNotMatch(restore, /--clean/);
  });
});
