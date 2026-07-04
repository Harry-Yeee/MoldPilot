import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  applyDesignChangeEvent,
  applyPmCustomTrialLimit,
  type LimitControlActor,
  type LimitControlProject,
  type LimitControlTrialEvent,
  type LimitControlTx
} from "../../src/server/mold-trial-limit-service.ts";

type FakeRow = Record<string, unknown>;
type FakeWriteArgs = {
  data: FakeRow;
  where?: {
    id?: string;
  };
};

type FakeState = {
  activityLogs: FakeRow[];
  designChanges: FakeRow[];
  projectUpdates: FakeRow[];
  trialLimitAdjustments: FakeRow[];
};

const planningPm: LimitControlActor = {
  id: "user-planning-pm",
  roleCode: "PM"
};

const marketing: LimitControlActor = {
  id: "user-marketing",
  roleCode: "MARKETING"
};

const viewer: LimitControlActor = {
  id: "user-viewer",
  roleCode: "VIEWER"
};

function baseProject(overrides: Partial<LimitControlProject> = {}): LimitControlProject {
  return {
    id: "project-1",
    baseTrialLimit: 3,
    currentTrialLimit: 3,
    customTrialLimit: null,
    customTrialLimitReason: null,
    designChanges: [],
    trialEvents: [],
    ...overrides
  };
}

function countedCompletedTrial(): LimitControlTrialEvent {
  return {
    actualDate: new Date("2026-03-01T00:00:00.000Z"),
    countsAgainstLimit: true,
    plannedDate: new Date("2026-03-01T00:00:00.000Z"),
    status: "COMPLETED",
    trialCode: "T0"
  };
}

function createFakeTx(): { state: FakeState; tx: LimitControlTx } {
  const state: FakeState = {
    activityLogs: [],
    designChanges: [],
    projectUpdates: [],
    trialLimitAdjustments: []
  };

  const tx = {
    activityLog: {
      create: async ({ data }: FakeWriteArgs) => {
        const row = { id: `activity-${state.activityLogs.length + 1}`, ...data };
        state.activityLogs.push(row);
        return row;
      }
    },
    designChangeEvent: {
      create: async ({ data }: FakeWriteArgs) => {
        const row = { id: `design-change-${state.designChanges.length + 1}`, ...data };
        state.designChanges.push(row);
        return row;
      }
    },
    moldTrialProject: {
      update: async ({ data, where }: FakeWriteArgs) => {
        const row = { id: where?.id ?? "project-1", ...data };
        state.projectUpdates.push(row);
        return row;
      }
    },
    trialLimitAdjustment: {
      create: async ({ data }: FakeWriteArgs) => {
        const row = { id: `limit-adjustment-${state.trialLimitAdjustments.length + 1}`, ...data };
        state.trialLimitAdjustments.push(row);
        return row;
      }
    }
  };

  return {
    state,
    tx: tx as unknown as LimitControlTx
  };
}

