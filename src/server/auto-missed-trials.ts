import { shouldAutoMissTrial, shouldRunAutoMissedSweep } from "@/domain/mold-trial/auto-missed";
import { prisma } from "@/lib/prisma";
import { trialStatusLabels } from "@/server/mold-trial-codecs";

let lastAllProjectsAutoMissedSweepAt: number | null = null;

function activityDate(value: Date | null | undefined): string | null {
  return value == null ? null : value.toISOString().slice(0, 10);
}

function claimAllProjectsAutoMissedSweep(now: Date): boolean {
  if (
    !shouldRunAutoMissedSweep({
      lastRunAt: lastAllProjectsAutoMissedSweepAt,
      now
    })
  ) {
    return false;
  }

  lastAllProjectsAutoMissedSweepAt = now.getTime();
  return true;
}

async function findAutoMissedCandidates(projectCode?: string) {
  return prisma.trialEvent.findMany({
    where: {
      ...(projectCode == null ? {} : { moldTrialProject: { projectCode } }),
      status: {
        in: ["PLANNED", "AT_RISK"]
      },
      actualDate: null,
      result: null,
      outcomeDisposition: null,
      autoMissedAt: null
    },
    select: {
      id: true,
      moldTrialProjectId: true,
      trialCode: true,
      sequenceNumber: true,
      plannedDate: true,
      actualDate: true,
      status: true,
      result: true,
      outcomeDisposition: true
    }
  });
}

type AutoMissedCandidate = Awaited<ReturnType<typeof findAutoMissedCandidates>>[number];

async function markAutoMissedTrials(
  candidates: readonly AutoMissedCandidate[],
  actorUserId: string,
  now: Date
): Promise<number> {
  const trialsToMark = candidates.filter((trial) =>
    shouldAutoMissTrial(
      {
        plannedDate: trial.plannedDate,
        actualDate: trial.actualDate,
        status: trialStatusLabels[trial.status],
        result: trial.result,
        outcomeDisposition: trial.outcomeDisposition
      },
      now
    )
  );

  if (trialsToMark.length === 0) {
    return 0;
  }

  return prisma.$transaction(async (tx) => {
    let markedCount = 0;
    const markedProjectIds = new Set<string>();

    for (const trial of trialsToMark) {
      const result = await tx.trialEvent.updateMany({
        where: {
          id: trial.id,
          status: {
            in: ["PLANNED", "AT_RISK"]
          },
          actualDate: null,
          result: null,
          outcomeDisposition: null,
          autoMissedAt: null
        },
        data: {
          status: "AUTO_MISSED_REASON_REQUIRED",
          autoMissedAt: now
        }
      });

      if (result.count === 0) {
        continue;
      }

      markedCount += 1;
      markedProjectIds.add(trial.moldTrialProjectId);

      await tx.activityLog.create({
        data: {
          actorUserId,
          entityType: "TrialEvent",
          entityId: trial.id,
          action: "auto_marked_missed_reason_required",
          beforeJson: {
            status: trial.status,
            plannedDate: activityDate(trial.plannedDate)
          },
          afterJson: {
            status: "AUTO_MISSED_REASON_REQUIRED",
            autoMissedAt: now.toISOString()
          },
          note: "Applied automatically after the next-day noon business cutoff."
        }
      });
    }

    if (markedProjectIds.size > 0) {
      await tx.moldTrialProject.updateMany({
        where: { id: { in: [...markedProjectIds] } },
        data: {
          status: "TRIAL_DELAYED"
        }
      });
    }

    return markedCount;
  });
}

export async function applyAutoMissedTrialsForProject(
  projectCode: string,
  actorUserId: string,
  now: Date = new Date()
): Promise<number> {
  return markAutoMissedTrials(await findAutoMissedCandidates(projectCode), actorUserId, now);
}

export async function applyAutoMissedTrialsForAllProjects(actorUserId: string, now: Date = new Date()): Promise<number> {
  if (!claimAllProjectsAutoMissedSweep(now)) {
    return 0;
  }

  return markAutoMissedTrials(await findAutoMissedCandidates(), actorUserId, now);
}
