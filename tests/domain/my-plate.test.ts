import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  belongsToApproveDateChangesSection,
  belongsToAssemblyAcknowledgeSection,
  belongsToAssemblySelfCheckSection,
  belongsToComingUpSection,
  belongsToConfirmTrialDatesSection,
  belongsToDepartmentInboxSection,
  belongsToDesignRevisionsSection,
  belongsToMyOpenIssuesSection,
  belongsToNeedsReasonSection,
  belongsToPmConfirmReadySection,
  belongsToQcReportsToUploadSection,
  belongsToReturnedDatesSection,
  comparePlateItemsByDate,
  isAssemblyActionableIssue,
  isOverdue,
  isViewerProjectPm,
  type PlateDesignChangeRecord,
  type PlateIssueRecord,
  type PlateTrialRecord,
  type PlateViewer
} from "../../src/domain/mold-trial/my-plate.ts";
import { measurementReportEligibleStatuses } from "../../src/domain/mold-trial/measurement-report.ts";

const NOW = new Date("2026-07-04T09:00:00.000Z");

const pmBill: PlateViewer = { userId: "bill", roleCode: "PM" };
const pmJun: PlateViewer = { userId: "jun", roleCode: "PM" };
const assemblyZhong: PlateViewer = { userId: "zhong", roleCode: "ASSEMBLY" };
const qcGong: PlateViewer = { userId: "gong", roleCode: "QC" };
const injectionWang: PlateViewer = { userId: "wang", roleCode: "INJECTION" };
const marketingYvonne: PlateViewer = { userId: "yvonne", roleCode: "MARKETING" };
const designLin: PlateViewer = { userId: "lin", roleCode: "DESIGN" };

function designChange(overrides: Partial<PlateDesignChangeRecord> = {}): PlateDesignChangeRecord {
  return { projectStatus: "ACTIVE", hasDrawing: false, ...overrides };
}

function trial(overrides: Partial<PlateTrialRecord> = {}): PlateTrialRecord {
  return {
    status: "PLANNED",
    plannedDate: new Date("2026-07-06T00:00:00.000Z"),
    projectPlanningPmId: "bill",
    projectTechnicalPmId: "jun",
    ...overrides
  };
}

function issue(overrides: Partial<PlateIssueRecord> = {}): PlateIssueRecord {
  return {
    status: "OPEN",
    ownerUserId: null,
    issueType: "ASSEMBLY_FITTING_ISSUE",
    ownerGroupCode: "assembly",
    assemblyAcknowledgedAt: null,
    assemblySelfCheckedAt: null,
    pmReadyConfirmedAt: null,
    projectPlanningPmId: "bill",
    projectTechnicalPmId: "jun",
    ...overrides
  };
}

describe("my-plate project PM scoping", () => {
  test("matches planning and technical PM, rejects strangers", () => {
    assert.equal(isViewerProjectPm(pmBill, trial()), true);
    assert.equal(isViewerProjectPm(pmJun, trial()), true);
    assert.equal(isViewerProjectPm({ userId: "cheng", roleCode: "PM" }, trial()), false);
  });
});

describe("needs-a-reason section", () => {
  test("includes auto-missed trials on my project", () => {
    assert.equal(
      belongsToNeedsReasonSection(pmBill, trial({ status: "AUTO_MISSED_REASON_REQUIRED" })),
      true
    );
  });

  test("excludes auto-missed trials on someone else's project", () => {
    assert.equal(
      belongsToNeedsReasonSection(
        { userId: "cheng", roleCode: "PM" },
        trial({ status: "AUTO_MISSED_REASON_REQUIRED" })
      ),
      false
    );
  });

  test("excludes non-auto-missed statuses even on my project", () => {
    assert.equal(belongsToNeedsReasonSection(pmBill, trial({ status: "PLANNED" })), false);
    assert.equal(belongsToNeedsReasonSection(pmBill, trial({ status: "DELAYED" })), false);
  });
});

