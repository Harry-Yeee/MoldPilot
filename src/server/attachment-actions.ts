"use server";

import type {
  AttachmentEntityType as PrismaAttachmentEntityType,
  FileType as PrismaFileType,
  FileVisibility as PrismaFileVisibility
} from "@prisma/client";
import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  defaultVisibilityForFileType,
  selectableVisibilities,
  uploadableFileTypes,
  validateAttachmentUpload,
  type AttachmentFileType,
  type AttachmentVisibility
} from "@/domain/mold-trial/attachments";
import {
  DUPLICATE_SUBMISSION_WINDOW_MS,
  isDuplicateAttachmentSubmission
} from "@/domain/mold-trial/submission-guards";
import { prisma } from "@/lib/prisma";
import { friendlyActionErrorMessage } from "@/server/action-errors";
import { getCurrentUser } from "@/server/current-user";
import { hasPermission } from "@/server/permissions";
import { writeAttachmentFile } from "@/server/attachment-storage";

const fileTypeValues = uploadableFileTypes as readonly PrismaFileType[];
const visibilityValues = selectableVisibilities as readonly PrismaFileVisibility[];
const entityTypeValues = [
  "MOLD_TRIAL_PROJECT",
  "TRIAL_EVENT",
  "TRIAL_ISSUE",
  "DESIGN_CHANGE_EVENT",
  "MISSED_TRIAL_EVENT"
] as const satisfies readonly PrismaAttachmentEntityType[];

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

function parseFileType(raw: string): AttachmentFileType {
  if ((fileTypeValues as readonly string[]).includes(raw)) {
    return raw as AttachmentFileType;
  }
  throw new Error("Unsupported file type.");
}

/**
 * Resolve the visibility for an upload. An explicit, valid choice wins; when the
 * field is omitted/blank we apply the FileType-aware default server-side (CAD +
 * video default to TECHNICAL, everything else to INTERNAL) so the IP-protection
 * default is enforced even if the client never sent a value. CUSTOMER_SAFE is
 * never a default — it can only arrive as an explicit choice.
 */
function parseVisibility(raw: string, fileType: AttachmentFileType): AttachmentVisibility {
  if (raw.length === 0) {
    return defaultVisibilityForFileType(fileType);
  }
  if ((visibilityValues as readonly string[]).includes(raw)) {
    return raw as AttachmentVisibility;
  }
  throw new Error("Unsupported visibility.");
}

function parseEntityType(raw: string): PrismaAttachmentEntityType {
  if ((entityTypeValues as readonly string[]).includes(raw)) {
    return raw as PrismaAttachmentEntityType;
  }
  throw new Error("Unsupported attachment target.");
}

/**
 * Confirm the (entityType, entityId) target actually belongs to the given
 * project, so an upload can never be filed against another project's records.
 */
async function assertEntityBelongsToProject(
  entityType: PrismaAttachmentEntityType,
  entityId: string,
  projectId: string
): Promise<void> {
  if (entityType === "MOLD_TRIAL_PROJECT") {
    if (entityId !== projectId) {
      throw new Error("Attachment target does not belong to this project.");
    }
    return;
  }

  const matchers: Record<Exclude<PrismaAttachmentEntityType, "MOLD_TRIAL_PROJECT" | "PROCESS_SHEET_EXPORT">, () => Promise<number>> = {
    TRIAL_EVENT: () => prisma.trialEvent.count({ where: { id: entityId, moldTrialProjectId: projectId } }),
    TRIAL_ISSUE: () => prisma.trialIssue.count({ where: { id: entityId, moldTrialProjectId: projectId } }),
    DESIGN_CHANGE_EVENT: () =>
      prisma.designChangeEvent.count({ where: { id: entityId, moldTrialProjectId: projectId } }),
    MISSED_TRIAL_EVENT: () =>
      prisma.missedTrialEvent.count({ where: { id: entityId, moldTrialProjectId: projectId } })
  };

  const matcher = matchers[entityType as keyof typeof matchers];
  if (matcher == null) {
    throw new Error("Attachment target does not belong to this project.");
  }

  const matches = await matcher();
  if (matches === 0) {
    throw new Error("Attachment target does not belong to this project.");
  }
}

