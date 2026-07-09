/**
 * Pure, unit-testable rules for the QC measurement-report workflow (Feature 4).
 *
 * A "measurement report" is the finished PDF/Excel QC produces *outside* the
 * system after a trial completes; this module answers, for one trial and the set
 * of attachments filed against it, whether that trial requires a report, whether
 * it is still missing, or which uploaded file is the current report. No Prisma,
 * no filesystem, no React — the server action, project page, dashboard, and phone
 * section all share these decisions, and the tests exercise them in isolation.
 *
 * DB enum shapes (`TrialStatus`, `FileType`, `AttachmentEntityType`) are mirrored
 * as string-literal unions so this module never imports the generated client.
 */

import type { TrialStatusDbValue } from "@/domain/mold-trial/my-plate";

/**
 * Trial statuses for which a measurement report is expected and may be uploaded.
 * A report is produced from a completed trial's parts; planned/at-risk/missed/
 * aborted/cancelled/skipped trials never have one. PENDING_FOLLOW_UP counts as
 * completed-with-open-items, so it still expects (and accepts) a report.
 */
export const measurementReportEligibleStatuses: ReadonlySet<TrialStatusDbValue> = new Set([
  "COMPLETED",
  "PENDING_FOLLOW_UP"
]);

/** The trial, reduced to the one field the report rules need. */
export type MeasurementReportTrial = {
  status: TrialStatusDbValue;
};

/**
 * One candidate attachment for a trial's report, in DB form. Only non-deleted
 * QC_REPORT files whose entityType is TRIAL_EVENT and whose entityId is the
 * trial count; callers may pass a wider set and let {@link measurementReportState}
 * filter, or pre-narrow the query (the server layer does the latter).
 */
export type MeasurementReportAttachment = {
  id: string;
  entityType: string;
  entityId: string;
  fileType: string;
  deletedAt: Date | null;
  uploadedAt: Date;
  uploaderName: string;
  visibility: string;
};

export type MeasurementReportState =
  | { kind: "NOT_REQUIRED" }
  | { kind: "MISSING" }
  | {
      kind: "UPLOADED";
      attachmentId: string;
      uploadedAt: Date;
      uploadedBy: string;
      visibility: string;
    };

/** True when a report may be uploaded/expected for a trial in this status. */
export function canUploadMeasurementReport(status: TrialStatusDbValue): boolean {
  return measurementReportEligibleStatuses.has(status);
}

/**
 * Whether an attachment is a live measurement report for the given trial:
 * a non-deleted QC_REPORT filed against that TRIAL_EVENT.
 */
export function isMeasurementReportAttachment(
  attachment: MeasurementReportAttachment,
  trialEventId: string
): boolean {
  return (
    attachment.deletedAt == null &&
    attachment.fileType === "QC_REPORT" &&
    attachment.entityType === "TRIAL_EVENT" &&
    attachment.entityId === trialEventId
  );
}

/**
 * Resolve the current measurement-report state for one trial.
 *
 * - Trials not in an eligible status → NOT_REQUIRED (the panel shows nothing).
 * - No matching non-deleted QC_REPORT → MISSING (the loud amber state).
 * - One or more → UPLOADED with the *newest* by `uploadedAt` (newest wins; ties
 *   break on the later id so the result is deterministic).
 */
export function measurementReportState(
  trial: MeasurementReportTrial,
  trialEventId: string,
  attachments: readonly MeasurementReportAttachment[]
): MeasurementReportState {
  if (!canUploadMeasurementReport(trial.status)) {
    return { kind: "NOT_REQUIRED" };
  }

  const current = newestMeasurementReport(attachments, trialEventId);
  if (current == null) {
    return { kind: "MISSING" };
  }

  return {
    kind: "UPLOADED",
    attachmentId: current.id,
    uploadedAt: current.uploadedAt,
    uploadedBy: current.uploaderName,
    visibility: current.visibility
  };
}

/**
 * The newest live measurement report for a trial, or null when none exists.
 * Exposed so the server action can find the file to soft-delete on replace
 * without re-deriving the selection rule.
 */
export function newestMeasurementReport(
  attachments: readonly MeasurementReportAttachment[],
  trialEventId: string
): MeasurementReportAttachment | null {
  let newest: MeasurementReportAttachment | null = null;

  for (const attachment of attachments) {
    if (!isMeasurementReportAttachment(attachment, trialEventId)) {
      continue;
    }

    if (newest == null || isNewer(attachment, newest)) {
      newest = attachment;
    }
  }

  return newest;
}

/** Strict "b is newer than the current newest a" — later uploadedAt, id as tiebreak. */
function isNewer(candidate: MeasurementReportAttachment, current: MeasurementReportAttachment): boolean {
  const candidateTime = candidate.uploadedAt.getTime();
  const currentTime = current.uploadedAt.getTime();

  if (candidateTime !== currentTime) {
    return candidateTime > currentTime;
  }

  return candidate.id > current.id;
}

/**
 * Build the stored, download-friendly filename for a measurement report:
 * `<projectCode>_<trialCode>_measurement-report.<ext>`. The Content-Disposition
 * on the download route reuses `fileName`, so this is the name Marketing's
 * browser saves. `projectCode`/`trialCode` are sanitized to a filename-safe
 * token set; the extension is the validated (dotless) extension.
 */
export function measurementReportFileName(input: {
  projectCode: string;
  trialCode: string;
  extension: string;
}): string {
  const project = filenameToken(input.projectCode) || "project";
  const trial = filenameToken(input.trialCode) || "trial";
  const extension = input.extension.replace(/[^a-z0-9]/gi, "").toLowerCase();
  const base = `${project}_${trial}_measurement-report`;
  return extension.length > 0 ? `${base}.${extension}` : base;
}

/** Collapse a code to `[A-Za-z0-9-]`, hyphenating other separators. */
function filenameToken(raw: string): string {
  return raw
    .trim()
    .replace(/[^A-Za-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
