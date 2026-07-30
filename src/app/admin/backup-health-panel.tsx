import {
  backupHealthFindingLabels,
  backupHealthLabels,
  pickLabel,
  type Locale
} from "@/domain/mold-trial/labels";
import type {
  BackupHealthLevel,
  BackupHealthStage,
  BackupStageName,
  BackupStageStatus
} from "@/domain/security/backup-status";
import { loadBackupHealth } from "@/server/backup-health";

/**
 * Admin-only backup health line (Backup v2).
 *
 * One compact bilingual light fed by `backup-status.json` — no database query,
 * no new dependency, and no crash path: the loader swallows an absent or
 * corrupt file and this component renders the calm "no status yet" state.
 * Hidden below `md`: an admin diagnosing backups is at a desk, and the phone
 * layout is reserved for shop-floor work.
 */

const LEVEL_LABEL: Record<BackupHealthLevel, keyof typeof backupHealthLabels> = {
  green: "levelGreen",
  amber: "levelAmber",
  red: "levelRed",
  unknown: "levelUnknown"
};

const STAGE_LABEL: Record<BackupStageName, keyof typeof backupHealthLabels> = {
  localArchive: "localArchive",
  cloudUpload: "cloudUpload",
  nightlyVerify: "nightlyVerify",
  cloudDrill: "cloudDrill"
};

const STATUS_LABEL: Record<BackupStageStatus, keyof typeof backupHealthLabels> = {
  ok: "statusOk",
  failed: "statusFailed",
  offline: "statusOffline",
  skipped: "statusSkipped",
  unconfigured: "statusUnconfigured",
  never: "statusNever"
};

function formatSuccessAge(stage: BackupHealthStage, locale: Locale): string {
  if (stage.successAgeHours == null) {
    return pickLabel(backupHealthLabels.neverSucceeded, locale);
  }

  if (stage.successAgeHours < 1) {
    return pickLabel(backupHealthLabels.justNow, locale);
  }

  if (stage.successAgeHours < 48) {
    return `${Math.floor(stage.successAgeHours)}${pickLabel(backupHealthLabels.hoursAgo, locale)}`;
  }

  return `${Math.floor(stage.successAgeHours / 24)}${pickLabel(backupHealthLabels.daysAgo, locale)}`;
}

export async function BackupHealthPanel({ locale }: { locale: Locale }) {
  const health = await loadBackupHealth();
  const levelWord = pickLabel(backupHealthLabels[LEVEL_LABEL[health.level]], locale);
  const title = pickLabel(backupHealthLabels.title, locale);

  return (
    <section
      aria-label={title}
      className={`backupHealth backupHealth--${health.level} hidden md:block`}
      role="status"
    >
      <div className="backupHealthHead">
        <span aria-hidden="true" className="backupHealthDot" />
        <strong>{title}</strong>
        <span className="backupHealthVerdict">{levelWord}</span>
      </div>

      {health.missing ? (
        // A missing file is calm on a dev machine and loud where backups are
        // expected (BACKUP_EXPECTED=1) — the level already carries that verdict.
        <p className="backupHealthHint">
          {pickLabel(
            health.level === "red"
              ? backupHealthLabels.missingStatusHint
              : backupHealthLabels.noStatusHint,
            locale
          )}
        </p>
      ) : (
        <ul className="backupHealthLegs">
          {health.stages.map((stage) => (
            <li key={stage.name}>
              <span className="backupHealthLegName">
                {pickLabel(backupHealthLabels[STAGE_LABEL[stage.name]], locale)}
              </span>
              <span className="backupHealthLegValue">
                {pickLabel(backupHealthLabels[STATUS_LABEL[stage.status]], locale)}
                {" · "}
                {formatSuccessAge(stage, locale)}
              </span>
            </li>
          ))}
        </ul>
      )}

      {health.findings.length === 0 ? null : (
        <ul className="backupHealthFindings">
          {health.findings.map((finding) => (
            <li className={`backupHealthFinding--${finding.level}`} key={finding.code}>
              {pickLabel(backupHealthFindingLabels[finding.code], locale)}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
