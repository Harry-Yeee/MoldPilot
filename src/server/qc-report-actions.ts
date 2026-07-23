"use server";

import type { FileVisibility as PrismaFileVisibility } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  canUploadMeasurementReport,
  newestMeasurementReport
} from "@/domain/mold-trial/measurement-report";
import type { TrialStatusDbValue } from "@/domain/mold-trial/my-plate";
import {
  DUPLICATE_SUBMISSION_WINDOW_MS,
  isDuplicateMeasurementReportSubmission
} from "@/domain/mold-trial/submission-guards";
import { prisma } from "@/lib/prisma";
import { friendlyActionErrorMessage } from "@/server/action-errors";
import { getCurrentUser } from "@/server/current-user";
import { hasPermission } from "@/server/permissions";
import { storeMeasurementReport } from "@/server/measurement-report-storage";

/**
 * Server action for the QC measurement-report workflow. Wraps the shared
 * `storeMeasurementReport` helper: forces fileType QC_REPORT + entityType
 * TRIAL_EVENT, defaults visibility to CUSTOMER_SAFE (uploader may choose INTERNAL
 * for drafts not ready for the customer), and enforces both the permission
 * (`qc.measurement_report.upload`, plus `qc.measurement_report.replace` when a
 * report already exists) and the domain eligibility rule (COMPLETED /
 * PENDING_FOLLOW_UP only) server-side. Replacing soft-deletes the previous report
 * and logs MEASUREMENT_REPORT_REPLACED inside the storage helper's transaction.
 */

/** Visibilities the uploader may pick for a report — customer-safe or an internal draft. */
const REPORT_VISIBILITIES = ["CUSTOMER_SAFE", "INTERNAL"] as const satisfies readonly PrismaFileVisibility[];
const DEFAULT_REPORT_VISIBILITY: PrismaFileVisibility = "CUSTOMER_SAFE";

function value(formData: FormData, key: string): string {
  const raw = formData.get(key);
  return typeof raw === "string" ? raw.trim() : "";
}

function redirectPath(formData: FormData, fallback: string): string {
  const path = value(formData, "redirectTo");
  return path.startsWith("/") ? path : fallback;
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

function parseVisibility(raw: string): PrismaFileVisibility {
  if (raw.length === 0) {
    return DEFAULT_REPORT_VISIBILITY;
  }
  if ((REPORT_VISIBILITIES as readonly string[]).includes(raw)) {
    return raw as PrismaFileVisibility;
  }
  throw new Error("Unsupported visibility for a measurement report.");
}

export async function uploadMeasurementReport(formData: FormData) {
  const fallback = redirectPath(formData, "/");

  try {
    const actor = await getCurrentUser();

    if (!(await hasPermission(actor.id, "qc.measurement_report.upload"))) {
      redirectWithMessage(fallback, "error", "You do not have permission to upload measurement reports.");
    }

    const trialEventId = value(formData, "trialEventId");
    if (trialEventId.length === 0) {
      redirectWithMessage(fallback, "error", "Missing trial reference.");
    }

    const trial = await prisma.trialEvent.findUnique({
      where: { id: trialEventId },
      select: {
        id: true,
        status: true,
        trialCode: true,
        sequenceNumber: true,
        moldTrialProject: { select: { id: true, projectCode: true } }
      }
    });

    if (trial == null) {
      redirectWithMessage(fallback, "error", "Trial was not found.");
    }

    if (!canUploadMeasurementReport(trial.status as TrialStatusDbValue)) {
      redirectWithMessage(
        fallback,
        "error",
        "A measurement report can only be uploaded for a completed trial."
      );
    }

    const file = formData.get("file");
    if (!(file instanceof File) || file.size === 0) {
      redirectWithMessage(fallback, "error", "Choose a report file to upload.");
    }

    const visibility = parseVisibility(value(formData, "visibility"));
    const noteRaw = value(formData, "note");
    const note = noteRaw.length === 0 ? null : noteRaw;

    // Find the current report (if any) so a re-upload is treated as a replace:
    // the replace permission is required, and the old file is soft-deleted.
    const candidates = await prisma.fileAttachment.findMany({
      where: {
        moldTrialProjectId: trial.moldTrialProject.id,
        entityType: "TRIAL_EVENT",
        entityId: trial.id,
        fileType: "QC_REPORT",
        deletedAt: null
      },
      select: {
        id: true,
        entityType: true,
        entityId: true,
        fileType: true,
        deletedAt: true,
        uploadedAt: true,
        fileName: true,
        uploadedById: true,
        sizeBytes: true
      }
    });

    // Double-tap guard: an identical re-tap (same trial + uploader + byte size)
    // within the window returns success without a second write — and BEFORE the
    // replace gate, so a plain double-tap never trips a "no replace permission"
    // error. A genuine replacement file differs in size and flows through below.
    const now = new Date();
    if (
      candidates.some((candidate) =>
        isDuplicateMeasurementReportSubmission(
          { entityId: candidate.entityId, uploadedById: candidate.uploadedById, sizeBytes: candidate.sizeBytes, uploadedAt: candidate.uploadedAt },
          { entityId: trial.id, uploadedById: actor.id, sizeBytes: file.size },
          now,
          DUPLICATE_SUBMISSION_WINDOW_MS
        )
      )
    ) {
      revalidatePath(fallback);
      redirectWithMessage(fallback, "success", "Measurement report uploaded.");
    }

    const newest = newestMeasurementReport(
      candidates.map((candidate) => ({
        id: candidate.id,
        entityType: candidate.entityType,
        entityId: candidate.entityId,
        fileType: candidate.fileType,
        deletedAt: candidate.deletedAt,
        uploadedAt: candidate.uploadedAt,
        // Not needed for selection; supplied to satisfy the shared shape.
        uploaderName: "",
        visibility: ""
      })),
      trial.id
    );
    const existing = newest == null ? null : candidates.find((candidate) => candidate.id === newest.id) ?? null;

    if (existing != null && !(await hasPermission(actor.id, "qc.measurement_report.replace"))) {
      redirectWithMessage(fallback, "error", "You do not have permission to replace a measurement report.");
    }

    const result = await storeMeasurementReport({
      actorId: actor.id,
      projectId: trial.moldTrialProject.id,
      projectCode: trial.moldTrialProject.projectCode,
      trialEventId: trial.id,
      trialCode: `T${Math.max(0, trial.sequenceNumber - 1)}`,
      file,
      visibility,
      note,
      previousReport: existing == null ? null : { id: existing.id, fileName: existing.fileName }
    });

    if (!result.ok) {
      redirectWithMessage(fallback, "error", result.message);
    }

    revalidatePath(fallback);
    redirectWithMessage(
      fallback,
      "success",
      result.replaced ? "Measurement report replaced." : "Measurement report uploaded."
    );
  } catch (error) {
    if (isRedirectSignal(error)) {
      throw error;
    }

    redirectWithMessage(fallback, "error", friendlyActionErrorMessage(error, "Unable to upload measurement report."));
  }
}
