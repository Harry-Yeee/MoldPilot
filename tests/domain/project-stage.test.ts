import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  computeProjectStage,
  projectStages,
  type ProjectStageIssueSummary,
  type ProjectStageTrial
} from "../../src/domain/mold-trial/project-stage.ts";
import type { ProjectStatus } from "../../src/domain/mold-trial/types.ts";

function trial(overrides: Partial<ProjectStageTrial> = {}): ProjectStageTrial {
  return {
    id: "trial-1",
    sequenceNumber: 2,
    plannedDate: "2026-08-10",
    status: "Planned",
    dateConfirmationStatus: "PENDING_CONFIRMATION",
    ...overrides
  };
}

function issues(overrides: Partial<ProjectStageIssueSummary> = {}): ProjectStageIssueSummary {
  return { openCount: 0, unclaimedCount: 0, awaitingVerificationCount: 0, ...overrides };
}

describe("poster stage list", () => {
  test("mirrors the six training-poster stages, in order, in both languages", () => {
    assert.equal(projectStages.length, 6);
    assert.deepEqual(
      projectStages.map((stage) => [stage.index, stage.id, stage.labelZh, stage.labelEn]),
      [
        [0, "INTAKE", "项目立项", "Project intake"],
        [1, "DATE_CONFIRMATION", "排期确认", "Date confirmation"],
        [2, "TRIAL_DAY", "试模当天", "Trial day"],
        [3, "CORRECTION", "整改循环", "Correction loop"],
        [4, "VERIFY_REPORT", "验证与报告", "Verify & report"],
        [5, "COUNT_CLOSE", "计数与收尾", "Count & close"]
      ]
    );
  });
});

describe("project status -> stage", () => {
  const cases: readonly [ProjectStatus, number, string][] = [
    ["Intake", 0, "INTAKE"],
    ["In Correction", 3, "CORRECTION"],
    ["Waiting Verification", 4, "VERIFY_REPORT"],
    ["Approved", 5, "COUNT_CLOSE"],
    ["Over Limit", 5, "COUNT_CLOSE"],
    ["Closed", 5, "COUNT_CLOSE"],
    ["Cancelled", 5, "COUNT_CLOSE"],
    ["Blocked", 1, "DATE_CONFIRMATION"],
    ["Paused", 1, "DATE_CONFIRMATION"]
  ];

  for (const [projectStatus, stageIndex, stageId] of cases) {
    test(`${projectStatus} -> stage ${stageIndex} (${stageId})`, () => {
      const stage = computeProjectStage({ projectStatus, trials: [trial()], issues: issues() });
      assert.equal(stage.stageIndex, stageIndex);
      assert.equal(stage.stageId, stageId);
      assert.ok(stage.nextAction.en.length > 0);
      assert.ok(stage.nextAction.zh.length > 0);
    });
  }

  test("intake asks the PM for the mold code and the first T0 date", () => {
    const stage = computeProjectStage({ projectStatus: "Intake", trials: [], issues: issues() });
    assert.equal(stage.nextAction.role, "PM");
    assert.match(stage.nextAction.en, /first T0 date/);
    assert.match(stage.nextAction.zh, /首次 T0 日期/);
  });

  test("closed and cancelled projects ask for nothing", () => {
    for (const projectStatus of ["Closed", "Cancelled"] as const) {
      const stage = computeProjectStage({ projectStatus, trials: [], issues: issues() });
      assert.equal(stage.nextAction.role, "SYSTEM");
      assert.match(stage.nextAction.en, /no action needed/);
    }
  });

  test("over limit sends the PM to the GM before more trials", () => {
    const stage = computeProjectStage({ projectStatus: "Over Limit", trials: [], issues: issues() });
    assert.equal(stage.nextAction.role, "PM");
    assert.match(stage.nextAction.en, /GM/);
  });

  test("blocked and paused both point the PM back at scheduling", () => {
    for (const projectStatus of ["Blocked", "Paused"] as const) {
      const stage = computeProjectStage({ projectStatus, trials: [trial()], issues: issues() });
      assert.equal(stage.stageId, "DATE_CONFIRMATION");
      assert.equal(stage.nextAction.role, "PM");
    }
  });
});