export async function uploadAttachment(formData: FormData) {
  const fallback = redirectPath(formData, "/");

  try {
    const actor = await getCurrentUser();

    if (!(await hasPermission(actor.id, "attachment.upload"))) {
      redirectWithMessage(fallback, "error", "You do not have permission to upload files.");
    }

    const projectId = value(formData, "projectId");
    if (projectId.length === 0) {
      redirectWithMessage(fallback, "error", "Missing project reference.");
    }

    const project = await prisma.moldTrialProject.findUnique({
      where: { id: projectId },
      select: { id: true, projectCode: true }
    });
    if (project == null) {
      redirectWithMessage(fallback, "error", "Project was not found.");
    }

    const entityType = parseEntityType(value(formData, "entityType"));
    const entityId = value(formData, "entityId");
    if (entityId.length === 0) {
      redirectWithMessage(fallback, "error", "Missing attachment target.");
    }
    const fileType = parseFileType(value(formData, "fileType"));
    const visibility = parseVisibility(value(formData, "visibility"), fileType);

    const file = formData.get("file");
    if (!(file instanceof File) || file.size === 0) {
      redirectWithMessage(fallback, "error", "Choose a file to upload.");
    }

    await assertEntityBelongsToProject(entityType, entityId, project.id);

    // Validate type + size BEFORE reading the file into memory.
    const validation = validateAttachmentUpload({
      fileType,
      declaredContentType: file.type,
      fileName: file.name,
      sizeBytes: file.size
    });

    if (!validation.ok) {
      redirectWithMessage(fallback, "error", validation.issues[0]?.message ?? "This file cannot be uploaded.");
    }

    // Double-tap guard: an identical file (same target + uploader + stored name +
    // byte size) written within the window is a re-tap — skip the disk + DB write
    // and return success instead of creating a duplicate attachment row.
    const now = new Date();
    const duplicateWindowStart = new Date(now.getTime() - DUPLICATE_SUBMISSION_WINDOW_MS);
    const recentUploads = await prisma.fileAttachment.findMany({
      where: {
        moldTrialProjectId: project.id,
        entityType,
        entityId,
        uploadedById: actor.id,
        deletedAt: null,
        uploadedAt: { gte: duplicateWindowStart }
      },
      select: { entityId: true, uploadedById: true, fileName: true, sizeBytes: true, uploadedAt: true }
    });
    if (
      recentUploads.some((existing) =>
        isDuplicateAttachmentSubmission(
          existing,
          { entityId, uploadedById: actor.id, fileName: validation.safeFileName, sizeBytes: file.size },
          now
        )
      )
    ) {
      revalidatePath(fallback);
      redirectWithMessage(fallback, "success", "File uploaded.");
    }

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
          moldTrialProjectId: project.id,
          entityType,
          entityId,
          fileName: validation.safeFileName,
          fileType: fileType as PrismaFileType,
          storageKey,
          contentType: validation.contentType,
          sizeBytes,
          visibility: visibility as PrismaFileVisibility,
          uploadedById: actor.id
        }
      });

      await tx.activityLog.create({
        data: {
          actorUserId: actor.id,
          entityType: "FileAttachment",
          entityId: attachment.id,
          action: "uploaded_attachment",
          afterJson: {
            projectCode: project.projectCode,
            fileName: attachment.fileName,
            fileType: attachment.fileType,
            visibility: attachment.visibility,
            sizeBytes: attachment.sizeBytes,
            targetEntityType: entityType,
            targetEntityId: entityId
          }
        }
      });
    });

    revalidatePath(fallback);
    redirectWithMessage(fallback, "success", "File uploaded.");
  } catch (error) {
    if (isRedirectSignal(error)) {
      throw error;
    }

    redirectWithMessage(fallback, "error", friendlyActionErrorMessage(error, "Unable to upload file."));
  }
}

export async function deleteAttachment(formData: FormData) {
  const fallback = redirectPath(formData, "/");

  try {
    const actor = await getCurrentUser();
    const attachmentId = value(formData, "attachmentId");
    if (attachmentId.length === 0) {
      redirectWithMessage(fallback, "error", "Missing attachment reference.");
    }

    const attachment = await prisma.fileAttachment.findUnique({
      where: { id: attachmentId },
      select: {
        id: true,
        fileName: true,
        uploadedById: true,
        deletedAt: true,
        moldTrialProject: { select: { projectCode: true } }
      }
    });

    if (attachment == null || attachment.deletedAt != null) {
      redirectWithMessage(fallback, "error", "Attachment was not found.");
    }

    // Uploader-or-admin rule: the original uploader may always delete their own
    // file; anyone else needs the attachment.delete permission (Admin by default).
    const isUploader = attachment.uploadedById === actor.id;
    const canAdminDelete = await hasPermission(actor.id, "attachment.delete");
    if (!isUploader && !canAdminDelete) {
      redirectWithMessage(fallback, "error", "You do not have permission to delete this file.");
    }

    await prisma.$transaction(async (tx) => {
      await tx.fileAttachment.update({
        where: { id: attachment.id },
        data: {
          deletedAt: new Date(),
          deletedById: actor.id
        }
      });

      await tx.activityLog.create({
        data: {
          actorUserId: actor.id,
          entityType: "FileAttachment",
          entityId: attachment.id,
          action: "deleted_attachment",
          beforeJson: {
            projectCode: attachment.moldTrialProject.projectCode,
            fileName: attachment.fileName
          }
        }
      });
    });

    revalidatePath(fallback);
    redirectWithMessage(fallback, "success", "File deleted.");
  } catch (error) {
    if (isRedirectSignal(error)) {
      throw error;
    }

    redirectWithMessage(fallback, "error", friendlyActionErrorMessage(error, "Unable to delete file."));
  }
}
