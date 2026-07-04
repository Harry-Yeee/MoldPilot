import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { selectCurrentPlannedTrial, sortCurrentPlannedTrials } from "../../src/domain/mold-trial/current-trial.ts";
import type { TrialEvent } from "../../src/domain/mold-trial/types.ts";

function trial(id: string, status: TrialEvent["status"], plannedDate: string): TrialEvent {
  return {
    id,
    trialCode: "T1",
    plannedDate,
    status
  };
}

describe("current trial selection", () => {
  test("selects the nearest planned or at-risk trial and ignores stale delayed trials", () => {
    const trials = [
      trial("old-delayed", "Delayed", "2026-03-01"),
      trial("future-planned", "Planned", "2026-04-15"),
      trial("near-at-risk", "At Risk", "2026-04-05"),
      trial("completed", "Completed", "2026-03-20")
    ];

    assert.equal(selectCurrentPlannedTrial(trials)?.id, "near-at-risk");
    assert.deepEqual(sortCurrentPlannedTrials(trials).map((candidate) => candidate.id), [
      "near-at-risk",
      "future-planned"
    ]);
  });

  test("selects auto-missed reason-required trial as the current action item", () => {
    const trials = [
      trial("future-planned", "Planned", "2026-04-15"),
      trial("auto-missed", "Auto Missed - Reason Required", "2026-04-01")
    ];

    assert.equal(selectCurrentPlannedTrial(trials)?.id, "auto-missed");
  });

  test("returns null when no current planned or at-risk trial exists", () => {
    const trials = [
      trial("delayed", "Delayed", "2026-03-01"),
      trial("cancelled", "Cancelled", "2026-03-05"),
      trial("skipped", "Skipped", "2026-03-08")
    ];

    assert.equal(selectCurrentPlannedTrial(trials), null);
  });
});
