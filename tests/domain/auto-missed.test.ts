import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import {
  autoMissedCutoffUtc,
  shouldAutoMissTrial,
  shouldRunAutoMissedSweep,
  validateAutoMissedResolution
} from "../../src/domain/mold-trial/auto-missed.ts";

describe("auto-missed trial rules", () => {
  test("uses next-day noon Asia/Shanghai cutoff", () => {
    assert.equal(autoMissedCutoffUtc("2026-07-01")?.toISOString(), "2026-07-02T04:00:00.000Z");
  });

  test("does not auto-miss before next-day noon", () => {
    assert.equal(
      shouldAutoMissTrial(
        {
          plannedDate: "2026-07-01",
          status: "Planned"
        },
        "2026-07-02T03:59:59.000Z"
      ),
      false
    );
  });

  test("marks planned trial auto-missed at or after next-day noon", () => {
    assert.equal(
      shouldAutoMissTrial(
        {
          plannedDate: "2026-07-01",
          status: "Planned"
        },
        "2026-07-02T04:00:00.000Z"
      ),
      true
    );
    assert.equal(
      shouldAutoMissTrial(
        {
          plannedDate: "2026-07-01",
          status: "At Risk"
        },
        "2026-07-02T05:00:00.000Z"
      ),
      true
    );
  });

  test("does not auto-miss stale or already-resulted trials", () => {
    assert.equal(
      shouldAutoMissTrial(
        {
          plannedDate: "2026-07-01",
          status: "Delayed"
        },
        "2026-07-02T05:00:00.000Z"
      ),
      false
    );
    assert.equal(
      shouldAutoMissTrial(
        {
          plannedDate: "2026-07-01",
          actualDate: "2026-07-01",
          status: "Planned",
          result: "Not Approved / Rework Required"
        },
        "2026-07-02T05:00:00.000Z"
      ),
      false
    );
  });

  test("confirmed missed resolution requires reason fields and new date", () => {
    const missing = validateAutoMissedResolution({
      mode: "MISSED",
      plannedDate: "2026-07-01",
      explanation: "Assembly was not ready."
    });
    const valid = validateAutoMissedResolution({
      mode: "MISSED",
      plannedDate: "2026-07-01",
      newPlannedDate: "2026-07-05",
      reasonCategory: "Mold Correction Not Complete",
      responsibleArea: "Assembly",
      explanation: "Assembly correction needs one more day."
    });

    assert.equal(missing.ok, false);
    assert.deepEqual(
      missing.issues.map((issue) => issue.field),
      ["reasonCategory", "responsibleArea", "newPlannedDate"]
    );
    assert.equal(valid.ok, true);
  });

  test("blocked or paused resolution requires explanation but no new planned date", () => {
    assert.equal(
      validateAutoMissedResolution({
        mode: "BLOCKED",
        plannedDate: "2026-07-01"
      }).ok,
      false
    );
    assert.equal(
      validateAutoMissedResolution({
        mode: "PAUSED",
        plannedDate: "2026-07-01",
        explanation: "Waiting for internal decision."
      }).ok,
      true
    );
  });

  test("server auto-miss helper is idempotent and late completion is audited", () => {
    const serviceSource = readFileSync(new URL("../../src/server/auto-missed-trials.ts", import.meta.url), "utf8");
    const actionsSource = readFileSync(new URL("../../src/server/mold-trial-actions.ts", import.meta.url), "utf8");
    const dashboardSource = readFileSync(new URL("../../src/server/mold-trial-dashboard.ts", import.meta.url), "utf8");

    assert.equal(serviceSource.includes("updateMany"), true);
    assert.equal(serviceSource.includes("autoMissedAt: null"), true);
    assert.equal(serviceSource.includes("applyAutoMissedTrialsForAllProjects"), true);
    assert.equal(serviceSource.includes("findAutoMissedCandidates()"), true);
    assert.equal(dashboardSource.includes("applyAutoMissedTrialsForAllProjects(actorUserId)"), true);
    assert.equal(actionsSource.includes("corrected_auto_missed_by_late_completed_trial"), true);
    assert.equal(actionsSource.includes("LATE_COMPLETED_TRIAL_ENTERED"), true);
  });

  test("all-project auto-miss sweep throttle allows one run per five minutes", () => {
    const first = new Date("2026-07-03T04:00:00.000Z");

    assert.equal(shouldRunAutoMissedSweep({ lastRunAt: null, now: first }), true);
    assert.equal(
      shouldRunAutoMissedSweep({
        lastRunAt: first.getTime(),
        now: new Date("2026-07-03T04:04:59.999Z")
      }),
      false
    );
    assert.equal(
      shouldRunAutoMissedSweep({
        lastRunAt: first.getTime(),
        now: new Date("2026-07-03T04:05:00.000Z")
      }),
      true
    );
  });
});
