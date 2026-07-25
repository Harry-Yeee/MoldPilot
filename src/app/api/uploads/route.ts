import type {
  AttachmentEntityType,
  FileType,
  FileVisibility
} from "@prisma/client";
import { randomUUID } from "node:crypto";
import {
  attachmentSizeLimitBytes,
  defaultVisibilityForFileType,
  selectableVisibilities,
  uploadableFileTypes,
  validateAttachmentUpload,
  type AttachmentFileType,
  type AttachmentVisibility
} from "@/domain/mold-trial/attachments";
import {
  MAX_CONCURRENT_UPLOADS_PER_USER,
  validateUploadOrigin
} from "@/domain/security/upload-security";
import {
  canUploadMeasurementReport,
  measurementReportFileName,
  newestMeasurementReport
} from "@/domain/mold-trial/measurement-report";
import type { TrialStatusDbValue } from "@/domain/mold-trial/my-plate";
import {
  DUPLICATE_SUBMISSION_WINDOW_MS,
  isDuplicateAttachmentSubmission,
  isDuplicateMeasurementReportSubmission
} from "@/domain/mold-trial/submission-guards";
import { prisma } from "@/lib/prisma";
import {
  cleanupAbandonedQuarantineFiles,
  releaseQuarantinedAttachment,
  removeQuarantinedAttachment,
  removeStoredAttachment,
  streamBodyToQuarantine
} from "@/server/attachment-storage";
import { getOptionalCurrentUser } from "@/server/current-user";
import { hasPermission } from "@/server/permissions";
import { inspectAndScanQuarantinedAttachment } from "@/server/secure-upload-pipeline";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const entityTypes = new Set<AttachmentEntityType>([
  "MOLD_TRIAL_PROJECT",
  "TRIAL_EVENT",
  "TRIAL_ISSUE",
  "DESIGN_CHANGE_EVENT",
  "MISSED_TRIAL_EVENT"
]);
const fileTypes = new Set<string>(uploadableFileTypes);
const visibilities = new Set<string>(selectableVisibilities);
const visibilityManagers = new Set(["ADMIN", "GM", "PM"]);
const activeUploadsByUser = new Map<string, number>();

class UploadHttpError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
  }
}

function json(
  body: { success: boolean; message: string; attachmentId?: string; replaced?: boolean },
  status = 200
): Response {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff"
    }
  });
}

function decodedHeader(request: Request, name: string, maxLength: number): string {
  const raw = request.headers.get(name);
  if (raw == null || raw.length === 0 || raw.length > maxLength * 4) {
    return "";
  }
  try {
    return decodeURIComponent(raw).slice(0, maxLength);
  } catch {
    return "";
  }
}

function requiredHeader(request: Request, name: string, maxLength = 200): string {
  const result = decodedHeader(request, name, maxLength);
  if (result.length === 0) {
    throw new UploadHttpError("Upload metadata is incomplete.", 400);
  }
  return result;
}

function parseFileType(request: Request): AttachmentFileType {
  const raw = requiredHeader(request, "x-moldpilot-file-type", 40);
  if (!fileTypes.has(raw)) {
    throw new UploadHttpError("Unsupported file type.", 400);
  }
  return raw as AttachmentFileType;
}

function parseVisibility(
  request: Request,
  fileType: AttachmentFileType,
  canChoose: boolean
): AttachmentVisibility {
  if (!canChoose) {
    return defaultVisibilityForFileType(fileType);
  }
  const raw = decodedHeader(request, "x-moldpilot-visibility", 40);
  if (raw.length === 0) {
    return defaultVisibilityForFileType(fileType);
  }
  if (!visibilities.has(raw)) {
    throw new UploadHttpError("Unsupported file visibility.", 400);
  }
  return raw as AttachmentVisibility;
}

function parseEntityType(request: Request): AttachmentEntityType {
  const raw = requiredHeader(request, "x-moldpilot-entity-type", 50) as AttachmentEntityType;
  if (!entityTypes.has(raw)) {
    throw new UploadHttpError("Unsupported attachment target.", 400);
  }
  return raw;
}

