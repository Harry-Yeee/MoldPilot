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

import type { DateConfirmationStatus } from "@/domain/mold-trial/date-confirmation";
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
  /**
   * `department_groups.code` of the group this user belongs to. Usually the same
   * as the role's inbox group ("assembly"), but assembly members sit in the
   * working CHILD groups (`assembly-a` 钟组 / `assembly-b` 裴组). Optional: a
   * user with no department group (or a caller that does not load one) keeps
   * exactly the pre-2026-08-05 behaviour.
   */
  departmentGroupCode?: string | null;
  /**
   * Code of that group's parent, when it has one ("assembly" for `assembly-a`).
   * This is what makes the child-group widening safe: the inbox only widens when
   * the viewer's group genuinely descends from the role's inbox group.
   */
  departmentGroupParentCode?: string | null;
};

/** A trial event scoped to its project's PM assignment. */
export type PlateTrialRecord = {
  status: TrialStatusDbValue;
  plannedDate: Date | null;
  /** Actual completion date; drives the QC report-upload recency window. */
  actualDate?: Date | null;
  /** Date-confirmation handshake state; drives the three Feature 6 sections. */
  dateConfirmationStatus?: DateConfirmationStatus;
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

/**
 * A design-change event, reduced to what the "Design: revisions" section filters
 * on. `hasDrawing` is the server's data join (a live, non-deleted DRAWING
 * attachment on this DESIGN_CHANGE_EVENT); `projectStatus` is the owning
 * project's Prisma `ProjectStatus` enum value (DB form) so terminal projects drop
 * out.
 */
export type PlateDesignChangeRecord = {
  projectStatus: string;
  hasDrawing: boolean;
};

const OPEN_ISSUE_EXCLUDED_STATUSES: ReadonlySet<IssueStatusDbValue> = new Set(["VERIFIED", "CLOSED"]);

/** Project statuses that end a project — a design revision on one is no longer waiting. */
const TERMINAL_PROJECT_STATUSES: ReadonlySet<string> = new Set(["CANCELLED", "CLOSED"]);

/**
 * Roles whose "Department inbox" is exactly one department group. PM is handled
 * separately (it spans pm/planning/technical and is gated on project PM
 * assignment). Exported so the server query layer reuses the same map instead of
 * re-declaring it.
 */
export const directDepartmentInboxGroupByRole: Partial<Record<RoleCode, string>> = {
  ASSEMBLY: "assembly",
  INJECTION: "injection",
  MARKETING: "marketing",
  QC: "qc",
  DESIGN: "design"
};
const pmDepartmentInboxGroups: ReadonlySet<string> = new Set(["pm", "planning", "technical"]);

/**
 * The assembly PARENT group code. Kept as a local literal rather than imported
 * from `issue-routing.ts` so this module keeps its "no value imports from other
 * domain modules" shape; the two are asserted equal in tests.
 */
const ASSEMBLY_GROUP_CODE = "assembly";

/**
 * Every DepartmentGroup code whose queue this viewer watches: the one group
 * their role owns, PLUS their own group when that group is a CHILD of it.
 *
 * This is the fix that makes per-mold assembly assignment safe. Issue routing
 * can now put an assembly issue on `assembly-a` (钟组) instead of the `assembly`
 * parent; matching on the parent code alone would have made those issues vanish
 * from every inbox. Widening is strictly additive — the parent code is always in
 * the set, so no parent-owned issue that was visible yesterday stops being
 * visible — and it is scoped by lineage, so 钟组 sees `assembly` + `assembly-a`
 * and never `assembly-b`.
 *
 * Returns an empty set for roles with no single department inbox (PM, GM,
 * ADMIN, VIEWER); PM is handled separately by
 * {@link belongsToDepartmentInboxSection}.
 */
export function departmentInboxGroupCodesForViewer(viewer: PlateViewer): ReadonlySet<string> {
  const roleGroupCode = directDepartmentInboxGroupByRole[viewer.roleCode];

  if (roleGroupCode == null) {
    return new Set<string>();
  }

  const codes = new Set<string>([roleGroupCode]);

  if (viewer.departmentGroupCode != null && viewer.departmentGroupParentCode === roleGroupCode) {
    codes.add(viewer.departmentGroupCode);
  }

  return codes;
}

/**
 * The assembly group codes an assembly viewer acts on: the `assembly` parent
 * plus their own working group. Same lineage rule as
 * {@link departmentInboxGroupCodesForViewer}, named separately because the
 * assembly acknowledge / self-check sections are not the department inbox.
 */
export function assemblyGroupCodesForViewer(viewer: PlateViewer): ReadonlySet<string> {
  const codes = new Set<string>([ASSEMBLY_GROUP_CODE]);

  if (viewer.departmentGroupCode != null && viewer.departmentGroupParentCode === ASSEMBLY_GROUP_CODE) {
    codes.add(viewer.departmentGroupCode);
  }

  return codes;
}

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
 * owned by an assembly group I watch, or an assembly/fitting issue type). DB
 * enum form: `ASSEMBLY_FITTING_ISSUE`, group code `assembly` (or my own working
 * group under it).
 *
 * Visibility is deliberately NARROWER than the action guard: the guard lets any
 * assembly-role user act on anything in the assembly lineage, while this only
 * puts 钟组's own molds on 钟组's plate. Visible therefore always implies
 * actionable, which is the invariant the mirror needs.
 */
