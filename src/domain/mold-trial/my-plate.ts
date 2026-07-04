/**
 * Pure section-membership logic for the phone-first `/me` "My Plate" page.
 *
 * Every decision about *which items land on the logged-in user's plate* lives
 * here as a pure function over typed plain records (no Prisma imports), so the
 * rules are unit-testable in isolation. `src/server/my-plate.ts` runs the
 * database queries and maps rows into these inputs; the page renders whatever
 * comes back.
 *
 * "My department group is assembly" / "I'm a PM" map to the user's `RoleCode`
 * (the seed assigns roles, not department groups). Assembly == role `ASSEMBLY`,
 * PM == role `PM`.
 */

import type { RoleCode } from "@/domain/mold-trial/types";

/** Prisma `TrialIssueStatus` enum values (DB form) relevant to plate filtering. */
export type IssueStatusDbValue =
  | "OPEN"
  | "IN_PROGRESS"
  | "WAITING_INTERNAL"
  | "WAITING_CUSTOMER"
  | "WAITING_SUPPLIER"
  | "WAITING_VERIFICATION"
  | "VERIFIED"
  | "CLOSED";

/** Prisma `TrialStatus` enum values (DB form) relevant to plate filtering. */
export type TrialStatusDbValue =
  | "PLANNED"
  | "AT_RISK"
  | "AUTO_MISSED_REASON_REQUIRED"
  | "DELAYED"
  | "COMPLETED"
  | "PENDING_FOLLOW_UP"
  | "ABORTED"
  | "CANCELLED"
  | "SKIPPED";

/** The viewer, reduced to just what plate rules need. */
export type PlateViewer = {
  userId: string;
  roleCode: RoleCode;
};

/** A trial event scoped to its project's PM assignment. */
export type PlateTrialRecord = {
  status: TrialStatusDbValue;
  plannedDate: Date | null;
  projectPlanningPmId: string | null;
  projectTechnicalPmId: string | null;
};

/** A trial issue, reduced to the fields the plate sections filter on. */
export type PlateIssueRecord = {
  status: IssueStatusDbValue;
  ownerUserId: string | null;
  /** Prisma `TrialIssueType` enum value (DB form). */
  issueType: string;
  /** DepartmentGroup code of the issue owner group, if any. */
  ownerGroupCode: string | null;
  assemblyAcknowledgedAt: Date | null;
  assemblySelfCheckedAt: Date | null;
  pmReadyConfirmedAt: Date | null;
  projectPlanningPmId: string | null;
  projectTechnicalPmId: string | null;
};

const OPEN_ISSUE_EXCLUDED_STATUSES: ReadonlySet<IssueStatusDbValue> = new Set(["VERIFIED", "CLOSED"]);
const directDepartmentInboxGroupByRole: Partial<Record<RoleCode, string>> = {
  ASSEMBLY: "assembly",
  INJECTION: "injection",
  MARKETING: "marketing",
  QC: "qc"
};
const pmDepartmentInboxGroups: ReadonlySet<string> = new Set(["pm", "planning", "technical"]);

/** True when the viewer is the planning or technical PM on the item's project. */
export function isViewerProjectPm(
  viewer: PlateViewer,
  item: { projectPlanningPmId: string | null; projectTechnicalPmId: string | null }
): boolean {
  return item.projectPlanningPmId === viewer.userId || item.projectTechnicalPmId === viewer.userId;
}

/** True when the viewer's role is a PM role. */
export function isPmRole(viewer: PlateViewer): boolean {
  return viewer.roleCode === "PM";
}

/** True when the viewer's role is an Assembly role. */
export function isAssemblyRole(viewer: PlateViewer): boolean {
  return viewer.roleCode === "ASSEMBLY";
}

/**
 * Whether an assembly viewer can actually act on this issue — mirrors the
 * server-side `isAssemblyRelevantIssue` guard so the assembly sections only
 * surface issues the acknowledge/self-check action will accept (assigned to me,
 * owned by the assembly group, or an assembly/fitting issue type). DB enum form:
 * `ASSEMBLY_FITTING_ISSUE`, group code `assembly`.
 */
export function isAssemblyActionableIssue(viewer: PlateViewer, issue: PlateIssueRecord): boolean {
  return (
    issue.ownerUserId === viewer.userId ||
    issue.ownerGroupCode === "assembly" ||
    issue.issueType === "ASSEMBLY_FITTING_ISSUE"
  );
}

/**
 * "Needs a reason": auto-missed trials awaiting a reason on a project where the
 * viewer is planning or technical PM.
 */
export function belongsToNeedsReasonSection(viewer: PlateViewer, trial: PlateTrialRecord): boolean {
  return trial.status === "AUTO_MISSED_REASON_REQUIRED" && isViewerProjectPm(viewer, trial);
}

