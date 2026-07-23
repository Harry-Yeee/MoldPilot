"use server";

import type {
  ChangeRequester as PrismaChangeRequester,
  IssueAffectedScope as PrismaIssueAffectedScope,
  MissedTrialReasonCategory as PrismaMissedTrialReasonCategory,
  MoldTrialProjectStatus as PrismaMoldTrialProjectStatus,
  NewTrialReasonCategory as PrismaNewTrialReasonCategory,
  Prisma,
  Priority as PrismaPriority,
  ResponsibleArea as PrismaResponsibleArea,
  Severity as PrismaSeverity,
  SourceArea as PrismaSourceArea,
  TrialCode as PrismaTrialCode,
  TrialIssueSource as PrismaTrialIssueSource,
  TrialIssueStatus as PrismaTrialIssueStatus,
  TrialIssueType as PrismaTrialIssueType,
  TrialOutcomeDisposition as PrismaTrialOutcomeDisposition,
  TrialResult as PrismaTrialResult,
  TrialStatus as PrismaTrialStatus
} from "@prisma/client";
import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { validateSelectedCustomerForProject } from "@/domain/mold-trial/customers";
import { validateAutoMissedResolution, type AutoMissedResolutionMode } from "@/domain/mold-trial/auto-missed";
import { clearedProposalFields } from "@/domain/mold-trial/date-confirmation";
import { selectCurrentPlannedTrial } from "@/domain/mold-trial/current-trial";
import {
  DUPLICATE_SUBMISSION_WINDOW_MS,
  isDuplicateIssueSubmission,
  isDuplicateMissedTrialSubmission,
  isDuplicateTrialSubmission
} from "@/domain/mold-trial/submission-guards";
import { createInternalTrackingCode, normalizeClientProjectRef } from "@/domain/mold-trial/identifiers";
import { computeDefaultIssueDueDate, defaultOwnerGroupCodeForIssueType } from "@/domain/mold-trial/issue-routing";
import { normalizeMoldTrialParts, validateIssueAffectedPart, type MoldTrialPartInput } from "@/domain/mold-trial/parts";
import {
  buildCustomerSafeProcessSheetExport,
  DEFAULT_PROCESS_SHEET_TEMPLATE_CODE,
  formatInjectionMachineLabel,
  isProcessSheetColumnEditable,
  isProcessSheetSummaryParameter,
  snapshotInjectionMachine
} from "@/domain/mold-trial/process-sheet";
import {
  DEFAULT_TRIAL_PANEL_COUNT,
  trialStageLabel,
  validateExtraTrialPanelCreation,
  validateNextTrialStageCreation
} from "@/domain/mold-trial/trial-panel";
import {
  validateCompletedTrialFinalization,
  validateFirstPlannedTrialSchedule,
  validateMissedTrialEvent,
  validateMoldTrialProjectCreate,
  validateMoldTrialProjectIntakeCreate,
  validateNewPlannedTrial,
  validateTrialIssueClosure,
  validateTrialIssueCreate,
  validateTrialIssueLifecycleUpdate
} from "@/domain/mold-trial/validation";
import { prisma } from "@/lib/prisma";
import {
  issueSourceLabels,
  issueAffectedScopeLabels,
  issueStatusLabels,
  issueTypeLabels,
  missedTrialReasonLabels,
  newTrialReasonLabels,
  outcomeDispositionLabels,
  projectStatusLabels,
  responsibleAreaLabels,
  severityLabels,
  sourceAreaLabels,
  trialCodeLabels,
  trialStatusLabels,
  trialResultLabels
} from "@/server/mold-trial-codecs";
import { friendlyActionErrorMessage } from "@/server/action-errors";
import { writeAttachmentFile } from "@/server/attachment-storage";
import { getCurrentUser } from "@/server/current-user";
import { storeIssuePhotos } from "@/server/issue-photo-storage";
import { applyDesignChangeEvent, applyPmCustomTrialLimit } from "@/server/mold-trial-limit-service";
import { requirePermission, requirePermissions } from "@/server/permissions";
import { createSimplePdfBuffer } from "@/server/simple-pdf";
import { isAssemblyRelevantIssue, type PermissionCode } from "@/domain/mold-trial/permission-policy";
import type { RoleCode, TrialIssueLifecycleField, ValidationResult } from "@/domain/mold-trial/types";

const disallowedCustomerIdentityFields = [
  "customerName",
  "customerFullName",
  "customerContactName",
  "customerEmail",
  "customerPhone",
  "quoteValue",
  "salesPipelineStage",
  "customerDisplayName",
  "customerShortName",
  "customerAliases",
  "customer_name",
  "customer_contact_name",
  "customer_email",
  "customer_phone",
  "quote_value",
  "sales_pipeline_stage",
  "customer_display_name",
  "customer_short_name",
  "customer_aliases"
];

const priorityValues = ["NORMAL", "HIGH", "CRITICAL"] as const satisfies readonly PrismaPriority[];
const trialResultValues = [
  "APPROVED",
  "NOT_APPROVED",
  "CONDITIONAL",
  "PENDING_QC",
  "PENDING_CUSTOMER_FEEDBACK",
  "INVALID_TRIAL"
] as const satisfies readonly PrismaTrialResult[];
const missedTrialReasonValues = [
  "DESIGN_NOT_READY",
  "DESIGN_CHANGE_PENDING",
  "STEEL_OR_COMPONENT_NOT_READY",
  "CNC_NOT_COMPLETE",
  "EDM_NOT_COMPLETE",
  "FITTING_NOT_COMPLETE",
  "MOLD_CORRECTION_NOT_COMPLETE",
  "INJECTION_MACHINE_NOT_AVAILABLE",
  "MATERIAL_NOT_AVAILABLE",
  "QC_PLAN_NOT_READY",
  "CUSTOMER_REQUIREMENT_CHANGE",
  "SUPPLIER_OR_OUTSOURCING_DELAY",
  "INTERNAL_DECISION_PENDING",
  "OTHER"
] as const satisfies readonly PrismaMissedTrialReasonCategory[];
const responsibleAreaValues = [
  "TECHNICAL",
  "MACHINING",
  "ASSEMBLY",
  "INJECTION",
  "QC",
  "PURCHASING",
  "CUSTOMER",
  "SUPPLIER",
  "PLANNING",
  "OTHER"
] as const satisfies readonly PrismaResponsibleArea[];
const newTrialReasonValues = [
  "PLANNED_NEXT_TRIAL_AFTER_CORRECTION",
  "CUSTOMER_DESIGN_CHANGE",
  "BAD_CUSTOMER_FEEDBACK",
  "CUSTOMER_SAMPLE_REJECTION",
  "CUSTOMER_REQUIREMENT_CLARIFICATION",
  "INTERNAL_REWORK",
  "TRIAL_ISSUE_VERIFICATION",
  "QC_FAILURE",
  "MOLD_CORRECTION_VERIFICATION",
  "INJECTION_PROCESS_RETEST",
  "ABORTED_OR_INVALID_PREVIOUS_TRIAL",
  "OTHER"
] as const satisfies readonly PrismaNewTrialReasonCategory[];
const sourceAreaValues = [
  "PLANNING",
  "TECHNICAL",
  "MARKETING",
  "INJECTION",
  "QC",
  "CUSTOMER",
  "SUPPLIER",
  "OTHER"
] as const satisfies readonly PrismaSourceArea[];
const issueTypeValues = [
  "DESIGN_CHANGE",
  "BAD_CUSTOMER_FEEDBACK",
  "CUSTOMER_SAMPLE_REJECTION",
  "DFM_PART_DESIGN_ISSUE",
  "MOLD_DESIGN_ISSUE",
  "MACHINING_ISSUE",
  "ASSEMBLY_FITTING_ISSUE",
  "INJECTION_PROCESS_ISSUE",
  "MATERIAL_ISSUE",
  "QC_DIMENSION_ISSUE",
  "APPEARANCE_ISSUE",
  "SUPPLIER_OUTSOURCING_ISSUE",
  "CUSTOMER_REQUIREMENT_CHANGE",
  "ABORTED_INVALID_TRIAL",
  "OTHER"
] as const satisfies readonly PrismaTrialIssueType[];
const issueSourceValues = [
  "INTERNAL_TRIAL",
  "PM_REVIEW",
  "TECHNICAL_REVIEW",
  "QC_INSPECTION",
  "INJECTION_PROCESS",
  "MARKETING_CLIENT_FEEDBACK",
  "CUSTOMER_DESIGN_CHANGE",
  "OTHER"
] as const satisfies readonly PrismaTrialIssueSource[];
const issueAffectedScopeValues = ["MOLD", "PART", "MULTIPLE_PARTS"] as const satisfies readonly PrismaIssueAffectedScope[];
const severityValues = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const satisfies readonly PrismaSeverity[];
const issueStatusValues = [
  "OPEN",
  "IN_PROGRESS",
  "WAITING_INTERNAL",
  "WAITING_CUSTOMER",
  "WAITING_SUPPLIER",
  "WAITING_VERIFICATION",
  "VERIFIED",
  "CLOSED"
] as const satisfies readonly PrismaTrialIssueStatus[];
const issueCreateStatusValues = [
  "OPEN",
  "IN_PROGRESS",
  "WAITING_INTERNAL",
  "WAITING_CUSTOMER",
  "WAITING_SUPPLIER",
  "WAITING_VERIFICATION"
] as const satisfies readonly PrismaTrialIssueStatus[];
const changeRequesterValues = ["CUSTOMER", "INTERNAL", "MARKETING", "SUPPLIER", "OTHER"] as const satisfies readonly PrismaChangeRequester[];
const noDesignChangeRequesterValue = "NONE";
const priorityDomainLabels = {
  NORMAL: "Normal",
  HIGH: "High",
  CRITICAL: "Critical"
} as const;

function isDesignChangeRelatedReason(reason: PrismaNewTrialReasonCategory): boolean {
  return reason === "CUSTOMER_DESIGN_CHANGE";
}

function value(formData: FormData, key: string): string {
  const raw = formData.get(key);
  return typeof raw === "string" ? raw.trim() : "";
}

function optionalValue(formData: FormData, key: string): string | null {
  const next = value(formData, key);
  return next.length === 0 ? null : next;
}

function checkboxValue(formData: FormData, key: string): boolean {
  const raw = formData.get(key);
  return raw === "on" || raw === "true" || raw === "1";
}

function formDate(formData: FormData, key: string): Date | null {
  const raw = optionalValue(formData, key);

  if (raw == null) {
    return null;
  }

  const date = new Date(`${raw}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function optionalInteger(formData: FormData, key: string): number | null {
  const raw = optionalValue(formData, key);

  if (raw == null) {
    return null;
  }

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${key} must be a non-negative whole number.`);
  }

  return parsed;
}

