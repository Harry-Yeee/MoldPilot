/**
 * Pure decision helpers for double-submit / duplicate-window guards (double-tap
 * hardening — real humans double-tap buttons on laggy factory Wi-Fi).
 *
 * No Prisma imports: the action layer runs ONE indexed query for a recent
 * matching row inside its existing transaction and delegates the "is this a
 * duplicate?" decision to these pure functions, so the rules stay unit-testable
 * in isolation (mirroring how `date-confirmation.ts` backs its action layer).
 *
 * A "duplicate submission" is the SAME logical create arriving twice inside a
 * short window (a double-tapped button). Each helper compares the natural key of
 * an already-persisted row against the incoming candidate and asks whether that
 * row was created recently enough to be the first tap of the same submission.
 * These guards intentionally never touch the precondition/state-machine guards
 * (close, resolve-auto-missed, claim) — those are enforced with an updateMany +
 * count precondition in the action layer, not a time window.
 */

import type { DateLike } from "@/domain/mold-trial/types";

/** Default double-submit window: a second identical submit inside 20s is a dupe. */
export const DUPLICATE_SUBMISSION_WINDOW_MS = 20_000;

function toMillis(value: DateLike | number | null | undefined): number | null {
  if (value == null) {
    return null;
  }

  const date = value instanceof Date ? value : new Date(value);
  const millis = date.getTime();
  return Number.isNaN(millis) ? null : millis;
}

/** `YYYY-MM-DD` (UTC day) for a DateLike, or null — the canonical same-day key. */
function dayKey(value: DateLike | null | undefined): string | null {
  const millis = toMillis(value);
  if (millis == null) {
    return null;
  }

  return new Date(millis).toISOString().slice(0, 10);
}