describe("confirm-trial-dates section (Injection)", () => {
  test("includes planned/at-risk trials awaiting confirmation for Injection", () => {
    assert.equal(
      belongsToConfirmTrialDatesSection(injectionWang, trial({ dateConfirmationStatus: "PENDING_CONFIRMATION" })),
      true
    );
    assert.equal(
      belongsToConfirmTrialDatesSection(
        injectionWang,
        trial({ status: "AT_RISK", dateConfirmationStatus: "PENDING_CONFIRMATION" })
      ),
      true
    );
  });

  test("excludes already-confirmed, proposed, or returned trials", () => {
    for (const status of ["CONFIRMED", "RESCHEDULE_PROPOSED", "RETURNED_TO_PM"] as const) {
      assert.equal(
        belongsToConfirmTrialDatesSection(injectionWang, trial({ dateConfirmationStatus: status })),
        false
      );
    }
  });

  test("is not offered to non-Injection roles", () => {
    assert.equal(
      belongsToConfirmTrialDatesSection(pmBill, trial({ dateConfirmationStatus: "PENDING_CONFIRMATION" })),
      false
    );
    assert.equal(
      belongsToConfirmTrialDatesSection(marketingYvonne, trial({ dateConfirmationStatus: "PENDING_CONFIRMATION" })),
      false
    );
  });

  test("excludes non-planned trial statuses", () => {
    assert.equal(
      belongsToConfirmTrialDatesSection(
        injectionWang,
        trial({ status: "AUTO_MISSED_REASON_REQUIRED", dateConfirmationStatus: "PENDING_CONFIRMATION" })
      ),
      false
    );
  });
});

describe("approve-date-changes section (Marketing)", () => {
  test("includes trials with a proposed change for Marketing", () => {
    assert.equal(
      belongsToApproveDateChangesSection(marketingYvonne, trial({ dateConfirmationStatus: "RESCHEDULE_PROPOSED" })),
      true
    );
  });

  test("excludes pending, confirmed, or returned trials", () => {
    for (const status of ["PENDING_CONFIRMATION", "CONFIRMED", "RETURNED_TO_PM"] as const) {
      assert.equal(
        belongsToApproveDateChangesSection(marketingYvonne, trial({ dateConfirmationStatus: status })),
        false
      );
    }
  });

  test("is not offered to non-Marketing roles", () => {
    assert.equal(
      belongsToApproveDateChangesSection(injectionWang, trial({ dateConfirmationStatus: "RESCHEDULE_PROPOSED" })),
      false
    );
    assert.equal(
      belongsToApproveDateChangesSection(pmBill, trial({ dateConfirmationStatus: "RESCHEDULE_PROPOSED" })),
      false
    );
  });
});

describe("returned-dates section (PM)", () => {
  test("includes returned trials on my project for the PM", () => {
    assert.equal(
      belongsToReturnedDatesSection(pmBill, trial({ dateConfirmationStatus: "RETURNED_TO_PM" })),
      true
    );
    assert.equal(
      belongsToReturnedDatesSection(pmJun, trial({ dateConfirmationStatus: "RETURNED_TO_PM" })),
      true
    );
  });

  test("excludes returned trials on someone else's project", () => {
    assert.equal(
      belongsToReturnedDatesSection(
        { userId: "cheng", roleCode: "PM" },
        trial({ dateConfirmationStatus: "RETURNED_TO_PM" })
      ),
      false
    );
  });

  test("excludes non-returned statuses even on my project", () => {
    for (const status of ["PENDING_CONFIRMATION", "CONFIRMED", "RESCHEDULE_PROPOSED"] as const) {
      assert.equal(belongsToReturnedDatesSection(pmBill, trial({ dateConfirmationStatus: status })), false);
    }
  });

  test("is not offered to non-PM roles", () => {
    assert.equal(
      belongsToReturnedDatesSection(injectionWang, trial({ dateConfirmationStatus: "RETURNED_TO_PM" })),
      false
    );
  });
});

