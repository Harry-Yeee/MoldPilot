import { DEFAULT_BASE_TRIAL_LIMIT } from "./types.ts";
import type {
  DesignChangeCreateInput,
  DesignChangeEvent,
  RoleCode,
  TrialEvent,
  TrialLimitInput,
  TrialLimitState,
  TrialLimitSummary,
  ValidationResult
} from "./types.ts";

const customTrialLimitRoles = new Set<RoleCode>(["PM", "ADMIN"]);
const designChangeCreateRoles = new Set<RoleCode>(["PM", "MARKETING", "ADMIN"]);
const designChangeApprovalRoles = new Set<RoleCode>(["PM", "ADMIN"]);
const marketingDesignChangeRequesters = new Set(["Customer", "Marketing"]);

function isBlank(value: string | null | undefined): boolean {
  return value == null || value.trim().length === 0;
}

function validationResult(issues: ValidationResult["issues"]): ValidationResult {
  return {
    ok: issues.length === 0,
    issues
  };
}

export function countCompletedTrials(trialEvents: readonly TrialEvent[]): number {
  return trialEvents.filter((trial) => {
    if (trial.countsAgainstLimit != null) {
      return trial.countsAgainstLimit;
    }

    return trial.status === "Completed";
  }).length;
}

export function getTrialLimitState(completedTrialCount: number, currentTrialLimit: number): TrialLimitState {
  if (completedTrialCount > currentTrialLimit) {
    return "Over Limit";
  }

  if (completedTrialCount === currentTrialLimit) {
    return "At Limit";
  }

  if (currentTrialLimit > 1 && completedTrialCount === currentTrialLimit - 1) {
    return "Near Limit";
  }

  return "Healthy";
}

export function evaluateDesignChangeAllowance(input: {
  completedTrialCount: number;
  approved: boolean;
  approverId?: string | null;
  approvalReason?: string | null;
}): {
  grantsExtraTrial: boolean;
  extraTrialCount: number;
  reason: string;
} {
  if (input.completedTrialCount < 1) {
    return {
      grantsExtraTrial: false,
      extraTrialCount: 0,
      reason: "Design changes before the first completed trial do not add trial allowance."
    };
  }

  if (!input.approved) {
    return {
      grantsExtraTrial: false,
      extraTrialCount: 0,
      reason: "Design-change allowance requires approval."
    };
  }

  if (isBlank(input.approverId) || isBlank(input.approvalReason)) {
    return {
      grantsExtraTrial: false,
      extraTrialCount: 0,
      reason: "Approved design-change allowance requires approver and reason."
    };
  }

  return {
    grantsExtraTrial: true,
    extraTrialCount: 1,
    reason: "Approved design change after at least one completed trial grants one extra trial."
  };
}

export function getApprovedDesignChangeExtraTrials(designChanges: readonly DesignChangeEvent[] = []): number {
  return designChanges.reduce((total, change) => {
    const allowance = evaluateDesignChangeAllowance({
      completedTrialCount: change.firstCompletedTrialAlreadyDone ? 1 : 0,
      approved: change.grantsExtraTrial,
      approverId: change.approvedById,
      approvalReason: change.approvalReason
    });

    return total + allowance.extraTrialCount;
  }, 0);
}

export function validateCustomTrialLimit(input: {
  customTrialLimit?: number | null;
  customTrialLimitReason?: string | null;
}): ValidationResult {
  const issues: ValidationResult["issues"] = [];

  if (input.customTrialLimit == null) {
    return validationResult(issues);
  }

  if (!Number.isInteger(input.customTrialLimit) || input.customTrialLimit < 1) {
    issues.push({
      field: "customTrialLimit",
      message: "Custom trial limit must be a positive whole number."
    });
  }

  if (isBlank(input.customTrialLimitReason)) {
    issues.push({
      field: "customTrialLimitReason",
      message: "PM custom trial limit requires a visible reason."
    });
  }

  return validationResult(issues);
}

export function validatePmCustomTrialLimit(input: {
  actorRole?: RoleCode | null;
  customTrialLimit?: number | null;
  customTrialLimitReason?: string | null;
}): ValidationResult {
  const issues = [...validateCustomTrialLimit(input).issues];

  if (input.customTrialLimit == null) {
    issues.push({
      field: "customTrialLimit",
      message: "Custom trial limit is required."
    });
  }

  if (input.actorRole == null || !customTrialLimitRoles.has(input.actorRole)) {
    issues.push({
      field: "actorRole",
      message: "Only PM or Admin can set PM custom trial limits."
    });
  }

  return validationResult(issues);
}

