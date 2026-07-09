import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  approveTrialDateChange,
  clearedProposalFields,
  confirmTrialDate,
  daysBetweenProposedAndTarget,
  isProposedDateAfterTarget,
  participatesInDateConfirmation,
  pmSetPlannedDate,
  proposeTrialDateChange,
  rejectTrialDateChange,
  type DateConfirmationState,
  type DateConfirmationStatus
} from "../../src/domain/mold-trial/date-confirmation.ts";

function state(overrides: Partial<DateConfirmationState> = {}): DateConfirmationState {
  return {
    dateConfirmationStatus: "PENDING_CONFIRMATION",
    plannedDate: new Date("2026-07-10T00:00:00.000Z"),
    proposedDate: null,
    ...overrides
  };
}

const allStatuses: readonly DateConfirmationStatus[] = [
  "PENDING_CONFIRMATION",
  "CONFIRMED",
  "RESCHEDULE_PROPOSED",
  "RETURNED_TO_PM"
];

describe("date-confirmation participation", () => {
  test("only PLANNED and AT_RISK trials participate", () => {
    assert.equal(participatesInDateConfirmation("PLANNED"), true);
    assert.equal(participatesInDateConfirmation("AT_RISK"), true);
  });

  test("terminal, completed, and auto-missed trials do not participate", () => {
    for (const status of [
      "AUTO_MISSED_REASON_REQUIRED",
      "DELAYED",
      "COMPLETED",
      "PENDING_FOLLOW_UP",
      "ABORTED",
      "CANCELLED",
      "SKIPPED"
    ]) {
      assert.equal(participatesInDateConfirmation(status), false);
    }
  });
});

describe("confirmTrialDate", () => {
  test("confirms from PENDING_CONFIRMATION with a machine, clearing proposal fields", () => {
    const result = confirmTrialDate({ state: state(), injectionMachineId: "machine-12" });
    assert.equal(result.ok, true);
    assert.ok(result.ok);
    assert.equal(result.nextStatus, "CONFIRMED");
    assert.equal(result.clearProposalFields, true);
  });

  test("rejects confirm without a machine", () => {
    const result = confirmTrialDate({ state: state(), injectionMachineId: null });
    assert.equal(result.ok, false);
  });

  test("rejects confirm with a blank machine id", () => {
    const result = confirmTrialDate({ state: state(), injectionMachineId: "   " });
    assert.equal(result.ok, false);
  });

  test("rejects confirm from any non-pending state even with a machine", () => {
    for (const status of allStatuses) {
      if (status === "PENDING_CONFIRMATION") {
        continue;
      }
      const result = confirmTrialDate({
        state: state({ dateConfirmationStatus: status }),
        injectionMachineId: "machine-12"
      });
      assert.equal(result.ok, false, `expected reject from ${status}`);
    }
  });
});

describe("proposeTrialDateChange", () => {
  test("proposes a different date with a reason from PENDING_CONFIRMATION", () => {
    const result = proposeTrialDateChange({
      state: state(),
      proposedDate: new Date("2026-07-13T00:00:00.000Z"),
      reason: "Machine 12 booked until Thursday"
    });
    assert.equal(result.ok, true);
    assert.ok(result.ok);
    assert.equal(result.nextStatus, "RESCHEDULE_PROPOSED");
  });

  test("rejects a proposal equal to the current planned date", () => {
    const result = proposeTrialDateChange({
      state: state({ plannedDate: new Date("2026-07-10T00:00:00.000Z") }),
      proposedDate: "2026-07-10",
      reason: "Same day"
    });
    assert.equal(result.ok, false);
  });

  test("rejects a proposal with no reason", () => {
    const result = proposeTrialDateChange({
      state: state(),
      proposedDate: new Date("2026-07-13T00:00:00.000Z"),
      reason: "  "
    });
    assert.equal(result.ok, false);
  });

  test("rejects a proposal with an invalid date", () => {
    const result = proposeTrialDateChange({
      state: state(),
      proposedDate: null,
      reason: "reason"
    });
    assert.equal(result.ok, false);
  });

  test("rejects a proposal from a non-pending state", () => {
    for (const status of ["CONFIRMED", "RESCHEDULE_PROPOSED", "RETURNED_TO_PM"] as const) {
      const result = proposeTrialDateChange({
        state: state({ dateConfirmationStatus: status }),
        proposedDate: new Date("2026-07-13T00:00:00.000Z"),
        reason: "reason"
      });
      assert.equal(result.ok, false, `expected reject from ${status}`);
    }
  });
});

