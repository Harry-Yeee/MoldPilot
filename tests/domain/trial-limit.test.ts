import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  calculateCurrentTrialLimit,
  countCompletedTrials,
  customLimitCreatesAuditRecords,
  designChangeCreatesActivityActions,
  designChangeCreatesLimitAdjustment,
  evaluateDesignChangeAllowance,
  evaluateTrialLimit,
  getTrialLimitState,
  validateCustomTrialLimit,
  validateDesignChangeCreate,
  validatePmCustomTrialLimit
} from "../../src/domain/mold-trial/trial-limit.ts";
import type { DesignChangeEvent, TrialEvent } from "../../src/domain/mold-trial/types.ts";

function completedTrial(trialCode: TrialEvent["trialCode"]): TrialEvent {
  return {
    trialCode,
    plannedDate: "2026-03-01",
    actualDate: "2026-03-01",
    status: "Completed"
  };
}

describe("trial limit domain rules", () => {
  test("AT-007 counts completed trials and ignores planned, cancelled, and skipped trials", () => {
    const trials: TrialEvent[] = [
      completedTrial("T0"),
      { trialCode: "T1", plannedDate: "2026-03-12", status: "Planned" },
      { trialCode: "T1", plannedDate: "2026-03-13", status: "Cancelled" },
      { trialCode: "T1", plannedDate: "2026-03-14", status: "Skipped" }
    ];

    assert.equal(countCompletedTrials(trials), 1);
  });

  test("does not count completed trials explicitly excluded from the limit", () => {
    const trials: TrialEvent[] = [
      completedTrial("T0"),
      {
        ...completedTrial("T1"),
        countsAgainstLimit: false
      }
    ];

    assert.equal(countCompletedTrials(trials), 1);
  });

  test("counts happened trials waiting for follow-up when explicitly marked against the limit", () => {
    const trials: TrialEvent[] = [
      {
        trialCode: "T0",
        plannedDate: "2026-03-01",
        actualDate: "2026-03-01",
        status: "Pending Follow-Up",
        result: "Conditional",
        outcomeDisposition: "Pending Customer Feedback",
        countsAgainstLimit: true
      }
    ];

    assert.equal(countCompletedTrials(trials), 1);
    assert.equal(evaluateTrialLimit({ trialEvents: trials }).completedTrialCount, 1);
  });

  test("does not count pending follow-up by default without an explicit limit decision", () => {
    const trials: TrialEvent[] = [
      {
        trialCode: "T0",
        plannedDate: "2026-03-01",
        actualDate: "2026-03-01",
        status: "Pending Follow-Up",
        result: "Conditional",
        outcomeDisposition: "Pending Customer Feedback"
      }
    ];

    assert.equal(countCompletedTrials(trials), 0);
  });

  test("AT-011 returns documented trial-limit warning states", () => {
    assert.equal(getTrialLimitState(0, 3), "Healthy");
    assert.equal(getTrialLimitState(1, 3), "Healthy");
    assert.equal(getTrialLimitState(2, 3), "Near Limit");
    assert.equal(getTrialLimitState(3, 3), "At Limit");
    assert.equal(getTrialLimitState(4, 3), "Over Limit");
  });

  test("AT-012 design change before first completed trial does not add allowance", () => {
    const decision = evaluateDesignChangeAllowance({
      completedTrialCount: 0,
      approved: true,
      approverId: "pm-1",
      approvalReason: "Customer changed clip geometry."
    });

    assert.equal(decision.grantsExtraTrial, false);
    assert.equal(decision.extraTrialCount, 0);
    assert.equal(calculateCurrentTrialLimit({ designChanges: [] }), 3);
  });

  test("AT-013 design change after first completed trial adds one approved allowance", () => {
    const designChanges: DesignChangeEvent[] = [
      {
        firstCompletedTrialAlreadyDone: true,
        grantsExtraTrial: true,
        approvedById: "pm-1",
        approvalReason: "Approved customer design change after T0."
      }
    ];

    assert.equal(calculateCurrentTrialLimit({ designChanges }), 4);
    assert.deepEqual(
      evaluateTrialLimit({
        trialEvents: [completedTrial("T0"), completedTrial("T1"), completedTrial("T2")],
        designChanges
      }),
      {
        baseTrialLimit: 3,
        completedTrialCount: 3,
        currentTrialLimit: 4,
        designChangeExtraTrialCount: 1,
        remainingTrialAllowance: 1,
        warningState: "Near Limit",
        usesCustomLimit: false
      }
    );
  });

  test("AT-014 PM custom trial limit requires a visible reason", () => {
    const result = validateCustomTrialLimit({
      customTrialLimit: 5,
      customTrialLimitReason: " "
    });

    assert.equal(result.ok, false);
    assert.deepEqual(result.issues.map((issue) => issue.field), ["customTrialLimitReason"]);
  });

  test("PM custom trial limit is PM/Admin only and creates audit records", () => {
    const blocked = validatePmCustomTrialLimit({
      actorRole: "MARKETING",
      customTrialLimit: 5,
      customTrialLimitReason: "Deep rib correction needs one more pass."
    });

    assert.equal(blocked.ok, false);
    assert.equal(blocked.issues[0]?.field, "actorRole");

    const allowed = validatePmCustomTrialLimit({
      actorRole: "PM",
      customTrialLimit: 5,
      customTrialLimitReason: "Difficult tool, PM approved one extra pass."
    });

    assert.equal(allowed.ok, true);
    assert.deepEqual(customLimitCreatesAuditRecords(), {
      trialLimitAdjustmentType: "PM Custom Limit",
      activityAction: "set_pm_custom_trial_limit"
    });
  });

  test("AT-015 PM custom trial limit overrides calculated design-change limit", () => {
    const summary = evaluateTrialLimit({
      customTrialLimit: 5,
      customTrialLimitReason: "Deep rib correction needs one more verification pass.",
      trialEvents: [completedTrial("T0"), completedTrial("T1"), completedTrial("T2")],
      designChanges: [
        {
          firstCompletedTrialAlreadyDone: true,
          grantsExtraTrial: true,
          approvedById: "pm-1",
          approvalReason: "Customer design change."
        }
      ]
    });

    assert.equal(summary.currentTrialLimit, 5);
    assert.equal(summary.usesCustomLimit, true);
    assert.equal(summary.warningState, "Healthy");
  });

  test("design change before first completed counted trial cannot grant extra allowance", () => {
    const validation = validateDesignChangeCreate({
      actorRole: "PM",
      changeDate: "2026-04-01",
      requestedBy: "Internal",
      title: "Wall thickness update",
      description: "Engineering update before first trial.",
      approveExtraTrial: true,
      completedTrialCount: 0,
      approvedById: "pm-1",
      approvalReason: "Trying to approve too early."
    });

    assert.equal(validation.ok, false);
    assert.equal(validation.issues[0]?.field, "completedTrialCount");

    assert.deepEqual(
      evaluateDesignChangeAllowance({
        completedTrialCount: 0,
        approved: true,
        approverId: "pm-1",
        approvalReason: "Customer changed part before T0."
      }),
      {
        grantsExtraTrial: false,
        extraTrialCount: 0,
        reason: "Design changes before the first completed trial do not add trial allowance."
      }
    );
  });

  test("approved design change after first counted trial grants one adjustment and activity log", () => {
    const validation = validateDesignChangeCreate({
      actorRole: "PM",
      changeDate: "2026-04-08",
      requestedBy: "Customer",
      title: "Clip geometry update",
      description: "Customer requested clip clearance update after T0.",
      approveExtraTrial: true,
      completedTrialCount: 1,
      approvedById: "pm-1",
      approvalReason: "Customer-driven design change after counted trial."
    });
    const allowance = evaluateDesignChangeAllowance({
      completedTrialCount: 1,
      approved: true,
      approverId: "pm-1",
      approvalReason: "Customer-driven design change after counted trial."
    });

    assert.equal(validation.ok, true);
    assert.equal(allowance.grantsExtraTrial, true);
    assert.equal(allowance.extraTrialCount, 1);
    assert.equal(designChangeCreatesLimitAdjustment(allowance), true);
    assert.deepEqual(designChangeCreatesActivityActions(allowance), [
      "created_design_change",
      "created_design_change_extra_trial_adjustment"
    ]);
  });

  test("Marketing/Sales can report customer-driven design changes but cannot approve allowance", () => {
    const customerDriven = validateDesignChangeCreate({
      actorRole: "MARKETING",
      changeDate: "2026-04-10",
      requestedBy: "Customer",
      title: "Customer sample feedback",
      description: "Customer requested fit clearance update.",
      approveExtraTrial: false,
      completedTrialCount: 1
    });

    assert.equal(customerDriven.ok, true);

    const attemptedApproval = validateDesignChangeCreate({
      actorRole: "MARKETING",
      changeDate: "2026-04-10",
      requestedBy: "Customer",
      title: "Customer sample feedback",
      description: "Customer requested fit clearance update.",
      approveExtraTrial: true,
      completedTrialCount: 1,
      approvedById: "sales-1",
      approvalReason: "Customer asked for change."
    });

    assert.equal(attemptedApproval.ok, false);
    assert.equal(attemptedApproval.issues[0]?.field, "actorRole");
  });
});