function acquireUploadSlot(userId: string): (() => void) | null {
  const active = activeUploadsByUser.get(userId) ?? 0;
  if (active >= MAX_CONCURRENT_UPLOADS_PER_USER) {
    return null;
  }
  activeUploadsByUser.set(userId, active + 1);
  return () => {
    const next = Math.max(0, (activeUploadsByUser.get(userId) ?? 1) - 1);
    if (next === 0) {
      activeUploadsByUser.delete(userId);
    } else {
      activeUploadsByUser.set(userId, next);
    }
  };
}

function assertedContentLength(request: Request, maxBytes: number): number | null {
  const raw = request.headers.get("content-length");
  if (raw == null) {
    return null;
  }
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new UploadHttpError("Upload size is invalid.", 400);
  }
  if (parsed > maxBytes) {
    throw new UploadHttpError("Upload exceeds the permitted size.", 413);
  }
  return parsed;
}

async function assertEntityBelongsToProject(
  entityType: AttachmentEntityType,
  entityId: string,
  projectId: string
): Promise<void> {
  if (entityType === "MOLD_TRIAL_PROJECT") {
    if (entityId !== projectId) {
      throw new UploadHttpError("Attachment target is invalid.", 400);
    }
    return;
  }

  const count =
    entityType === "TRIAL_EVENT"
      ? await prisma.trialEvent.count({ where: { id: entityId, moldTrialProjectId: projectId } })
      : entityType === "TRIAL_ISSUE"
        ? await prisma.trialIssue.count({ where: { id: entityId, moldTrialProjectId: projectId } })
        : entityType === "DESIGN_CHANGE_EVENT"
          ? await prisma.designChangeEvent.count({ where: { id: entityId, moldTrialProjectId: projectId } })
          : await prisma.missedTrialEvent.count({ where: { id: entityId, moldTrialProjectId: projectId } });
  if (count === 0) {
    throw new UploadHttpError("Attachment target is invalid.", 400);
  }
}

async function persistGenericUpload(input: {
  attachmentId: string;
  actorId: string;
  projectId: string;
  projectCode: string;
  entityType: AttachmentEntityType;
  entityId: string;
  fileType: AttachmentFileType;
  visibility: AttachmentVisibility;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  storageKey: string;
}): Promise<{ attachmentId: string; duplicate: boolean }> {
  const now = new Date();
  const recent = await prisma.fileAttachment.findMany({
    where: {
      moldTrialProjectId: input.projectId,
      entityType: input.entityType,
      entityId: input.entityId,
      uploadedById: input.actorId,
      deletedAt: null,
      uploadedAt: { gte: new Date(now.getTime() - DUPLICATE_SUBMISSION_WINDOW_MS) }
    },
    select: {
      id: true,
      entityId: true,
      uploadedById: true,
      fileName: true,
      sizeBytes: true,
      uploadedAt: true
    }
  });
  const duplicate = recent.find((existing) =>
    isDuplicateAttachmentSubmission(
      existing,
      {
        entityId: input.entityId,
        uploadedById: input.actorId,
        fileName: input.fileName,
        sizeBytes: input.sizeBytes
      },
      now
    )
  );
  if (duplicate != null) {
    await removeStoredAttachment(input.storageKey);
    return { attachmentId: duplicate.id, duplicate: true };
  }

  try {
    await prisma.$transaction(async (tx) => {
      const attachment = await tx.fileAttachment.create({
        data: {
          id: input.attachmentId,
          moldTrialProjectId: input.projectId,
          entityType: input.entityType,
          entityId: input.entityId,
          fileName: input.fileName,
          fileType: input.fileType as FileType,
          storageKey: input.storageKey,
          contentType: input.contentType,
          sizeBytes: input.sizeBytes,
          visibility: input.visibility as FileVisibility,
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
            targetEntityType: input.entityType,
            targetEntityId: input.entityId,
            securityPipeline: "quarantine_validate_scan_release"
          }
        }
      });
    });
  } catch (error) {
    await removeStoredAttachment(input.storageKey);
    throw error;
  }
  return { attachmentId: input.attachmentId, duplicate: false };
}

