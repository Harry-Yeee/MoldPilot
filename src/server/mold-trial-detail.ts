import { notFound } from "next/navigation";
import { measurementReportState } from "@/domain/mold-trial/measurement-report";
import type { TrialStatusDbValue } from "@/domain/mold-trial/my-plate";
import { compareInjectionMachineNo } from "@/domain/mold-trial/process-sheet";
import { evaluateTrialLimit } from "@/domain/mold-trial/trial-limit";
import { formatBilingualUserName } from "@/domain/mold-trial/users";
import type { ProjectNoteRecord } from "@/domain/mold-trial/project-notes";
import { prisma } from "@/lib/prisma";
import { applyAutoMissedTrialsForProject } from "@/server/auto-missed-trials";
import { trialCodeLabels, trialStatusLabels } from "@/server/mold-trial-codecs";
import { listProjectNoteRows } from "@/server/project-note-store";

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
        include: {
          dateConfirmedBy: {
            select: {
              displayName: true,
              username: true
            }
          }
        },
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

  const issueIds = project.trialIssues.map((issue) => issue.id);
  const trialEventIds = project.trialEvents.map((trial) => trial.id);

  // Ids of every QC_REPORT ever filed against this project's trial events
  // (including soft-deleted ones), so replace/upload entries surface in the
  // activity timeline. Fetched before the main batch since the activity-log
  // query needs the id list up front.
  const measurementReportAttachmentIds =
    trialEventIds.length === 0
      ? []
      : (
          await prisma.fileAttachment.findMany({
            where: {
              moldTrialProjectId: project.id,
              entityType: "TRIAL_EVENT",
              entityId: { in: trialEventIds },
              fileType: "QC_REPORT"
            },
            select: { id: true }
          })
        ).map((attachment) => attachment.id);
  const measurementReportIdsForActivity = measurementReportAttachmentIds;

  const [
    activityLogs,
    activeInjectionMachines,
    projectAttachments,
    issuePhotoRows,
    measurementReportRows,
    customerSafeRows,
    projectNotes
  ] = await Promise.all([
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
        {
          entityType: "FileAttachment",
          entityId: {
            in: [
              ...project.fileAttachments.map((attachment) => attachment.id),
              ...measurementReportIdsForActivity
            ]
          }
        }
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
    }),
    prisma.fileAttachment.findMany({
      where: {
        moldTrialProjectId: project.id,
        entityType: "MOLD_TRIAL_PROJECT",
        deletedAt: null
      },
      include: {
        uploadedBy: {
          select: { displayName: true, username: true }
        }
      },
      orderBy: [{ uploadedAt: "desc" }]
    }),
    // TRIAL_PHOTO attachments filed against this project's issues, oldest first
    // so galleries read in capture order. Grouped by issue id below.
    issueIds.length === 0
      ? Promise.resolve([])
      : prisma.fileAttachment.findMany({
          where: {
            moldTrialProjectId: project.id,
            entityType: "TRIAL_ISSUE",
            entityId: { in: issueIds },
            fileType: "TRIAL_PHOTO",
            deletedAt: null
          },
          include: {
            uploadedBy: {
              select: { displayName: true, username: true }
            }
          },
          orderBy: [{ uploadedAt: "asc" }]
        }),
    // Live QC measurement reports filed against this project's trial events.
    // Newest-wins selection happens in the pure domain layer per trial.
    trialEventIds.length === 0
      ? Promise.resolve([])
      : prisma.fileAttachment.findMany({
          where: {
            moldTrialProjectId: project.id,
            entityType: "TRIAL_EVENT",
            entityId: { in: trialEventIds },
            fileType: "QC_REPORT",
            deletedAt: null
          },
          include: {
            uploadedBy: { select: { displayName: true, username: true } }
          },
          orderBy: [{ uploadedAt: "desc" }]
        }),
    // Every non-deleted CUSTOMER_SAFE attachment on the project, for the
    // Marketing "Customer files" section (measurement reports surfaced first).
    prisma.fileAttachment.findMany({
      where: {
        moldTrialProjectId: project.id,
        visibility: "CUSTOMER_SAFE",
        deletedAt: null
      },
      include: {
        uploadedBy: { select: { displayName: true, username: true } }
      },
      orderBy: [{ uploadedAt: "desc" }]
    }),
    // Client notes 客户备注 — the whole ledger, retired lines included. Read
    // through the ProjectNote seam (the model arrives with the 2026-08-06
    // migration); ordering is re-applied in the pure domain layer.
    listProjectNoteRows(project.id)
  ]);

  // Group issue photos by issue id (entityId) for O(1) per-issue lookup in the page.
  const issuePhotosByIssueId = new Map<string, typeof issuePhotoRows>();
  for (const photo of issuePhotoRows) {
    const list = issuePhotosByIssueId.get(photo.entityId) ?? [];
    list.push(photo);
    issuePhotosByIssueId.set(photo.entityId, list);
  }

  // Measurement-report state per trial event, resolved through the pure domain
  // rule (newest non-deleted QC_REPORT wins). Only eligible statuses are ever
  // anything other than NOT_REQUIRED.
  const reportAttachments = measurementReportRows.map((row) => ({
    id: row.id,
    entityType: row.entityType,
    entityId: row.entityId,
    fileType: row.fileType,
    deletedAt: row.deletedAt,
    uploadedAt: row.uploadedAt,
    uploaderName: row.uploadedBy.displayName,
    visibility: row.visibility
  }));
  const measurementReportByTrialId = new Map<string, ReturnType<typeof measurementReportState>>();
  for (const trial of project.trialEvents) {
    measurementReportByTrialId.set(
      trial.id,
      measurementReportState({ status: trial.status as TrialStatusDbValue }, trial.id, reportAttachments)
    );
  }

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

  // Notes in the shape the pure section renderer consumes: names resolved here
  // (the page never re-queries a user), ordering decided by orderProjectNotes.
  const clientNotes: ProjectNoteRecord[] = projectNotes.map((note) => ({
    id: note.id,
    body: note.body,
    createdAt: note.createdAt,
    createdByName: formatBilingualUserName(note.createdBy),
    retiredAt: note.retiredAt,
    retiredByName: note.retiredBy == null ? null : formatBilingualUserName(note.retiredBy)
  }));

  return {
    project,
    activityLogs,
    activeInjectionMachines: [...activeInjectionMachines].sort(compareInjectionMachineNo),
    projectAttachments,
    issuePhotosByIssueId,
    measurementReportByTrialId,
    customerSafeAttachments: customerSafeRows,
    clientNotes,
    limit
  };
}