export function isAssemblyActionableIssue(viewer: PlateViewer, issue: PlateIssueRecord): boolean {
  return (
    issue.ownerUserId === viewer.userId ||
    (issue.ownerGroupCode != null && assemblyGroupCodesForViewer(viewer).has(issue.ownerGroupCode)) ||
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
 * Injection — "Confirm trial dates": planned/at-risk trials still awaiting the
 * date-confirmation handshake. Injection owns confirmation, so the section is
 * not project-scoped (Injection serves every project's machines). Recording a
 * result works regardless; this only surfaces the confirm/propose action.
 */
export function belongsToConfirmTrialDatesSection(viewer: PlateViewer, trial: PlateTrialRecord): boolean {
  if (viewer.roleCode !== "INJECTION") {
    return false;
  }

  if (trial.status !== "PLANNED" && trial.status !== "AT_RISK") {
    return false;
  }

  return trial.dateConfirmationStatus === "PENDING_CONFIRMATION";
}

/**
 * Marketing — "Approve date changes": trials whose Injection counter-proposal is
 * awaiting a Marketing decision. Marketing owns the customer target date, so
 * this is not project-scoped. Only planned/at-risk trials participate.
 */
export function belongsToApproveDateChangesSection(viewer: PlateViewer, trial: PlateTrialRecord): boolean {
  if (viewer.roleCode !== "MARKETING") {
    return false;
  }

  if (trial.status !== "PLANNED" && trial.status !== "AT_RISK") {
    return false;
  }

  return trial.dateConfirmationStatus === "RESCHEDULE_PROPOSED";
}

/**
 * PM — "Returned dates": trials Marketing returned to the PM, on a project where
 * the viewer is planning or technical PM. The PM coordinates and sets a new
 * date, which restarts the handshake.
 */
export function belongsToReturnedDatesSection(viewer: PlateViewer, trial: PlateTrialRecord): boolean {
  if (viewer.roleCode !== "PM" || !isViewerProjectPm(viewer, trial)) {
    return false;
  }

  if (trial.status !== "PLANNED" && trial.status !== "AT_RISK") {
    return false;
  }

  return trial.dateConfirmationStatus === "RETURNED_TO_PM";
}

/**
 * "My open issues": issues I own that are not yet Verified or Closed.
 */
export function belongsToMyOpenIssuesSection(viewer: PlateViewer, issue: PlateIssueRecord): boolean {
  return issue.ownerUserId === viewer.userId && !OPEN_ISSUE_EXCLUDED_STATUSES.has(issue.status);
}

/**
 * "Department inbox": group-owned issues that have not been claimed by a
 * person yet. Department roles see their own group — and, for a member of a
 * working child group, that group too (see
 * {@link departmentInboxGroupCodesForViewer}). PM sees PM/planning/technical
 * group items only when they are the planning or technical PM on that project.
 */
export function belongsToDepartmentInboxSection(viewer: PlateViewer, issue: PlateIssueRecord): boolean {
  if (issue.ownerUserId != null || OPEN_ISSUE_EXCLUDED_STATUSES.has(issue.status)) {
    return false;
  }

  if (viewer.roleCode === "PM") {
    return issue.ownerGroupCode != null && pmDepartmentInboxGroups.has(issue.ownerGroupCode) && isViewerProjectPm(viewer, issue);
  }

  return issue.ownerGroupCode != null && departmentInboxGroupCodesForViewer(viewer).has(issue.ownerGroupCode);
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
 * Trial statuses for which QC uploads a measurement report. Kept as a local
 * constant (rather than importing from `measurement-report.ts`) so `my-plate.ts`
 * stays free of value-level dependencies — `measurement-report.ts` already
 * imports the `TrialStatusDbValue` *type* from here, and a reverse value import
 * would create a runtime cycle. The two lists are asserted equal in tests.
 */
const qcReportEligibleStatuses: ReadonlySet<TrialStatusDbValue> = new Set(["COMPLETED", "PENDING_FOLLOW_UP"]);

/**
 * "QC: reports to upload": for QC users, recently completed (or pending-follow-up)
 * trials whose actual date lands within the last `windowDays` days (inclusive of
 * today). Whether the report is actually *missing* is a data join the server
 * applies (only trials without a live QC_REPORT are passed in); this pure rule
 * owns the role + status + recency gate. Trials with no actual date are excluded.
 */
export function belongsToQcReportsToUploadSection(
  viewer: PlateViewer,
  trial: PlateTrialRecord,
  now: Date,
  windowDays = 14
): boolean {
  if (viewer.roleCode !== "QC") {
    return false;
  }

  if (!qcReportEligibleStatuses.has(trial.status)) {
    return false;
  }

  if (trial.actualDate == null) {
    return false;
  }

  const startOfToday = startOfUtcDay(now);
  const windowStart = addUtcDays(startOfToday, -windowDays);
  const actual = startOfUtcDay(trial.actualDate);

  return actual.getTime() >= windowStart.getTime() && actual.getTime() <= startOfToday.getTime();
}

/**
 * "Design: revisions": for DESIGN users, design-change events on a live (non-
 * terminal) project that do not yet have a DRAWING attached. Whether a drawing
 * actually exists is a data join the server applies (`hasDrawing`); this pure
 * rule owns the role + project-liveness gate. Once the first drawing lands the
 * card clears.
 */
export function belongsToDesignRevisionsSection(viewer: PlateViewer, record: PlateDesignChangeRecord): boolean {
  if (viewer.roleCode !== "DESIGN") {
    return false;
  }

  if (TERMINAL_PROJECT_STATUSES.has(record.projectStatus)) {
    return false;
  }

  return !record.hasDrawing;
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
