import type { ChangeRequester as PrismaChangeRequester, Prisma } from "@prisma/client";
import {
  countCompletedTrials,
  designChangeCreatesActivityActions,
  evaluateDesignChangeAllowance,
  getApprovedDesignChangeExtraTrials,
  validateDesignChangeCreate,
  validatePmCustomTrialLimit
} from "../domain/mold-trial/trial-limit.ts";
import type { DesignChangeEvent, RoleCode, TrialCode, TrialStatus, ValidationResult } from "../domain/mold-trial/types.ts";
import { changeRequesterLabels, trialCodeLabels, trialStatusLabels } from "./mold-trial-codecs.ts";

export type LimitControlTx = Pick<
  Prisma.TransactionClient,
  "activityLog" | "designChangeEvent" | "moldTrialProject" | "trialLimitAdjustment"
>;

export type LimitControlActor = {
  id: string;
  roleCode: RoleCode;
};

export type LimitControlTrialEvent = {
  trialCode: string;
  plannedDate: Date | string | null;
  actualDate: Date | string | null;
  status: string;
  countsAgainstLimit: boolean | null;
};

export type LimitControlDesignChange = {
  firstCompletedTrialAlreadyDone: boolean;
  grantsExtraTrial: boolean;
  extraTrialCount: number | null;
  approvedById: string | null;
  approvalReason: string | null;
};

export type LimitControlProject = {
  id: string;
  baseTrialLimit: number;
  currentTrialLimit: number;
  customTrialLimit: number | null;
  customTrialLimitReason: string | null;
  trialEvents?: readonly LimitControlTrialEvent[];
  designChanges?: readonly LimitControlDesignChange[];
};

function firstValidationMessage(result: ValidationResult): string {
  return result.issues[0]?.message ?? "Validation failed.";
}

function mappedTrialCode(value: string): TrialCode {
  const label = trialCodeLabels[value as keyof typeof trialCodeLabels];

  if (label == null) {
    throw new Error(`Trial code ${value} is not mapped for trial-limit evaluation.`);
  }

  return label;
}

function mappedTrialStatus(value: string): TrialStatus {
  const label = trialStatusLabels[value as keyof typeof trialStatusLabels];

  if (label == null) {
    throw new Error(`Trial status ${value} is not mapped for trial-limit evaluation.`);
  }

  return label;
}

function countedTrialCount(trials: readonly LimitControlTrialEvent[] = []): number {
  return countCompletedTrials(
    trials.map((trial) => ({
      trialCode: mappedTrialCode(trial.trialCode),
      plannedDate: trial.plannedDate,
      actualDate: trial.actualDate,
      status: mappedTrialStatus(trial.status),
      countsAgainstLimit: trial.countsAgainstLimit
    }))
  );
}

export async function applyPmCustomTrialLimit(
  tx: LimitControlTx,
  input: {
    project: LimitControlProject;
    actor: LimitControlActor;
    customTrialLimit: number | null;
    customTrialLimitReason: string | null;
  }
) {
  const validation = validatePmCustomTrialLimit({
    actorRole: input.actor.roleCode,
    customTrialLimit: input.customTrialLimit,
    customTrialLimitReason: input.customTrialLimitReason
  });

  if (!validation.ok || input.customTrialLimit == null) {
    throw new Error(firstValidationMessage(validation));
  }

  const updated = await tx.moldTrialProject.update({
    where: { id: input.project.id },
    data: {
      currentTrialLimit: input.customTrialLimit,
      customTrialLimit: input.customTrialLimit,
      customTrialLimitReason: input.customTrialLimitReason,
      customTrialLimitSetById: input.actor.id,
      customTrialLimitSetAt: new Date()
    }
  });

  const adjustment = await tx.trialLimitAdjustment.create({
    data: {
      moldTrialProjectId: input.project.id,
      adjustmentType: "PM_CUSTOM_LIMIT",
      newLimit: input.customTrialLimit,
      reason: input.customTrialLimitReason ?? "",
      setById: input.actor.id
    }
  });

  await tx.activityLog.create({
    data: {
      actorUserId: input.actor.id,
      entityType: "MoldTrialProject",
      entityId: input.project.id,
      action: "set_pm_custom_trial_limit",
      beforeJson: {
        customTrialLimit: input.project.customTrialLimit,
        customTrialLimitReason: input.project.customTrialLimitReason,
        currentTrialLimit: input.project.currentTrialLimit
      },
      afterJson: {
        customTrialLimit: updated.customTrialLimit,
        customTrialLimitReason: updated.customTrialLimitReason,
        currentTrialLimit: updated.currentTrialLimit
      }
    }
  });

  await tx.activityLog.create({
    data: {
      actorUserId: input.actor.id,
      entityType: "TrialLimitAdjustment",
      entityId: adjustment.id,
      action: "created_pm_custom_limit_adjustment",
      afterJson: {
        adjustmentType: adjustment.adjustmentType,
        newLimit: adjustment.newLimit,
        reason: adjustment.reason
      }
    }
  });

  return { adjustment, updatedProject: updated };
}