describe("correction loop next action", () => {
  test("unclaimed issues send every department to its inbox first", () => {
    const stage = computeProjectStage({
      projectStatus: "In Correction",
      trials: [trial({ status: "Completed", dateConfirmationStatus: "CONFIRMED" })],
      issues: issues({ openCount: 3, unclaimedCount: 2 })
    });

    assert.equal(stage.stageId, "CORRECTION");
    assert.equal(stage.nextAction.role, "ALL");
    assert.match(stage.nextAction.en, /claims 2 unassigned issues/);
    assert.match(stage.nextAction.zh, /我来处理/);
  });

  test("one unclaimed issue reads singular in English", () => {
    const stage = computeProjectStage({
      projectStatus: "In Correction",
      trials: [],
      issues: issues({ openCount: 1, unclaimedCount: 1 })
    });

    assert.match(stage.nextAction.en, /claims 1 unassigned issue with/);
  });

  test("claimed but open issues wait on Assembly's acknowledgement + self-check", () => {
    const stage = computeProjectStage({
      projectStatus: "In Correction",
      trials: [],
      issues: issues({ openCount: 2, unclaimedCount: 0 })
    });

    assert.equal(stage.nextAction.role, "ASSEMBLY");
    assert.match(stage.nextAction.en, /self-checks before the next trial/);
  });

  test("no open issues left hands the correction loop back to the PM", () => {
    const stage = computeProjectStage({
      projectStatus: "In Correction",
      trials: [],
      issues: issues()
    });

    assert.equal(stage.nextAction.role, "PM");
    assert.match(stage.nextAction.en, /plans the next trial/);
  });
});

describe("verify & report next action", () => {
  test("a missing measurement report names the trial QC owes", () => {
    const stage = computeProjectStage({
      projectStatus: "Waiting Verification",
      trials: [
        trial({ id: "t0", sequenceNumber: 1, status: "Completed", measurementReportMissing: false }),
        trial({ id: "t1", sequenceNumber: 2, status: "Completed", measurementReportMissing: true })
      ],
      issues: issues()
    });

    assert.equal(stage.stageId, "VERIFY_REPORT");
    assert.equal(stage.nextAction.role, "QC");
    assert.match(stage.nextAction.en, /T1 measurement report/);
    assert.match(stage.nextAction.zh, /T1 测量报告/);
  });

  test("reports all in asks QC to verify at the next trial", () => {
    const stage = computeProjectStage({
      projectStatus: "Waiting Verification",
      trials: [trial({ status: "Completed", measurementReportMissing: false })],
      issues: issues()
    });

    assert.equal(stage.nextAction.role, "QC");
    assert.match(stage.nextAction.en, /verifies the fixes at the next trial/);
  });
});

describe("date-confirmation handshake -> stage", () => {
  test("pending confirmation asks Injection for the date + machine", () => {
    const stage = computeProjectStage({
      projectStatus: "Active",
      trials: [trial({ dateConfirmationStatus: "PENDING_CONFIRMATION" })],
      issues: issues()
    });

    assert.equal(stage.stageIndex, 1);
    assert.equal(stage.stageId, "DATE_CONFIRMATION");
    assert.equal(stage.nextAction.role, "INJECTION");
    assert.equal(stage.nextAction.en, "Injection confirms the T1 date + machine (≤24h)");
    assert.equal(stage.nextAction.zh, "注塑确认 T1 日期与机台（≤24小时）");
    assert.equal(stage.currentTrialId, "trial-1");
    assert.equal(stage.approximate, false);
  });

  test("a proposed change waits on Marketing", () => {
    const stage = computeProjectStage({
      projectStatus: "Waiting Trial",
      trials: [trial({ dateConfirmationStatus: "RESCHEDULE_PROPOSED" })],
      issues: issues()
    });

    assert.equal(stage.stageId, "DATE_CONFIRMATION");
    assert.equal(stage.nextAction.role, "MARKETING");
    assert.match(stage.nextAction.en, /Marketing approves or returns the T1 date change/);
  });

  test("a returned date goes back to the PM", () => {
    const stage = computeProjectStage({
      projectStatus: "Active",
      trials: [trial({ dateConfirmationStatus: "RETURNED_TO_PM" })],
      issues: issues()
    });

    assert.equal(stage.stageId, "DATE_CONFIRMATION");
    assert.equal(stage.nextAction.role, "PM");
    assert.match(stage.nextAction.en, /PM sets a new T1 date/);
  });

  test("a confirmed date moves the project to trial day", () => {
    const stage = computeProjectStage({
      projectStatus: "Active",
      trials: [trial({ dateConfirmationStatus: "CONFIRMED" })],
      issues: issues()
    });

    assert.equal(stage.stageIndex, 2);
    assert.equal(stage.stageId, "TRIAL_DAY");
    assert.equal(stage.nextAction.role, "INJECTION");
    assert.match(stage.nextAction.en, /Injection runs T1 and enters the process values/);
    assert.match(stage.nextAction.en, /PM records the result within 24h/);
  });

  test("a delayed project returns to scheduling even with a confirmed date", () => {
    const stage = computeProjectStage({
      projectStatus: "Trial Delayed",
      trials: [trial({ dateConfirmationStatus: "CONFIRMED" })],
      issues: issues()
    });

    assert.equal(stage.stageId, "DATE_CONFIRMATION");
    assert.equal(stage.nextAction.role, "PM");
    assert.match(stage.nextAction.en, /PM sets a new T1 date/);
  });

  test("a delayed project still surfaces a live handshake owner", () => {
    const stage = computeProjectStage({
      projectStatus: "Trial Delayed",
      trials: [trial({ dateConfirmationStatus: "RESCHEDULE_PROPOSED" })],
      issues: issues()
    });

    assert.equal(stage.nextAction.role, "MARKETING");
  });
});

