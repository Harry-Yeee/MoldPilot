import type {
  MissedTrialEvent,
  MoldTrialProjectCreateInput,
  MoldTrialProjectScheduleInput,
  ProjectStatus,
  RoleCode,
  TrialEvent,
  TrialIssue,
  TrialIssueCreateInput,
  TrialIssueLifecycleField,
  TrialIssueLifecycleUpdateInput,
  ValidationIssue,
  ValidationResult
} from "./types.ts";
import { validateIssueAffectedPart } from "./parts.ts";

const marketingAllowedIssueSources = new Set(["Marketing Client Feedback", "Customer Design Change"]);
const marketingAllowedIssueTypes = new Set([
  "Bad Customer Feedback",
  "Customer Sample Rejection",
  "Customer Requirement Change",
  "Design Change"
]);

const planningLifecycleRoles = new Set<RoleCode>(["PM", "ADMIN"]);
const qcLifecycleRoles = new Set<RoleCode>(["QC"]);
const injectionLifecycleRoles = new Set<RoleCode>(["INJECTION"]);
const assemblyLifecycleRoles = new Set<RoleCode>(["ASSEMBLY"]);
const issueOversightClosureRoles = new Set<RoleCode>(["PM", "GM", "ADMIN"]);
const rootCauseFields = new Set<TrialIssueLifecycleField>(["rootCause", "correctiveAction"]);
const verificationFields = new Set<TrialIssueLifecycleField>(["verificationMethod", "verificationResult"]);
const assemblyCorrectionFields = new Set<TrialIssueLifecycleField>([
  "assemblyAcknowledgedAt",
  "assemblyEstimatedFinishDate",
  "assemblyAcknowledgedById",
  "assemblySelfCheckedAt",
  "assemblySelfCheckedById",
  "assemblySelfCheckNote"
]);
const pmReadinessFields = new Set<TrialIssueLifecycleField>(["pmReadyConfirmedAt", "pmReadyConfirmedById"]);
const ownershipFields = new Set<TrialIssueLifecycleField>(["ownerUserId", "ownerGroupId"]);
const closureFields = new Set<TrialIssueLifecycleField>([
  "closedAt",
  "closedById",
  "fixSummary",
  "fixTimeMinutes",
  "nonOwnerCloseReason"
]);
const nonApprovedTrialResults = new Set([
  "Conditional",
  "Not Approved / Rework Required",
  "Pending QC",
  "Pending Customer Feedback",
  "Invalid Trial"
]);

function isBlank(value: string | null | undefined): boolean {
  return value == null || value.trim().length === 0;
}

function isMissing(value: unknown): boolean {
  return value == null || (typeof value === "string" && value.trim().length === 0);
}

function validationResult(issues: ValidationIssue[]): ValidationResult {
  return {
    ok: issues.length === 0,
    issues
  };
}

export function validateTrialIssueClosure(issue: TrialIssue): ValidationResult {
  const issues: ValidationIssue[] = [];

  if (issue.status !== "Closed") {
    return validationResult(issues);
  }

  if (issue.actorRole == null || issue.actorRole === "VIEWER") {
    issues.push({
      field: "actorRole",
      message: "Viewer cannot close trial issues."
    });
  }

  if (isBlank(issue.fixSummary)) {
    issues.push({
      field: "fixSummary",
      message: "Trial issue closure requires fix summary."
    });
  }

  if (issue.fixTimeMinutes == null || issue.fixTimeMinutes <= 0) {
    issues.push({
      field: "fixTimeMinutes",
      message: "Trial issue closure requires approximate fix time."
    });
  }

  if (isMissing(issue.closedAt)) {
    issues.push({
      field: "closedAt",
      message: "Trial issue closure requires closed date."
    });
  }

  if (isBlank(issue.closedById)) {
    issues.push({
      field: "closedById",
      message: "Trial issue closure requires closed by user."
    });
  }

  const closerIsOwner = !isBlank(issue.ownerUserId) && issue.closedById === issue.ownerUserId;
  const closerHasOversight = issue.actorRole != null && issueOversightClosureRoles.has(issue.actorRole);

  if (!closerIsOwner && !closerHasOversight) {
    issues.push({
      field: "actorRole",
      message: "Only the issue owner, PM, GM, or Admin can close trial issues."
    });
  }

  if (!closerIsOwner && isBlank(issue.nonOwnerCloseReason)) {
    issues.push({
      field: "nonOwnerCloseReason",
      message: "Closing another user's issue requires a non-owner close reason."
    });
  }

  return validationResult(issues);
}