describe("server-side trial limit controls", () => {
  test("PM custom trial limit updates project limit and writes adjustment plus ActivityLog records", async () => {
    const { state, tx } = createFakeTx();

    const result = await applyPmCustomTrialLimit(tx, {
      actor: planningPm,
      customTrialLimit: 5,
      customTrialLimitReason: "Deep rib correction needs one additional verification trial.",
      project: baseProject()
    });

    assert.equal(result.updatedProject.currentTrialLimit, 5);
    assert.equal(result.adjustment.adjustmentType, "PM_CUSTOM_LIMIT");
    assert.equal(state.projectUpdates.length, 1);
    assert.equal(state.projectUpdates[0]?.currentTrialLimit, 5);
    assert.equal(state.projectUpdates[0]?.customTrialLimit, 5);
    assert.equal(state.projectUpdates[0]?.customTrialLimitReason, "Deep rib correction needs one additional verification trial.");
    assert.equal(state.trialLimitAdjustments.length, 1);
    assert.equal(state.trialLimitAdjustments[0]?.newLimit, 5);
    assert.equal(state.trialLimitAdjustments[0]?.reason, "Deep rib correction needs one additional verification trial.");
    assert.deepEqual(state.activityLogs.map((log) => log.action), [
      "set_pm_custom_trial_limit",
      "created_pm_custom_limit_adjustment"
    ]);
  });

  test("non-PM roles cannot set a PM custom trial limit", async () => {
    const { state, tx } = createFakeTx();

    await assert.rejects(
      () =>
        applyPmCustomTrialLimit(tx, {
          actor: marketing,
          customTrialLimit: 5,
          customTrialLimitReason: "Marketing request without PM approval.",
          project: baseProject()
        }),
      /Only PM or Admin can set PM custom trial limits/
    );

    assert.equal(state.projectUpdates.length, 0);
    assert.equal(state.trialLimitAdjustments.length, 0);
    assert.equal(state.activityLogs.length, 0);
  });

  test("approved design change after a counted completed trial grants one extra trial", async () => {
    const { state, tx } = createFakeTx();

    const result = await applyDesignChangeEvent(tx, {
      actor: planningPm,
      approvalReason: "Customer-driven geometry change after T0 consumed one counted trial.",
      approveExtraTrial: true,
      changeDate: new Date("2026-04-08T00:00:00.000Z"),
      description: "Customer requested a clip clearance update after T0 samples.",
      project: baseProject({ trialEvents: [countedCompletedTrial()] }),
      requestedBy: "CUSTOMER",
      title: "Clip clearance update"
    });

    assert.equal(result.grantsExtraTrial, true);
    assert.equal(result.designChange.grantsExtraTrial, true);
    assert.equal(result.designChange.firstCompletedTrialAlreadyDone, true);
    assert.equal(result.adjustment?.adjustmentType, "DESIGN_CHANGE_EXTRA_TRIAL");
    assert.equal(state.projectUpdates[0]?.currentTrialLimit, 4);
    assert.equal(state.trialLimitAdjustments[0]?.deltaTrials, 1);
    assert.deepEqual(state.activityLogs.map((log) => log.action), [
      "created_design_change",
      "created_design_change_extra_trial_adjustment"
    ]);
  });

  test("design change before any counted completed trial records the event but does not increase the limit", async () => {
    const { state, tx } = createFakeTx();

    const result = await applyDesignChangeEvent(tx, {
      actor: planningPm,
      approvalReason: null,
      approveExtraTrial: false,
      changeDate: new Date("2026-04-01T00:00:00.000Z"),
      description: "Engineering adjusted wall thickness before the first trial.",
      project: baseProject(),
      requestedBy: "INTERNAL",
      title: "Wall thickness update"
    });

    assert.equal(result.grantsExtraTrial, false);
    assert.equal(result.designChange.firstCompletedTrialAlreadyDone, false);
    assert.equal(result.designChange.grantsExtraTrial, false);
    assert.equal(result.adjustment, null);
    assert.equal(state.designChanges.length, 1);
    assert.equal(state.projectUpdates[0]?.currentTrialLimit, 3);
    assert.equal(state.trialLimitAdjustments.length, 0);
    assert.deepEqual(state.activityLogs.map((log) => log.action), ["created_design_change"]);
  });

  test("Marketing can create customer-driven design changes but cannot approve extra trials", async () => {
    const customerDriven = createFakeTx();

    await applyDesignChangeEvent(customerDriven.tx, {
      actor: marketing,
      approvalReason: null,
      approveExtraTrial: false,
      changeDate: new Date("2026-04-10T00:00:00.000Z"),
      description: "Customer feedback requested a visible surface clearance change.",
      project: baseProject({ trialEvents: [countedCompletedTrial()] }),
      requestedBy: "CUSTOMER",
      title: "Customer surface feedback"
    });

    assert.equal(customerDriven.state.designChanges.length, 1);
    assert.equal(customerDriven.state.trialLimitAdjustments.length, 0);
    assert.deepEqual(customerDriven.state.activityLogs.map((log) => log.action), ["created_design_change"]);

    const attemptedApproval = createFakeTx();
    await assert.rejects(
      () =>
        applyDesignChangeEvent(attemptedApproval.tx, {
          actor: marketing,
          approvalReason: "Customer asked for the change.",
          approveExtraTrial: true,
          changeDate: new Date("2026-04-10T00:00:00.000Z"),
          description: "Customer feedback requested a visible surface clearance change.",
          project: baseProject({ trialEvents: [countedCompletedTrial()] }),
          requestedBy: "CUSTOMER",
          title: "Customer surface feedback"
        }),
      /Only PM or Admin can approve design-change extra trial allowance/
    );

    assert.equal(attemptedApproval.state.designChanges.length, 0);
    assert.equal(attemptedApproval.state.projectUpdates.length, 0);
    assert.equal(attemptedApproval.state.activityLogs.length, 0);
  });

  test("unauthorized roles are blocked by the design-change write path", async () => {
    const { state, tx } = createFakeTx();

    await assert.rejects(
      () =>
        applyDesignChangeEvent(tx, {
          actor: viewer,
          approvalReason: null,
          approveExtraTrial: false,
          changeDate: new Date("2026-04-12T00:00:00.000Z"),
          description: "Viewer attempted to add a design change.",
          project: baseProject(),
          requestedBy: "INTERNAL",
          title: "Viewer change attempt"
        }),
      /This role cannot create design change events/
    );

    assert.equal(state.designChanges.length, 0);
    assert.equal(state.projectUpdates.length, 0);
    assert.equal(state.trialLimitAdjustments.length, 0);
    assert.equal(state.activityLogs.length, 0);
  });
});
