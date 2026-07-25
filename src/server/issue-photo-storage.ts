import type { FileType as PrismaFileType, FileVisibility as PrismaFileVisibility } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { validateAttachmentUpload } from "@/domain/mold-trial/attachments";
import { validateIssuePhotoBatch } from "@/domain/mold-trial/issue-photos";
import {
  DUPLICATE_SUBMISSION_WINDOW_MS,
  isDuplicateAttachmentSubmission,
  type ExistingAttachmentSubmission
} from "@/domain/mold-trial/submission-guards";
import { prisma } from "@/lib/prisma";
import {
  releaseQuarantinedAttachment,
  removeStoredAttachment
} from "@/server/attachment-storage";
import { quarantineAndInspectBuffer } from "@/server/secure-upload-pipeline";

/**
 * Server-only (not a `"use server"` action — it is never callable from the
 * client) helper that persists trial-issue photos as INTERNAL `TRIAL_PHOTO`
 * attachments on an already-created issue. It reuses the same validation
 * (`validateAttachmentUpload`), byte storage (`writeAttachmentFile`), and
 * `FileAttachment` + `ActivityLog` row shape that `uploadAttachment` uses, so
 * there is one source of truth for how a photo is validated and stored.
 *
 * Called from `createTrialIssue` / `editTrialIssue` AFTER the issue transaction
 * commits, so a photo that fails validation or storage never rolls back the
 * issue or the other photos. Each photo is written in its own transaction and
 * failures are collected by filename for the caller's warning message.
 */

/** A photo that failed validation or storage, named so the caller can report it. */
export type IssuePhotoFailure = {
  fileName: string;
  message: string;
};

export type StoreIssuePhotosResult = {
  storedCount: number;
  failures: IssuePhotoFailure[];
};

export async function storeIssuePhotos(input: {
  actorId: string;
  projectId: string;
  projectCode: string;
  issueId: string;
  files: readonly File[];
}): Promise<StoreIssuePhotosResult> {
  const failures: IssuePhotoFailure[] = [];
  let storedCount = 0;
  const batchValidation = validateIssuePhotoBatch(input.files.map((file) => file.size));
  if (!batchValidation.ok) {
    return {
      storedCount,
      failures: [{ fileName: "photos", message: batchValidation.message }]
    };
  }

  // Double-tap guard: a re-submitted edit (same issue) that re-sends the same
  // photos should not add duplicate rows. Load this uploader's very recent
  // photos on the issue once, then skip any incoming file that matches one
  // (same stored name + byte size) within the window.
  const now = new Date();
  const duplicateWindowStart = new Date(now.getTime() - DUPLICATE_SUBMISSION_WINDOW_MS);
  const recentPhotos: ExistingAttachmentSubmission[] = (
    await prisma.fileAttachment.findMany({
      where: {
        moldTrialProjectId: input.projectId,
        entityType: "TRIAL_ISSUE",
        entityId: input.issueId,
        fileType: "TRIAL_PHOTO",
        uploadedById: input.actorId,
        deletedAt: null,
        uploadedAt: { gte: duplicateWindowStart }
      },
      select: { entityId: true, uploadedById: true, fileName: true, sizeBytes: true, uploadedAt: true }
    })
  ).map((row) => ({
    entityId: row.entityId,
    uploadedById: row.uploadedById,
    fileName: row.fileName,
    sizeBytes: row.sizeBytes,
    uploadedAt: row.uploadedAt
  }));

  for (const file of input.files) {
    if (!(file instanceof File) || file.size === 0) {
      continue;
    }

    const displayName = file.name.length > 0 ? file.name : "photo";

    // Same TRIAL_PHOTO rules the generic uploader enforces (jpeg/png/webp/heic ≤10 MB).
    const validation = validateAttachmentUpload({
      fileType: "TRIAL_PHOTO",
      declaredContentType: file.type,
      fileName: file.name,
      sizeBytes: file.size
    });

    if (!validation.ok) {
      failures.push({
        fileName: displayName,
        message: validation.issues[0]?.message ?? "This photo cannot be uploaded."
      });
      continue;
    }

    const photoKey = {
      entityId: input.issueId,
      uploadedById: input.actorId,
      fileName: validation.safeFileName,
      sizeBytes: file.size
    };
    if (recentPhotos.some((existing) => isDuplicateAttachmentSubmission(existing, photoKey, now))) {
      // Already stored within the window (double-tapped edit) — skip silently.
      continue;
    }

    try {
      const attachmentId = randomUUID();
      const bytes = Buffer.from(await file.arrayBuffer());
      const inspected = await quarantineAndInspectBuffer({
        id: attachmentId,
        data: bytes,
        fileType: "TRIAL_PHOTO",
        declaredContentType: file.type,
        fileName: file.name
      });
      if (!inspected.ok) {
        failures.push({ fileName: displayName, message: inspected.message });
        continue;
      }
      const { storageKey, sizeBytes } = await releaseQuarantinedAttachment({
        quarantinePath: inspected.quarantinePath,
        id: attachmentId,
        extension: inspected.validation.extension
      });

      try {
        await prisma.$transaction(async (tx) => {
          const attachment = await tx.fileAttachment.create({
            data: {
              id: attachmentId,
              moldTrialProjectId: input.projectId,
              entityType: "TRIAL_ISSUE",
              entityId: input.issueId,
              fileName: inspected.validation.safeFileName,
              fileType: "TRIAL_PHOTO" as PrismaFileType,
              storageKey,
              contentType: inspected.validation.contentType,
              sizeBytes,
              visibility: "INTERNAL" as PrismaFileVisibility,
              uploadedById: input.actorId
            }
          });

          await tx.activityLog.create({
            data: {
              actorUserId: input.actorId,
              entityType: "FileAttachment",
              entityId: attachment.id,
              action: "uploaded_attachment",
              afterJson: {
                projectCode: input.projectCode,
                fileName: attachment.fileName,
                fileType: attachment.fileType,
                visibility: attachment.visibility,
                sizeBytes: attachment.sizeBytes,
                targetEntityType: "TRIAL_ISSUE",
                targetEntityId: input.issueId,
                securityPipeline: "quarantine_signature_scan"
              }
            }
          });
        });
      } catch (error) {
        await removeStoredAttachment(storageKey);
        throw error;
      }

      // Track the just-stored photo so a repeated file within the same batch is
      // also treated as a duplicate.
      recentPhotos.push({ ...photoKey, uploadedAt: new Date() });
      storedCount += 1;
    } catch {
      failures.push({ fileName: displayName, message: "Could not be saved." });
    }
  }

  return { storedCount, failures };
}