export async function applyDesignChangeEvent(
  tx: LimitControlTx,
  input: {
    project: LimitControlProject;
    actor: LimitControlActor;
    changeDate: Date | null;
    requestedBy: PrismaChangeRequester;
    title: string;
    description: string;
    approveExtraTrial: boolean;
    approvalReason: string | null;
  }
) {
  const requesterLabel = changeRequesterLabels[input.requestedBy];

  if (requesterLabel == null) {
    throw new Error("Invalid design change requester type.");
  }

  const completedTrialCount = countedTrialCount(input.project.trialEvents);
  const validation = validateDesignChangeCreate({
    actorRole: input.actor.roleCode,
    changeDate: input.changeDate,
    requestedBy: requesterLabel,
    title: input.title,
    description: input.description,
    approveExtraTrial: input.approveExtraTrial,
    completedTrialCount,
    approvedById: input.approveExtraTrial ? input.actor.id : null,
    approvalReason: input.approvalReason
  });

  if (!validation.ok || input.changeDate == null) {
    throw new Error(firstValidationMessage(validation));
  }

  const allowance = evaluateDesignChangeAllowance({
    completedTrialCount,
    approved: input.approveExtraTrial,
    approverId: input.approveExtraTrial ? input.actor.id : null,
    approvalReason: input.approvalReason
  });
  const grantsExtraTrial = allowance.grantsExtraTrial;
  const existingExtraTrials = getApprovedDesignChangeExtraTrials(
    (input.project.designChanges ?? []).map(
      (change): DesignChangeEvent => ({
        firstCompletedTrialAlreadyDone: change.firstCompletedTrialAlreadyDone,
        grantsExtraTrial: change.grantsExtraTrial,
        extraTrialCount: change.extraTrialCount,
        approvedById: change.approvedById,
        approvalReason: change.approvalReason
      })
    )
  );
  const nextCurrentTrialLimit =
    input.project.customTrialLimit ?? input.project.baseTrialLimit + existingExtraTrials + (grantsExtraTrial ? 1 : 0);

  const designChange = await tx.designChangeEvent.create({
    data: {
      moldTrialProjectId: input.project.id,
      changeDate: input.changeDate,
      requestedBy: input.requestedBy,
      title: input.title,
      description: input.description,
      firstCompletedTrialAlreadyDone: completedTrialCount > 0,
      grantsExtraTrial,
      extraTrialCount: grantsExtraTrial ? 1 : null,
      approvedById: grantsExtraTrial ? input.actor.id : null,
      approvalReason: grantsExtraTrial ? input.approvalReason : null,
      createdById: input.actor.id
    }
  });

  const adjustment = grantsExtraTrial
    ? await tx.trialLimitAdjustment.create({
        data: {
          moldTrialProjectId: input.project.id,
          adjustmentType: "DESIGN_CHANGE_EXTRA_TRIAL",
          deltaTrials: 1,
          reason: input.approvalReason ?? "",
          relatedDesignChangeEventId: designChange.id,
          setById: input.actor.id,
          approvedById: input.actor.id
        }
      })
    : null;

  const updatedProject = await tx.moldTrialProject.update({
    where: { id: input.project.id },
    data: {
      currentTrialLimit: nextCurrentTrialLimit
    }
  });

  const activityActions = designChangeCreatesActivityActions({ grantsExtraTrial });
  await tx.activityLog.create({
    data: {
      actorUserId: input.actor.id,
      entityType: "DesignChangeEvent",
      entityId: designChange.id,
      action: activityActions[0],
      afterJson: {
        requestedBy: designChange.requestedBy,
        title: designChange.title,
        firstCompletedTrialAlreadyDone: designChange.firstCompletedTrialAlreadyDone,
        grantsExtraTrial: designChange.grantsExtraTrial,
        extraTrialCount: designChange.extraTrialCount
      }
    }
  });

  if (adjustment != null) {
    await tx.activityLog.create({
      data: {
        actorUserId: input.actor.id,
        entityType: "TrialLimitAdjustment",
        entityId: adjustment.id,
        action: "created_design_change_extra_trial_adjustment",
        afterJson: {
          adjustmentType: adjustment.adjustmentType,
          deltaTrials: adjustment.deltaTrials,
          reason: adjustment.reason,
          relatedDesignChangeEventId: adjustment.relatedDesignChangeEventId
        }
      }
    });
  }

  return {
    adjustment,
    designChange,
    grantsExtraTrial,
    updatedProject
  };
}
