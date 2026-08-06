"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { assertProjectNotArchived } from "@/domain/mold-trial/project-archive";
import { prisma } from "@/lib/prisma";
import { friendlyActionErrorMessage } from "@/server/action-errors";
import { getCurrentUser } from "@/server/current-user";
import { hasPermission } from "@/server/permissions";

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

export async function uploadAttachment(formData: FormData) {
  const fallback = redirectPath(formData, "/");
  redirectWithMessage(
    fallback,
    "error",
    "This upload form is outdated. Refresh the page and use the protected uploader."
  );
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

    // Archived projects are READ ONLY, and that includes their files: the list
    // still renders and every file still downloads, but nothing may be removed.
    const project = await prisma.moldTrialProject.findUnique({
      where: { projectCode: attachment.moldTrialProject.projectCode }
    });

    if (project != null) {
      assertProjectNotArchived(project);
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