export function validateMoldTrialProjectCreate(input: MoldTrialProjectCreateInput): ValidationResult {
  const issues: ValidationIssue[] = [];

  if (isBlank(input.customerCode)) {
    issues.push({
      field: "customerCode",
      message: "Customer code is required."
    });
  }

  if (isBlank(input.partCode)) {
    issues.push({
      field: "partCode",
      message: "Part code is required."
    });
  }

  if (isBlank(input.moldCode)) {
    issues.push({
      field: "moldCode",
      message: "Mold code is required."
    });
  }

  if (isBlank(input.planningPmId)) {
    issues.push({
      field: "planningPmId",
      message: "Planning PM is required."
    });
  }

  if (isMissing(input.firstPlannedTrialDate)) {
    issues.push({
      field: "firstPlannedTrialDate",
      message: "First planned trial date is required."
    });
  }

  if (input.actorRole != null && !planningLifecycleRoles.has(input.actorRole)) {
    issues.push({
      field: "actorRole",
      message: "Only Planning PM or Admin can create a project with the first T0 date already scheduled."
    });
  }

  return validationResult(issues);
}

export function validateMoldTrialProjectIntakeCreate(input: MoldTrialProjectCreateInput): ValidationResult {
  const issues: ValidationIssue[] = [];

  if (isBlank(input.customerCode)) {
    issues.push({
      field: "customerCode",
      message: "Customer code is required."
    });
  }

  if (isBlank(input.partCode)) {
    issues.push({
      field: "partCode",
      message: "Part code is required."
    });
  }

  if (input.actorRole === "MARKETING" && !isMissing(input.firstPlannedTrialDate)) {
    issues.push({
      field: "firstPlannedTrialDate",
      message: "Marketing can create intake records but cannot set the first T0 date."
    });
  }

  return validationResult(issues);
}

export function validateFirstPlannedTrialSchedule(input: MoldTrialProjectScheduleInput): ValidationResult {
  const issues: ValidationIssue[] = [];

  if (!planningLifecycleRoles.has(input.actorRole ?? "VIEWER")) {
    issues.push({
      field: "actorRole",
      message: "Only Planning PM or Admin can set the first T0 planned date."
    });
  }

  if (isMissing(input.plannedDate)) {
    issues.push({
      field: "plannedDate",
      message: "First T0 planned date is required."
    });
  }

  if (isBlank(input.moldCode)) {
    issues.push({
      field: "moldCode",
      message: "Mold code is required before setting first T0."
    });
  }

  if (input.projectStatus !== "Intake") {
    issues.push({
      field: "projectStatus",
      message: "First T0 date can be set only while the project is waiting for PM schedule."
    });
  }

  return validationResult(issues);
}

export function validateTrialIssueCreate(input: TrialIssueCreateInput): ValidationResult {
  const issues: ValidationIssue[] = [];
  const affectedPart = validateIssueAffectedPart(input);

  issues.push(...affectedPart.issues);

  if (isBlank(input.title)) {
    issues.push({
      field: "title",
      message: "Trial issue title is required."
    });
  }

  if (isMissing(input.issueType)) {
    issues.push({
      field: "issueType",
      message: "Trial issue type is required."
    });
  }

  if (isMissing(input.source)) {
    issues.push({
      field: "source",
      message: "Trial issue source is required."
    });
  }

  if (isMissing(input.severity)) {
    issues.push({
      field: "severity",
      message: "Trial issue severity is required."
    });
  }

  if (isMissing(input.status)) {
    issues.push({
      field: "status",
      message: "Trial issue status is required."
    });
  }

  if (isBlank(input.ownerUserId)) {
    issues.push({
      field: "owner",
      message: "Trial issue owner is required."
    });
  }

  if (isMissing(input.dueDate)) {
    issues.push({
      field: "dueDate",
      message: "Trial issue due date is required."
    });
  }

  if (input.actorRole === "MARKETING") {
    if (input.source != null && !marketingAllowedIssueSources.has(input.source)) {
      issues.push({
        field: "source",
        message: "Marketing can create only client-feedback or customer-driven trial issues."
      });
    }

    if (input.issueType != null && !marketingAllowedIssueTypes.has(input.issueType)) {
      issues.push({
        field: "issueType",
        message: "Marketing can create only customer-feedback or customer-driven issue types."
      });
    }
  }

  if (input.status === "Closed") {
    const closure = validateTrialIssueClosure({
      status: "Closed",
      fixSummary: input.fixSummary,
      fixTimeMinutes: input.fixTimeMinutes,
      closedAt: input.closedAt,
      closedById: input.closedById,
      ownerUserId: input.ownerUserId,
      nonOwnerCloseReason: input.nonOwnerCloseReason,
      actorRole: input.actorRole
    });

    issues.push(...closure.issues);
  }

  return validationResult(issues);
}

