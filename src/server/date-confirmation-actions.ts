"use server";

import type { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  approveTrialDateChange as approveTrialDateChangeTransition,
  clearedProposalFields,
  confirmTrialDate as confirmTrialDateTransition,
  participatesInDateConfirmation,
  proposeTrialDateChange as proposeTrialDateChangeTransition,
  rejectTrialDateChange as rejectTrialDateChangeTransition,
  type DateConfirmationResult
} from "@/domain/mold-trial/date-confirmation";
import type { PermissionCode } from "@/domain/mold-trial/permission-policy";
import { snapshotInjectionMachine } from "@/domain/mold-trial/process-sheet";
import { prisma } from "@/lib/prisma";
import { friendlyActionErrorMessage } from "@/server/action-errors";
import { getCurrentUser } from "@/server/current-user";
import { requirePermissions } from "@/server/permissions";

function value(formData: FormData, key: string): string {
  const raw = formData.get(key);
  return typeof raw === "string" ? raw.trim() : "";
}

function optionalValue(formData: FormData, key: string): string | null {
  const next = value(formData, key);
  return next.length === 0 ? null : next;
}

function formDate(formData: FormData, key: string): Date | null {
  const raw = optionalValue(formData, key);

  if (raw == null) {
    return null;
  }

  const date = new Date(`${raw}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function activityDate(value: Date | null | undefined): string | null {
  return value == null ? null : value.toISOString().slice(0, 10);
}

function redirectPath(formData: FormData, fallback: string): string {
  const path = optionalValue(formData, "redirectTo");
  return path?.startsWith("/") === true ? path : fallback;
}

function redirectWithMessage(path: string, type: "error" | "success", message: string): never {
  const separator = path.includes("?") ? "&" : "?";
  redirect(`${path}${separator}${type}=${encodeURIComponent(message)}`);
}

function isRedirectSignal(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "digest" in error &&
    String((error as { digest: unknown }).digest).startsWith("NEXT_REDIRECT")
  );
}

async function getActor(requiredPermissions: PermissionCode | readonly PermissionCode[]) {
  const actor = await getCurrentUser();
  const permissionsToRequire = typeof requiredPermissions === "string" ? [requiredPermissions] : requiredPermissions;

  await requirePermissions(actor.id, permissionsToRequire);

  return actor;
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

/**
 * Load the trial + its project scope, asserting it exists, belongs to the given
 * project, and still participates in the handshake (planned / at-risk). Returns
 * the trial row (with the confirmation columns) plus the resolved fallback path.
 */
async function loadParticipatingTrial(input: {
  formData: FormData;
  fallback: string;
}) {
  const projectCode = value(input.formData, "projectCode");
  const trialEventId = value(input.formData, "trialEventId");

  if (trialEventId.length === 0) {
    redirectWithMessage(input.fallback, "error", "Trial event is required.");
  }

  const trial = await prisma.trialEvent.findUnique({
    where: { id: trialEventId },
    select: {
      id: true,
      status: true,
      plannedDate: true,
      dateConfirmationStatus: true,
      proposedDate: true,
      proposedReason: true,
      injectionMachineId: true,
      moldTrialProject: {
        select: {
          id: true,
          projectCode: true,
          customerTargetDate: true
        }
      }
    }
  });

  if (trial == null) {
    redirectWithMessage(input.fallback, "error", "Trial event not found.");
  }

  if (projectCode.length > 0 && trial.moldTrialProject.projectCode !== projectCode) {
    redirectWithMessage(input.fallback, "error", "Trial event does not belong to this project.");
  }

  if (!participatesInDateConfirmation(trial.status)) {
    redirectWithMessage(
      input.fallback,
      "error",
      "Only current planned or at-risk trials take part in date confirmation."
    );
  }

  return trial;
}

function guardTransition(result: DateConfirmationResult, fallback: string): void {
  if (!result.ok) {
    redirectWithMessage(fallback, "error", result.message);
  }
}

/** Injection confirms the trial's planned date and pins an injection machine. */
export async function confirmTrialDate(formData: FormData) {
  const projectCode = value(formData, "projectCode");
  const fallback = redirectPath(formData, `/projects/${projectCode}`);

  try {
    const actor = await getActor("trial.date.confirm");
    const trial = await loadParticipatingTrial({ formData, fallback });
    const injectionMachineId = optionalValue(formData, "injectionMachineId");

    const transition = confirmTrialDateTransition({
      state: {
        dateConfirmationStatus: trial.dateConfirmationStatus,
        plannedDate: trial.plannedDate,
        proposedDate: trial.proposedDate
      },
      injectionMachineId
    });
    guardTransition(transition, fallback);

    const machine =
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

    if (machine == null) {
      redirectWithMessage(fallback, "error", "Selected injection machine was not found.");
    }

    if (!machine.active) {
      redirectWithMessage(fallback, "error", "Archived injection machines cannot confirm a trial date.");
    }

    const snapshot = snapshotInjectionMachine(machine);

    await prisma.$transaction(async (tx) => {
      const confirmed = await tx.trialEvent.update({
        where: { id: trial.id },
        data: {
          dateConfirmationStatus: "CONFIRMED",
          dateConfirmedById: actor.id,
          dateConfirmedAt: new Date(),
          injectionMachineId: machine.id,
          machineNoSnapshot: snapshot.machineNoSnapshot,
          machineTonnageSnapshot: snapshot.machineTonnageSnapshot,
          machine: snapshot.machineDisplayText,
          ...clearedProposalFields()
        }
      });

      await logActivity(tx, {
        actorUserId: actor.id,
        entityType: "TrialEvent",
        entityId: confirmed.id,
        action: "confirmed_trial_date",
        beforeJson: {
          dateConfirmationStatus: trial.dateConfirmationStatus,
          plannedDate: activityDate(trial.plannedDate)
        },
        afterJson: {
          dateConfirmationStatus: confirmed.dateConfirmationStatus,
          plannedDate: activityDate(confirmed.plannedDate),
          machineNoSnapshot: confirmed.machineNoSnapshot
        }
      });
    });

    revalidatePath("/");
    revalidatePath(fallback);
    redirectWithMessage(fallback, "success", "Trial date confirmed.");
  } catch (error) {
    if (isRedirectSignal(error)) {
      throw error;
    }

    redirectWithMessage(fallback, "error", friendlyActionErrorMessage(error, "Unable to confirm trial date."));
  }
}

/** Injection counter-proposes a different planned date with a required reason. */
export async function proposeTrialDateChange(formData: FormData) {
  const projectCode = value(formData, "projectCode");
  const fallback = redirectPath(formData, `/projects/${projectCode}`);

  try {
    const actor = await getActor("trial.date.propose_change");
    const trial = await loadParticipatingTrial({ formData, fallback });
    const proposedDate = formDate(formData, "proposedDate");
    const reason = optionalValue(formData, "proposedReason");

    const transition = proposeTrialDateChangeTransition({
      state: {
        dateConfirmationStatus: trial.dateConfirmationStatus,
        plannedDate: trial.plannedDate,
        proposedDate: trial.proposedDate
      },
      proposedDate,
      reason
    });
    guardTransition(transition, fallback);

    await prisma.$transaction(async (tx) => {
      const proposed = await tx.trialEvent.update({
        where: { id: trial.id },
        data: {
          dateConfirmationStatus: "RESCHEDULE_PROPOSED",
          proposedDate,
          proposedById: actor.id,
          proposedReason: reason,
          rescheduleDecisionById: null,
          rescheduleDecisionAt: null,
          rescheduleRejectReason: null
        }
      });

      await logActivity(tx, {
        actorUserId: actor.id,
        entityType: "TrialEvent",
        entityId: proposed.id,
        action: "proposed_trial_date_change",
        beforeJson: {
          dateConfirmationStatus: trial.dateConfirmationStatus,
          plannedDate: activityDate(trial.plannedDate)
        },
        afterJson: {
          dateConfirmationStatus: proposed.dateConfirmationStatus,
          plannedDate: activityDate(proposed.plannedDate),
          proposedDate: activityDate(proposed.proposedDate),
          proposedReason: proposed.proposedReason
        }
      });
    });

    revalidatePath("/");
    revalidatePath(fallback);
    redirectWithMessage(fallback, "success", "Proposed a different trial date. Awaiting Marketing approval.");
  } catch (error) {
    if (isRedirectSignal(error)) {
      throw error;
    }

    redirectWithMessage(fallback, "error", friendlyActionErrorMessage(error, "Unable to propose a trial date change."));
  }
}

/**
 * Marketing approves the counter-proposal: the proposed date becomes the new
 * planned date and the trial is confirmed, all in the same transaction so the
 * auto-missed cutoff keys off the new plannedDate. The old planned date is
 * recorded in the ActivityLog beforeJson.
 */
export async function approveTrialDateChange(formData: FormData) {
  const projectCode = value(formData, "projectCode");
  const fallback = redirectPath(formData, `/projects/${projectCode}`);

  try {
    const actor = await getActor("trial.date.approve_change");
    const trial = await loadParticipatingTrial({ formData, fallback });

    const transition = approveTrialDateChangeTransition({
      state: {
        dateConfirmationStatus: trial.dateConfirmationStatus,
        plannedDate: trial.plannedDate,
        proposedDate: trial.proposedDate
      }
    });
    guardTransition(transition, fallback);

    if (!transition.ok || transition.newPlannedDate == null) {
      redirectWithMessage(fallback, "error", "There is no proposed date to approve.");
    }

    const newPlannedDate = transition.newPlannedDate as Date;

    await prisma.$transaction(async (tx) => {
      const approved = await tx.trialEvent.update({
        where: { id: trial.id },
        data: {
          plannedDate: newPlannedDate,
          dateConfirmationStatus: "CONFIRMED",
          dateConfirmedById: actor.id,
          dateConfirmedAt: new Date(),
          rescheduleDecisionById: actor.id,
          rescheduleDecisionAt: new Date(),
          rescheduleRejectReason: null,
          proposedDate: null,
          proposedById: null,
          proposedReason: null
        }
      });

      await tx.moldTrialProject.update({
        where: { id: trial.moldTrialProject.id },
        data: { nextPlannedTrialDate: newPlannedDate }
      });

      await logActivity(tx, {
        actorUserId: actor.id,
        entityType: "TrialEvent",
        entityId: approved.id,
        action: "approved_trial_date_change",
        beforeJson: {
          dateConfirmationStatus: trial.dateConfirmationStatus,
          plannedDate: activityDate(trial.plannedDate),
          proposedDate: activityDate(trial.proposedDate)
        },
        afterJson: {
          dateConfirmationStatus: approved.dateConfirmationStatus,
          plannedDate: activityDate(approved.plannedDate)
        }
      });
    });

    revalidatePath("/");
    revalidatePath(fallback);
    redirectWithMessage(fallback, "success", "Approved the new trial date.");
  } catch (error) {
    if (isRedirectSignal(error)) {
      throw error;
    }

    redirectWithMessage(fallback, "error", friendlyActionErrorMessage(error, "Unable to approve the trial date change."));
  }
}

/** Marketing rejects the counter-proposal with a required reason; returns to PM. */
export async function rejectTrialDateChange(formData: FormData) {
  const projectCode = value(formData, "projectCode");
  const fallback = redirectPath(formData, `/projects/${projectCode}`);

  try {
    const actor = await getActor("trial.date.approve_change");
    const trial = await loadParticipatingTrial({ formData, fallback });
    const reason = optionalValue(formData, "rescheduleRejectReason");

    const transition = rejectTrialDateChangeTransition({
      state: {
        dateConfirmationStatus: trial.dateConfirmationStatus,
        plannedDate: trial.plannedDate,
        proposedDate: trial.proposedDate
      },
      reason
    });
    guardTransition(transition, fallback);

    await prisma.$transaction(async (tx) => {
      const returned = await tx.trialEvent.update({
        where: { id: trial.id },
        data: {
          dateConfirmationStatus: "RETURNED_TO_PM",
          rescheduleDecisionById: actor.id,
          rescheduleDecisionAt: new Date(),
          rescheduleRejectReason: reason
        }
      });

      await logActivity(tx, {
        actorUserId: actor.id,
        entityType: "TrialEvent",
        entityId: returned.id,
        action: "rejected_trial_date_change",
        beforeJson: {
          dateConfirmationStatus: trial.dateConfirmationStatus,
          plannedDate: activityDate(trial.plannedDate),
          proposedDate: activityDate(trial.proposedDate)
        },
        afterJson: {
          dateConfirmationStatus: returned.dateConfirmationStatus,
          plannedDate: activityDate(returned.plannedDate),
          rescheduleRejectReason: returned.rescheduleRejectReason
        }
      });
    });

    revalidatePath("/");
    revalidatePath(fallback);
    redirectWithMessage(fallback, "success", "Returned the trial date to the PM.");
  } catch (error) {
    if (isRedirectSignal(error)) {
      throw error;
    }

    redirectWithMessage(fallback, "error", friendlyActionErrorMessage(error, "Unable to reject the trial date change."));
  }
}

/**
 * The PM re-dates a trial Marketing returned to them, coordinating a new planned
 * date and restarting the handshake (status back to PENDING_CONFIRMATION, all
 * proposal / decision fields cleared). Uses the PM's existing scheduling
 * permission. Only offered for RETURNED_TO_PM trials, but resetting from any
 * state is legal — the PM owns the planned date.
 */
export async function redateReturnedTrial(formData: FormData) {
  const projectCode = value(formData, "projectCode");
  const fallback = redirectPath(formData, `/projects/${projectCode}`);

  try {
    const actor = await getActor("trial.schedule.reschedule");
    const trial = await loadParticipatingTrial({ formData, fallback });
    const newPlannedDate = formDate(formData, "plannedDate");

    if (newPlannedDate == null) {
      redirectWithMessage(fallback, "error", "A new planned date is required.");
    }

    await prisma.$transaction(async (tx) => {
      const redated = await tx.trialEvent.update({
        where: { id: trial.id },
        data: {
          plannedDate: newPlannedDate,
          status: "PLANNED",
          sourceArea: "PLANNING",
          requestedById: actor.id,
          // Re-dating restarts the confirmation handshake from scratch.
          dateConfirmationStatus: "PENDING_CONFIRMATION",
          dateConfirmedById: null,
          dateConfirmedAt: null,
          ...clearedProposalFields()
        }
      });

      await tx.moldTrialProject.update({
        where: { id: trial.moldTrialProject.id },
        data: { nextPlannedTrialDate: newPlannedDate }
      });

      await logActivity(tx, {
        actorUserId: actor.id,
        entityType: "TrialEvent",
        entityId: redated.id,
        action: "redated_returned_trial",
        beforeJson: {
          dateConfirmationStatus: trial.dateConfirmationStatus,
          plannedDate: activityDate(trial.plannedDate),
          rescheduleRejectReason: trial.proposedReason
        },
        afterJson: {
          dateConfirmationStatus: redated.dateConfirmationStatus,
          plannedDate: activityDate(redated.plannedDate)
        }
      });
    });

    revalidatePath("/");
    revalidatePath(fallback);
    redirectWithMessage(fallback, "success", "Trial re-dated. Awaiting confirmation again.");
  } catch (error) {
    if (isRedirectSignal(error)) {
      throw error;
    }

    redirectWithMessage(fallback, "error", friendlyActionErrorMessage(error, "Unable to re-date the returned trial."));
  }
}
