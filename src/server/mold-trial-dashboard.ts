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

  return buildMoldTrialDashboard(projects);
}