function optionalDecimalValue(raw: string | null, fieldLabel: string): string | null {
  if (raw == null) {
    return null;
  }

  const parsed = Number.parseFloat(raw);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${fieldLabel} must be a number.`);
  }

  return raw;
}

function parseProcessValue(input: {
  raw: string | null;
  valueType: string;
  fieldLabel: string;
}): {
  valueText: string | null;
  valueNumber: string | null;
  valueDate: Date | null;
} {
  const raw = input.raw == null || input.raw.trim().length === 0 ? null : input.raw.trim();

  if (raw == null) {
    return {
      valueText: null,
      valueNumber: null,
      valueDate: null
    };
  }

  if (input.valueType === "NUMBER") {
    return {
      valueText: null,
      valueNumber: optionalDecimalValue(raw, input.fieldLabel),
      valueDate: null
    };
  }

  if (input.valueType === "DATE") {
    const parsed = new Date(`${raw}T00:00:00.000Z`);
    if (Number.isNaN(parsed.getTime())) {
      throw new Error(`${input.fieldLabel} must be a valid date.`);
    }

    return {
      valueText: null,
      valueNumber: null,
      valueDate: parsed
    };
  }

  if (input.valueType === "BOOLEAN") {
    const normalized = raw.toLowerCase();
    if (!["true", "false", "yes", "no", "1", "0"].includes(normalized)) {
      throw new Error(`${input.fieldLabel} must be yes or no.`);
    }

    return {
      valueText: normalized === "true" || normalized === "yes" || normalized === "1" ? "Yes" : "No",
      valueNumber: null,
      valueDate: null
    };
  }

  return {
    valueText: raw,
    valueNumber: null,
    valueDate: null
  };
}

function processValueComparisonText(value: {
  valueText: string | null;
  valueNumber: unknown | null;
  valueDate: Date | string | null;
}): string {
  if (value.valueNumber != null) {
    return String(value.valueNumber);
  }

  if (value.valueDate != null) {
    return new Date(value.valueDate).toISOString().slice(0, 10);
  }

  return value.valueText ?? "";
}

function values(formData: FormData, key: string): string[] {
  return formData
    .getAll(key)
    .map((raw) => (typeof raw === "string" ? raw.trim() : ""))
    .filter((raw) => raw.length > 0);
}

function indexedValues(formData: FormData, key: string): string[] {
  return formData.getAll(key).map((raw) => (typeof raw === "string" ? raw.trim() : ""));
}

/** All non-empty File entries submitted under `key` (e.g. issue photos). */
function fileValues(formData: FormData, key: string): File[] {
  return formData.getAll(key).filter((raw): raw is File => raw instanceof File && raw.size > 0);
}

/**
 * Build a redirect message for an issue that saved but had one or more photos
 * fail to attach, naming the failed files. Returns null when nothing failed so
 * the caller keeps the plain success message.
 */
function photoWarningSuffix(failures: readonly { fileName: string }[]): string | null {
  if (failures.length === 0) {
    return null;
  }
  const names = failures.map((failure) => failure.fileName).join(", ");
  return `${failures.length} photo(s) could not be attached: ${names}.`;
}

function parseMoldTrialPartRows(formData: FormData): MoldTrialPartInput[] {
  const partIds = indexedValues(formData, "partId");
  const partCodes = indexedValues(formData, "partCode");
  const partNames = indexedValues(formData, "partName");
  const cavityLabels = indexedValues(formData, "cavityLabel");
  const cavityCounts = indexedValues(formData, "cavityCount");
  const notes = indexedValues(formData, "partNotes");
  const rowCount = Math.max(
    partIds.length,
    partCodes.length,
    partNames.length,
    cavityLabels.length,
    cavityCounts.length,
    notes.length
  );

  return Array.from({ length: rowCount }, (_, index) => ({
    id: partIds[index] ?? null,
    partCode: partCodes[index] ?? null,
    partName: partNames[index] ?? null,
    cavityLabel: cavityLabels[index] ?? null,
    cavityCount: cavityCounts[index] ?? null,
    notes: notes[index] ?? null,
    active: true
  }));
}

function toDbEnum<T extends string>(
  raw: string,
  allowed: readonly T[],
  fieldLabel: string,
  fallback?: T
): T {
  const next = raw.length === 0 ? fallback : raw;

  if (next != null && allowed.includes(next as T)) {
    return next as T;
  }

  throw new Error(`Invalid ${fieldLabel}.`);
}

function activityDate(value: Date | null | undefined): string | null {
  return value == null ? null : value.toISOString().slice(0, 10);
}

function sameDate(left: Date | null | undefined, right: Date | null | undefined): boolean {
  return activityDate(left) === activityDate(right);
}

function sameText(left: string | null | undefined, right: string | null | undefined): boolean {
  return (left ?? null) === (right ?? null);
}

function currentPlannedTrialId(
  trials: readonly {
    id: string;
    plannedDate: Date | null;
    status: PrismaTrialStatus;
  }[]
): string | null {
  return (
    selectCurrentPlannedTrial(
      trials.map((trial) => ({
        id: trial.id,
        plannedDate: trial.plannedDate,
        status: trialStatusLabels[trial.status]
      }))
    )?.id ?? null
  );
}

function currentProcessSheetEditableTrialId(
  trials: readonly {
    id: string;
    plannedDate: Date | null;
    sequenceNumber: number;
    status: PrismaTrialStatus;
  }[]
): string | null {
  const plannedTrialId = currentPlannedTrialId(trials);

  if (plannedTrialId != null) {
    return plannedTrialId;
  }

  return [...trials].sort((left, right) => {
    if (left.sequenceNumber !== right.sequenceNumber) {
      return right.sequenceNumber - left.sequenceNumber;
    }

    return new Date(right.plannedDate ?? 0).getTime() - new Date(left.plannedDate ?? 0).getTime();
  })[0]?.id ?? null;
}

function redirectPath(formData: FormData, fallback: string): string {
  const path = optionalValue(formData, "redirectTo");
  return path?.startsWith("/") === true ? path : fallback;
}

function redirectWithMessage(path: string, type: "error" | "success", message: string): never {
  const separator = path.includes("?") ? "&" : "?";
  redirect(`${path}${separator}${type}=${encodeURIComponent(message)}`);
}

function autoMissedResolutionMode(raw: string): AutoMissedResolutionMode {
  if (raw === "MISSED" || raw === "BLOCKED" || raw === "PAUSED") {
    return raw;
  }

  throw new Error("Invalid auto-missed resolution type.");
}

function isRedirectSignal(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "digest" in error &&
    String((error as { digest: unknown }).digest).startsWith("NEXT_REDIRECT")
  );
}

function assertNoCustomerIdentity(formData: FormData): ValidationResult {
  const issues = disallowedCustomerIdentityFields
    .filter((field) => formData.has(field))
    .map((field) => ({
      field,
      message: "Customer identity fields are not allowed in Phase 1 core forms."
    }));

  return {
    ok: issues.length === 0,
    issues
  };
}

function firstValidationMessage(result: ValidationResult): string {
  return result.issues[0]?.message ?? "Validation failed.";
}

async function getActor(requiredPermissions: PermissionCode | readonly PermissionCode[] = []) {
  const actor = await getCurrentUser();
  const permissionsToRequire = typeof requiredPermissions === "string" ? [requiredPermissions] : requiredPermissions;

  await requirePermissions(actor.id, permissionsToRequire);

  return actor;
}

async function requireIssueLifecyclePermissions(input: {
  actor: {
    id: string;
    roleCode: RoleCode;
  };
  issue: {
    issueType: PrismaTrialIssueType;
    ownerUserId: string | null;
    ownerGroup?: {
      code: string;
    } | null;
  };
  changedFields: readonly TrialIssueLifecycleField[];
  nextStatus: PrismaTrialIssueStatus;
}) {
  const requiredPermissions = new Set<PermissionCode>();

  for (const field of input.changedFields) {
    if (field === "rootCause" || field === "correctiveAction" || field === "verificationMethod") {
      requiredPermissions.add("trial.issue.edit_root_cause");
    }

    if (field === "verificationResult") {
      requiredPermissions.add("trial.issue.qc_verify");
    }

    if (
      field === "assemblyAcknowledgedAt" ||
      field === "assemblyEstimatedFinishDate" ||
      field === "assemblyAcknowledgedById" ||
      field === "assemblySelfCheckedAt" ||
      field === "assemblySelfCheckedById" ||
      field === "assemblySelfCheckNote"
    ) {
      requiredPermissions.add("trial.issue.assembly_acknowledge");
    }

    if (field === "pmReadyConfirmedAt" || field === "pmReadyConfirmedById") {
      requiredPermissions.add("trial.schedule.reschedule");
    }

    if (field === "closedAt") {
      requiredPermissions.add("trial.issue.close");
    }

    if (
      field === "status" ||
      field === "dueDate" ||
      field === "ownerUserId" ||
      field === "ownerGroupId" ||
      field === "affectedScope" ||
      field === "affectedPartId" ||
      field === "affectedCavityNote"
    ) {
      requiredPermissions.add("trial.issue.create");
    }
  }

  if (input.nextStatus === "VERIFIED") {
    requiredPermissions.add("trial.issue.qc_verify");
  }

  if (input.nextStatus === "CLOSED") {
    requiredPermissions.add("trial.issue.close");
  }

  await requirePermissions(input.actor.id, [...requiredPermissions]);

  if (
    input.actor.roleCode === "ASSEMBLY" &&
    requiredPermissions.has("trial.issue.assembly_acknowledge") &&
    !isAssemblyRelevantIssue({
      actorUserId: input.actor.id,
      issueType: input.issue.issueType,
      ownerUserId: input.issue.ownerUserId,
      ownerGroupCode: input.issue.ownerGroup?.code
    })
  ) {
    throw new Error("Assembly can acknowledge only assigned or Assembly-relevant trial issues.");
  }
}

function isDepartmentInboxClaim(input: {
  actor: {
    id: string;
    roleCode: RoleCode;
  };
  issue: {
    status: PrismaTrialIssueStatus;
    ownerUserId: string | null;
    ownerGroup?: {
      code: string;
    } | null;
    moldTrialProject: {
      planningPmId: string | null;
      technicalPmId: string | null;
    };
  };
  ownerUser: {
    id: string;
  } | null;
  ownerGroup: {
    code: string;
  } | null;
  changedFields: readonly TrialIssueLifecycleField[];
}): boolean {
  if (
    input.issue.ownerUserId != null ||
    input.ownerUser?.id !== input.actor.id ||
    input.issue.status === "VERIFIED" ||
    input.issue.status === "CLOSED" ||
    input.changedFields.length !== 1 ||
    input.changedFields[0] !== "ownerUserId" ||
    input.ownerGroup?.code !== input.issue.ownerGroup?.code
  ) {
    return false;
  }

  switch (input.actor.roleCode) {
    case "ASSEMBLY":
      return input.issue.ownerGroup?.code === "assembly";
    case "INJECTION":
      return input.issue.ownerGroup?.code === "injection";
    case "MARKETING":
      return input.issue.ownerGroup?.code === "marketing";
    case "QC":
      return input.issue.ownerGroup?.code === "qc";
    case "PM":
      return (
        (input.issue.ownerGroup?.code === "pm" ||
          input.issue.ownerGroup?.code === "planning" ||
          input.issue.ownerGroup?.code === "technical") &&
        (input.issue.moldTrialProject.planningPmId === input.actor.id ||
          input.issue.moldTrialProject.technicalPmId === input.actor.id)
      );
    default:
      return false;
  }
}

function isMarketingClientFeedbackIssue(issue: { source: PrismaTrialIssueSource }): boolean {
  return issue.source === "MARKETING_CLIENT_FEEDBACK" || issue.source === "CUSTOMER_DESIGN_CHANGE";
}

async function requireSimpleIssueEditAuthorization(input: {
  actor: {
    id: string;
    roleCode: RoleCode;
  };
  issue: {
    createdById: string;
    reportedById: string;
    source: PrismaTrialIssueSource;
    status: PrismaTrialIssueStatus;
  };
}) {
  if (input.issue.status === "CLOSED") {
    if (input.actor.roleCode === "GM") {
      await requirePermission(input.actor.id, "trial.issue.create");
      return;
    }

    throw new Error("Only GM can edit closed trial issues.");
  }

  if (input.actor.roleCode === "PM" || input.actor.roleCode === "ADMIN") {
    await requirePermission(input.actor.id, "trial.issue.create");
    return;
  }

  if (
    input.actor.roleCode === "MARKETING" &&
    isMarketingClientFeedbackIssue(input.issue) &&
    (input.issue.createdById === input.actor.id || input.issue.reportedById === input.actor.id)
  ) {
    await requirePermission(input.actor.id, "trial.issue.create");
    return;
  }

  throw new Error("Current user cannot edit this trial issue.");
}

async function requireTrialIssueCloseAuthorization(input: {
  actor: {
    id: string;
    roleCode: RoleCode;
  };
  issue: {
    ownerUserId: string | null;
    source: PrismaTrialIssueSource;
  };
}) {
  if (input.actor.roleCode === "VIEWER") {
    throw new Error("Viewer cannot close trial issues.");
  }

  const closerIsOwner = input.issue.ownerUserId === input.actor.id;
  const closerHasOversight =
    input.actor.roleCode === "PM" || input.actor.roleCode === "GM" || input.actor.roleCode === "ADMIN";

  if (
    closerIsOwner &&
    input.actor.roleCode === "MARKETING" &&
    !isMarketingClientFeedbackIssue(input.issue)
  ) {
    throw new Error("Marketing can close only assigned client-feedback trial issues.");
  }

  if (closerIsOwner) {
    return;
  }

  if (!closerHasOversight) {
    throw new Error("Only the issue owner, PM, GM, or Admin can close trial issues.");
  }

  await requirePermission(input.actor.id, "trial.issue.close");
}

async function findUserByUsername(username: string, label: string) {
  const user = await prisma.user.findUnique({ where: { username } });

  if (user == null) {
    throw new Error(`${label} ${username} was not found. Run prisma:seed first.`);
  }

  if (user.status !== "ACTIVE") {
    throw new Error(`${label} ${username} is archived and cannot be selected for new workflow assignments.`);
  }

  return user;
}

async function maxTrialSequence(tx: Prisma.TransactionClient, projectId: string): Promise<number> {
  const aggregate = await tx.trialEvent.aggregate({
    where: { moldTrialProjectId: projectId },
    _max: { sequenceNumber: true }
  });

  return aggregate._max.sequenceNumber ?? 0;
}

async function processSheetTemplateSnapshotForCustomer(customer: {
  defaultProcessSheetTemplate?: {
    id: string;
    code: string;
    active: boolean;
  } | null;
} | null): Promise<{ id: string; code: string } | null> {
  if (customer?.defaultProcessSheetTemplate?.active) {
    return {
      id: customer.defaultProcessSheetTemplate.id,
      code: customer.defaultProcessSheetTemplate.code
    };
  }

  return prisma.processSheetTemplate.findFirst({
    where: {
      code: DEFAULT_PROCESS_SHEET_TEMPLATE_CODE,
      active: true
    },
    select: {
      id: true,
      code: true
    }
  });
}

function dbTrialCodeForSequence(sequenceNumber: number): PrismaTrialCode {
  if (sequenceNumber === 1) {
    return "T0";
  }

  if (sequenceNumber === 2) {
    return "T1";
  }

  if (sequenceNumber === 3) {
    return "T2";
  }

  return "EXTRA";
}

async function generateUniqueProjectTrackingCode(tx: Prisma.TransactionClient): Promise<string> {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const code = createInternalTrackingCode();
    const existing = await tx.moldTrialProject.findUnique({
      where: { projectCode: code },
      select: { id: true }
    });

    if (existing == null) {
      return code;
    }
  }

  throw new Error("Unable to generate a unique internal tracking code.");
}

function assertProjectHasMoldCode(project: { moldCode: string | null | undefined }) {
  if ((project.moldCode ?? "").trim().length === 0) {
    throw new Error("Mold code is required before setting T0, scheduling trials, or recording trial activity.");
  }
}

async function assertProjectHasActivePart(projectId: string) {
  const activePartCount = await prisma.moldTrialPart.count({
    where: {
      moldTrialProjectId: projectId,
      active: true
    }
  });

  if (activePartCount === 0) {
    throw new Error("At least one active part/cavity row is required before trial scheduling or completion.");
  }
}

async function resolveAffectedPart(input: {
  projectId: string;
  affectedScope: PrismaIssueAffectedScope;
  affectedPartId: string | null;
  allowInactivePartId?: string | null;
}) {
  if (input.affectedScope !== "PART" || input.affectedPartId == null) {
    return null;
  }

  const part = await prisma.moldTrialPart.findFirst({
    where: {
      id: input.affectedPartId,
      moldTrialProjectId: input.projectId,
      ...(input.affectedPartId === input.allowInactivePartId ? {} : { active: true })
    },
    select: { id: true }
  });

  if (part == null) {
    throw new Error("Affected part/cavity does not belong to this project or is inactive.");
  }

  return part;
}

function mapProjectStatus(status: string) {
  return projectStatusLabels[status] ?? "Active";
}

function projectStatusAfterTrial(outcomeDisposition: string): PrismaMoldTrialProjectStatus {
  if (outcomeDisposition === "APPROVED_COMPLETE") {
    return "APPROVED";
  }

  if (outcomeDisposition === "REWORK_REQUIRED") {
    return "IN_CORRECTION";
  }

  if (outcomeDisposition === "APPROVED_WITH_MINOR_ITEMS" || outcomeDisposition === "PENDING_QC") {
    return "WAITING_VERIFICATION";
  }

  return "ACTIVE";
}

function legacyOutcomeDispositionForResult(result: PrismaTrialResult): PrismaTrialOutcomeDisposition {
  switch (result) {
    case "APPROVED":
      return "APPROVED_COMPLETE";
    case "CONDITIONAL":
      return "APPROVED_WITH_MINOR_ITEMS";
    case "NOT_APPROVED":
      return "REWORK_REQUIRED";
    case "PENDING_QC":
      return "PENDING_QC";
    case "PENDING_CUSTOMER_FEEDBACK":
      return "PENDING_CUSTOMER_FEEDBACK";
    case "INVALID_TRIAL":
      return "ABORTED_INVALID_TRIAL";
  }
}

async function logActivity(
  tx: Prisma.TransactionClient,
  input: {
    actorUserId: string;
    entityType: string;
    entityId: string;
    action: string;
    beforeJson?: Prisma.InputJsonValue;
    afterJson?: Prisma.InputJsonValue;
    note?: string;
  }
) {
  await tx.activityLog.create({
    data: {
      actorUserId: input.actorUserId,
      entityType: input.entityType,
      entityId: input.entityId,
      action: input.action,
      beforeJson: input.beforeJson,
      afterJson: input.afterJson,
      note: input.note
    }
  });
}

export async function createMoldTrialProject(formData: FormData) {
  const fallback = redirectPath(formData, "/");

  try {
    const privacy = assertNoCustomerIdentity(formData);
    if (!privacy.ok) {
      redirectWithMessage(fallback, "error", firstValidationMessage(privacy));
    }

    const firstPlannedTrialDate = formDate(formData, "firstPlannedTrialDate");
    const actor = await getActor(
      firstPlannedTrialDate == null ? "project.intake.create" : ["project.intake.create", "trial.schedule.first_t0"]
    );
    const planningPmUsername = optionalValue(formData, "planningPmUsername");
    const planningPm =
      planningPmUsername == null
        ? firstPlannedTrialDate == null
          ? null
          : await findUserByUsername("bill", "PM")
        : await findUserByUsername(planningPmUsername, "PM");
    const technicalPmUsername = optionalValue(formData, "technicalPmUsername");
    const technicalPm = technicalPmUsername == null ? null : await findUserByUsername(technicalPmUsername, "Secondary PM");
    const clientProjectRef = normalizeClientProjectRef(
      optionalValue(formData, "clientProjectRef") ?? optionalValue(formData, "projectCode")
    );
    const customerId = value(formData, "customerId");
    const customer =
      customerId.length === 0
        ? null
        : await prisma.customer.findUnique({
            where: { id: customerId },
            include: {
              defaultProcessSheetTemplate: {
                select: {
                  id: true,
                  code: true,
                  active: true
                }
              }
            }
          });
    const customerValidation = validateSelectedCustomerForProject(customer);

    if (!customerValidation.ok) {
      redirectWithMessage(fallback, "error", firstValidationMessage(customerValidation));
    }

    const selectedCustomer = customer;
    if (selectedCustomer == null || !selectedCustomer.active) {
      redirectWithMessage(fallback, "error", "Select an active client.");
    }
    const processSheetTemplate = await processSheetTemplateSnapshotForCustomer(selectedCustomer);

    const priority = toDbEnum(value(formData, "priority"), priorityValues, "priority", "NORMAL");
    const partResult = normalizeMoldTrialParts(parseMoldTrialPartRows(formData), {
      fallbackPartCode: value(formData, "partCode")
    });

    if (!partResult.ok) {
      redirectWithMessage(fallback, "error", firstValidationMessage(partResult));
    }

    const primaryPartCode = partResult.parts[0]?.partCode ?? value(formData, "partCode");
    const input = {
      projectCode: null,
      clientProjectRef,
      customerCode: selectedCustomer.code,
      partCode: primaryPartCode,
      moldCode: value(formData, "moldCode"),
      intakeNote: value(formData, "intakeNote"),
      customerTargetDate: formDate(formData, "customerTargetDate"),
      initialCustomerNote: optionalValue(formData, "initialCustomerNote"),
      planningPmId: planningPm?.id,
      firstPlannedTrialDate,
      priority: priorityDomainLabels[priority],
      actorRole: actor.roleCode
    };
    const validation =
      firstPlannedTrialDate == null ? validateMoldTrialProjectIntakeCreate(input) : validateMoldTrialProjectCreate(input);

    if (!validation.ok) {
      redirectWithMessage(fallback, "error", firstValidationMessage(validation));
    }

    const created = await prisma.$transaction(async (tx) => {
      const projectCode = await generateUniqueProjectTrackingCode(tx);
      const project = await tx.moldTrialProject.create({
        data: {
          projectCode,
          clientProjectRef,
          customerId: selectedCustomer.id,
          customerCode: selectedCustomer.code,
          processSheetTemplateId: processSheetTemplate?.id ?? null,
          processSheetTemplateCode: processSheetTemplate?.code ?? null,
          partCode: primaryPartCode,
          moldCode: value(formData, "moldCode"),
          planningPmId: planningPm?.id,
          technicalPmId: technicalPm?.id,
          status: firstPlannedTrialDate == null ? "INTAKE" : "WAITING_TRIAL",
          priority,
          intakeNote: value(formData, "intakeNote"),
          customerTargetDate: formDate(formData, "customerTargetDate"),
          initialCustomerNote: optionalValue(formData, "initialCustomerNote"),
          firstPlannedTrialDate,
          nextPlannedTrialDate: firstPlannedTrialDate,
          baseTrialLimit: 3,
          currentTrialLimit: 3,
          createdById: actor.id
        }
      });

      await tx.moldTrialPart.createMany({
        data: partResult.parts.map((part) => ({
          moldTrialProjectId: project.id,
          partCode: part.partCode,
          partName: part.partName,
          cavityLabel: part.cavityLabel,
          cavityCount: part.cavityCount,
          notes: part.notes,
          sortOrder: part.sortOrder,
          active: part.active
        }))
      });

      await logActivity(tx, {
        actorUserId: actor.id,
        entityType: "MoldTrialProject",
        entityId: project.id,
          action: firstPlannedTrialDate == null ? "created_project_intake" : "created_project",
          afterJson: {
            projectCode: project.projectCode,
            clientProjectRef: project.clientProjectRef,
            status: project.status,
            customerId: project.customerId,
            customerCode: project.customerCode,
            processSheetTemplateCode: project.processSheetTemplateCode,
          partCount: partResult.parts.length
        }
      });

      if (firstPlannedTrialDate != null) {
        const trial = await tx.trialEvent.create({
          data: {
            moldTrialProjectId: project.id,
            trialCode: "T0",
            sequenceNumber: 1,
            plannedDate: firstPlannedTrialDate,
            status: "PLANNED",
            dateConfirmationStatus: "PENDING_CONFIRMATION",
            countsAgainstLimit: false,
            createdById: actor.id
          }
        });

        await logActivity(tx, {
          actorUserId: actor.id,
          entityType: "TrialEvent",
          entityId: trial.id,
          action: "created_initial_planned_trial",
          afterJson: { trialCode: trial.trialCode, plannedDate: activityDate(trial.plannedDate) }
        });
      }

      return project;
    });

    revalidatePath("/");
    redirectWithMessage(
      `/projects/${created.projectCode}`,
      "success",
      firstPlannedTrialDate == null ? "Project intake created. Planning PM can set T0 next." : "Mold trial project created."
    );
  } catch (error) {
    if (isRedirectSignal(error)) {
      throw error;
    }

    redirectWithMessage(fallback, "error", friendlyActionErrorMessage(error, "Unable to create project."));
  }
}

export async function updateMoldTrialParts(formData: FormData) {
  const projectCode = value(formData, "projectCode");
  const fallback = redirectPath(formData, `/projects/${projectCode}`);

  try {
    const privacy = assertNoCustomerIdentity(formData);
    if (!privacy.ok) {
      redirectWithMessage(fallback, "error", firstValidationMessage(privacy));
    }

    const actor = await getActor("project.basic.edit");
    const project = await prisma.moldTrialProject.findUnique({
      where: { projectCode },
      include: {
        parts: {
          orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }]
        }
      }
    });

    if (project == null) {
      throw new Error("Project not found.");
    }

    const partResult = normalizeMoldTrialParts(parseMoldTrialPartRows(formData), {
      fallbackPartCode: project.partCode
    });

    if (!partResult.ok) {
      redirectWithMessage(fallback, "error", firstValidationMessage(partResult));
    }

    const submittedExistingIds = new Set(partResult.parts.map((part) => part.id).filter((id): id is string => id != null));
    const invalidExistingId = [...submittedExistingIds].find(
      (id) => !project.parts.some((existingPart) => existingPart.id === id)
    );

    if (invalidExistingId != null) {
      throw new Error("Submitted part/cavity row does not belong to this project.");
    }

    const primaryPartCode = partResult.parts.find((part) => part.active)?.partCode ?? project.partCode;

    await prisma.$transaction(async (tx) => {
      await tx.moldTrialPart.updateMany({
        where: {
          moldTrialProjectId: project.id,
          id: {
            notIn: [...submittedExistingIds]
          }
        },
        data: { active: false }
      });

      for (const part of partResult.parts) {
        if (part.id == null) {
          await tx.moldTrialPart.create({
            data: {
              moldTrialProjectId: project.id,
              partCode: part.partCode,
              partName: part.partName,
              cavityLabel: part.cavityLabel,
              cavityCount: part.cavityCount,
              notes: part.notes,
              sortOrder: part.sortOrder,
              active: true
            }
          });
          continue;
        }

        await tx.moldTrialPart.update({
          where: { id: part.id },
          data: {
            partCode: part.partCode,
            partName: part.partName,
            cavityLabel: part.cavityLabel,
            cavityCount: part.cavityCount,
            notes: part.notes,
            sortOrder: part.sortOrder,
            active: true
          }
        });
      }

      const updated = await tx.moldTrialProject.update({
        where: { id: project.id },
        data: { partCode: primaryPartCode }
      });

      await logActivity(tx, {
        actorUserId: actor.id,
        entityType: "MoldTrialProject",
        entityId: project.id,
        action: "updated_mold_trial_parts",
        beforeJson: {
          partCode: project.partCode,
          partCount: project.parts.filter((part) => part.active).length
        },
        afterJson: {
          partCode: updated.partCode,
          partCount: partResult.parts.filter((part) => part.active).length
        }
      });
    });

    revalidatePath("/");
    revalidatePath(fallback);
    redirectWithMessage(fallback, "success", "Parts / cavities updated.");
  } catch (error) {
    if (isRedirectSignal(error)) {
      throw error;
    }

    redirectWithMessage(fallback, "error", friendlyActionErrorMessage(error, "Unable to update parts / cavities."));
  }
}

export async function updateMoldTrialProjectIdentifiers(formData: FormData) {
  const projectCode = value(formData, "projectCode");
  const fallback = redirectPath(formData, `/projects/${projectCode}`);

  try {
    const privacy = assertNoCustomerIdentity(formData);
    if (!privacy.ok) {
      redirectWithMessage(fallback, "error", firstValidationMessage(privacy));
    }

    const actor = await getActor("project.basic.edit");
    const clientProjectRef = normalizeClientProjectRef(optionalValue(formData, "clientProjectRef"));
    const moldCode = value(formData, "moldCode");
    const project = await prisma.moldTrialProject.findUnique({ where: { projectCode } });

    if (project == null) {
      throw new Error("Project not found.");
    }

    if (project.status !== "INTAKE" && moldCode.length === 0) {
      redirectWithMessage(fallback, "error", "Mold code can be blank only while the project is in Intake.");
    }

    const updated = await prisma.$transaction(async (tx) => {
      const next = await tx.moldTrialProject.update({
        where: { id: project.id },
        data: {
          clientProjectRef,
          moldCode
        }
      });

      await logActivity(tx, {
        actorUserId: actor.id,
        entityType: "MoldTrialProject",
        entityId: project.id,
        action: "updated_project_identifiers",
        beforeJson: {
          clientProjectRef: project.clientProjectRef,
          moldCode: project.moldCode
        },
        afterJson: {
          clientProjectRef: next.clientProjectRef,
          moldCode: next.moldCode
        }
      });

      return next;
    });

    revalidatePath("/");
    revalidatePath(fallback);
    redirectWithMessage(fallback, "success", `Updated identifiers for ${updated.moldCode || updated.clientProjectRef || updated.projectCode}.`);
  } catch (error) {
    if (isRedirectSignal(error)) {
      throw error;
    }

    redirectWithMessage(fallback, "error", friendlyActionErrorMessage(error, "Unable to update identifiers."));
  }
}

export async function setFirstPlannedTrialDate(formData: FormData) {
  const projectCode = value(formData, "projectCode");
  const fallback = redirectPath(formData, `/projects/${projectCode}`);

  try {
    const privacy = assertNoCustomerIdentity(formData);
    if (!privacy.ok) {
      redirectWithMessage(fallback, "error", firstValidationMessage(privacy));
    }

    const actor = await getActor("trial.schedule.first_t0");
    const plannedDate = formDate(formData, "plannedDate");
    const planningPmUsername = optionalValue(formData, "planningPmUsername");
    const project = await prisma.moldTrialProject.findUnique({
      where: { projectCode },
      include: {
        customer: {
          include: {
            defaultProcessSheetTemplate: {
              select: {
                id: true,
                code: true,
                active: true
              }
            }
          }
        },
        trialEvents: {
          select: { id: true, trialCode: true }
        }
      }
    });

    if (project == null) {
      throw new Error("Project not found.");
    }

    assertProjectHasMoldCode(project);
    await assertProjectHasActivePart(project.id);

    const planningPm =
      planningPmUsername == null
        ? actor.roleCode === "PM"
          ? actor
          : await findUserByUsername("bill", "PM")
        : await findUserByUsername(planningPmUsername, "PM");
    const validation = validateFirstPlannedTrialSchedule({
      projectStatus: projectStatusLabels[project.status],
      plannedDate,
      moldCode: project.moldCode,
      actorRole: actor.roleCode,
      planningPmId: planningPm.id
    });

    if (!validation.ok || plannedDate == null) {
      redirectWithMessage(fallback, "error", firstValidationMessage(validation));
    }

    if (project.firstPlannedTrialDate != null || project.trialEvents.some((trial) => trial.trialCode === "T0")) {
      redirectWithMessage(fallback, "error", "This project already has a T0 planned trial.");
    }

    const processSheetTemplate = await processSheetTemplateSnapshotForCustomer(project.customer);

    await prisma.$transaction(async (tx) => {
      const sequenceNumber = (await maxTrialSequence(tx, project.id)) + 1;
      const trial = await tx.trialEvent.create({
        data: {
          moldTrialProjectId: project.id,
          trialCode: "T0",
          sequenceNumber,
          plannedDate,
          status: "PLANNED",
          dateConfirmationStatus: "PENDING_CONFIRMATION",
          countsAgainstLimit: false,
          createdById: actor.id
        }
      });

      const updated = await tx.moldTrialProject.update({
        where: { id: project.id },
        data: {
          planningPmId: planningPm.id,
          status: "WAITING_TRIAL",
          firstPlannedTrialDate: plannedDate,
          nextPlannedTrialDate: plannedDate,
          ...(project.processSheetTemplateId == null
            ? {
                processSheetTemplateId: processSheetTemplate?.id ?? null,
                processSheetTemplateCode: processSheetTemplate?.code ?? null
              }
            : {})
        }
      });

      await logActivity(tx, {
        actorUserId: actor.id,
        entityType: "MoldTrialProject",
        entityId: updated.id,
        action: "set_first_t0_planned_date",
        beforeJson: { status: project.status, firstPlannedTrialDate: activityDate(project.firstPlannedTrialDate) },
        afterJson: { status: updated.status, firstPlannedTrialDate: activityDate(updated.firstPlannedTrialDate) }
      });
      await logActivity(tx, {
        actorUserId: actor.id,
        entityType: "TrialEvent",
        entityId: trial.id,
        action: "created_initial_planned_trial",
        afterJson: { trialCode: trial.trialCode, plannedDate: activityDate(trial.plannedDate) }
      });
    });

    revalidatePath("/");
    revalidatePath(fallback);
    redirectWithMessage(fallback, "success", "First T0 planned date set.");
  } catch (error) {
    if (isRedirectSignal(error)) {
      throw error;
    }

    redirectWithMessage(fallback, "error", friendlyActionErrorMessage(error, "Unable to set first T0 date."));
  }
}

export async function recordMissedTrial(formData: FormData) {
  const projectCode = value(formData, "projectCode");
  const fallback = redirectPath(formData, `/projects/${projectCode}`);

  try {
    const privacy = assertNoCustomerIdentity(formData);
    if (!privacy.ok) {
      redirectWithMessage(fallback, "error", firstValidationMessage(privacy));
    }

    const actor = await getActor(["trial.missed.record", "trial.schedule.reschedule"]);
    const project = await prisma.moldTrialProject.findUnique({
      where: { projectCode },
      include: {
        trialEvents: {
          orderBy: [{ sequenceNumber: "desc" }]
        }
      }
    });

    if (project == null) {
      throw new Error("Project not found.");
    }

    assertProjectHasMoldCode(project);
    await assertProjectHasActivePart(project.id);

    const selectedTrialId = optionalValue(formData, "trialEventId");
    const defaultTrialId = currentPlannedTrialId(project.trialEvents);
    const delayedTrial = project.trialEvents.find((trial) => trial.id === (selectedTrialId ?? defaultTrialId)) ?? null;

    if (delayedTrial == null) {
      redirectWithMessage(fallback, "error", "Select a current planned or at-risk trial to mark missed.");
    }

    if (delayedTrial.status !== "PLANNED" && delayedTrial.status !== "AT_RISK") {
      redirectWithMessage(fallback, "error", "Only current planned or at-risk trials can be marked missed.");
    }

    const plannedDate = delayedTrial.plannedDate ?? formDate(formData, "plannedDate");
    const newPlannedDate = formDate(formData, "newPlannedDate");
    const reasonCategoryRaw = value(formData, "reasonCategory");
    const responsibleAreaRaw = value(formData, "responsibleArea");
    const validation = validateMissedTrialEvent(
      {
        plannedDate,
        newPlannedDate,
        reasonCategory: missedTrialReasonLabels[reasonCategoryRaw],
        responsibleArea: responsibleAreaLabels[responsibleAreaRaw],
        explanation: value(formData, "explanation"),
        createdById: actor.id
      },
      mapProjectStatus(project.status),
      { requireNewPlannedDate: true }
    );

    if (!validation.ok || plannedDate == null || newPlannedDate == null) {
      redirectWithMessage(fallback, "error", firstValidationMessage(validation));
    }

    const reasonCategory = toDbEnum(reasonCategoryRaw, missedTrialReasonValues, "missed-trial reason");
    const responsibleArea = toDbEnum(responsibleAreaRaw, responsibleAreaValues, "responsible area");

    const now = new Date();
    const duplicateWindowStart = new Date(now.getTime() - DUPLICATE_SUBMISSION_WINDOW_MS);

    await prisma.$transaction(async (tx) => {
      // Double-tap guard: a second identical submit (same trial + new planned
      // day) inside the window records nothing more — the first submit already
      // wrote the MissedTrialEvent + re-plan and its ActivityLog.
      const recentMissed = await tx.missedTrialEvent.findMany({
        where: { trialEventId: delayedTrial.id, createdAt: { gte: duplicateWindowStart } },
        select: { trialEventId: true, newPlannedDate: true, createdAt: true }
      });
      if (
        recentMissed.some((existing) =>
          isDuplicateMissedTrialSubmission(existing, { trialEventId: delayedTrial.id, newPlannedDate }, now)
        )
      ) {
        return;
      }

      const missed = await tx.missedTrialEvent.create({
        data: {
          moldTrialProjectId: project.id,
          trialEventId: delayedTrial.id,
          plannedDate,
          newPlannedDate,
          reasonCategory,
          responsibleArea,
          explanation: value(formData, "explanation"),
          createdById: actor.id
        }
      });

      const planned = await tx.trialEvent.update({
        where: { id: delayedTrial.id },
        data: {
          plannedDate: newPlannedDate,
          status: "PLANNED",
          planReasonCategory: "OTHER",
          planReasonDetail: `Replanned after missed trial: ${value(formData, "explanation")}`,
          sourceArea: "PLANNING",
          requestedById: actor.id,
          // PM re-dated the trial: the confirmation handshake restarts.
          dateConfirmationStatus: "PENDING_CONFIRMATION",
          dateConfirmedById: null,
          dateConfirmedAt: null,
          ...clearedProposalFields()
        }
      });

      await tx.moldTrialProject.update({
        where: { id: project.id },
        data: {
          status: "TRIAL_DELAYED",
          nextPlannedTrialDate: newPlannedDate
        }
      });

      await logActivity(tx, {
        actorUserId: actor.id,
        entityType: "MissedTrialEvent",
        entityId: missed.id,
        action: "recorded_missed_trial",
        afterJson: { reasonCategory: missed.reasonCategory, newPlannedDate: activityDate(missed.newPlannedDate) }
      });
      await logActivity(tx, {
        actorUserId: actor.id,
        entityType: "TrialEvent",
        entityId: planned.id,
        action: "replanned_same_trial_stage",
        beforeJson: { plannedDate: activityDate(delayedTrial.plannedDate), status: delayedTrial.status },
        afterJson: {
          trialStage: trialStageLabel(planned.sequenceNumber),
          plannedDate: activityDate(planned.plannedDate),
          status: planned.status
        }
      });
    });

    revalidatePath("/");
    revalidatePath(fallback);
    redirectWithMessage(fallback, "success", "Missed trial recorded.");
  } catch (error) {
    if (isRedirectSignal(error)) {
      throw error;
    }

    redirectWithMessage(fallback, "error", friendlyActionErrorMessage(error, "Unable to record missed trial."));
  }
}

export async function resolveAutoMissedTrial(formData: FormData) {
  const projectCode = value(formData, "projectCode");
  const fallback = redirectPath(formData, `/projects/${projectCode}`);

  try {
    const privacy = assertNoCustomerIdentity(formData);
    if (!privacy.ok) {
      redirectWithMessage(fallback, "error", firstValidationMessage(privacy));
    }

    const mode = autoMissedResolutionMode(value(formData, "resolutionMode"));
    const actor = await getActor(
      mode === "MISSED" ? ["trial.missed.record", "trial.schedule.reschedule"] : "trial.missed.record"
    );
    const trialEventId = value(formData, "trialEventId");
    const project = await prisma.moldTrialProject.findUnique({
      where: { projectCode },
      include: {
        trialEvents: {
          orderBy: [{ sequenceNumber: "desc" }]
        }
      }
    });

    if (project == null) {
      throw new Error("Project not found.");
    }

    assertProjectHasMoldCode(project);
    await assertProjectHasActivePart(project.id);

    const trial = project.trialEvents.find((event) => event.id === trialEventId);
    if (trial == null) {
      redirectWithMessage(fallback, "error", "Auto-missed trial event is required.");
    }

    // Idempotency guard: once this auto-missed trial has been resolved (the
    // column is stamped), a second submit is a graceful success — no duplicate
    // MissedTrialEvent, no duplicate ActivityLog, no second re-plan.
    if (trial.autoMissedResolvedAt != null) {
      redirectWithMessage(fallback, "success", "Auto-missed trial already resolved.");
    }

    if (trial.status !== "AUTO_MISSED_REASON_REQUIRED") {
      redirectWithMessage(fallback, "error", "Only auto-missed trials can be resolved from this panel.");
    }

    const explanation = value(formData, "explanation");
    const reasonCategoryRaw = value(formData, "reasonCategory");
    const responsibleAreaRaw = value(formData, "responsibleArea");
    const newPlannedDate = formDate(formData, "newPlannedDate");
    const validation = validateAutoMissedResolution({
      mode,
      plannedDate: trial.plannedDate,
      newPlannedDate,
      reasonCategory: missedTrialReasonLabels[reasonCategoryRaw],
      responsibleArea: responsibleAreaLabels[responsibleAreaRaw],
      explanation
    });

    if (!validation.ok) {
      redirectWithMessage(fallback, "error", firstValidationMessage(validation));
    }

    if (mode === "MISSED") {
      const reasonCategory = toDbEnum(reasonCategoryRaw, missedTrialReasonValues, "missed-trial reason");
      const responsibleArea = toDbEnum(responsibleAreaRaw, responsibleAreaValues, "responsible area");

      if (newPlannedDate == null) {
        redirectWithMessage(fallback, "error", "Confirmed missed trial requires new planned date.");
      }

      const missedOutcome = await prisma.$transaction(async (tx) => {
        // Precondition guard: resolve the trial only while it is still awaiting a
        // reason and unresolved. A concurrent/second submit finds count === 0 and
        // writes no MissedTrialEvent, no project change, no ActivityLog.
        const claimed = await tx.trialEvent.updateMany({
          where: { id: trial.id, status: "AUTO_MISSED_REASON_REQUIRED", autoMissedResolvedAt: null },
          data: {
            plannedDate: newPlannedDate,
            status: "PLANNED",
            planReasonCategory: "PLANNED_NEXT_TRIAL_AFTER_CORRECTION",
            planReasonDetail: `Auto-missed trial replanned: ${explanation}`,
            sourceArea: "PLANNING",
            requestedById: actor.id,
            autoMissedResolvedAt: new Date(),
            autoMissedResolvedById: actor.id,
            autoMissedResolution: "MISSED_CONFIRMED",
            // PM set a new planned date: the confirmation handshake restarts.
            dateConfirmationStatus: "PENDING_CONFIRMATION",
            dateConfirmedById: null,
            dateConfirmedAt: null,
            ...clearedProposalFields()
          }
        });

        if (claimed.count === 0) {
          return { resolved: false as const };
        }

        const missed = await tx.missedTrialEvent.create({
          data: {
            moldTrialProjectId: project.id,
            trialEventId: trial.id,
            plannedDate: trial.plannedDate,
            newPlannedDate,
            reasonCategory,
            responsibleArea,
            explanation,
            createdById: actor.id
          }
        });

        await tx.moldTrialProject.update({
          where: { id: project.id },
          data: {
            status: "TRIAL_DELAYED",
            nextPlannedTrialDate: newPlannedDate
          }
        });

        await logActivity(tx, {
          actorUserId: actor.id,
          entityType: "MissedTrialEvent",
          entityId: missed.id,
          action: "confirmed_auto_missed_trial",
          afterJson: {
            reasonCategory: missed.reasonCategory,
            responsibleArea: missed.responsibleArea,
            newPlannedDate: activityDate(missed.newPlannedDate)
          }
        });
        await logActivity(tx, {
          actorUserId: actor.id,
          entityType: "TrialEvent",
          entityId: trial.id,
          action: "resolved_auto_missed_as_truly_missed",
          beforeJson: { status: trial.status, autoMissedAt: trial.autoMissedAt?.toISOString() ?? null },
          afterJson: {
            trialStage: trialStageLabel(trial.sequenceNumber),
            status: "PLANNED",
            plannedDate: activityDate(newPlannedDate),
            autoMissedResolution: "MISSED_CONFIRMED"
          }
        });

        return { resolved: true as const };
      });

      revalidatePath("/");
      revalidatePath(fallback);
      redirectWithMessage(
        fallback,
        "success",
        missedOutcome.resolved ? "Auto-missed trial resolved as missed." : "Auto-missed trial already resolved."
      );
    }

    const projectStatus: PrismaMoldTrialProjectStatus = mode === "BLOCKED" ? "BLOCKED" : "PAUSED";
    const autoMissedResolution = mode === "BLOCKED" ? "BLOCKED" : "PAUSED";

    const blockedOutcome = await prisma.$transaction(async (tx) => {
      // Precondition guard: same idempotency window as the MISSED path — only the
      // first submit transitions the still-unresolved auto-missed trial.
      const claimed = await tx.trialEvent.updateMany({
        where: { id: trial.id, status: "AUTO_MISSED_REASON_REQUIRED", autoMissedResolvedAt: null },
        data: {
          status: "DELAYED",
          autoMissedResolvedAt: new Date(),
          autoMissedResolvedById: actor.id,
          autoMissedResolution
        }
      });

      if (claimed.count === 0) {
        return { resolved: false as const };
      }

      await tx.moldTrialProject.update({
        where: { id: project.id },
        data: {
          status: projectStatus
        }
      });

      await logActivity(tx, {
        actorUserId: actor.id,
        entityType: "TrialEvent",
        entityId: trial.id,
        action: mode === "BLOCKED" ? "resolved_auto_missed_as_blocked" : "resolved_auto_missed_as_paused",
        beforeJson: { status: trial.status, autoMissedAt: trial.autoMissedAt?.toISOString() ?? null },
        afterJson: {
          status: "DELAYED",
          projectStatus,
          autoMissedResolution,
          explanation
        }
      });

      return { resolved: true as const };
    });

    revalidatePath("/");
    revalidatePath(fallback);
    redirectWithMessage(
      fallback,
      "success",
      blockedOutcome.resolved
        ? mode === "BLOCKED"
          ? "Project marked blocked."
          : "Project marked paused."
        : "Auto-missed trial already resolved."
    );
  } catch (error) {
    if (isRedirectSignal(error)) {
      throw error;
    }

    redirectWithMessage(fallback, "error", friendlyActionErrorMessage(error, "Unable to resolve auto-missed trial."));
  }
}

export async function recordCompletedTrial(formData: FormData) {
  const projectCode = value(formData, "projectCode");
  const fallback = redirectPath(formData, `/projects/${projectCode}`);

  try {
    const privacy = assertNoCustomerIdentity(formData);
    if (!privacy.ok) {
      redirectWithMessage(fallback, "error", firstValidationMessage(privacy));
    }

    const actor = await getActor("trial.record.completed");
    const trialEventId = value(formData, "trialEventId");
    const actualDate = formDate(formData, "actualDate");
    const resultRaw = value(formData, "result");
    const outcomeNote = optionalValue(formData, "outcomeNote");
    const sampleQuantity = optionalInteger(formData, "sampleQuantity");
    const injectionMachineId = optionalValue(formData, "injectionMachineId");
    const project = await prisma.moldTrialProject.findUnique({
      where: { projectCode },
      include: {
        trialIssues: {
          where: { foundAtTrialEventId: trialEventId },
          select: { id: true }
        }
      }
    });

    if (project == null) {
      throw new Error("Project not found.");
    }

    assertProjectHasMoldCode(project);
    await assertProjectHasActivePart(project.id);

    if (trialEventId.length === 0) {
      redirectWithMessage(fallback, "error", "Trial event is required.");
    }

    const result = toDbEnum(resultRaw, trialResultValues, "trial result");
    const validation = validateCompletedTrialFinalization(
      {
        trialCode: "T0",
        plannedDate: new Date(),
        actualDate,
        status: "Completed",
        result: trialResultLabels[resultRaw],
        outcomeNote
      },
      {
        linkedIssueCount: project.trialIssues.length
      }
    );

    if (!validation.ok || actualDate == null) {
      redirectWithMessage(fallback, "error", firstValidationMessage(validation));
    }

    const outcomeDisposition = legacyOutcomeDispositionForResult(result);
    const selectedInjectionMachine =
      injectionMachineId == null
        ? null
        : await prisma.injectionMachine.findUnique({
            where: { id: injectionMachineId },
            select: {
              id: true,
              machineNo: true,
              displayName: true,
              model: true,
              brand: true,
              tonnage: true,
              active: true
            }
          });

    if (injectionMachineId != null && selectedInjectionMachine == null) {
      throw new Error("Selected injection machine was not found.");
    }

    if (selectedInjectionMachine != null && !selectedInjectionMachine.active) {
      throw new Error("Archived injection machines cannot be selected for new trial records.");
    }

    const machineSnapshot =
      selectedInjectionMachine == null ? null : snapshotInjectionMachine(selectedInjectionMachine);

    await prisma.$transaction(async (tx) => {
      const before = await tx.trialEvent.findUnique({ where: { id: trialEventId } });

      if (before == null) {
        throw new Error("Trial event not found.");
      }

      if (before.moldTrialProjectId !== project.id) {
        throw new Error("Trial event does not belong to this project.");
      }

      const wasAutoMissed = before.status === "AUTO_MISSED_REASON_REQUIRED";
      if (before.status !== "PLANNED" && before.status !== "AT_RISK" && !wasAutoMissed) {
        throw new Error("Only current planned, at-risk, or auto-missed trials can be recorded as completed.");
      }

      const status: PrismaTrialStatus = result === "PENDING_QC" || result === "PENDING_CUSTOMER_FEEDBACK"
        ? "PENDING_FOLLOW_UP"
        : "COMPLETED";
      const trial = await tx.trialEvent.update({
        where: { id: trialEventId },
        data: {
          actualDate,
          status,
          result,
          outcomeDisposition,
          outcomeNote,
          followUpOwnerId: null,
          followUpDueDate: null,
          ...(selectedInjectionMachine == null || machineSnapshot == null
            ? {}
            : {
                injectionMachineId: selectedInjectionMachine.id,
                machineNoSnapshot: machineSnapshot.machineNoSnapshot,
                machineTonnageSnapshot: machineSnapshot.machineTonnageSnapshot,
                machine: machineSnapshot.machineDisplayText
              }),
          sampleQuantity,
          mainIssuesSummary: optionalValue(formData, "mainIssuesSummary"),
          countsAgainstLimit: true,
          ...(wasAutoMissed
            ? {
                autoMissedResolvedAt: new Date(),
                autoMissedResolvedById: actor.id,
                autoMissedResolution: "LATE_COMPLETED_TRIAL_ENTERED" as const
              }
            : {})
        }
      });

      await tx.moldTrialProject.update({
        where: { id: project.id },
        data: {
          status: projectStatusAfterTrial(outcomeDisposition)
        }
      });

      await logActivity(tx, {
        actorUserId: actor.id,
        entityType: "TrialEvent",
        entityId: trial.id,
        action: "recorded_completed_trial",
        beforeJson: { status: before.status, actualDate: activityDate(before.actualDate) },
          afterJson: {
            status: trial.status,
            actualDate: activityDate(trial.actualDate),
            result: trial.result,
            machineNoSnapshot: trial.machineNoSnapshot
          }
      });

      if (wasAutoMissed) {
        await logActivity(tx, {
          actorUserId: actor.id,
          entityType: "TrialEvent",
          entityId: trial.id,
          action: "corrected_auto_missed_by_late_completed_trial",
          beforeJson: {
            status: before.status,
            autoMissedAt: before.autoMissedAt?.toISOString() ?? null
          },
          afterJson: {
            status: trial.status,
            actualDate: activityDate(trial.actualDate),
            autoMissedResolution: trial.autoMissedResolution
          }
        });
      }
    });

    revalidatePath("/");
    revalidatePath(fallback);
    redirectWithMessage(fallback, "success", "Completed trial recorded.");
  } catch (error) {
    if (isRedirectSignal(error)) {
      throw error;
    }

    redirectWithMessage(fallback, "error", friendlyActionErrorMessage(error, "Unable to record completed trial."));
  }
}

export type ProcessSheetSaveState = {
  ok: boolean;
  message: string | null;
  savedAt: string | null;
  changedCount: number;
  savedFieldCount: number;
};

async function saveTrialProcessSheetValuesCore(formData: FormData): Promise<ProcessSheetSaveState> {
  const projectCode = value(formData, "projectCode");
  const fallback = redirectPath(formData, `/projects/${projectCode}`).split("#")[0];

  const privacy = assertNoCustomerIdentity(formData);
  if (!privacy.ok) {
    throw new Error(firstValidationMessage(privacy));
  }

  const actor = await getActor("trial.process_sheet.edit");
  const trialEventId = value(formData, "trialEventId");
  const parameterIds = values(formData, "processParameterId");
  const injectionMachineId = optionalValue(formData, "injectionMachineId");

  if (trialEventId.length === 0) {
    throw new Error("Trial event is required.");
  }

  if (parameterIds.length === 0) {
    throw new Error("Process sheet has no editable parameters.");
  }

  const project = await prisma.moldTrialProject.findUnique({
    where: { projectCode },
    include: {
      processSheetTemplate: {
        include: {
          parameters: {
            where: { active: true },
            orderBy: [{ sortOrder: "asc" }]
          }
        }
      },
      trialEvents: {
        orderBy: [{ sequenceNumber: "asc" }, { plannedDate: "asc" }]
      },
      processValues: {
        where: { trialEventId },
        select: {
          processSheetParameterId: true,
          valueText: true,
          valueNumber: true,
          valueDate: true
        }
      }
    }
  });

  if (project == null) {
    throw new Error("Project not found.");
  }

  assertProjectHasMoldCode(project);

  const trial = project.trialEvents.find((event) => event.id === trialEventId);
  if (trial == null) {
    throw new Error("Trial event does not belong to this project.");
  }

  const editableTrialEventId = currentProcessSheetEditableTrialId(project.trialEvents);
  if (!isProcessSheetColumnEditable({ trialEventId, currentEditableTrialEventId: editableTrialEventId })) {
    throw new Error("Only the current trial process-sheet column can be edited.");
  }

  if (project.processSheetTemplate == null) {
    throw new Error("This project does not have a process-sheet template assigned.");
  }

  const parametersById = new Map(project.processSheetTemplate.parameters.map((parameter) => [parameter.id, parameter]));
  const parameters = parameterIds.flatMap((parameterId) => {
    const parameter = parametersById.get(parameterId);
    if (parameter == null) {
      throw new Error("One or more process-sheet parameters were not found.");
    }

    return isProcessSheetSummaryParameter(parameter.parameterKey) ? [] : [parameter];
  });

  if (parameters.length === 0) {
    throw new Error("Process sheet has no editable process parameters.");
  }

  const selectedInjectionMachine =
    injectionMachineId == null
      ? null
      : await prisma.injectionMachine.findUnique({
          where: { id: injectionMachineId },
          select: {
            id: true,
            machineNo: true,
            displayName: true,
            model: true,
            brand: true,
            tonnage: true,
            active: true
          }
        });

  if (injectionMachineId != null && selectedInjectionMachine == null) {
    throw new Error("Selected injection machine was not found.");
  }

  if (selectedInjectionMachine != null && !selectedInjectionMachine.active) {
    throw new Error("Archived injection machines cannot be selected for process-sheet entry.");
  }

  const machineSnapshot =
    selectedInjectionMachine == null ? null : snapshotInjectionMachine(selectedInjectionMachine);
  const existingValueByParameter = new Map(
    project.processValues.map((processValue) => [processValue.processSheetParameterId, processValue])
  );
  const parsedValues = parameters.map((parameter) => {
    const raw = optionalValue(formData, `value:${parameter.id}`);
    const parsed = parseProcessValue({
      raw,
      valueType: parameter.valueType,
      fieldLabel: parameter.labelEn
    });
    const previous = existingValueByParameter.get(parameter.id);
    const changed =
      processValueComparisonText(parsed) !==
      processValueComparisonText(previous ?? { valueText: null, valueNumber: null, valueDate: null });

    return { parameter, parsed, changed };
  });
  const machineChanged = selectedInjectionMachine != null && selectedInjectionMachine.id !== trial.injectionMachineId;
  const changedCount = parsedValues.filter((parsed) => parsed.changed).length + (machineChanged ? 1 : 0);

  await prisma.$transaction(async (tx) => {
    if (selectedInjectionMachine != null && machineSnapshot != null) {
      await tx.trialEvent.update({
        where: { id: trialEventId },
        data: {
          injectionMachineId: selectedInjectionMachine.id,
          machineNoSnapshot: machineSnapshot.machineNoSnapshot,
          machineTonnageSnapshot: machineSnapshot.machineTonnageSnapshot,
          machine: machineSnapshot.machineDisplayText
        }
      });
    }

    for (const { parameter, parsed } of parsedValues) {
      await tx.trialProcessValue.upsert({
        where: {
          trialEventId_processSheetParameterId: {
            trialEventId,
            processSheetParameterId: parameter.id
          }
        },
        update: {
          parameterKeySnapshot: parameter.parameterKey,
          labelEnSnapshot: parameter.labelEn,
          labelZhSnapshot: parameter.labelZh,
          unitSnapshot: parameter.unit,
          valueText: parsed.valueText,
          valueNumber: parsed.valueNumber,
          valueDate: parsed.valueDate,
          customerVisible: parameter.customerVisible,
          enteredById: actor.id
        },
        create: {
          moldTrialProjectId: project.id,
          trialEventId,
          processSheetParameterId: parameter.id,
          parameterKeySnapshot: parameter.parameterKey,
          labelEnSnapshot: parameter.labelEn,
          labelZhSnapshot: parameter.labelZh,
          unitSnapshot: parameter.unit,
          valueText: parsed.valueText,
          valueNumber: parsed.valueNumber,
          valueDate: parsed.valueDate,
          customerVisible: parameter.customerVisible,
          enteredById: actor.id
        }
      });
    }

    await logActivity(tx, {
      actorUserId: actor.id,
      entityType: "TrialEvent",
      entityId: trialEventId,
      action: "saved_trial_process_sheet",
      afterJson: {
        projectCode,
        changedParameterCount: changedCount,
        savedParameterCount: parameters.length,
        machineNoSnapshot: machineSnapshot?.machineNoSnapshot ?? trial.machineNoSnapshot ?? null
      }
    });
  });

  revalidatePath(fallback);
  return {
    ok: true,
    message: "Process sheet saved.",
    savedAt: new Date().toISOString(),
    changedCount,
    savedFieldCount: parameters.length + (selectedInjectionMachine != null ? 1 : 0)
  };
}

export async function saveTrialProcessSheetValues(
  _previousState: ProcessSheetSaveState,
  formData: FormData
): Promise<ProcessSheetSaveState> {
  try {
    return await saveTrialProcessSheetValuesCore(formData);
  } catch (error) {
    if (isRedirectSignal(error)) {
      throw error;
    }

    return {
      ok: false,
      message: friendlyActionErrorMessage(error, "Unable to save process sheet."),
      savedAt: null,
      changedCount: 0,
      savedFieldCount: 0
    };
  }
}

export type ProcessSheetPdfExportState = {
  success: boolean;
  attachmentId: string | null;
  fileName: string | null;
  error: string | null;
};

export async function exportProcessSheetPdf(
  _previousState: ProcessSheetPdfExportState,
  formData: FormData
): Promise<ProcessSheetPdfExportState> {
  const projectCode = value(formData, "projectCode");

  try {
    const actor = await getActor("trial.process_sheet.export_pdf");
    const project = await prisma.moldTrialProject.findUnique({
      where: { projectCode },
      include: {
        processSheetTemplate: {
          include: {
            parameters: {
              where: { active: true },
              orderBy: [{ sortOrder: "asc" }]
            }
          }
        },
        trialEvents: {
          orderBy: [{ sequenceNumber: "asc" }, { plannedDate: "asc" }]
        },
        trialIssues: {
          include: {
            foundAtTrialEvent: {
              select: {
                trialCode: true,
                sequenceNumber: true
              }
            }
          },
          orderBy: [{ createdAt: "asc" }]
        },
        processValues: {
          include: {
            processSheetParameter: true
          }
        }
      }
    });

    if (project == null) {
      throw new Error("Project not found.");
    }

    if (project.processSheetTemplate == null) {
      throw new Error("This project does not have a process-sheet template assigned.");
    }

    const valueByTrialAndParameter = new Map(
      project.processValues.map((processValue) => [
        `${processValue.trialEventId}:${processValue.processSheetParameterId}`,
        processValue
      ])
    );
    const processRows = project.processSheetTemplate.parameters
      .filter((parameter) => !isProcessSheetSummaryParameter(parameter.parameterKey))
      .map((parameter) => ({
        label: `${parameter.labelEn}${parameter.unit == null ? "" : ` (${parameter.unit})`}`,
        customerVisible: parameter.customerVisible,
        values: project.trialEvents.map((trial) => {
          const processValue = valueByTrialAndParameter.get(`${trial.id}:${parameter.id}`);
          if (processValue == null) {
            return "-";
          }

          if (processValue.valueNumber != null) {
            return String(processValue.valueNumber);
          }

          if (processValue.valueDate != null) {
            return activityDate(processValue.valueDate) ?? "-";
          }

          return processValue.valueText ?? "-";
        })
      }));
    const trialSummaries = project.trialEvents.map((trial) => {
      const code = trialStageLabel(trial.sequenceNumber);
      const result = trial.result == null ? "No result" : trialResultLabels[trial.result];

      return `${code}: ${result}`;
    });
    const exportText = buildCustomerSafeProcessSheetExport({
      projectIdentifier: project.moldCode.trim().length > 0 ? project.moldCode : project.projectCode,
      trialSummaries,
      processRows,
      issues: project.trialIssues.map((issue) => ({
        title:
          issue.foundAtTrialEvent == null
            ? issue.title
            : `${issue.title} (${trialStageLabel(issue.foundAtTrialEvent.sequenceNumber)})`,
        status: issueStatusLabels[issue.status],
        correctionSummary: issue.correctiveAction,
        rootCause: issue.rootCause,
        rootCauseApproved: issue.status === "VERIFIED" || issue.status === "CLOSED",
        internalOwner: issue.ownerUserId,
        assemblySelfCheckNote: issue.assemblySelfCheckNote
      })),
      nextStep: project.trialEvents.at(-1)?.nextAction ?? project.trialEvents.at(-1)?.planReasonDetail ?? null
    });
    const fileName = `${project.projectCode}-process-sheet-${Date.now()}.pdf`;
    const attachmentId = randomUUID();
    const pdfBuffer = await createSimplePdfBuffer(exportText);
    const { storageKey, sizeBytes } = await writeAttachmentFile({
      id: attachmentId,
      extension: "pdf",
      data: pdfBuffer
    });

    await prisma.$transaction(async (tx) => {
      const attachment = await tx.fileAttachment.create({
        data: {
          id: attachmentId,
          moldTrialProjectId: project.id,
          entityType: "PROCESS_SHEET_EXPORT",
          entityId: project.id,
          fileName,
          fileType: "PROCESS_SHEET_PDF",
          storageKey,
          contentType: "application/pdf",
          sizeBytes,
          visibility: "CUSTOMER_SAFE",
          uploadedById: actor.id
        }
      });

      await logActivity(tx, {
        actorUserId: actor.id,
        entityType: "FileAttachment",
        entityId: attachment.id,
        action: "exported_process_sheet_pdf",
        afterJson: {
          projectCode,
          attachmentId: attachment.id,
          fileName,
          sizeBytes: attachment.sizeBytes,
          visibility: attachment.visibility
        }
      });
    });

    revalidatePath(`/projects/${projectCode}`);
    return {
      success: true,
      attachmentId,
      fileName,
      error: null
    };
  } catch (error) {
    if (isRedirectSignal(error)) {
      throw error;
    }

    return {
      success: false,
      attachmentId: null,
      fileName: null,
      error: friendlyActionErrorMessage(error, "Unable to export process sheet PDF.")
    };
  }
}

export async function addNewPlannedTrial(formData: FormData) {
  const projectCode = value(formData, "projectCode");
  const fallback = redirectPath(formData, `/projects/${projectCode}`);

  try {
    const privacy = assertNoCustomerIdentity(formData);
    if (!privacy.ok) {
      redirectWithMessage(fallback, "error", firstValidationMessage(privacy));
    }

    const actor = await getActor("trial.schedule.reschedule");
    const requester = await findUserByUsername(value(formData, "requesterUsername") || actor.username, "Requester");
    const project = await prisma.moldTrialProject.findUnique({
      where: { projectCode },
      include: {
        designChanges: {
          select: {
            firstCompletedTrialAlreadyDone: true,
            grantsExtraTrial: true,
            extraTrialCount: true,
            approvedById: true,
            approvalReason: true
          }
        },
        trialEvents: {
          select: {
            id: true,
            trialCode: true,
            sequenceNumber: true,
            plannedDate: true,
            actualDate: true,
            status: true,
            result: true,
            outcomeDisposition: true,
            countsAgainstLimit: true,
            planReasonCategory: true,
            planReasonDetail: true,
            relatedDesignChangeEventId: true
          }
        },
        trialIssues: {
          select: {
            id: true,
            title: true,
            status: true,
            foundAtTrialEvent: {
              select: {
                sequenceNumber: true
              }
            }
          }
        },
        trialLimitAdjustments: {
          select: {
            adjustmentType: true,
            deltaTrials: true,
            reason: true
          }
        }
      }
    });
    const plannedDate = formDate(formData, "plannedDate");
    const planReasonCategoryRaw = value(formData, "planReasonCategory");
    const sourceAreaRaw = value(formData, "sourceArea");
    const planReasonCategory = toDbEnum(planReasonCategoryRaw, newTrialReasonValues, "new-trial reason");
    const sourceArea = toDbEnum(sourceAreaRaw, sourceAreaValues, "source area");
    const planReasonDetail = optionalValue(formData, "planReasonDetail");

    if (project == null) {
      throw new Error("Project not found.");
    }

    assertProjectHasMoldCode(project);
    await assertProjectHasActivePart(project.id);

    const validation = validateNewPlannedTrial(
      {
        trialCode: "T0",
        plannedDate,
        status: "Planned",
        planReasonCategory: newTrialReasonLabels[planReasonCategory],
        planReasonDetail,
        requestedById: requester.id,
        sourceArea: sourceAreaLabels[sourceArea]
      },
      { actorRole: actor.roleCode }
    );

    if (!validation.ok || plannedDate == null) {
      redirectWithMessage(fallback, "error", firstValidationMessage(validation));
    }

    const nextSequenceNumber = project.trialEvents.reduce(
      (maxSequence, trial) => Math.max(maxSequence, trial.sequenceNumber),
      0
    ) + 1;
    const nextStageValidation = validateNextTrialStageCreation({
      nextSequenceNumber,
      trialEvents: project.trialEvents.map((trial) => ({
        id: trial.id,
        trialCode: trialCodeLabels[trial.trialCode],
        sequenceNumber: trial.sequenceNumber,
        plannedDate: trial.plannedDate,
        actualDate: trial.actualDate,
        status: trialStatusLabels[trial.status],
        result: trial.result == null ? null : trialResultLabels[trial.result],
        outcomeDisposition: trial.outcomeDisposition == null ? null : outcomeDispositionLabels[trial.outcomeDisposition],
        countsAgainstLimit: trial.countsAgainstLimit,
        planReasonCategory: trial.planReasonCategory == null ? null : newTrialReasonLabels[trial.planReasonCategory],
        planReasonDetail: trial.planReasonDetail,
        relatedDesignChangeEventId: trial.relatedDesignChangeEventId
      })),
      issues: project.trialIssues.map((issue) => ({
        id: issue.id,
        title: issue.title,
        status: issueStatusLabels[issue.status],
        foundAtTrialSequenceNumber: issue.foundAtTrialEvent?.sequenceNumber ?? null
      }))
    });

    if (!nextStageValidation.ok) {
      redirectWithMessage(fallback, "error", firstValidationMessage(nextStageValidation));
    }

    const extraPanelValidation = validateExtraTrialPanelCreation({
      nextSequenceNumber,
      trialEvents: project.trialEvents.map((trial) => ({
        id: trial.id,
        trialCode: trialCodeLabels[trial.trialCode],
        sequenceNumber: trial.sequenceNumber,
        plannedDate: trial.plannedDate,
        actualDate: trial.actualDate,
        status: trialStatusLabels[trial.status],
        result: trial.result == null ? null : trialResultLabels[trial.result],
        outcomeDisposition: trial.outcomeDisposition == null ? null : outcomeDispositionLabels[trial.outcomeDisposition],
        countsAgainstLimit: trial.countsAgainstLimit,
        planReasonCategory: trial.planReasonCategory == null ? null : newTrialReasonLabels[trial.planReasonCategory],
        planReasonDetail: trial.planReasonDetail,
        relatedDesignChangeEventId: trial.relatedDesignChangeEventId
      })),
      designChanges: project.designChanges,
      trialLimitAdjustments: project.trialLimitAdjustments,
      candidateReasonCategory: newTrialReasonLabels[planReasonCategory],
      candidateReasonDetail: planReasonDetail
    });

    if (!extraPanelValidation.ok) {
      redirectWithMessage(fallback, "error", firstValidationMessage(extraPanelValidation));
    }

    const trialCode = dbTrialCodeForSequence(nextSequenceNumber);
    const designChangeRequestedByRaw = value(formData, "designChangeRequestedBy");
    const createsDesignChangeAllowance =
      nextSequenceNumber > DEFAULT_TRIAL_PANEL_COUNT &&
      isDesignChangeRelatedReason(planReasonCategory) &&
      designChangeRequestedByRaw !== noDesignChangeRequesterValue;

    if (createsDesignChangeAllowance) {
      await requirePermissions(actor.id, ["trial.design_change.report", "trial.design_change.approve_extra_trial"]);
    }

    const now = new Date();
    const duplicateWindowStart = new Date(now.getTime() - DUPLICATE_SUBMISSION_WINDOW_MS);

    await prisma.$transaction(async (tx) => {
      // Double-tap guard: same project + planned day + trial code created within
      // the window means the first submit already added this trial (and any
      // design-change allowance) — skip the duplicate create entirely.
      const recentTrials = await tx.trialEvent.findMany({
        where: { moldTrialProjectId: project.id, createdAt: { gte: duplicateWindowStart } },
        select: { moldTrialProjectId: true, plannedDate: true, trialCode: true, createdAt: true }
      });
      if (
        recentTrials.some((existing) =>
          isDuplicateTrialSubmission(existing, { moldTrialProjectId: project.id, plannedDate, trialCode }, now)
        )
      ) {
        return;
      }

      let relatedDesignChangeEventId: string | null = null;

      if (createsDesignChangeAllowance) {
        const requestedBy = toDbEnum(
          designChangeRequestedByRaw,
          changeRequesterValues,
          "design change requester type"
        );
        const designChangeTitle =
          optionalValue(formData, "designChangeTitle") ??
          `Design change extra-trial reason for ${trialStageLabel(nextSequenceNumber)}`;
        const designChangeDescription = planReasonDetail ?? designChangeTitle;
        const result = await applyDesignChangeEvent(tx, {
          project,
          actor: {
            id: actor.id,
            roleCode: actor.roleCode
          },
          changeDate: formDate(formData, "designChangeDate") ?? plannedDate,
          requestedBy,
          title: designChangeTitle,
          description: designChangeDescription,
          approveExtraTrial: true,
          approvalReason: planReasonDetail ?? designChangeDescription
        });

        relatedDesignChangeEventId = result.designChange.id;
      }

      const trial = await tx.trialEvent.create({
        data: {
          moldTrialProjectId: project.id,
          trialCode,
          sequenceNumber: nextSequenceNumber,
          plannedDate,
          status: "PLANNED",
          dateConfirmationStatus: "PENDING_CONFIRMATION",
          planReasonCategory,
          planReasonDetail,
          sourceArea,
          requestedById: requester.id,
          relatedDesignChangeEventId,
          countsAgainstLimit: false,
          createdById: actor.id
        }
      });

      await tx.moldTrialProject.update({
        where: { id: project.id },
        data: {
          status: "WAITING_TRIAL",
          nextPlannedTrialDate: plannedDate
        }
      });

      await logActivity(tx, {
        actorUserId: actor.id,
        entityType: "TrialEvent",
        entityId: trial.id,
        action: "added_new_planned_trial",
        afterJson: {
          trialStage: trialStageLabel(trial.sequenceNumber),
          trialCode: trial.trialCode,
          plannedDate: activityDate(trial.plannedDate),
          planReasonCategory: trial.planReasonCategory
        }
      });
    });

    revalidatePath("/");
    revalidatePath(fallback);
    redirectWithMessage(fallback, "success", "New planned trial added.");
  } catch (error) {
    if (isRedirectSignal(error)) {
      throw error;
    }

    redirectWithMessage(fallback, "error", friendlyActionErrorMessage(error, "Unable to add planned trial."));
  }
}

export async function createTrialIssue(formData: FormData) {
  const projectCode = value(formData, "projectCode");
  const fallback = redirectPath(formData, `/projects/${projectCode}`);

  try {
    const privacy = assertNoCustomerIdentity(formData);
    if (!privacy.ok) {
      redirectWithMessage(fallback, "error", firstValidationMessage(privacy));
    }

    const actor = await getActor("trial.issue.create");
    const project = await prisma.moldTrialProject.findUnique({ where: { projectCode } });
    const ownerUsername = optionalValue(formData, "ownerUsername");
    const explicitOwnerGroupCode = optionalValue(formData, "ownerGroupCode");
    const ownerUser = ownerUsername == null ? null : await findUserByUsername(ownerUsername, "Owner");
    const foundAtTrialEventId = optionalValue(formData, "foundAtTrialEventId");
    const issueTypeRaw = value(formData, "issueType");
    // R1 (blame-free intake): the create form never names a person. When neither
    // an owner user nor an explicit department override is supplied, route the
    // issue to the department inbox its type belongs to, so it lands in a queue a
    // whole role watches instead of on one named individual. An explicit owner or
    // department override (e.g. from the edit tools) still flows through unchanged.
    const ownerGroupCode =
      ownerUser == null && explicitOwnerGroupCode == null
        ? defaultOwnerGroupCodeForIssueType(issueTypeRaw)
        : explicitOwnerGroupCode;
    const ownerGroup =
      ownerGroupCode == null
        ? null
        : await prisma.departmentGroup.findUnique({ where: { code: ownerGroupCode } });
    const sourceRaw = value(formData, "source");
    const severityRaw = value(formData, "severity");
    const statusRaw = value(formData, "status");
    const selectedAffectedPartId = optionalValue(formData, "affectedPartId");
    const affectedScopeRaw = optionalValue(formData, "affectedScope") ?? (selectedAffectedPartId == null ? "MOLD" : "PART");
    const affectedScope = toDbEnum(affectedScopeRaw, issueAffectedScopeValues, "affected scope", "MOLD");
    const affectedPartId = affectedScope === "PART" ? optionalValue(formData, "affectedPartId") : null;
    const affectedCavityNote = optionalValue(formData, "affectedCavityNote");
    const dueDate = formDate(formData, "dueDate");

    if (project == null) {
      throw new Error("Project not found.");
    }

    assertProjectHasMoldCode(project);

    await resolveAffectedPart({
      projectId: project.id,
      affectedScope,
      affectedPartId
    });

    if (ownerGroupCode != null && ownerGroup == null) {
      throw new Error(`Owner group ${ownerGroupCode} was not found. Run prisma:seed first.`);
    }

    const validation = validateTrialIssueCreate({
      title: value(formData, "title"),
      affectedScope: issueAffectedScopeLabels[affectedScope],
      affectedPartId,
      affectedCavityNote,
      issueType: issueTypeLabels[issueTypeRaw],
      source: issueSourceLabels[sourceRaw],
      severity: severityLabels[severityRaw],
      status: issueStatusLabels[statusRaw],
      ownerUserId: ownerUser?.id,
      ownerGroupId: ownerGroup?.id,
      dueDate,
      actorRole: actor.roleCode
    });

    if (!validation.ok) {
      redirectWithMessage(fallback, "error", firstValidationMessage(validation));
    }

    const issueType = toDbEnum(issueTypeRaw, issueTypeValues, "issue type");
    const source = toDbEnum(sourceRaw, issueSourceValues, "issue source");
    const severity = toDbEnum(severityRaw, severityValues, "issue severity");
    const status = toDbEnum(statusRaw, issueCreateStatusValues, "issue status for creation", "OPEN");

    // Photos ride along in the same submission; capture them before the issue
    // transaction so we can attach them right after it commits.
    const photoFiles = fileValues(formData, "photos");
    const candidateTitle = value(formData, "title");
    const now = new Date();
    const duplicateWindowStart = new Date(now.getTime() - DUPLICATE_SUBMISSION_WINDOW_MS);

    const createResult = await prisma.$transaction(async (tx) => {
      // Double-tap guard: same project + creator + title created within the
      // window is the same intent arriving twice. Return the idempotent success
      // without creating a second issue (photos on the dup submit are dropped).
      const recentIssues = await tx.trialIssue.findMany({
        where: {
          moldTrialProjectId: project.id,
          createdById: actor.id,
          createdAt: { gte: duplicateWindowStart }
        },
        select: { moldTrialProjectId: true, createdById: true, title: true, createdAt: true }
      });
      if (
        recentIssues.some((existing) =>
          isDuplicateIssueSubmission(
            existing,
            { moldTrialProjectId: project.id, createdById: actor.id, title: candidateTitle },
            now
          )
        )
      ) {
        return { duplicate: true as const, issueId: null };
      }

      if (foundAtTrialEventId != null) {
        const foundAtTrial = await tx.trialEvent.findFirst({
          where: {
            id: foundAtTrialEventId,
            moldTrialProjectId: project.id
          },
          select: { id: true }
        });

        if (foundAtTrial == null) {
          throw new Error("Linked trial event does not belong to this project.");
        }
      }

      const issue = await tx.trialIssue.create({
        data: {
          moldTrialProjectId: project.id,
          foundAtTrialEventId,
          affectedScope,
          affectedPartId,
          affectedCavityNote,
          title: candidateTitle,
          description: optionalValue(formData, "description"),
          issueType,
          source,
          sourceDetail: optionalValue(formData, "sourceDetail"),
          severity,
          status,
          ownerUserId: ownerUser?.id,
          ownerGroupId: ownerGroup?.id,
          // R1: when the creator leaves the due date blank, apply the default
          // policy window (createdAt + DEFAULT_ISSUE_DUE_HOURS) instead of blocking.
          dueDate: dueDate ?? computeDefaultIssueDueDate(now),
          createdById: actor.id,
          reportedById: actor.id
        }
      });

      await logActivity(tx, {
        actorUserId: actor.id,
        entityType: "TrialIssue",
        entityId: issue.id,
        action: "created_trial_issue",
        afterJson: {
          title: issue.title,
          severity: issue.severity,
          source: issue.source,
          affectedScope: issue.affectedScope,
          affectedPartId: issue.affectedPartId
        }
      });

      return { duplicate: false as const, issueId: issue.id };
    });

    // A duplicate double-tap already succeeded once: skip re-storing photos and
    // return the normal success message (idempotent success, not an error).
    if (createResult.duplicate || createResult.issueId == null) {
      revalidatePath("/");
      revalidatePath(fallback);
      redirectWithMessage(fallback, "success", "Trial issue created.");
    }

    // Store photos only after the issue commits: a failed/invalid photo never
    // rolls back the saved issue; the failed filenames surface as a warning.
    const photoResult =
      photoFiles.length === 0
        ? { storedCount: 0, failures: [] }
        : await storeIssuePhotos({
            actorId: actor.id,
            projectId: project.id,
            projectCode: project.projectCode,
            issueId: createResult.issueId,
            files: photoFiles
          });

    revalidatePath("/");
    revalidatePath(fallback);
    const warning = photoWarningSuffix(photoResult.failures);
    redirectWithMessage(
      fallback,
      warning == null ? "success" : "error",
      warning == null ? "Trial issue created." : `Trial issue created. ${warning}`
    );
  } catch (error) {
    if (isRedirectSignal(error)) {
      throw error;
    }

    redirectWithMessage(fallback, "error", friendlyActionErrorMessage(error, "Unable to create trial issue."));
  }
}

export async function editTrialIssue(formData: FormData) {
  const projectCode = value(formData, "projectCode");
  const fallback = redirectPath(formData, `/projects/${projectCode}`);

  try {
    const privacy = assertNoCustomerIdentity(formData);
    if (!privacy.ok) {
      redirectWithMessage(fallback, "error", firstValidationMessage(privacy));
    }

    const actor = await getActor();
    const issueId = value(formData, "issueId");

    if (issueId.length === 0) {
      redirectWithMessage(fallback, "error", "Trial issue is required.");
    }

    const issue = await prisma.trialIssue.findFirst({
      where: {
        id: issueId,
        moldTrialProject: {
          projectCode
        }
      },
      include: {
        moldTrialProject: {
          select: {
            id: true,
            moldCode: true
          }
        }
      }
    });

    if (issue == null) {
      throw new Error("Trial issue not found.");
    }

    assertProjectHasMoldCode(issue.moldTrialProject);

    await requireSimpleIssueEditAuthorization({
      actor,
      issue
    });

    const editingClosedIssue = issue.status === "CLOSED";
    const ownerUsername = optionalValue(formData, "ownerUsername");
    const ownerUser = ownerUsername == null ? null : await findUserByUsername(ownerUsername, "Owner");
    const selectedAffectedPartId = optionalValue(formData, "affectedPartId");
    const affectedScope = selectedAffectedPartId == null ? "MOLD" : "PART";
    const affectedPartId = affectedScope === "PART" ? selectedAffectedPartId : null;
    const issueType = toDbEnum(value(formData, "issueType"), issueTypeValues, "issue type", issue.issueType);
    const source = toDbEnum(value(formData, "source"), issueSourceValues, "issue source", issue.source);
    const severity = toDbEnum(value(formData, "severity"), severityValues, "issue severity", issue.severity);
    const status = toDbEnum(value(formData, "status"), issueStatusValues, "issue status", issue.status);
    const dueDate = formDate(formData, "dueDate");
    const description = optionalValue(formData, "description");

    if (status === "CLOSED" && issue.status !== "CLOSED") {
      redirectWithMessage(fallback, "error", "Use Close Issue to close a trial issue.");
    }

    if (editingClosedIssue && status !== "CLOSED") {
      redirectWithMessage(fallback, "error", "GM closed-issue override cannot reopen an issue.");
    }

    await resolveAffectedPart({
      projectId: issue.moldTrialProjectId,
      affectedScope,
      affectedPartId,
      allowInactivePartId: issue.affectedPartId
    });

    const validation = validateTrialIssueCreate({
      title: value(formData, "title"),
      affectedScope: issueAffectedScopeLabels[affectedScope],
      affectedPartId,
      issueType: issueTypeLabels[issueType],
      source: issueSourceLabels[source],
      severity: severityLabels[severity],
      status: editingClosedIssue ? "Verified" : issueStatusLabels[status],
      ownerUserId: ownerUser?.id,
      dueDate,
      actorRole: actor.roleCode
    });

    if (!validation.ok) {
      redirectWithMessage(fallback, "error", firstValidationMessage(validation));
    }

    // New photos ride along in the same submission; existing photos are managed
    // separately (delete via the attachment list), so an edit only ever adds.
    const photoFiles = fileValues(formData, "photos");

    await prisma.$transaction(async (tx) => {
      const updated = await tx.trialIssue.update({
        where: { id: issue.id },
        data: {
          title: value(formData, "title"),
          description,
          issueType,
          source,
          severity,
          status,
          affectedScope,
          affectedPartId,
          affectedCavityNote: null,
          ownerUserId: ownerUser?.id,
          ownerGroupId: null,
          dueDate
        }
      });

      await logActivity(tx, {
        actorUserId: actor.id,
        entityType: "TrialIssue",
        entityId: updated.id,
        action: editingClosedIssue ? "gm_edited_closed_trial_issue" : "edited_trial_issue",
        beforeJson: {
          title: issue.title,
          description: issue.description,
          issueType: issue.issueType,
          source: issue.source,
          severity: issue.severity,
          status: issue.status,
          affectedScope: issue.affectedScope,
          affectedPartId: issue.affectedPartId,
          ownerUserId: issue.ownerUserId,
          ownerGroupId: issue.ownerGroupId,
          dueDate: activityDate(issue.dueDate)
        },
        afterJson: {
          title: updated.title,
          description: updated.description,
          issueType: updated.issueType,
          source: updated.source,
          severity: updated.severity,
          status: updated.status,
          affectedScope: updated.affectedScope,
          affectedPartId: updated.affectedPartId,
          ownerUserId: updated.ownerUserId,
          ownerGroupId: updated.ownerGroupId,
          dueDate: activityDate(updated.dueDate),
          closedIssueOverride: editingClosedIssue
        }
      });
    });

    const photoResult =
      photoFiles.length === 0
        ? { storedCount: 0, failures: [] }
        : await storeIssuePhotos({
            actorId: actor.id,
            projectId: issue.moldTrialProjectId,
            projectCode,
            issueId: issue.id,
            files: photoFiles
          });

    revalidatePath("/");
    revalidatePath(fallback);
    const warning = photoWarningSuffix(photoResult.failures);
    redirectWithMessage(
      fallback,
      warning == null ? "success" : "error",
      warning == null ? "Trial issue edited." : `Trial issue edited. ${warning}`
    );
  } catch (error) {
    if (isRedirectSignal(error)) {
      throw error;
    }

    redirectWithMessage(fallback, "error", friendlyActionErrorMessage(error, "Unable to edit trial issue."));
  }
}

export async function closeTrialIssue(formData: FormData) {
  const projectCode = value(formData, "projectCode");
  const fallback = redirectPath(formData, `/projects/${projectCode}`);

  try {
    const privacy = assertNoCustomerIdentity(formData);
    if (!privacy.ok) {
      redirectWithMessage(fallback, "error", firstValidationMessage(privacy));
    }

    const actor = await getActor();
    const issueId = value(formData, "issueId");

    if (issueId.length === 0) {
      redirectWithMessage(fallback, "error", "Trial issue is required.");
    }

    const issue = await prisma.trialIssue.findFirst({
      where: {
        id: issueId,
        moldTrialProject: {
          projectCode
        }
      },
      include: {
        moldTrialProject: {
          select: {
            moldCode: true
          }
        }
      }
    });

    if (issue == null) {
      throw new Error("Trial issue not found.");
    }

    assertProjectHasMoldCode(issue.moldTrialProject);

    // A second submit (the first close already committed) is a graceful success,
    // not an error — the user's intent (close it) succeeded once already.
    if (issue.status === "CLOSED") {
      redirectWithMessage(fallback, "success", "Trial issue already closed.");
    }

    await requireTrialIssueCloseAuthorization({
      actor,
      issue
    });

    const fixSummary = optionalValue(formData, "fixSummary");
    const fixTimeMinutes = optionalInteger(formData, "fixTimeMinutes");
    const closedAt = formDate(formData, "closedAt");
    const nonOwnerCloseReason = optionalValue(formData, "nonOwnerCloseReason");

    const validation = validateTrialIssueClosure({
      status: "Closed",
      issueType: issueTypeLabels[issue.issueType],
      fixSummary,
      fixTimeMinutes,
      closedAt,
      closedById: actor.id,
      ownerUserId: issue.ownerUserId,
      nonOwnerCloseReason,
      actorRole: actor.roleCode
    });

    if (!validation.ok) {
      redirectWithMessage(fallback, "error", firstValidationMessage(validation));
    }

    const nonOwnerCloseReasonWritten = issue.ownerUserId === actor.id ? null : nonOwnerCloseReason;

    const closeOutcome = await prisma.$transaction(async (tx) => {
      // Precondition guard: transition only an issue that is not already CLOSED.
      // A concurrent/second submit (already CLOSED by the first) finds
      // count === 0 and writes no second ActivityLog.
      const result = await tx.trialIssue.updateMany({
        where: { id: issue.id, status: { not: "CLOSED" } },
        data: {
          status: "CLOSED",
          fixSummary,
          fixTimeMinutes,
          closedAt,
          closedById: actor.id,
          nonOwnerCloseReason: nonOwnerCloseReasonWritten
        }
      });

      if (result.count === 0) {
        return { closed: false as const };
      }

      await logActivity(tx, {
        actorUserId: actor.id,
        entityType: "TrialIssue",
        entityId: issue.id,
        action: "closed_trial_issue",
        beforeJson: {
          status: issue.status,
          closedAt: activityDate(issue.closedAt),
          closedById: issue.closedById,
          fixSummary: issue.fixSummary,
          fixTimeMinutes: issue.fixTimeMinutes,
          nonOwnerCloseReason: issue.nonOwnerCloseReason
        },
        afterJson: {
          status: "CLOSED",
          closedAt: activityDate(closedAt),
          closedById: actor.id,
          fixSummary,
          fixTimeMinutes,
          nonOwnerCloseReason: nonOwnerCloseReasonWritten
        }
      });

      return { closed: true as const };
    });

    revalidatePath("/");
    revalidatePath(fallback);
    redirectWithMessage(
      fallback,
      "success",
      closeOutcome.closed ? "Trial issue closed." : "Trial issue already closed."
    );
  } catch (error) {
    if (isRedirectSignal(error)) {
      throw error;
    }

    redirectWithMessage(fallback, "error", friendlyActionErrorMessage(error, "Unable to close trial issue."));
  }
}

export async function updateTrialIssue(formData: FormData) {
  const projectCode = value(formData, "projectCode");
  const fallback = redirectPath(formData, `/projects/${projectCode}`);

  try {
    const privacy = assertNoCustomerIdentity(formData);
    if (!privacy.ok) {
      redirectWithMessage(fallback, "error", firstValidationMessage(privacy));
    }

    const actor = await getActor();
    const issueId = value(formData, "issueId");

    if (issueId.length === 0) {
      redirectWithMessage(fallback, "error", "Trial issue is required.");
    }

    const issue = await prisma.trialIssue.findFirst({
      where: {
        id: issueId,
        moldTrialProject: {
          projectCode
        }
      },
      include: {
        moldTrialProject: {
          select: {
            moldCode: true,
            planningPmId: true,
            technicalPmId: true
          }
        },
        ownerGroup: {
          select: {
            code: true
          }
        }
      }
    });

    if (issue == null) {
      throw new Error("Trial issue not found.");
    }

    assertProjectHasMoldCode(issue.moldTrialProject);

    if (issue.status === "CLOSED") {
      redirectWithMessage(
        fallback,
        "error",
        actor.roleCode === "GM"
          ? "Use the GM closed-issue override edit action for closed issues."
          : "Only GM can edit closed trial issues."
      );
    }

    const ownerUsername = optionalValue(formData, "ownerUsername");
    const ownerGroupCode = optionalValue(formData, "ownerGroupCode");
    const ownerUser = ownerUsername == null ? null : await findUserByUsername(ownerUsername, "Owner");
    const ownerGroup = ownerGroupCode == null
      ? null
      : await prisma.departmentGroup.findUnique({ where: { code: ownerGroupCode } });
    const affectedScope = toDbEnum(value(formData, "affectedScope"), issueAffectedScopeValues, "affected scope", issue.affectedScope);
    const affectedPartId = affectedScope === "PART" ? optionalValue(formData, "affectedPartId") : null;
    const affectedCavityNote = optionalValue(formData, "affectedCavityNote");

    if (ownerGroupCode != null && ownerGroup == null) {
      throw new Error(`Owner group ${ownerGroupCode} was not found. Run prisma:seed first.`);
    }

    if (ownerUser == null && ownerGroup == null) {
      redirectWithMessage(fallback, "error", "Trial issue owner is required.");
    }

    await resolveAffectedPart({
      projectId: issue.moldTrialProjectId,
      affectedScope,
      affectedPartId,
      allowInactivePartId: issue.affectedPartId
    });

    const affectedValidation = validateIssueAffectedPart({
      affectedScope: issueAffectedScopeLabels[affectedScope],
      affectedPartId,
      affectedCavityNote
    });

    if (!affectedValidation.ok) {
      redirectWithMessage(fallback, "error", firstValidationMessage(affectedValidation));
    }

    const status = toDbEnum(value(formData, "status"), issueStatusValues, "issue status", issue.status);
    const rootCause = optionalValue(formData, "rootCause");
    const correctiveAction = optionalValue(formData, "correctiveAction");
    const verificationMethod = optionalValue(formData, "verificationMethod");
    const verificationResult = optionalValue(formData, "verificationResult");
    const assemblyAcknowledgedAt = formDate(formData, "assemblyAcknowledgedAt");
    const assemblyEstimatedFinishDate = formDate(formData, "assemblyEstimatedFinishDate");
    const assemblyAcknowledgedById =
      assemblyAcknowledgedAt == null
        ? null
        : sameDate(issue.assemblyAcknowledgedAt, assemblyAcknowledgedAt)
          ? issue.assemblyAcknowledgedById
          : actor.id;
    const assemblySelfCheckedAt = formDate(formData, "assemblySelfCheckedAt");
    const assemblySelfCheckNote = optionalValue(formData, "assemblySelfCheckNote");
    const assemblySelfCheckedById =
      assemblySelfCheckedAt == null
        ? null
        : sameDate(issue.assemblySelfCheckedAt, assemblySelfCheckedAt)
          ? issue.assemblySelfCheckedById
          : actor.id;
    const pmReadyConfirmedAt = formDate(formData, "pmReadyConfirmedAt");
    const pmReadyConfirmedById =
      pmReadyConfirmedAt == null
        ? null
        : sameDate(issue.pmReadyConfirmedAt, pmReadyConfirmedAt)
          ? issue.pmReadyConfirmedById
          : actor.id;
    const dueDate = formDate(formData, "dueDate");
    const closedAt = formDate(formData, "closedAt");
    const changedFields: TrialIssueLifecycleField[] = [];

    if (issue.status !== status) {
      changedFields.push("status");
    }

    if (issue.affectedScope !== affectedScope) {
      changedFields.push("affectedScope");
    }

    if ((issue.affectedPartId ?? null) !== (affectedPartId ?? null)) {
      changedFields.push("affectedPartId");
    }

    if (!sameText(issue.affectedCavityNote, affectedCavityNote)) {
      changedFields.push("affectedCavityNote");
    }

    if (!sameText(issue.rootCause, rootCause)) {
      changedFields.push("rootCause");
    }

    if (!sameText(issue.correctiveAction, correctiveAction)) {
      changedFields.push("correctiveAction");
    }

    if (!sameText(issue.verificationMethod, verificationMethod)) {
      changedFields.push("verificationMethod");
    }

    if (!sameText(issue.verificationResult, verificationResult)) {
      changedFields.push("verificationResult");
    }

    if (!sameDate(issue.assemblyAcknowledgedAt, assemblyAcknowledgedAt)) {
      changedFields.push("assemblyAcknowledgedAt");
    }

    if (!sameDate(issue.assemblyEstimatedFinishDate, assemblyEstimatedFinishDate)) {
      changedFields.push("assemblyEstimatedFinishDate");
    }

    if ((issue.assemblyAcknowledgedById ?? null) !== (assemblyAcknowledgedById ?? null)) {
      changedFields.push("assemblyAcknowledgedById");
    }

    if (!sameDate(issue.assemblySelfCheckedAt, assemblySelfCheckedAt)) {
      changedFields.push("assemblySelfCheckedAt");
    }

    if ((issue.assemblySelfCheckedById ?? null) !== (assemblySelfCheckedById ?? null)) {
      changedFields.push("assemblySelfCheckedById");
    }

    if (!sameText(issue.assemblySelfCheckNote, assemblySelfCheckNote)) {
      changedFields.push("assemblySelfCheckNote");
    }

    if (!sameDate(issue.pmReadyConfirmedAt, pmReadyConfirmedAt)) {
      changedFields.push("pmReadyConfirmedAt");
    }

    if ((issue.pmReadyConfirmedById ?? null) !== (pmReadyConfirmedById ?? null)) {
      changedFields.push("pmReadyConfirmedById");
    }

    if (!sameDate(issue.closedAt, closedAt)) {
      changedFields.push("closedAt");
    }

    if (!sameDate(issue.dueDate, dueDate)) {
      changedFields.push("dueDate");
    }

    if ((issue.ownerUserId ?? null) !== (ownerUser?.id ?? null)) {
      changedFields.push("ownerUserId");
    }

    if ((issue.ownerGroupId ?? null) !== (ownerGroup?.id ?? null)) {
      changedFields.push("ownerGroupId");
    }

    const departmentInboxClaim = isDepartmentInboxClaim({
      actor,
      issue,
      ownerUser,
      ownerGroup,
      changedFields
    });
    const effectiveChangedFields = departmentInboxClaim
      ? changedFields.filter((field) => field !== "ownerUserId")
      : changedFields;

    const validation = validateTrialIssueLifecycleUpdate({
      status: issueStatusLabels[status],
      issueType: issueTypeLabels[issue.issueType],
      rootCause,
      correctiveAction,
      verificationMethod,
      verificationResult,
      assemblyAcknowledgedAt,
      assemblyEstimatedFinishDate,
      assemblyAcknowledgedById,
      assemblySelfCheckedAt,
      assemblySelfCheckedById,
      assemblySelfCheckNote,
      pmReadyConfirmedAt,
      pmReadyConfirmedById,
      closedAt,
      actorRole: actor.roleCode,
      changedFields: effectiveChangedFields
    });

    if (!validation.ok) {
      redirectWithMessage(fallback, "error", firstValidationMessage(validation));
    }

    await requireIssueLifecyclePermissions({
      actor,
      issue,
      changedFields: effectiveChangedFields,
      nextStatus: status
    });

    await prisma.$transaction(async (tx) => {
      const updateData = {
        status,
        affectedScope,
        affectedPartId,
        affectedCavityNote,
        ownerUserId: ownerUser?.id,
        ownerGroupId: ownerGroup?.id,
        dueDate,
        rootCause,
        correctiveAction,
        verificationMethod,
        verificationResult,
        assemblyAcknowledgedAt,
        assemblyEstimatedFinishDate,
        assemblyAcknowledgedById,
        assemblySelfCheckedAt,
        assemblySelfCheckedById,
        assemblySelfCheckNote,
        pmReadyConfirmedAt,
        pmReadyConfirmedById,
        closedAt: status === "CLOSED" ? closedAt : null
      };

      let updated;
      if (departmentInboxClaim) {
        // Claim-race guard: assign an owner only while the department-inbox issue
        // is still unclaimed (ownerUserId IS NULL). The concurrent loser gets
        // count === 0 and a clear "already claimed by <name>" error — never a
        // silent overwrite of the winner's claim.
        const claim = await tx.trialIssue.updateMany({
          where: { id: issue.id, ownerUserId: null },
          data: updateData
        });

        if (claim.count === 0) {
          const current = await tx.trialIssue.findUnique({
            where: { id: issue.id },
            select: { ownerUser: { select: { displayName: true, username: true } } }
          });
          const claimedByName = current?.ownerUser?.displayName ?? current?.ownerUser?.username ?? "another user";
          throw new Error(`Already being handled by ${claimedByName} / 已由 ${claimedByName} 处理`);
        }

        updated = await tx.trialIssue.findUniqueOrThrow({ where: { id: issue.id } });
      } else {
        updated = await tx.trialIssue.update({
          where: { id: issue.id },
          data: updateData
        });
      }

      await logActivity(tx, {
        actorUserId: actor.id,
        entityType: "TrialIssue",
        entityId: updated.id,
        action: status === "CLOSED" ? "closed_trial_issue" : "updated_trial_issue",
        beforeJson: {
          status: issue.status,
          affectedScope: issue.affectedScope,
          affectedPartId: issue.affectedPartId,
          affectedCavityNote: issue.affectedCavityNote,
          ownerUserId: issue.ownerUserId,
          ownerGroupId: issue.ownerGroupId,
          dueDate: activityDate(issue.dueDate),
          rootCause: issue.rootCause,
          correctiveAction: issue.correctiveAction,
          verificationMethod: issue.verificationMethod,
          verificationResult: issue.verificationResult,
          assemblyAcknowledgedAt: activityDate(issue.assemblyAcknowledgedAt),
          assemblyEstimatedFinishDate: activityDate(issue.assemblyEstimatedFinishDate),
          assemblySelfCheckedAt: activityDate(issue.assemblySelfCheckedAt),
          assemblySelfCheckNote: issue.assemblySelfCheckNote,
          pmReadyConfirmedAt: activityDate(issue.pmReadyConfirmedAt),
          closedAt: activityDate(issue.closedAt)
        },
        afterJson: {
          status: updated.status,
          affectedScope: updated.affectedScope,
          affectedPartId: updated.affectedPartId,
          affectedCavityNote: updated.affectedCavityNote,
          ownerUserId: updated.ownerUserId,
          ownerGroupId: updated.ownerGroupId,
          dueDate: activityDate(updated.dueDate),
          rootCause: updated.rootCause,
          correctiveAction: updated.correctiveAction,
          verificationMethod: updated.verificationMethod,
          verificationResult: updated.verificationResult,
          assemblyAcknowledgedAt: activityDate(updated.assemblyAcknowledgedAt),
          assemblyEstimatedFinishDate: activityDate(updated.assemblyEstimatedFinishDate),
          assemblySelfCheckedAt: activityDate(updated.assemblySelfCheckedAt),
          assemblySelfCheckNote: updated.assemblySelfCheckNote,
          pmReadyConfirmedAt: activityDate(updated.pmReadyConfirmedAt),
          closedAt: activityDate(updated.closedAt)
        }
      });
    });

    revalidatePath("/");
    revalidatePath(fallback);
    redirectWithMessage(fallback, "success", status === "CLOSED" ? "Trial issue closed." : "Trial issue updated.");
  } catch (error) {
    if (isRedirectSignal(error)) {
      throw error;
    }

    redirectWithMessage(fallback, "error", friendlyActionErrorMessage(error, "Unable to update trial issue."));
  }
}

export async function setPmCustomTrialLimit(formData: FormData) {
  const projectCode = value(formData, "projectCode");
  const fallback = redirectPath(formData, `/projects/${projectCode}`);

  try {
    const privacy = assertNoCustomerIdentity(formData);
    if (!privacy.ok) {
      redirectWithMessage(fallback, "error", firstValidationMessage(privacy));
    }

    const actor = await getActor("trial.limit.set_custom");
    const customTrialLimit = optionalInteger(formData, "customTrialLimit");
    const customTrialLimitReason = optionalValue(formData, "customTrialLimitReason");
    const project = await prisma.moldTrialProject.findUnique({ where: { projectCode } });

    if (project == null) {
      throw new Error("Project not found.");
    }

    await prisma.$transaction(async (tx) => {
      await applyPmCustomTrialLimit(tx, {
        project,
        actor: {
          id: actor.id,
          roleCode: actor.roleCode
        },
        customTrialLimit,
        customTrialLimitReason
      });
    });

    revalidatePath("/");
    revalidatePath(fallback);
    redirectWithMessage(fallback, "success", "PM custom trial limit saved.");
  } catch (error) {
    if (isRedirectSignal(error)) {
      throw error;
    }

    redirectWithMessage(fallback, "error", friendlyActionErrorMessage(error, "Unable to set custom trial limit."));
  }
}

export async function createDesignChangeEvent(formData: FormData) {
  const projectCode = value(formData, "projectCode");
  const fallback = redirectPath(formData, `/projects/${projectCode}`);

  try {
    const privacy = assertNoCustomerIdentity(formData);
    if (!privacy.ok) {
      redirectWithMessage(fallback, "error", firstValidationMessage(privacy));
    }

    const actor = await getActor("trial.design_change.report");
    const changeDate = formDate(formData, "changeDate");
    const requestedByRaw = value(formData, "requestedBy");
    const approveExtraTrial = checkboxValue(formData, "approveExtraTrial");
    if (approveExtraTrial) {
      await requirePermission(actor.id, "trial.design_change.approve_extra_trial");
    }

    const approvalReason = optionalValue(formData, "approvalReason");
    const requestedBy = toDbEnum(requestedByRaw, changeRequesterValues, "design change requester type");
    const project = await prisma.moldTrialProject.findUnique({
      where: { projectCode },
      include: {
        trialEvents: true,
        designChanges: true
      }
    });

    if (project == null) {
      throw new Error("Project not found.");
    }

    const result = await prisma.$transaction((tx) =>
      applyDesignChangeEvent(tx, {
        project,
        actor: {
          id: actor.id,
          roleCode: actor.roleCode
        },
        changeDate,
        requestedBy,
        title: value(formData, "title"),
        description: value(formData, "description"),
        approveExtraTrial,
        approvalReason
      })
    );

    revalidatePath("/");
    revalidatePath(fallback);
    redirectWithMessage(
      fallback,
      "success",
      result.grantsExtraTrial ? "Design change saved with extra trial allowance." : "Design change saved."
    );
  } catch (error) {
    if (isRedirectSignal(error)) {
      throw error;
    }

    redirectWithMessage(fallback, "error", friendlyActionErrorMessage(error, "Unable to create design change."));
  }
}
