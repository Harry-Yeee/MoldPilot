import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

function source(relativePath: string): string {
  return readFileSync(new URL(`../../${relativePath}`, import.meta.url), "utf8");
}

describe("backup security", () => {
  it("creates encrypted versioned archives without an overwrite mirror", () => {
    const backup = source("scripts/backup.sh");
    assert.match(backup, /BACKUP_AGE_RECIPIENT/);
    assert.match(backup, /age --recipient/);
    assert.match(backup, /moldpilot-backup-\$STAMP\.tar\.age/);
    assert.match(backup, /\[ ! -e "\$DESTINATION" \]/);
    assert.doesNotMatch(backup, /uploads-mirror/);
    assert.doesNotMatch(backup, /rsync -a --delete/);
  });

  it("includes encrypted recovery configuration and requires off-machine storage", () => {
    const backup = source("scripts/backup.sh");
    assert.match(backup, /\/Volumes\/\*/);
    assert.match(backup, /recovery\/moldpilot\.env/);
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