async function persistMeasurementReport(input: {
  attachmentId: string;
  actorId: string;
  trial: {
    id: string;
    sequenceNumber: number;
    moldTrialProject: { id: string; projectCode: string };
  };
  visibility: AttachmentVisibility;
  note: string | null;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  storageKey: string;
  previousReport: { id: string; fileName: string } | null;
}): Promise<void> {
  const trialCode = `T${Math.max(0, input.trial.sequenceNumber - 1)}`;
  try {
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
              projectCode: input.trial.moldTrialProject.projectCode,
              fileName: input.previousReport.fileName,
              trialEventId: input.trial.id,
              trialCode
            },
            afterJson: {
              replacedByAttachmentId: input.attachmentId,
              replacedByFileName: input.fileName
            }
          }
        });
      }

      const attachment = await tx.fileAttachment.create({
        data: {
          id: input.attachmentId,
          moldTrialProjectId: input.trial.moldTrialProject.id,
          entityType: "TRIAL_EVENT",
          entityId: input.trial.id,
          fileName: input.fileName,
          fileType: "QC_REPORT",
          storageKey: input.storageKey,
          contentType: input.contentType,
          sizeBytes: input.sizeBytes,
          visibility: input.visibility as FileVisibility,
          uploadedById: input.actorId
        }
      });
      await tx.activityLog.create({
        data: {
          actorUserId: input.actorId,
          entityType: "FileAttachment",
          entityId: attachment.id,
          action: input.previousReport == null ? "uploaded_measurement_report" : "replaced_measurement_report",
          afterJson: {
            projectCode: input.trial.moldTrialProject.projectCode,
            fileName: attachment.fileName,
            fileType: attachment.fileType,
            visibility: attachment.visibility,
            sizeBytes: attachment.sizeBytes,
            trialEventId: input.trial.id,
            trialCode,
            note: input.note,
            securityPipeline: "quarantine_validate_scan_release"
          }
        }
      });
    });
  } catch (error) {
    await removeStoredAttachment(input.storageKey);
    throw error;
  }
}

