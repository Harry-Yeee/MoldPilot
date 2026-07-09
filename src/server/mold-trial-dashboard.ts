import { buildMoldTrialDashboard } from "@/domain/mold-trial/dashboard";
import { prisma } from "@/lib/prisma";
import { applyAutoMissedTrialsForAllProjects } from "@/server/auto-missed-trials";

export async function getMoldTrialDashboardData(actorUserId?: string) {
  if (actorUserId != null) {
    await applyAutoMissedTrialsForAllProjects(actorUserId);
  }

  const projects = await prisma.moldTrialProject.findMany({
    include: {
      planningPm: {
        select: {
          displayName: true
        }
      },
      technicalPm: {
        select: {
          displayName: true
        }
      },
      parts: {
        select: {
          partCode: true,
          sortOrder: true,
          active: true
        },
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }]
      },
      trialEvents: {
        select: {
          id: true,
          trialCode: true,
          sequenceNumber: true,
          plannedDate: true,
          actualDate: true,
          status: true,
          result: true,
          outcomeDisposition: true,
          countsAgainstLimit: true
        },
        orderBy: [{ sequenceNumber: "asc" }, { plannedDate: "asc" }]
      },
      // Live measurement reports (QC_REPORT filed against a trial event), so the
      // dashboard can flag completed trials still missing their report.
      fileAttachments: {
        where: {
          entityType: "TRIAL_EVENT",
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
          visibility: true
        }
      },
      trialIssues: {
        select: {
          severity: true,
          status: true,
          assemblyEstimatedFinishDate: true,
          assemblyAcknowledgedAt: true,
          pmReadyConfirmedAt: true
        }
      },
      designChanges: {
        select: {
          firstCompletedTrialAlreadyDone: true,
          grantsExtraTrial: true,
          extraTrialCount: true,
          approvedById: true,
          approvalReason: true
        }
      },
      missedTrialEvents: {
        select: {
          id: true
        }
      }
    },
    orderBy: [{ projectCode: "asc" }]
  });

  return buildMoldTrialDashboard(
    projects.map((project) => ({
      ...project,
      // Map QC_REPORT rows into the pure domain shape; uploaderName is irrelevant
      // to the missing-report count, so a placeholder keeps the query narrow.
      measurementReports: project.fileAttachments.map((attachment) => ({
        id: attachment.id,
        entityType: attachment.entityType,
        entityId: attachment.entityId,
        fileType: attachment.fileType,
        deletedAt: attachment.deletedAt,
        uploadedAt: attachment.uploadedAt,
        uploaderName: "",
        visibility: attachment.visibility
      }))
    }))
  );
}