describe("my-open-issues section", () => {
  test("includes issues I own that are not verified/closed", () => {
    assert.equal(belongsToMyOpenIssuesSection(qcGong, issue({ ownerUserId: "gong", status: "IN_PROGRESS" })), true);
    assert.equal(belongsToMyOpenIssuesSection(qcGong, issue({ ownerUserId: "gong", status: "OPEN" })), true);
  });

  test("excludes issues owned by someone else", () => {
    assert.equal(belongsToMyOpenIssuesSection(qcGong, issue({ ownerUserId: "wang", status: "OPEN" })), false);
  });

  test("excludes verified and closed issues", () => {
    assert.equal(belongsToMyOpenIssuesSection(qcGong, issue({ ownerUserId: "gong", status: "VERIFIED" })), false);
    assert.equal(belongsToMyOpenIssuesSection(qcGong, issue({ ownerUserId: "gong", status: "CLOSED" })), false);
  });
});

describe("department inbox section", () => {
  test("each department role sees only unassigned issues for its group", () => {
    assert.equal(belongsToDepartmentInboxSection(injectionWang, issue({ ownerGroupCode: "injection" })), true);
    assert.equal(belongsToDepartmentInboxSection(injectionWang, issue({ ownerGroupCode: "qc" })), false);

    assert.equal(belongsToDepartmentInboxSection(qcGong, issue({ ownerGroupCode: "qc" })), true);
    assert.equal(belongsToDepartmentInboxSection(qcGong, issue({ ownerGroupCode: "injection" })), false);

    assert.equal(belongsToDepartmentInboxSection(assemblyZhong, issue({ ownerGroupCode: "assembly" })), true);
    assert.equal(belongsToDepartmentInboxSection(assemblyZhong, issue({ ownerGroupCode: "marketing" })), false);

    assert.equal(belongsToDepartmentInboxSection(marketingYvonne, issue({ ownerGroupCode: "marketing" })), true);
    assert.equal(belongsToDepartmentInboxSection(marketingYvonne, issue({ ownerGroupCode: "assembly" })), false);

    assert.equal(belongsToDepartmentInboxSection(designLin, issue({ ownerGroupCode: "design" })), true);
    assert.equal(belongsToDepartmentInboxSection(designLin, issue({ ownerGroupCode: "assembly" })), false);
  });

  test("PM sees pm, planning, and technical group issues only on assigned projects", () => {
    assert.equal(belongsToDepartmentInboxSection(pmBill, issue({ ownerGroupCode: "pm" })), true);
    assert.equal(belongsToDepartmentInboxSection(pmBill, issue({ ownerGroupCode: "planning" })), true);
    assert.equal(belongsToDepartmentInboxSection(pmBill, issue({ ownerGroupCode: "technical" })), true);
    assert.equal(belongsToDepartmentInboxSection(pmBill, issue({ ownerGroupCode: "qc" })), false);
    assert.equal(
      belongsToDepartmentInboxSection(
        { userId: "cheng", roleCode: "PM" },
        issue({ ownerGroupCode: "technical", projectPlanningPmId: "bill", projectTechnicalPmId: "jun" })
      ),
      false
    );
  });

  test("excludes verified, closed, and personally owned issues", () => {
    assert.equal(belongsToDepartmentInboxSection(qcGong, issue({ ownerGroupCode: "qc", status: "VERIFIED" })), false);
    assert.equal(belongsToDepartmentInboxSection(qcGong, issue({ ownerGroupCode: "qc", status: "CLOSED" })), false);
    assert.equal(
      belongsToDepartmentInboxSection(qcGong, issue({ ownerGroupCode: "qc", ownerUserId: "gong" })),
      false
    );
  });
});