function hasAny(changedFields: readonly TrialIssueLifecycleField[], fields: ReadonlySet<TrialIssueLifecycleField>) {
  return changedFields.some((field) => fields.has(field));
}

export function validateTrialIssueLifecycleUpdate(input: TrialIssueLifecycleUpdateInput): ValidationResult {
  const issues: ValidationIssue[] = [];
  const changedFields = input.changedFields ?? [];
  const actorRole = input.actorRole;

  if (actorRole == null || actorRole === "VIEWER") {
    issues.push({
      field: "actorRole",
      message: "Viewer cannot edit trial issue lifecycle fields."
    });
    return validationResult(issues);
  }

  if (actorRole === "MARKETING" && changedFields.length > 0) {
    issues.push({
      field: "actorRole",
      message: "Marketing cannot edit root cause, corrective action, verification, ownership, status, or closure."
    });
  }

  if (input.status === "Closed") {
    const closure = validateTrialIssueClosure(input);
    issues.push(...closure.issues);

    const closerIsOwner = !isBlank(input.ownerUserId) && input.closedById === input.ownerUserId;
    const closerHasOversight = issueOversightClosureRoles.has(actorRole);

    if (!closerIsOwner && !closerHasOversight) {
      issues.push({
        field: "status",
        message: "Only the issue owner, PM, GM, or Admin can close trial issues."
      });
    }
  }

  if (input.status !== "Closed" && !isMissing(input.closedAt)) {
    issues.push({
      field: "closedAt",
      message: "Closed date can be set only when issue status is Closed."
    });
  }

  if (planningLifecycleRoles.has(actorRole)) {
    return validationResult(issues);
  }

  if (qcLifecycleRoles.has(actorRole)) {
    const disallowed = changedFields.filter(
      (field) =>
        rootCauseFields.has(field) ||
        ownershipFields.has(field) ||
        closureFields.has(field) ||
        assemblyCorrectionFields.has(field) ||
        pmReadinessFields.has(field) ||
        field === "verificationMethod"
    );

    if (disallowed.length > 0) {
      issues.push({
        field: disallowed[0] ?? "actorRole",
        message: "QC can update verification result, status, and due date only."
      });
    }

    return validationResult(issues);
  }

  if (injectionLifecycleRoles.has(actorRole)) {
    const disallowed = changedFields.filter(
      (field) =>
        verificationFields.has(field) ||
        ownershipFields.has(field) ||
        closureFields.has(field) ||
        assemblyCorrectionFields.has(field) ||
        pmReadinessFields.has(field)
    );

    if (input.issueType !== "Injection Process Issue" && hasAny(changedFields, rootCauseFields)) {
      issues.push({
        field: "issueType",
        message: "Injection can edit root cause or corrective action only for injection process issues."
      });
    }

    if (disallowed.length > 0) {
      issues.push({
        field: disallowed[0] ?? "actorRole",
        message: "Injection can update process-related root cause, corrective action, status, and due date only."
      });
    }

    return validationResult(issues);
  }

  if (assemblyLifecycleRoles.has(actorRole)) {
    const disallowed = changedFields.filter((field) => !assemblyCorrectionFields.has(field));

    if (disallowed.length > 0) {
      issues.push({
        field: disallowed[0] ?? "actorRole",
        message: "Assembly can update only correction acknowledgement and estimated finish date."
      });
    }

    if (changedFields.includes("assemblyAcknowledgedAt") && isMissing(input.assemblyAcknowledgedAt)) {
      issues.push({
        field: "assemblyAcknowledgedAt",
        message: "Assembly acknowledgement requires an acknowledgement date."
      });
    }

    if (changedFields.includes("assemblyEstimatedFinishDate") && isMissing(input.assemblyEstimatedFinishDate)) {
      issues.push({
        field: "assemblyEstimatedFinishDate",
        message: "Assembly acknowledgement requires an estimated correction finish date."
      });
    }

    if (changedFields.includes("assemblySelfCheckedAt") && isMissing(input.assemblySelfCheckedAt)) {
      issues.push({
        field: "assemblySelfCheckedAt",
        message: "Assembly self-check requires a self-check date."
      });
    }

    return validationResult(issues);
  }

  if (changedFields.length > 0) {
    issues.push({
      field: "actorRole",
      message: "This role cannot edit trial issue lifecycle fields in this milestone."
    });
  }

  return validationResult(issues);
}

