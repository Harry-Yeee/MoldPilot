import type { FileType as PrismaFileType, FileVisibility as PrismaFileVisibility } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { validateAttachmentUpload } from "@/domain/mold-trial/attachments";
import { prisma } from "@/lib/prisma";
import { writeAttachmentFile } from "@/server/attachment-storage";

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

    try {
      const attachmentId = randomUUID();
      const bytes = Buffer.from(await file.arrayBuffer());
      const { storageKey, sizeBytes } = await writeAttachmentFile({
        id: attachmentId,
        extension: validation.extension,
        data: bytes
      });

      await prisma.$transaction(async (tx) => {
        const attachment = await tx.fileAttachment.create({
          data: {
            id: attachmentId,
            moldTrialProjectId: input.projectId,
            entityType: "TRIAL_ISSUE",
            entityId: input.issueId,
            fileName: validation.safeFileName,
            fileType: "TRIAL_PHOTO" as PrismaFileType,
            storageKey,
            contentType: validation.contentType,
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
              targetEntityId: input.issueId
            }
          }
        });
      });

      storedCount += 1;
    } catch {
      failures.push({ fileName: displayName, message: "Could not be saved." });
    }
  }

  return { storedCount, failures };
}