export function validateDesignChangeCreate(input: DesignChangeCreateInput): ValidationResult {
  const issues: ValidationResult["issues"] = [];
  const completedTrialCount = input.completedTrialCount ?? 0;

  if (input.actorRole == null || !designChangeCreateRoles.has(input.actorRole)) {
    issues.push({
      field: "actorRole",
      message: "This role cannot create design change events."
    });
  }

  if (input.actorRole === "MARKETING" && input.requestedBy != null && !marketingDesignChangeRequesters.has(input.requestedBy)) {
    issues.push({
      field: "requestedBy",
      message: "Marketing can create only customer-driven design changes."
    });
  }

  if (input.changeDate == null) {
    issues.push({
      field: "changeDate",
      message: "Design change date is required."
    });
  }

  if (input.requestedBy == null) {
    issues.push({
      field: "requestedBy",
      message: "Design change requester type is required."
    });
  }

  if (isBlank(input.title)) {
    issues.push({
      field: "title",
      message: "Design change title is required."
    });
  }

  if (isBlank(input.description)) {
    issues.push({
      field: "description",
      message: "Design change description is required."
    });
  }

  if (input.approveExtraTrial === true) {
    if (input.actorRole == null || !designChangeApprovalRoles.has(input.actorRole)) {
      issues.push({
        field: "actorRole",
        message: "Only PM or Admin can approve design-change extra trial allowance."
      });
    }

    if (completedTrialCount < 1) {
      issues.push({
        field: "completedTrialCount",
        message: "Design-change extra trial allowance requires at least one completed counted trial."
      });
    }

    if (isBlank(input.approvedById)) {
      issues.push({
        field: "approvedById",
        message: "Approved design-change allowance requires approver."
      });
    }

    if (isBlank(input.approvalReason)) {
      issues.push({
        field: "approvalReason",
        message: "Approved design-change allowance requires approval reason."
      });
    }
  }

  return validationResult(issues);
}

export function designChangeCreatesLimitAdjustment(input: {
  grantsExtraTrial: boolean;
}): boolean {
  return input.grantsExtraTrial;
}

export function customLimitCreatesAuditRecords(): {
  trialLimitAdjustmentType: "PM Custom Limit";
  activityAction: "set_pm_custom_trial_limit";
} {
  return {
    trialLimitAdjustmentType: "PM Custom Limit",
    activityAction: "set_pm_custom_trial_limit"
  };
}

export function designChangeCreatesActivityActions(input: {
  grantsExtraTrial: boolean;
}): readonly ("created_design_change" | "created_design_change_extra_trial_adjustment")[] {
  return input.grantsExtraTrial
    ? ["created_design_change", "created_design_change_extra_trial_adjustment"]
    : ["created_design_change"];
}

export function calculateCurrentTrialLimit(input: Omit<TrialLimitInput, "trialEvents">): number {
  const baseTrialLimit = input.baseTrialLimit ?? DEFAULT_BASE_TRIAL_LIMIT;

  if (input.customTrialLimit != null) {
    return input.customTrialLimit;
  }

  return baseTrialLimit + getApprovedDesignChangeExtraTrials(input.designChanges);
}

export function evaluateTrialLimit(input: TrialLimitInput): TrialLimitSummary {
  const baseTrialLimit = input.baseTrialLimit ?? DEFAULT_BASE_TRIAL_LIMIT;
  const completedTrialCount = countCompletedTrials(input.trialEvents);
  const designChangeExtraTrialCount = getApprovedDesignChangeExtraTrials(input.designChanges);
  const usesCustomLimit = input.customTrialLimit != null;
  const currentTrialLimit = usesCustomLimit ? input.customTrialLimit as number : baseTrialLimit + designChangeExtraTrialCount;

  return {
    baseTrialLimit,
    completedTrialCount,
    currentTrialLimit,
    designChangeExtraTrialCount,
    remainingTrialAllowance: currentTrialLimit - completedTrialCount,
    warningState: getTrialLimitState(completedTrialCount, currentTrialLimit),
    usesCustomLimit
  };
}