export function validateCompletedTrialFinalization(
  trial: TrialEvent,
  context: {
    linkedIssueCount?: number;
    otherTrialIssueCount?: number;
  } = {}
): ValidationResult {
  const issues: ValidationIssue[] = [];

  if (trial.status !== "Completed") {
    return validationResult(issues);
  }

  if (isMissing(trial.actualDate)) {
    issues.push({
      field: "actualDate",
      message: "Completed trial requires actual date."
    });
  }

  if (isMissing(trial.result)) {
    issues.push({
      field: "result",
      message: "Completed trial requires result."
    });
  }

  const needsFollowUpPath = trial.result != null && nonApprovedTrialResults.has(trial.result);

  if (needsFollowUpPath) {
    const hasLinkedIssue = (context.linkedIssueCount ?? 0) > 0;

    if (!hasLinkedIssue) {
      issues.push({
        field: "result",
        message: "Add at least one issue under this trial before saving a non-approved result."
      });
    }
  }

  return validationResult(issues);
}

export function validateNewPlannedTrial(
  trial: TrialEvent,
  options: {
    isInitialPlan?: boolean;
    actorRole?: RoleCode;
  } = {}
): ValidationResult {
  const issues: ValidationIssue[] = [];

  if (isMissing(trial.plannedDate)) {
    issues.push({
      field: "plannedDate",
      message: "Planned trial requires planned date."
    });
  }

  if (!options.isInitialPlan) {
    if (isMissing(trial.planReasonCategory)) {
      issues.push({
        field: "planReasonCategory",
        message: "New planned trial after the first requires reason category."
      });
    }

    if (isBlank(trial.requestedById)) {
      issues.push({
        field: "requestedById",
        message: "New planned trial after the first requires requester."
      });
    }

    if (isMissing(trial.sourceArea)) {
      issues.push({
        field: "sourceArea",
        message: "New planned trial after the first requires source area."
      });
    }
  }

  if (options.actorRole === "MARKETING") {
    issues.push({
      field: "actorRole",
      message: "Marketing can create intake and customer-feedback issues, but PM owns planned trial dates."
    });
  }

  return validationResult(issues);
}

export function validateMissedTrialEvent(
  event: MissedTrialEvent,
  projectStatus: ProjectStatus,
  options: {
    requireNewPlannedDate?: boolean;
  } = {}
): ValidationResult {
  const issues: ValidationIssue[] = [];
  const canOmitNewDate =
    options.requireNewPlannedDate !== true && (projectStatus === "Blocked" || projectStatus === "Paused");

  if (isMissing(event.plannedDate)) {
    issues.push({
      field: "plannedDate",
      message: "Missed trial event requires original planned date."
    });
  }

  if (!canOmitNewDate && isMissing(event.newPlannedDate)) {
    issues.push({
      field: "newPlannedDate",
      message: "Missed trial requires new planned date unless project is blocked or paused."
    });
  }

  if (isMissing(event.reasonCategory)) {
    issues.push({
      field: "reasonCategory",
      message: "Missed trial requires reason category."
    });
  }

  if (isMissing(event.responsibleArea)) {
    issues.push({
      field: "responsibleArea",
      message: "Missed trial requires responsible area."
    });
  }

  if (isBlank(event.explanation)) {
    issues.push({
      field: "explanation",
      message: "Missed trial requires explanation."
    });
  }

  return validationResult(issues);
}
