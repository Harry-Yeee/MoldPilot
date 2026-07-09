import type { FileType as PrismaFileType, FileVisibility as PrismaFileVisibility } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { validateAttachmentUpload } from "@/domain/mold-trial/attachments";
import { measurementReportFileName } from "@/domain/mold-trial/measurement-report";
import { prisma } from "@/lib/prisma";
import { writeAttachmentFile } from "@/server/attachment-storage";

/**
 * Server-only (NOT a `"use server"` action — never callable from the client)
 * helper that persists a QC measurement report as a `QC_REPORT` attachment on a
 * completed trial event. It reuses the same validation
 * (`validateAttachmentUpload`), byte storage (`writeAttachmentFile`), and
 * `FileAttachment` + `ActivityLog` row shape that `uploadAttachment` uses, so
 * there is one source of truth for how a report file is validated and stored —
 * mirroring `issue-photo-storage.ts` (Feature 3).
 *
 * Two differences from the generic uploader: the stored `fileName` is forced to
 * `<projectCode>_<trialCode>_measurement-report.<ext>` (so Marketing's download
 * carries that name via the existing Content-Disposition route), and a "replace"
 * soft-deletes a previous report in the same transaction and logs the swap. The
 * caller (`qc-report-actions.ts`) is responsible for the permission + domain
 * eligibility checks before invoking this helper.
 */

export type StoreMeasurementReportInput = {
  actorId: string;
  projectId: string;
  projectCode: string;
  trialEventId: string;
  trialCode: string;
  file: File;
  visibility: PrismaFileVisibility;
  note: string | null;
  /** The current report being replaced, if any; soft-deleted in the same tx. */
  previousReport: { id: string; fileName: string } | null;
};

export type StoreMeasurementReportResult =
  | { ok: true; attachmentId: string; fileName: string; replaced: boolean }
  | { ok: false; message: string };

export async function storeMeasurementReport(
  input: StoreMeasurementReportInput
): Promise<StoreMeasurementReportResult> {
  // Same QC_REPORT rules the generic uploader enforces (pdf/xlsx/xls/docx/csv/
  // pptx/ppt ≤25 MB), validated BEFORE the file is read into memory.
  const validation = validateAttachmentUpload({
    fileType: "QC_REPORT",
    declaredContentType: input.file.type,
    fileName: input.file.name,
    sizeBytes: input.file.size
  });

  if (!validation.ok) {
    return { ok: false, message: validation.issues[0]?.message ?? "This report cannot be uploaded." };
  }

  const fileName = measurementReportFileName({
    projectCode: input.projectCode,
    trialCode: input.trialCode,
    extension: validation.extension
  });

  const attachmentId = randomUUID();
  const bytes = Buffer.from(await input.file.arrayBuffer());
  const { storageKey, sizeBytes } = await writeAttachmentFile({
    id: attachmentId,
    extension: validation.extension,
    data: bytes
  });

  const replaced = input.previousReport != null;

  await prisma.$transaction(async (tx) => {
    if (input.previousReport != null) {
      await tx.fileAttachment.update({
        where: { id: input.previousReport.id },
        data: { deletedAt: new Date(), deletedById: input.actorId }
      });

      await tx.activityLog.create({
        data: {
          actorUserId: input.actorId,
          entityType: "FileAttachment",
          entityId: input.previousReport.id,
          action: "MEASUREMENT_REPORT_REPLACED",
          beforeJson: {
            projectCode: input.projectCode,
            fileName: input.previousReport.fileName,
            trialEventId: input.trialEventId,
            trialCode: input.trialCode
          },
          afterJson: {
            replacedByAttachmentId: attachmentId,
            replacedByFileName: fileName
          }
        }
      });
    }

    const attachment = await tx.fileAttachment.create({
      data: {
        id: attachmentId,
        moldTrialProjectId: input.projectId,
        entityType: "TRIAL_EVENT",
        entityId: input.trialEventId,
        fileName,
        fileType: "QC_REPORT" as PrismaFileType,
        storageKey,
        contentType: validation.contentType,
        sizeBytes,
        visibility: input.visibility,
        uploadedById: input.actorId
      }
    });

    await tx.activityLog.create({
      data: {
        actorUserId: input.actorId,
        entityType: "FileAttachment",
        entityId: attachment.id,
        action: replaced ? "replaced_measurement_report" : "uploaded_measurement_report",
        afterJson: {
          projectCode: input.projectCode,
          fileName: attachment.fileName,
          fileType: attachment.fileType,
          visibility: attachment.visibility,
          sizeBytes: attachment.sizeBytes,
          trialEventId: input.trialEventId,
          trialCode: input.trialCode,
          note: input.note
        }
      }
    });
  });

  return { ok: true, attachmentId, fileName, replaced };
}