describe("design revisions section", () => {
  test("includes design-change events with no drawing for DESIGN on a live project", () => {
    assert.equal(belongsToDesignRevisionsSection(designLin, designChange()), true);
    assert.equal(belongsToDesignRevisionsSection(designLin, designChange({ projectStatus: "IN_CORRECTION" })), true);
  });

  test("excludes events that already have a drawing attached", () => {
    assert.equal(belongsToDesignRevisionsSection(designLin, designChange({ hasDrawing: true })), false);
  });

  test("excludes design-change events on terminal (cancelled/closed) projects", () => {
    assert.equal(belongsToDesignRevisionsSection(designLin, designChange({ projectStatus: "CANCELLED" })), false);
    assert.equal(belongsToDesignRevisionsSection(designLin, designChange({ projectStatus: "CLOSED" })), false);
  });

  test("is not offered to non-DESIGN roles", () => {
    assert.equal(belongsToDesignRevisionsSection(pmBill, designChange()), false);
    assert.equal(belongsToDesignRevisionsSection(assemblyZhong, designChange()), false);
    assert.equal(belongsToDesignRevisionsSection(qcGong, designChange()), false);
  });
});

describe("assembly acknowledge section", () => {
  test("includes un-acknowledged open issues for assembly users", () => {
    assert.equal(belongsToAssemblyAcknowledgeSection(assemblyZhong, issue({ status: "OPEN" })), true);
  });

  test("excludes issues already acknowledged", () => {
    assert.equal(
      belongsToAssemblyAcknowledgeSection(
        assemblyZhong,
        issue({ assemblyAcknowledgedAt: new Date("2026-07-02T00:00:00.000Z") })
      ),
      false
    );
  });

  test("excludes non-assembly viewers", () => {
    assert.equal(belongsToAssemblyAcknowledgeSection(qcGong, issue({ status: "OPEN" })), false);
    assert.equal(belongsToAssemblyAcknowledgeSection(pmBill, issue({ status: "OPEN" })), false);
  });

  test("excludes verified/closed issues", () => {
    assert.equal(belongsToAssemblyAcknowledgeSection(assemblyZhong, issue({ status: "CLOSED" })), false);
  });

  test("excludes issues assembly cannot act on (not owned, not assembly group, not fitting type)", () => {
    const foreign = issue({ ownerGroupCode: "technical", issueType: "MOLD_DESIGN_ISSUE", ownerUserId: "gong" });
    assert.equal(belongsToAssemblyAcknowledgeSection(assemblyZhong, foreign), false);
  });

  test("includes an issue owned by the assembly user even if group/type differ", () => {
    const mine = issue({ ownerGroupCode: "technical", issueType: "MOLD_DESIGN_ISSUE", ownerUserId: "zhong" });
    assert.equal(belongsToAssemblyAcknowledgeSection(assemblyZhong, mine), true);
  });
});

describe("assembly relevance", () => {
  test("relevant when assigned to me, owned by assembly group, or a fitting issue", () => {
    assert.equal(
      isAssemblyActionableIssue(assemblyZhong, issue({ ownerUserId: "zhong", ownerGroupCode: "qc", issueType: "OTHER" })),
      true
    );
    assert.equal(
      isAssemblyActionableIssue(assemblyZhong, issue({ ownerGroupCode: "assembly", issueType: "OTHER", ownerUserId: null })),
      true
    );
    assert.equal(
      isAssemblyActionableIssue(assemblyZhong, issue({ ownerGroupCode: "qc", issueType: "ASSEMBLY_FITTING_ISSUE", ownerUserId: null })),
      true
    );
  });

  test("not relevant when none of the criteria match", () => {
    assert.equal(
      isAssemblyActionableIssue(assemblyZhong, issue({ ownerGroupCode: "qc", issueType: "MOLD_DESIGN_ISSUE", ownerUserId: "gong" })),
      false
    );
  });
});

