import { notFound } from "next/navigation";
import { compareInjectionMachineNo } from "@/domain/mold-trial/process-sheet";
import { evaluateTrialLimit } from "@/domain/mold-trial/trial-limit";
import { prisma } from "@/lib/prisma";
import { applyAutoMissedTrialsForProject } from "@/server/auto-missed-trials";
import { trialCodeLabels, trialStatusLabels } from "@/server/mold-trial-codecs";

export async function getMoldTrialProjectDetail(projectCode: string, options: { autoMissActorUserId?: string } = {}) {
  if (options.autoMissActorUserId != null) {
    await applyAutoMissedTrialsForProject(projectCode, options.autoMissActorUserId);
  }

  const project = await prisma.moldTrialProject.findUnique({
    where: { projectCode },
    include: {
      planningPm: {
        select: {
          displayName: true,
          username: true
        }
      },
      technicalPm: {
        select: {
          displayName: true,
          username: true
        }
      },
      customTrialLimitSetBy: {
        select: {
          displayName: true,
          username: true
        }
      },
      processSheetTemplate: {
        include: {
          parameters: {
            where: {
              active: true
            },
            orderBy: [{ sortOrder: "asc" }]
          }
        }
      },
      parts: {
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }]
      },
      trialEvents: {
        orderBy: [{ sequenceNumber: "asc" }, { plannedDate: "asc" }]
      },
      processValues: {
        include: {
          processSheetParameter: true,
          enteredBy: {
            select: {
              displayName: true
            }
          }
        },
        orderBy: [{ processSheetParameter: { sortOrder: "asc" } }]
      },
      trialIssues: {
        include: {
          ownerUser: {
            select: {
              displayName: true,
              username: true
            }
          },
          closedBy: {
            select: {
              displayName: true,
              username: true
            }
          },
          ownerGroup: {
            select: {
              code: true,
              name: true
            }
          },
          assemblyAcknowledgedBy: {
            select: {
              displayName: true,
              username: true
            }
          },
          assemblySelfCheckedBy: {
            select: {
              displayName: true,
              username: true
            }
          },
          pmReadyConfirmedBy: {
            select: {
              displayName: true,
              username: true
            }
          },
          foundAtTrialEvent: {
            select: {
              trialCode: true,
              sequenceNumber: true
            }
          },
          affectedPart: {
            select: {
              id: true,
              partCode: true,
              partName: true,
              cavityLabel: true,
              cavityCount: true,
              active: true,
              sortOrder: true
            }
          }
        },
        orderBy: [{ createdAt: "desc" }]
      },
      missedTrialEvents: {
        orderBy: [{ createdAt: "desc" }]
      },
      designChanges: {
        include: {
          approvedBy: {
            select: {
              displayName: true
            }
          },
          createdBy: {
            select: {
              displayName: true
            }
          }
        },
        orderBy: [{ changeDate: "desc" }]
      },
      trialLimitAdjustments: {
        include: {
          setBy: {
            select: {
              displayName: true
            }
          },
          approvedBy: {
            select: {
              displayName: true
            }
          }
        },
        orderBy: [{ createdAt: "desc" }]
      },
      fileAttachments: {
        where: {
          entityType: "PROCESS_SHEET_EXPORT"
        },
        orderBy: [{ uploadedAt: "desc" }]
      }
    }
  });

  if (project == null) {
    notFound();
  }

  const [activityLogs, activeInjectionMachines] = await Promise.all([
    prisma.activityLog.findMany({
    where: {
      OR: [
        { entityType: "MoldTrialProject", entityId: project.id },
        { entityType: "TrialEvent", entityId: { in: project.trialEvents.map((trial) => trial.id) } },
        { entityType: "TrialIssue", entityId: { in: project.trialIssues.map((issue) => issue.id) } },
        { entityType: "MissedTrialEvent", entityId: { in: project.missedTrialEvents.map((event) => event.id) } },
        { entityType: "DesignChangeEvent", entityId: { in: project.designChanges.map((change) => change.id) } },
        {
          entityType: "TrialLimitAdjustment",
          entityId: { in: project.trialLimitAdjustments.map((adjustment) => adjustment.id) }
        },
        { entityType: "FileAttachment", entityId: { in: project.fileAttachments.map((attachment) => attachment.id) } }
      ]
    },
    include: {
      actorUser: {
        select: {
          displayName: true
        }
      }
    },
    orderBy: [{ createdAt: "asc" }]
    }),
    prisma.injectionMachine.findMany({
      where: { active: true }
    })
  ]);

  const limit = evaluateTrialLimit({
    baseTrialLimit: project.baseTrialLimit,
    customTrialLimit: project.customTrialLimit,
    customTrialLimitReason: project.customTrialLimitReason,
    trialEvents: project.trialEvents.map((trial) => ({
      trialCode: trialCodeLabels[trial.trialCode],
      plannedDate: trial.plannedDate,
      actualDate: trial.actualDate,
      status: trialStatusLabels[trial.status],
      countsAgainstLimit: trial.countsAgainstLimit
    })),
    designChanges: project.designChanges.map((change) => ({
      firstCompletedTrialAlreadyDone: change.firstCompletedTrialAlreadyDone,
      grantsExtraTrial: change.grantsExtraTrial,
      extraTrialCount: change.extraTrialCount,
      approvedById: change.approvedById,
      approvalReason: change.approvalReason
    }))
  });

  return {
    project,
    activityLogs,
    activeInjectionMachines: [...activeInjectionMachines].sort(compareInjectionMachineNo),
    limit
  };
}