describe("current trial selection + auto-missed", () => {
  test("the nearest planned trial is the current one, and it drives the label", () => {
    const stage = computeProjectStage({
      projectStatus: "Active",
      trials: [
        trial({ id: "t0", sequenceNumber: 1, status: "Completed", plannedDate: "2026-06-01" }),
        trial({ id: "t2", sequenceNumber: 3, status: "Planned", plannedDate: "2026-09-01" }),
        trial({ id: "t1", sequenceNumber: 2, status: "Planned", plannedDate: "2026-08-01" })
      ],
      issues: issues()
    });

    assert.equal(stage.currentTrialId, "t1");
    assert.match(stage.nextAction.en, /T1 date \+ machine/);
  });

  test("an auto-missed trial asks the PM for the result or an honest reason", () => {
    const stage = computeProjectStage({
      projectStatus: "Active",
      trials: [trial({ status: "Auto Missed - Reason Required", dateConfirmationStatus: "CONFIRMED" })],
      issues: issues()
    });

    assert.equal(stage.stageIndex, 2);
    assert.equal(stage.stageId, "TRIAL_DAY");
    assert.equal(stage.nextAction.role, "PM");
    assert.match(stage.nextAction.en, /honest missed-trial reason/);
    assert.match(stage.nextAction.zh, /如实填写未试模原因/);
  });
});

describe("no current trial", () => {
  test("a completed trial without its report is stage 5, not stage 6", () => {
    const stage = computeProjectStage({
      projectStatus: "Active",
      trials: [trial({ status: "Completed", measurementReportMissing: true })],
      issues: issues()
    });

    assert.equal(stage.stageId, "VERIFY_REPORT");
    assert.equal(stage.nextAction.role, "QC");
    assert.equal(stage.currentTrialId, null);
  });

  test("open issues with nothing scheduled land in the correction loop", () => {
    const stage = computeProjectStage({
      projectStatus: "Active",
      trials: [trial({ status: "Completed" })],
      issues: issues({ openCount: 1, unclaimedCount: 1 })
    });

    assert.equal(stage.stageId, "CORRECTION");
    assert.equal(stage.nextAction.role, "ALL");
  });

  test("a finished trial with nothing outstanding waits on the PM to close or re-plan", () => {
    const stage = computeProjectStage({
      projectStatus: "Active",
      trials: [trial({ status: "Completed", result: "Approved" })],
      issues: issues()
    });

    assert.equal(stage.stageIndex, 5);
    assert.equal(stage.nextAction.role, "PM");
    assert.match(stage.nextAction.en, /closes the project, or plans the next trial/);
  });
});

describe("honest degradation", () => {
  test("no trials loaded gives the nearest stage, flagged approximate", () => {
    const stage = computeProjectStage({ projectStatus: "Active" });

    assert.equal(stage.stageId, "DATE_CONFIRMATION");
    assert.equal(stage.approximate, true);
    assert.equal(stage.currentTrialId, null);
    assert.equal(stage.nextAction.role, "PM");
  });

  test("a trial without confirmation state is assumed to still owe a confirmation", () => {
    const stage = computeProjectStage({
      projectStatus: "Active",
      trials: [trial({ dateConfirmationStatus: null })],
      issues: issues()
    });

    assert.equal(stage.stageId, "DATE_CONFIRMATION");
    assert.equal(stage.nextAction.role, "INJECTION");
    assert.equal(stage.approximate, true);
  });

  test("every reachable status yields a stage in range with a bilingual action", () => {
    const statuses: readonly ProjectStatus[] = [
      "Intake",
      "Active",
      "Waiting Trial",
      "Trial Delayed",
      "In Correction",
      "Waiting Verification",
      "Approved",
      "Over Limit",
      "Blocked",
      "Paused",
      "Cancelled",
      "Closed"
    ];

    for (const projectStatus of statuses) {
      const stage = computeProjectStage({ projectStatus, trials: [trial()], issues: issues() });
      assert.ok(stage.stageIndex >= 0 && stage.stageIndex <= 5, `${projectStatus} out of range`);
      assert.notEqual(stage.nextAction.en.trim(), "");
      assert.notEqual(stage.nextAction.zh.trim(), "");
      assert.notEqual(stage.nextAction.en, stage.nextAction.zh);
    }
  });
});
