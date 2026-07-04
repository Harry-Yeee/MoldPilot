import type { DateLike, TrialEvent } from "./types.ts";

type CurrentTrialCandidate = Pick<TrialEvent, "id" | "plannedDate" | "status">;

function timeValue(value: DateLike | null | undefined): number {
  if (value == null) {
    return Number.POSITIVE_INFINITY;
  }

  const time = new Date(value).getTime();
  return Number.isNaN(time) ? Number.POSITIVE_INFINITY : time;
}

export function sortCurrentPlannedTrials<T extends CurrentTrialCandidate>(trials: readonly T[]): T[] {
  return [...trials]
    .filter(
      (trial) =>
        trial.status === "Planned" ||
        trial.status === "At Risk" ||
        trial.status === "Auto Missed - Reason Required"
    )
    .sort((left, right) => timeValue(left.plannedDate) - timeValue(right.plannedDate));
}

export function selectCurrentPlannedTrial<T extends CurrentTrialCandidate>(trials: readonly T[]): T | null {
  return sortCurrentPlannedTrials(trials)[0] ?? null;
}