describe("assembly self-check section", () => {
  test("includes acknowledged-but-not-self-checked issues", () => {
    assert.equal(
      belongsToAssemblySelfCheckSection(
        assemblyZhong,
        issue({ assemblyAcknowledgedAt: new Date("2026-07-02T00:00:00.000Z") })
      ),
      true
    );
  });

  test("excludes issues not yet acknowledged", () => {
    assert.equal(belongsToAssemblySelfCheckSection(assemblyZhong, issue({ assemblyAcknowledgedAt: null })), false);
  });

  test("excludes issues already self-checked", () => {
    assert.equal(
      belongsToAssemblySelfCheckSection(
        assemblyZhong,
        issue({
          assemblyAcknowledgedAt: new Date("2026-07-02T00:00:00.000Z"),
          assemblySelfCheckedAt: new Date("2026-07-03T00:00:00.000Z")
        })
      ),
      false
    );
  });
});

describe("pm confirm-ready section", () => {
  test("includes self-checked-but-unconfirmed issues for PMs", () => {
    assert.equal(
      belongsToPmConfirmReadySection(
        pmBill,
        issue({ assemblySelfCheckedAt: new Date("2026-07-03T00:00:00.000Z") })
      ),
      true
    );
  });

  test("excludes issues not yet self-checked", () => {
    assert.equal(belongsToPmConfirmReadySection(pmBill, issue({ assemblySelfCheckedAt: null })), false);
  });

  test("excludes issues already confirmed ready", () => {
    assert.equal(
      belongsToPmConfirmReadySection(
        pmBill,
        issue({
          assemblySelfCheckedAt: new Date("2026-07-03T00:00:00.000Z"),
          pmReadyConfirmedAt: new Date("2026-07-04T00:00:00.000Z")
        })
      ),
      false
    );
  });

  test("excludes non-PM viewers", () => {
    assert.equal(
      belongsToPmConfirmReadySection(
        assemblyZhong,
        issue({ assemblySelfCheckedAt: new Date("2026-07-03T00:00:00.000Z") })
      ),
      false
    );
  });
});

describe("coming-up section", () => {
  test("includes planned trials within the next 7 days on my project", () => {
    assert.equal(
      belongsToComingUpSection(pmBill, trial({ plannedDate: new Date("2026-07-06T00:00:00.000Z") }), NOW),
      true
    );
  });

  test("includes a trial planned for today", () => {
    assert.equal(
      belongsToComingUpSection(pmBill, trial({ plannedDate: new Date("2026-07-04T00:00:00.000Z") }), NOW),
      true
    );
  });

  test("excludes trials beyond the 7-day window", () => {
    assert.equal(
      belongsToComingUpSection(pmBill, trial({ plannedDate: new Date("2026-07-12T00:00:00.000Z") }), NOW),
      false
    );
  });

  test("excludes past-dated trials", () => {
    assert.equal(
      belongsToComingUpSection(pmBill, trial({ plannedDate: new Date("2026-07-01T00:00:00.000Z") }), NOW),
      false
    );
  });

  test("excludes auto-missed and completed statuses", () => {
    assert.equal(
      belongsToComingUpSection(pmBill, trial({ status: "AUTO_MISSED_REASON_REQUIRED" }), NOW),
      false
    );
    assert.equal(belongsToComingUpSection(pmBill, trial({ status: "COMPLETED" }), NOW), false);
  });

  test("excludes trials on projects where I'm not PM", () => {
    assert.equal(
      belongsToComingUpSection({ userId: "cheng", roleCode: "PM" }, trial(), NOW),
      false
    );
  });
});