export async function POST(request: Request): Promise<Response> {
  const origin = validateUploadOrigin({
    configuredBaseUrl: process.env.MOLDPILOT_BASE_URL ?? null,
    requestUrl: request.url,
    originHeader: request.headers.get("origin"),
    hostHeader: request.headers.get("host"),
    uploadHeader: request.headers.get("x-moldpilot-upload")
  });
  if (!origin.ok) {
    return json({ success: false, message: origin.message }, 403);
  }

  const actor = await getOptionalCurrentUser({ allowPasswordChangeRequired: true });
  if (actor == null) {
    return json({ success: false, message: "Authentication is required." }, 401);
  }
  if (actor.forcePasswordChange) {
    return json({ success: false, message: "Change your password before uploading files." }, 403);
  }
  const releaseSlot = acquireUploadSlot(actor.id);
  if (releaseSlot == null) {
    return json({ success: false, message: "Too many uploads are already in progress." }, 429);
  }

  const attachmentId = randomUUID();
  let quarantinePath: string | null = null;
  try {
    const purpose = requiredHeader(request, "x-moldpilot-upload-purpose", 40);
    const fileType = purpose === "measurement-report" ? "QC_REPORT" : parseFileType(request);
    if (purpose !== "attachment" && purpose !== "measurement-report") {
      throw new UploadHttpError("Unsupported upload purpose.", 400);
    }
    const fileName = requiredHeader(request, "x-moldpilot-file-name", 240);
    const declaredContentType = request.headers.get("content-type")?.split(";")[0]?.trim() ?? "";
    const maxBytes = attachmentSizeLimitBytes(fileType);
    const contentLength = assertedContentLength(request, maxBytes);
    const metadataValidation = validateAttachmentUpload({
      fileType,
      declaredContentType,
      fileName,
      sizeBytes: contentLength ?? 1
    });
    if (!metadataValidation.ok) {
      throw new UploadHttpError(
        metadataValidation.issues[0]?.message ?? "File metadata is not allowed.",
        400
      );
    }

    let generic:
      | {
          projectId: string;
          projectCode: string;
          entityType: AttachmentEntityType;
          entityId: string;
          visibility: AttachmentVisibility;
        }
      | null = null;
    let measurement:
      | {
          trial: {
            id: string;
            status: TrialStatusDbValue;
            sequenceNumber: number;
            moldTrialProject: { id: string; projectCode: string };
          };
          visibility: AttachmentVisibility;
          note: string | null;
          previousReport: { id: string; fileName: string } | null;
        }
      | null = null;

    if (purpose === "attachment") {
      if (!(await hasPermission(actor.id, "attachment.upload"))) {
        throw new UploadHttpError("You do not have permission to upload files.", 403);
      }
      const projectId = requiredHeader(request, "x-moldpilot-project-id", 80);
      const project = await prisma.moldTrialProject.findUnique({
        where: { id: projectId },
        select: { id: true, projectCode: true }
      });
      if (project == null) {
        throw new UploadHttpError("Project was not found.", 404);
      }
      const entityType = parseEntityType(request);
      const entityId = requiredHeader(request, "x-moldpilot-entity-id", 80);
      await assertEntityBelongsToProject(entityType, entityId, project.id);
      generic = {
        projectId: project.id,
        projectCode: project.projectCode,
        entityType,
        entityId,
        visibility: parseVisibility(request, fileType, visibilityManagers.has(actor.roleCode))
      };
    } else {
      if (!(await hasPermission(actor.id, "qc.measurement_report.upload"))) {
        throw new UploadHttpError("You do not have permission to upload measurement reports.", 403);
      }
      const trialEventId = requiredHeader(request, "x-moldpilot-trial-event-id", 80);
      const trial = await prisma.trialEvent.findUnique({
        where: { id: trialEventId },
        select: {
          id: true,
          status: true,
          sequenceNumber: true,
          moldTrialProject: { select: { id: true, projectCode: true } }
        }
      });
      if (trial == null) {
        throw new UploadHttpError("Trial was not found.", 404);
      }
      if (!canUploadMeasurementReport(trial.status as TrialStatusDbValue)) {
        throw new UploadHttpError("A measurement report can only be uploaded for a completed trial.", 400);
      }
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
      const newest = newestMeasurementReport(
        candidates.map((candidate) => ({
          id: candidate.id,
          entityType: candidate.entityType,
          entityId: candidate.entityId,
          fileType: candidate.fileType,
          deletedAt: candidate.deletedAt,
          uploadedAt: candidate.uploadedAt,
          uploaderName: "",
          visibility: ""
        })),
        trial.id
      );
      const existing = newest == null ? null : candidates.find((candidate) => candidate.id === newest.id) ?? null;
      if (existing != null && !(await hasPermission(actor.id, "qc.measurement_report.replace"))) {
        throw new UploadHttpError("You do not have permission to replace a measurement report.", 403);
      }
      const requestedVisibility = decodedHeader(request, "x-moldpilot-visibility", 40);
      if (requestedVisibility !== "" && requestedVisibility !== "CUSTOMER_SAFE" && requestedVisibility !== "INTERNAL") {
        throw new UploadHttpError("Unsupported visibility for a measurement report.", 400);
      }
      measurement = {
        trial: {
          ...trial,
          status: trial.status as TrialStatusDbValue
        },
        visibility: (requestedVisibility || "CUSTOMER_SAFE") as AttachmentVisibility,
        note: decodedHeader(request, "x-moldpilot-note", 500) || null,
        previousReport: existing == null ? null : { id: existing.id, fileName: existing.fileName }
      };
    }

    const staged = await streamBodyToQuarantine({
      id: attachmentId,
      body: request.body,
      maxBytes
    });
    quarantinePath = staged.absolutePath;
    if (staged.sizeBytes === 0) {
      throw new UploadHttpError("File appears to be empty.", 400);
    }
    const inspected = await inspectAndScanQuarantinedAttachment({
      quarantinePath,
      fileType,
      declaredContentType,
      fileName,
      sizeBytes: staged.sizeBytes
    });
    if (!inspected.ok) {
      if (inspected.retainQuarantine) {
        quarantinePath = null;
      }
      throw new UploadHttpError(inspected.message, inspected.status);
    }

    const released = await releaseQuarantinedAttachment({
      quarantinePath,
      id: attachmentId,
      extension: inspected.validation.extension
    });
    quarantinePath = null;

    if (generic != null) {
      const persisted = await persistGenericUpload({
        attachmentId,
        actorId: actor.id,
        ...generic,
        fileType,
        fileName: inspected.validation.safeFileName,
        contentType: inspected.validation.contentType,
        sizeBytes: released.sizeBytes,
        storageKey: released.storageKey
      });
      return json({
        success: true,
        message: persisted.duplicate ? "File was already uploaded." : "File uploaded.",
        attachmentId: persisted.attachmentId
      });
    }

    if (measurement == null) {
      await removeStoredAttachment(released.storageKey);
      throw new UploadHttpError("Upload context was lost.", 500);
    }
    const trialCode = `T${Math.max(0, measurement.trial.sequenceNumber - 1)}`;
    const storedFileName = measurementReportFileName({
      projectCode: measurement.trial.moldTrialProject.projectCode,
      trialCode,
      extension: inspected.validation.extension
    });
    const recentDuplicate = await prisma.fileAttachment.findFirst({
      where: {
        moldTrialProjectId: measurement.trial.moldTrialProject.id,
        entityType: "TRIAL_EVENT",
        entityId: measurement.trial.id,
        fileType: "QC_REPORT",
        uploadedById: actor.id,
        sizeBytes: released.sizeBytes,
        deletedAt: null,
        uploadedAt: { gte: new Date(Date.now() - DUPLICATE_SUBMISSION_WINDOW_MS) }
      },
      select: { id: true, entityId: true, uploadedById: true, sizeBytes: true, uploadedAt: true }
    });
    if (
      isDuplicateMeasurementReportSubmission(
        recentDuplicate,
        { entityId: measurement.trial.id, uploadedById: actor.id, sizeBytes: released.sizeBytes },
        new Date()
      )
    ) {
      await removeStoredAttachment(released.storageKey);
      return json({
        success: true,
        message: "Measurement report was already uploaded.",
        attachmentId: recentDuplicate!.id,
        replaced: false
      });
    }

    await persistMeasurementReport({
      attachmentId,
      actorId: actor.id,
      trial: measurement.trial,
      visibility: measurement.visibility,
      note: measurement.note,
      fileName: storedFileName,
      contentType: inspected.validation.contentType,
      sizeBytes: released.sizeBytes,
      storageKey: released.storageKey,
      previousReport: measurement.previousReport
    });
    return json({
      success: true,
      message: measurement.previousReport == null ? "Measurement report uploaded." : "Measurement report replaced.",
      attachmentId,
      replaced: measurement.previousReport != null
    });
  } catch (error) {
    if (quarantinePath != null) {
      await removeQuarantinedAttachment(quarantinePath);
    }
    if (error instanceof UploadHttpError) {
      return json({ success: false, message: error.message }, error.status);
    }
    console.error(JSON.stringify({ event: "upload_failed", actorUserId: actor.id }));
    return json({ success: false, message: "Upload could not be completed." }, 500);
  } finally {
    releaseSlot();
    void cleanupAbandonedQuarantineFiles().catch(() => undefined);
  }
}