/**
 * "My open issues": issues I own that are not yet Verified or Closed.
 */
export function belongsToMyOpenIssuesSection(viewer: PlateViewer, issue: PlateIssueRecord): boolean {
  return issue.ownerUserId === viewer.userId && !OPEN_ISSUE_EXCLUDED_STATUSES.has(issue.status);
}

/**
 * "Department inbox": group-owned issues that have not been claimed by a
 * person yet. Department roles see only their own group. PM sees PM/planning/
 * technical group items only when they are the planning or technical PM on that
 * project.
 */
export function belongsToDepartmentInboxSection(viewer: PlateViewer, issue: PlateIssueRecord): boolean {
  if (issue.ownerUserId != null || OPEN_ISSUE_EXCLUDED_STATUSES.has(issue.status)) {
    return false;
  }

  if (viewer.roleCode === "PM") {
    return issue.ownerGroupCode != null && pmDepartmentInboxGroups.has(issue.ownerGroupCode) && isViewerProjectPm(viewer, issue);
  }

  return directDepartmentInboxGroupByRole[viewer.roleCode] === issue.ownerGroupCode;
}

/**
 * "Assembly: acknowledge": for Assembly users, still-open issues that have not
 * been acknowledged yet.
 */
export function belongsToAssemblyAcknowledgeSection(viewer: PlateViewer, issue: PlateIssueRecord): boolean {
  if (!isAssemblyRole(viewer) || !isAssemblyActionableIssue(viewer, issue)) {
    return false;
  }

  return !OPEN_ISSUE_EXCLUDED_STATUSES.has(issue.status) && issue.assemblyAcknowledgedAt == null;
}

/**
 * "Assembly: self-check": for Assembly users, issues that were acknowledged but
 * still need the pre-next-trial self-check.
 */
export function belongsToAssemblySelfCheckSection(viewer: PlateViewer, issue: PlateIssueRecord): boolean {
  if (!isAssemblyRole(viewer) || !isAssemblyActionableIssue(viewer, issue)) {
    return false;
  }

  return (
    !OPEN_ISSUE_EXCLUDED_STATUSES.has(issue.status) &&
    issue.assemblyAcknowledgedAt != null &&
    issue.assemblySelfCheckedAt == null
  );
}

/**
 * "PM: confirm ready": for PM users, issues that assembly has self-checked but
 * the PM has not yet confirmed ready for the next trial.
 */
export function belongsToPmConfirmReadySection(viewer: PlateViewer, issue: PlateIssueRecord): boolean {
  if (!isPmRole(viewer)) {
    return false;
  }

  return (
    !OPEN_ISSUE_EXCLUDED_STATUSES.has(issue.status) &&
    issue.assemblySelfCheckedAt != null &&
    issue.pmReadyConfirmedAt == null
  );
}

/**
 * "Coming up": planned/at-risk trials on a project where the viewer is PM, whose
 * planned date lands within the next `windowDays` days (inclusive of today).
 * Read-only section; auto-missed trials are excluded (they live in "Needs a
 * reason") and completed/cancelled ones never come up.
 */
export function belongsToComingUpSection(
  viewer: PlateViewer,
  trial: PlateTrialRecord,
  now: Date,
  windowDays = 7
): boolean {
  if (!isViewerProjectPm(viewer, trial)) {
    return false;
  }

  if (trial.status !== "PLANNED" && trial.status !== "AT_RISK") {
    return false;
  }

  if (trial.plannedDate == null) {
    return false;
  }

  const startOfToday = startOfUtcDay(now);
  const windowEnd = addUtcDays(startOfToday, windowDays);
  const planned = startOfUtcDay(trial.plannedDate);

  return planned.getTime() >= startOfToday.getTime() && planned.getTime() <= windowEnd.getTime();
}

/**
 * "Recent to future" ordering for any plate section. Items are sorted by their
 * relevant date ascending (oldest / most overdue first); items with no date sort
 * LAST. Dates are the `YYYY-MM-DD` strings the server maps onto each row, which
 * sort lexicographically the same as chronologically. Pure and stable: equal
 * dates keep their input order (callers use `Array.prototype.sort`, which is
 * stable), so this can drive `sort` directly.
 */
export function comparePlateItemsByDate(
  a: { date: string | null },
  b: { date: string | null }
): number {
  if (a.date === b.date) {
    return 0;
  }

  if (a.date == null) {
    return 1;
  }

  if (b.date == null) {
    return -1;
  }

  return a.date < b.date ? -1 : 1;
}

/** True when a planned date is strictly before the start of today (overdue). */
export function isOverdue(plannedDate: Date | null, now: Date): boolean {
  if (plannedDate == null) {
    return false;
  }

  return startOfUtcDay(plannedDate).getTime() < startOfUtcDay(now).getTime();
}

function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function addUtcDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}