describe("approveTrialDateChange", () => {
  test("approves from RESCHEDULE_PROPOSED, applying the proposed date and clearing proposal fields", () => {
    const proposed = new Date("2026-07-13T00:00:00.000Z");
    const result = approveTrialDateChange({
      state: state({ dateConfirmationStatus: "RESCHEDULE_PROPOSED", proposedDate: proposed })
    });
    assert.equal(result.ok, true);
    assert.ok(result.ok);
    assert.equal(result.nextStatus, "CONFIRMED");
    assert.equal(result.newPlannedDate, proposed);
    assert.equal(result.clearProposalFields, true);
  });

  test("rejects approve when there is no proposed date on record", () => {
    const result = approveTrialDateChange({
      state: state({ dateConfirmationStatus: "RESCHEDULE_PROPOSED", proposedDate: null })
    });
    assert.equal(result.ok, false);
  });

  test("rejects approve from any state other than RESCHEDULE_PROPOSED", () => {
    for (const status of ["PENDING_CONFIRMATION", "CONFIRMED", "RETURNED_TO_PM"] as const) {
      const result = approveTrialDateChange({
        state: state({ dateConfirmationStatus: status, proposedDate: new Date("2026-07-13T00:00:00.000Z") })
      });
      assert.equal(result.ok, false, `expected reject from ${status}`);
    }
  });
});

describe("rejectTrialDateChange", () => {
  test("rejects (returns to PM) from RESCHEDULE_PROPOSED with a reason", () => {
    const result = rejectTrialDateChange({
      state: state({ dateConfirmationStatus: "RESCHEDULE_PROPOSED", proposedDate: new Date("2026-07-13T00:00:00.000Z") }),
      reason: "Customer target cannot slip"
    });
    assert.equal(result.ok, true);
    assert.ok(result.ok);
    assert.equal(result.nextStatus, "RETURNED_TO_PM");
  });

  test("rejects the reject action when no reason is given", () => {
    const result = rejectTrialDateChange({
      state: state({ dateConfirmationStatus: "RESCHEDULE_PROPOSED", proposedDate: new Date("2026-07-13T00:00:00.000Z") }),
      reason: ""
    });
    assert.equal(result.ok, false);
  });

  test("rejects the reject action from any state other than RESCHEDULE_PROPOSED", () => {
    for (const status of ["PENDING_CONFIRMATION", "CONFIRMED", "RETURNED_TO_PM"] as const) {
      const result = rejectTrialDateChange({
        state: state({ dateConfirmationStatus: status }),
        reason: "reason"
      });
      assert.equal(result.ok, false, `expected reject from ${status}`);
    }
  });
});

describe("pmSetPlannedDate", () => {
  test("always resets to PENDING_CONFIRMATION and clears proposal fields", () => {
    const result = pmSetPlannedDate();
    assert.equal(result.ok, true);
    assert.equal(result.nextStatus, "PENDING_CONFIRMATION");
    assert.equal(result.clearProposalFields, true);
  });

  test("clearedProposalFields nulls every proposal / decision column", () => {
    assert.deepEqual(clearedProposalFields(), {
      proposedDate: null,
      proposedById: null,
      proposedReason: null,
      rescheduleDecisionById: null,
      rescheduleDecisionAt: null,
      rescheduleRejectReason: null
    });
  });
});

describe("customer target gap", () => {
  test("positive gap when the proposal is before the target", () => {
    assert.equal(daysBetweenProposedAndTarget("2026-07-10", "2026-07-13"), 3);
    assert.equal(isProposedDateAfterTarget("2026-07-10", "2026-07-13"), false);
  });

  test("zero gap on the target day", () => {
    assert.equal(daysBetweenProposedAndTarget("2026-07-13", "2026-07-13"), 0);
    assert.equal(isProposedDateAfterTarget("2026-07-13", "2026-07-13"), false);
  });

  test("negative gap (red) when the proposal slips past the target", () => {
    assert.equal(daysBetweenProposedAndTarget("2026-07-16", "2026-07-13"), -3);
    assert.equal(isProposedDateAfterTarget("2026-07-16", "2026-07-13"), true);
  });

  test("null gap when either date is missing", () => {
    assert.equal(daysBetweenProposedAndTarget(null, "2026-07-13"), null);
    assert.equal(daysBetweenProposedAndTarget("2026-07-13", null), null);
    assert.equal(isProposedDateAfterTarget(null, "2026-07-13"), false);
  });

  test("accepts Date objects as well as strings", () => {
    assert.equal(
      daysBetweenProposedAndTarget(new Date("2026-07-10T00:00:00.000Z"), new Date("2026-07-13T00:00:00.000Z")),
      3
    );
  });
});
