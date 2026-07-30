import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  evaluateBackupHealth,
  parseBackupStatus,
  type BackupHealth
} from "@/domain/security/backup-status";
import { attachmentStorageRoot } from "@/server/attachment-storage";

/**
 * Server-side reader for the Backup v2 status file.
 *
 * APP IDENTITY BLOCK (server half). The shell half is
 * scripts/backup-app-config.sh; these two must resolve the SAME path, which is
 * why the storage root comes from `attachmentStorageRoot()` rather than a
 * second copy of the default. Onboarding the next estate app means giving it
 * its own `BACKUP_STATUS_FILE` / storage dir — never editing the evaluation
 * logic, which lives app-agnostically in `@/domain/security/backup-status`.
 */
const STATUS_FILE_NAME = "backup-status.json";

export function backupStatusFilePath(): string {
  const configured = process.env.BACKUP_STATUS_FILE;
  if (configured != null && configured.trim().length > 0) {
    return path.isAbsolute(configured)
      ? configured
      : path.resolve(/* turbopackIgnore: true */ process.cwd(), configured);
  }

  return path.join(attachmentStorageRoot(), STATUS_FILE_NAME);
}

/**
 * Is this a machine where backups are EXPECTED to be running?
 *
 * Production `.env` sets `BACKUP_EXPECTED=1`. It is read server-side only and
 * never reaches the browser. With it set, a missing or corrupt status file is
 * RED — on a commissioned install the nightly job rewrites that file every
 * night, so its absence is a failure, not an absence of news. Unset (every
 * developer machine) keeps the calm "no status yet" line.
 */
export function backupExpected(): boolean {
  const flag = process.env.BACKUP_EXPECTED;
  return flag === "1" || flag?.toLowerCase() === "true";
}

/**
 * Read the status file without ever throwing. A background job owns this file;
 * it can be absent (nothing has run yet), mid-rename, truncated, or edited by
 * hand. Every one of those must degrade to a verdict rather than take the admin
 * page down — the page's job is to tell an admin about the backups, and a crash
 * tells them nothing. Which verdict depends on `BACKUP_EXPECTED`.
 */
export async function loadBackupHealth(now: Date = new Date()): Promise<BackupHealth> {
  let raw: string | null = null;
  const expected = backupExpected();

  try {
    raw = await readFile(backupStatusFilePath(), "utf8");
  } catch {
    raw = null;
  }

  try {
    return evaluateBackupHealth(parseBackupStatus(raw), now, { expected });
  } catch {
    return evaluateBackupHealth(null, now, { expected });
  }
}