/** Collapse a free-text natural key (an issue title) to a stable compare form. */
function normalizeText(value: string | null | undefined): string {
  return (value ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}

/**
 * True when `previousAt` falls inside `[now - windowMs, now]` — the existing row
 * was created within the last `windowMs` and so is recent enough to be the first
 * tap of a double-submit. Null / unparseable / future-dated timestamps → false.
 */
export function isWithinDuplicateWindow(
  previousAt: DateLike | number | null | undefined,
  now: DateLike | number,
  windowMs: number = DUPLICATE_SUBMISSION_WINDOW_MS
): boolean {
  const previousMillis = toMillis(previousAt);
  const nowMillis = toMillis(now);

  if (previousMillis == null || nowMillis == null) {
    return false;
  }

  const elapsed = nowMillis - previousMillis;
  return elapsed >= 0 && elapsed <= windowMs;
}

/* ------------------------------- Trial issue --------------------------------- */

/** Natural key that makes two `createTrialIssue` submissions "the same". */
export type IssueSubmissionKey = {
  moldTrialProjectId: string;
  createdById: string;
  title: string;
};

export type ExistingIssueSubmission = IssueSubmissionKey & { createdAt: DateLike };

/**
 * Same project + same creator + same title, created within the window. A blank
 * candidate title never matches (a titleless issue can't be created anyway).
 */
export function isDuplicateIssueSubmission(
  existing: ExistingIssueSubmission | null | undefined,
  candidate: IssueSubmissionKey,
  now: DateLike | number,
  windowMs: number = DUPLICATE_SUBMISSION_WINDOW_MS
): boolean {
  if (existing == null) {
    return false;
  }

  const candidateTitle = normalizeText(candidate.title);
  return (
    candidateTitle.length > 0 &&
    existing.moldTrialProjectId === candidate.moldTrialProjectId &&
    existing.createdById === candidate.createdById &&
    normalizeText(existing.title) === candidateTitle &&
    isWithinDuplicateWindow(existing.createdAt, now, windowMs)
  );
}

/* ---------------------------- New planned trial ------------------------------ */

/** Natural key that makes two `addNewPlannedTrial` submissions "the same". */
export type TrialSubmissionKey = {
  moldTrialProjectId: string;
  plannedDate: DateLike | null;
  trialCode: string;
};

export type ExistingTrialSubmission = TrialSubmissionKey & { createdAt: DateLike };

/** Same project + same planned day + same trial code, created within the window. */
export function isDuplicateTrialSubmission(
  existing: ExistingTrialSubmission | null | undefined,
  candidate: TrialSubmissionKey,
  now: DateLike | number,
  windowMs: number = DUPLICATE_SUBMISSION_WINDOW_MS
): boolean {
  if (existing == null) {
    return false;
  }

  const candidateDay = dayKey(candidate.plannedDate);
  return (
    candidateDay != null &&
    existing.moldTrialProjectId === candidate.moldTrialProjectId &&
    existing.trialCode === candidate.trialCode &&
    dayKey(existing.plannedDate) === candidateDay &&
    isWithinDuplicateWindow(existing.createdAt, now, windowMs)
  );
}

/* ----------------------------- Missed trial ---------------------------------- */

/** Natural key that makes two `recordMissedTrial` submissions "the same". */
export type MissedTrialSubmissionKey = {
  trialEventId: string;
  newPlannedDate: DateLike | null;
};

/**
 * An already-persisted MissedTrialEvent. `trialEventId` is nullable in the schema
 * (a project-level miss with no specific trial), so the existing-row shape widens
 * it; a null never matches a real candidate trial id.
 */
export type ExistingMissedTrialSubmission = {
  trialEventId: string | null;
  newPlannedDate: DateLike | null;
  createdAt: DateLike;
};

/** Same trial + same new planned day, created within the window. */
export function isDuplicateMissedTrialSubmission(
  existing: ExistingMissedTrialSubmission | null | undefined,
  candidate: MissedTrialSubmissionKey,
  now: DateLike | number,
  windowMs: number = DUPLICATE_SUBMISSION_WINDOW_MS
): boolean {
  if (existing == null) {
    return false;
  }

  const candidateDay = dayKey(candidate.newPlannedDate);
  return (
    candidateDay != null &&
    existing.trialEventId === candidate.trialEventId &&
    dayKey(existing.newPlannedDate) === candidateDay &&
    isWithinDuplicateWindow(existing.createdAt, now, windowMs)
  );
}

/* --------------------------- File attachment --------------------------------- */

/**
 * Natural key that makes two attachment writes "the same" — used by
 * `uploadAttachment` and the shared `storeIssuePhotos` helper. Size + name pin
 * the exact bytes; the same uploader hitting the same target is the double-tap.
 */
export type AttachmentSubmissionKey = {
  entityId: string;
  uploadedById: string;
  fileName: string;
  sizeBytes: number;
};

export type ExistingAttachmentSubmission = AttachmentSubmissionKey & { uploadedAt: DateLike };

/** Same target + uploader + fileName + byte size, uploaded within the window. */
export function isDuplicateAttachmentSubmission(
  existing: ExistingAttachmentSubmission | null | undefined,
  candidate: AttachmentSubmissionKey,
  now: DateLike | number,
  windowMs: number = DUPLICATE_SUBMISSION_WINDOW_MS
): boolean {
  if (existing == null) {
    return false;
  }

  return (
    existing.entityId === candidate.entityId &&
    existing.uploadedById === candidate.uploadedById &&
    existing.fileName === candidate.fileName &&
    existing.sizeBytes === candidate.sizeBytes &&
    isWithinDuplicateWindow(existing.uploadedAt, now, windowMs)
  );
}

/* --------------------------- Measurement report ------------------------------ */

/**
 * Natural key for a QC measurement-report re-tap. The stored fileName is
 * deterministic (`<projectCode>_<trialCode>_measurement-report.<ext>`), so a
 * genuine re-tap of the identical file matches on target + uploader + byte size,
 * while a real replacement (different file → different size) is NOT a duplicate
 * and flows through the normal replace path.
 */
export type MeasurementReportSubmissionKey = {
  entityId: string;
  uploadedById: string;
  sizeBytes: number;
};

export type ExistingMeasurementReportSubmission = MeasurementReportSubmissionKey & { uploadedAt: DateLike };

/** Same trial + uploader + byte size, uploaded within the window. */
export function isDuplicateMeasurementReportSubmission(
  existing: ExistingMeasurementReportSubmission | null | undefined,
  candidate: MeasurementReportSubmissionKey,
  now: DateLike | number,
  windowMs: number = DUPLICATE_SUBMISSION_WINDOW_MS
): boolean {
  if (existing == null) {
    return false;
  }

  return (
    existing.entityId === candidate.entityId &&
    existing.uploadedById === candidate.uploadedById &&
    existing.sizeBytes === candidate.sizeBytes &&
    isWithinDuplicateWindow(existing.uploadedAt, now, windowMs)
  );
}