describe("qc reports-to-upload section", () => {
  test("includes a QC user's trial completed today", () => {
    assert.equal(
      belongsToQcReportsToUploadSection(qcGong, trial({ status: "COMPLETED", actualDate: NOW }), NOW),
      true
    );
  });

  test("includes a trial completed 13 days ago (inside the 14-day window)", () => {
    assert.equal(
      belongsToQcReportsToUploadSection(
        qcGong,
        trial({ status: "COMPLETED", actualDate: new Date("2026-06-21T00:00:00.000Z") }),
        NOW
      ),
      true
    );
  });

  test("includes pending-follow-up trials", () => {
    assert.equal(
      belongsToQcReportsToUploadSection(
        qcGong,
        trial({ status: "PENDING_FOLLOW_UP", actualDate: new Date("2026-07-02T00:00:00.000Z") }),
        NOW
      ),
      true
    );
  });

  test("excludes trials completed more than 14 days ago", () => {
    assert.equal(
      belongsToQcReportsToUploadSection(
        qcGong,
        trial({ status: "COMPLETED", actualDate: new Date("2026-06-15T00:00:00.000Z") }),
        NOW
      ),
      false
    );
  });

  test("excludes trials with no actual date", () => {
    assert.equal(
      belongsToQcReportsToUploadSection(qcGong, trial({ status: "COMPLETED", actualDate: null }), NOW),
      false
    );
  });

  test("excludes non-eligible statuses", () => {
    assert.equal(
      belongsToQcReportsToUploadSection(qcGong, trial({ status: "PLANNED", actualDate: NOW }), NOW),
      false
    );
  });

  test("excludes non-QC roles", () => {
    assert.equal(
      belongsToQcReportsToUploadSection(pmBill, trial({ status: "COMPLETED", actualDate: NOW }), NOW),
      false
    );
    assert.equal(
      belongsToQcReportsToUploadSection(marketingYvonne, trial({ status: "COMPLETED", actualDate: NOW }), NOW),
      false
    );
  });

  test("the plate's eligible statuses match the measurement-report domain set", () => {
    for (const status of measurementReportEligibleStatuses) {
      assert.equal(
        belongsToQcReportsToUploadSection(qcGong, trial({ status, actualDate: NOW }), NOW),
        true,
        status
      );
    }
  });
});

describe("overdue detection", () => {
  test("flags dates before today", () => {
    assert.equal(isOverdue(new Date("2026-07-03T00:00:00.000Z"), NOW), true);
  });

  test("does not flag today or future", () => {
    assert.equal(isOverdue(new Date("2026-07-04T00:00:00.000Z"), NOW), false);
    assert.equal(isOverdue(new Date("2026-07-05T00:00:00.000Z"), NOW), false);
  });

  test("null is never overdue", () => {
    assert.equal(isOverdue(null, NOW), false);
  });
});

describe("comparePlateItemsByDate ordering", () => {
  test("sorts earlier (overdue) dates before later ones", () => {
    assert.equal(comparePlateItemsByDate({ date: "2026-07-01" }, { date: "2026-07-06" }), -1);
    assert.equal(comparePlateItemsByDate({ date: "2026-07-06" }, { date: "2026-07-01" }), 1);
  });

  test("equal dates compare as 0 (stable, keeps input order)", () => {
    assert.equal(comparePlateItemsByDate({ date: "2026-07-04" }, { date: "2026-07-04" }), 0);
  });

  test("null dates sort last", () => {
    assert.equal(comparePlateItemsByDate({ date: null }, { date: "2026-07-04" }), 1);
    assert.equal(comparePlateItemsByDate({ date: "2026-07-04" }, { date: null }), -1);
  });

  test("two null dates compare as 0", () => {
    assert.equal(comparePlateItemsByDate({ date: null }, { date: null }), 0);
  });

  test("Array.prototype.sort produces recent-to-future order with nulls last and stable ties", () => {
    const rows = [
      { id: "future", date: "2026-07-20" },
      { id: "no-date-a", date: null },
      { id: "overdue", date: "2026-06-01" },
      { id: "today-a", date: "2026-07-04" },
      { id: "no-date-b", date: null },
      { id: "today-b", date: "2026-07-04" }
    ];

    const ordered = [...rows].sort(comparePlateItemsByDate).map((row) => row.id);

    assert.deepEqual(ordered, ["overdue", "today-a", "today-b", "future", "no-date-a", "no-date-b"]);
  });
});
