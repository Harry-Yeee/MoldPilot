import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import {
  buildTrialPanels,
  canShowExtraTrialPanel,
  formatDaysAway,
  formatTrialCountBadge,
  trialStageLabel,
  validateExtraTrialPanelCreation,
  validateNextTrialStageCreation,
  type TrialPanelIssue,
  type TrialPanelTrial
} from "../../src/domain/mold-trial/trial-panel.ts";

function completedTrial(sequenceNumber: number, trialCode: TrialPanelTrial["trialCode"]): TrialPanelTrial {
  return {
    id: `trial-${sequenceNumber}`,
    trialCode,
    sequenceNumber,
    plannedDate: "2026-06-01",
    actualDate: "2026-06-01",
    status: "Completed",
    result: "Approved",
    outcomeDisposition: "Approved / Complete",
    countsAgainstLimit: true
  };
}

function nonApprovedCompletedTrial(sequenceNumber: number, trialCode: TrialPanelTrial["trialCode"]): TrialPanelTrial {
  return {
    ...completedTrial(sequenceNumber, trialCode),
    result: "Not Approved / Rework Required",
    outcomeDisposition: "Rework Required"
  };
}

describe("trial panel display rules", () => {
  test("normal detail page source does not show PM custom limit controls", () => {
    const detailPageSource = readFileSync(new URL("../../src/app/projects/[projectCode]/page.tsx", import.meta.url), "utf8");

    assert.equal(detailPageSource.includes("Set PM Custom Limit"), false);
    assert.equal(detailPageSource.includes("trial-limit-heading"), false);
  });

  test("normal detail page keeps trial work inside panels and hides standalone missed/design-change actions", () => {
    const detailPageSource = readFileSync(new URL("../../src/app/projects/[projectCode]/page.tsx", import.meta.url), "utf8");

    assert.equal(detailPageSource.includes("aria-label=\"Trial actions\""), false);
    assert.equal(detailPageSource.includes("Record Missed Trial"), false);
    assert.equal(detailPageSource.includes("Add Design Change"), false);
    assert.equal(detailPageSource.includes("project.recordResult"), true);
    assert.equal(detailPageSource.includes("TrialIssuePanelForm"), true);
  });

  test("missed trial replanning keeps the same visible trial stage", () => {
    const actionsSource = readFileSync(new URL("../../src/server/mold-trial-actions.ts", import.meta.url), "utf8");

    assert.equal(actionsSource.includes("created_replanned_trial"), false);
    assert.equal(actionsSource.includes("replanned_same_trial_stage"), true);
    assert.match(actionsSource, /where: \{ id: delayedTrial\.id \}/);
  });

  test("formats next planned trial days away", () => {
    assert.equal(formatDaysAway("2026-07-06", "2026-07-01"), "+5 days");
    assert.equal(formatDaysAway("2026-07-01", "2026-07-01"), "0 days");
    assert.equal(formatDaysAway("2026-06-29", "2026-07-01"), "-2 days overdue");
    assert.equal(formatDaysAway(null, "2026-07-01"), "Not set");
  });

  test("formats compact trial count badge text", () => {
    assert.equal(
      formatTrialCountBadge({
        baseTrialLimit: 3,
        completedTrialCount: 1,
        currentTrialLimit: 3,
        designChangeExtraTrialCount: 0,
        warningState: "Healthy"
      }),
      "1 / 3"
    );
    assert.equal(
      formatTrialCountBadge({
        baseTrialLimit: 3,
        completedTrialCount: 2,
        currentTrialLimit: 3,
        designChangeExtraTrialCount: 0,
        warningState: "Near Limit"
      }),
      "2 / 3 Near Limit"
    );
    assert.equal(
      formatTrialCountBadge({
        baseTrialLimit: 3,
        completedTrialCount: 3,
        currentTrialLimit: 3,
        designChangeExtraTrialCount: 0,
        warningState: "At Limit"
      }),
      "3 / 3 At Limit"
    );
    assert.equal(
      formatTrialCountBadge({
        baseTrialLimit: 3,
        completedTrialCount: 4,
        currentTrialLimit: 3,
        designChangeExtraTrialCount: 0,
        warningState: "Over Limit"
      }),
      "4 / 3 Extra Trial"
    );
    assert.equal(
      formatTrialCountBadge({
        baseTrialLimit: 3,
        completedTrialCount: 3,
        currentTrialLimit: 4,
        designChangeExtraTrialCount: 1,
        warningState: "Near Limit"
      }),
      "3 / 4 Design Change Allowance"
    );
  });

  test("builds default T0, T1, and T2 panels before extra trials", () => {
    const panels = buildTrialPanels({
      currentTrialId: "trial-1",
      trialEvents: [
        {
          id: "trial-1",
          trialCode: "T0",
          sequenceNumber: 1,
          plannedDate: "2026-07-10",
          status: "Planned"
        }
      ]
    });

    assert.deepEqual(panels.map((panel) => panel.title), ["T0", "T1", "T2"]);
    assert.equal(panels[0]?.isNextActionPanel, true);
  });

  test("uses plain T-stage labels without internal sequence suffixes", () => {
    assert.equal(trialStageLabel(1), "T0");
    assert.equal(trialStageLabel(2), "T1");
    assert.equal(trialStageLabel(3), "T2");
    assert.equal(trialStageLabel(4), "T3");

    const panels = buildTrialPanels({
      trialEvents: [
        completedTrial(1, "T0"),
        completedTrial(2, "T1"),
        completedTrial(3, "T2"),
        {
          id: "trial-4",
          trialCode: "Extra",
          sequenceNumber: 4,
          plannedDate: "2026-07-01",
          status: "Planned",
          planReasonDetail: "Approved design change verification."
        }
      ],
      trialLimitAdjustments: [
        {
          adjustmentType: "DESIGN_CHANGE_EXTRA_TRIAL",
          deltaTrials: 1,
          reason: "Customer approved an additional design-change trial."
        }
      ]
    });

    assert.deepEqual(panels.map((panel) => panel.title), ["T0", "T1", "T2", "T3"]);
  });

  test("blocks planning T1 until T0 has real completion or explicit closure", () => {
    const blocked = validateNextTrialStageCreation({
      nextSequenceNumber: 2,
      trialEvents: [
        {
          id: "trial-1",
          trialCode: "T0",
          sequenceNumber: 1,
          plannedDate: "2026-06-20",
          status: "Delayed"
        }
      ]
    });
    const allowedAfterCompletion = validateNextTrialStageCreation({
      nextSequenceNumber: 2,
      trialEvents: [completedTrial(1, "T0")]
    });
    const allowedAfterAbort = validateNextTrialStageCreation({
      nextSequenceNumber: 2,
      trialEvents: [
        {
          id: "trial-1",
          trialCode: "T0",
          sequenceNumber: 1,
          plannedDate: "2026-06-20",
          status: "Aborted"
        }
      ]
    });

    assert.equal(blocked.ok, false);
    assert.match(blocked.issues[0]?.message ?? "", /T0 must be completed/);
    assert.equal(allowedAfterCompletion.ok, true);
    assert.equal(allowedAfterAbort.ok, true);
  });

  test("blocks next trial after a non-approved previous trial until that same trial has a linked issue", () => {
    const blocked = validateNextTrialStageCreation({
      nextSequenceNumber: 2,
      trialEvents: [nonApprovedCompletedTrial(1, "T0")]
    });
    const wrongTrialIssue = validateNextTrialStageCreation({
      nextSequenceNumber: 2,
      trialEvents: [nonApprovedCompletedTrial(1, "T0")],
      issues: [
        {
          id: "issue-t1",
          title: "Issue from a different trial",
          status: "Open",
          foundAtTrialSequenceNumber: 2
        }
      ]
    });
    const allowedWithSameTrialIssue = validateNextTrialStageCreation({
      nextSequenceNumber: 2,
      trialEvents: [nonApprovedCompletedTrial(1, "T0")],
      issues: [
        {
          id: "issue-t0",
          title: "Flash found during T0",
          status: "Open",
          foundAtTrialSequenceNumber: 1
        }
      ]
    });
    const allowedAfterApprovedTrial = validateNextTrialStageCreation({
      nextSequenceNumber: 2,
      trialEvents: [completedTrial(1, "T0")]
    });

    assert.equal(blocked.ok, false);
    assert.equal(blocked.issues[0]?.field, "trialIssues");
    assert.match(blocked.issues[0]?.message ?? "", /Add at least one issue under T0 before planning T1/);
    assert.equal(wrongTrialIssue.ok, false);
    assert.equal(allowedWithSameTrialIssue.ok, true);
    assert.equal(allowedAfterApprovedTrial.ok, true);
  });

  test("blocks fourth trial panel until T0/T1/T2 are completed", () => {
    const trials: TrialPanelTrial[] = [
      completedTrial(1, "T0"),
      {
        id: "trial-2",
        trialCode: "T1",
        sequenceNumber: 2,
        plannedDate: "2026-06-08",
        status: "Planned"
      },
      completedTrial(3, "T2")
    ];

    assert.equal(
      canShowExtraTrialPanel({
        sequenceNumber: 4,
        trialEvents: trials,
        visibleExtraTrialReasonCount: 1
      }),
      false
    );
    assert.equal(
      validateExtraTrialPanelCreation({
        nextSequenceNumber: 4,
        trialEvents: trials,
        candidateReasonCategory: "QC Failure"
      }).ok,
      false
    );
  });

  test("requires visible reason before fourth trial panel can be added", () => {
    const trials: TrialPanelTrial[] = [
      completedTrial(1, "T0"),
      completedTrial(2, "T1"),
      completedTrial(3, "T2")
    ];

    const missingReason = validateExtraTrialPanelCreation({
      nextSequenceNumber: 4,
      trialEvents: trials,
      candidateReasonDetail: " "
    });
    const withReason = validateExtraTrialPanelCreation({
      nextSequenceNumber: 4,
      trialEvents: trials,
      candidateReasonCategory: "Bad Customer Feedback"
    });

    assert.equal(missingReason.ok, false);
    assert.equal(missingReason.issues[0]?.field, "planReasonCategory");
    assert.equal(withReason.ok, true);
  });

  test("shows fifth trial panel only after fourth trial is completed and another reason exists", () => {
    const trials: TrialPanelTrial[] = [
      completedTrial(1, "T0"),
      completedTrial(2, "T1"),
      completedTrial(3, "T2"),
      {
        ...completedTrial(4, "Extra"),
        planReasonDetail: "Design change verification."
      }
    ];

    assert.equal(
      validateExtraTrialPanelCreation({
        nextSequenceNumber: 5,
        trialEvents: trials,
        candidateReasonCategory: "Injection Process Retest"
      }).ok,
      true
    );
    assert.equal(buildTrialPanels({ trialEvents: trials }).length, 4);
    assert.equal(
      buildTrialPanels({
        trialEvents: trials,
        trialLimitAdjustments: [
          {
            adjustmentType: "DESIGN_CHANGE_EXTRA_TRIAL",
            deltaTrials: 1,
            reason: "Customer approved an additional design-change trial."
          }
        ]
      }).length,
      5
    );
  });

  test("does not double-count one design-change extra-trial reason from linked plan and adjustment", () => {
    const trials: TrialPanelTrial[] = [
      completedTrial(1, "T0"),
      completedTrial(2, "T1"),
      completedTrial(3, "T2"),
      {
        ...completedTrial(4, "Extra"),
        planReasonDetail: "Design change verification.",
        relatedDesignChangeEventId: "design-1"
      }
    ];

    assert.equal(
      validateExtraTrialPanelCreation({
        nextSequenceNumber: 5,
        trialEvents: trials,
        trialLimitAdjustments: [
          {
            adjustmentType: "DESIGN_CHANGE_EXTRA_TRIAL",
            deltaTrials: 1,
            reason: "Customer approved an additional design-change trial."
          }
        ],
        candidateReasonDetail: " "
      }).ok,
      false
    );
  });

  test("shows unresolved previous issues in later trial verification lists", () => {
    const issues: TrialPanelIssue[] = [
      {
        id: "issue-open",
        title: "Flash at cavity A",
        status: "Open",
        foundAtTrialSequenceNumber: 1
      },
      {
        id: "issue-closed",
        title: "Gate polish complete",
        status: "Closed",
        foundAtTrialSequenceNumber: 1
      }
    ];
    const panels = buildTrialPanels({
      issues,
      trialEvents: [
        completedTrial(1, "T0"),
        {
          id: "trial-2",
          trialCode: "T1",
          sequenceNumber: 2,
          plannedDate: "2026-07-08",
          status: "Planned"
        }
      ]
    });

    assert.deepEqual(panels[1]?.priorVerificationIssues.map((issue) => issue.title), ["Flash at cavity A"]);
  });
});
