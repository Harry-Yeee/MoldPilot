import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import {
  validateCompletedTrialFinalization,
  validateFirstPlannedTrialSchedule,
  validateMissedTrialEvent,
  validateMoldTrialProjectCreate,
  validateMoldTrialProjectIntakeCreate,
  validateNewPlannedTrial,
  validateTrialIssueCreate,
  validateTrialIssueClosure,
  validateTrialIssueLifecycleUpdate
} from "../../src/domain/mold-trial/validation.ts";
import type { TrialEvent } from "../../src/domain/mold-trial/types.ts";

describe("workflow validation domain rules", () => {
  test("Record Result and simple Add Trial Issue forms expose only the simplified Phase 1 fields", () => {
    const detailPageSource = readFileSync(new URL("../../src/app/projects/[projectCode]/page.tsx", import.meta.url), "utf8");
    const recordResultSource = detailPageSource.slice(
      detailPageSource.indexOf("function RecordTrialResultForm"),
      detailPageSource.indexOf("function AutoMissedResolutionForms")
    );
    const addIssueSource = detailPageSource.slice(
      detailPageSource.indexOf("function TrialIssuePanelForm"),
      detailPageSource.indexOf("function verificationStatusForIssue")
    );
    const issueActionsSource = readFileSync(
      new URL("../../src/app/projects/[projectCode]/trial-issue-row-actions.tsx", import.meta.url),
      "utf8"
    );

    for (const fieldName of ["actualDate", "result", "injectionMachineId", "sampleQuantity", "mainIssuesSummary", "outcomeNote"]) {
      assert.match(recordResultSource, new RegExp(`name="${fieldName}"`));
    }

    for (const removedField of [
      "outcomeDisposition",
      "followUpOwnerUsername",
      "followUpDueDate",
      "Legacy machine note",
      "name=\"machine\"",
      "name=\"material\""
    ]) {
      assert.doesNotMatch(recordResultSource, new RegExp(removedField));
    }

    for (const fieldName of ["title", "affectedPartId", "issueType", "source", "severity", "status", "dueDate", "description"]) {
      assert.match(addIssueSource, new RegExp(`name="${fieldName}"`));
    }

    // R1 (blame-free intake): title is the only required decision. The person
    // picker is removed entirely and the due date is no longer required; the
    // secondary fields collapse into the "More details" <details> block.
    assert.match(addIssueSource, /name="title"[\s\S]*required/);
    assert.match(addIssueSource, /issueMoreDetails/);
    assert.doesNotMatch(addIssueSource, /name="ownerUsername"/);
    assert.doesNotMatch(addIssueSource, /name="dueDate"[^>]*required/);

    for (const removedField of [
      "name=\"affectedScope\"",
      "name=\"affectedCavityNote\"",
      "name=\"sourceDetail\"",
      "name=\"ownerGroupCode\"",
      "rootCause",
      "correctiveAction",
      "verificationMethod",
      "verificationResult",
      "assemblyAcknowledgedAt",
      "assemblySelfCheckedAt",
      "pmReadyConfirmedAt",
      "closedAt"
    ]) {
      assert.doesNotMatch(addIssueSource, new RegExp(removedField));
    }

    assert.match(addIssueSource, /widePanelForm/);
    assert.doesNotMatch(detailPageSource, /Update Issue/);
    assert.doesNotMatch(detailPageSource, /issueEditorList/);
    assert.match(detailPageSource, /trialIssuePanelTable/);
    assert.match(detailPageSource, /common\.actions/);
    assert.match(detailPageSource, /canEdit=\{canEditSimpleIssue\(issue\)\}/);
    assert.match(detailPageSource, /canClose=\{canCloseSimpleIssue\(issue\)\}/);
    assert.match(issueActionsSource, /common\.edit/);
    assert.match(issueActionsSource, /common\.closeIssue/);

    for (const fieldName of ["title", "affectedPartId", "issueType", "source", "severity", "status", "ownerUsername", "dueDate", "description"]) {
      assert.match(issueActionsSource, new RegExp(`name="${fieldName}"`));
    }

    for (const removedField of [
      "sourceDetail",
      "ownerGroupCode",
      "rootCause",
      "correctiveAction",
      "verificationMethod",
      "verificationResult",
      "assemblyAcknowledgedAt",
      "assemblySelfCheckedAt",
      "pmReadyConfirmedAt"
    ]) {
      assert.doesNotMatch(issueActionsSource, new RegExp(removedField));
    }
  });

  test("closed issue rows lock actions for non-GM and expose audited GM override", () => {
    const detailPageSource = readFileSync(new URL("../../src/app/projects/[projectCode]/page.tsx", import.meta.url), "utf8");
    const issueActionsSource = readFileSync(
      new URL("../../src/app/projects/[projectCode]/trial-issue-row-actions.tsx", import.meta.url),
      "utf8"
    );
    const actionSource = readFileSync(new URL("../../src/server/mold-trial-actions.ts", import.meta.url), "utf8");

    assert.match(detailPageSource, /issue\.status === "CLOSED"[\s\S]*currentUser\.roleCode === "GM"/);
    assert.match(issueActionsSource, /disabled=\{issueIsClosed \|\| !canClose\}/);
    assert.match(issueActionsSource, /\{issueIsClosed \? t\("common\.closed"\) : t\("common\.closeIssue"\)\}/);
    assert.match(issueActionsSource, /issue\.closedOverride/);
    assert.match(actionSource, /input\.issue\.status === "CLOSED"[\s\S]*input\.actor\.roleCode === "GM"/);
    assert.match(actionSource, /Only GM can edit closed trial issues/);
    assert.match(actionSource, /gm_edited_closed_trial_issue/);
  });

  test("trial issue rows keep visible status text and add status-based scan coloring", () => {
    const detailPageSource = readFileSync(new URL("../../src/app/projects/[projectCode]/page.tsx", import.meta.url), "utf8");
    const globalStylesSource = readFileSync(new URL("../../src/app/globals.css", import.meta.url), "utf8");

    assert.match(detailPageSource, /function trialIssueRowStatusClass/);
    assert.match(detailPageSource, /status === "OPEN"[\s\S]*status === "WAITING_VERIFICATION"[\s\S]*trialIssueRowWarning/);
    assert.match(detailPageSource, /status === "CLOSED"[\s\S]*trialIssueRowClosed/);
    assert.match(detailPageSource, /data-issue-status=\{issue\.status\}/);
    assert.match(detailPageSource, /issueStatusChip/);
    assert.match(detailPageSource, /labelForTranslated\(dictionary, "issueStatus", issueStatusLabels, issue\.status\)/);
    assert.match(globalStylesSource, /\.trialIssueRowWarning/);
    assert.match(globalStylesSource, /\.trialIssueRowClosed/);
    assert.match(globalStylesSource, /\.issueStatusChip/);
  });

  test("Add Next Planned Trial design-change fields are conditional and default to no source", () => {
    const formSource = readFileSync(
      new URL("../../src/app/projects/[projectCode]/add-planned-trial-form.tsx", import.meta.url),
      "utf8"
    );
    const actionSource = readFileSync(new URL("../../src/server/mold-trial-actions.ts", import.meta.url), "utf8");

    assert.match(formSource, /defaultValue="NONE"/);
    assert.match(formSource, /\{isDesignChangeReason \?/);
    assert.match(formSource, /name="designChangeRequestedBy"/);
    assert.match(formSource, /name="designChangeDate"/);
    assert.match(formSource, /name="designChangeTitle"/);
    assert.doesNotMatch(formSource, /name="planReasonDetail"[\s\S]{0,80}required/);
    assert.match(actionSource, /isDesignChangeRelatedReason\(planReasonCategory\)/);
    assert.match(actionSource, /designChangeRequestedByRaw !== noDesignChangeRequesterValue/);
  });

  test("AT-002 rejects mold trial project creation without required identity and first planned date", () => {
    const result = validateMoldTrialProjectCreate({});

    assert.equal(result.ok, false);
    assert.deepEqual(
      result.issues.map((issue) => issue.field),
      ["customerCode", "partCode", "moldCode", "planningPmId", "firstPlannedTrialDate"]
    );
  });

  test("allows Marketing/Sales to create a project intake shell without client ref or T0 date", () => {
    const result = validateMoldTrialProjectIntakeCreate({
      customerCode: "C-101",
      partCode: "P-101",
      moldCode: "M-101",
      actorRole: "MARKETING"
    });

    assert.equal(result.ok, true);
  });

  test("allows Intake/Draft to be created without mold code", () => {
    const result = validateMoldTrialProjectIntakeCreate({
      customerCode: "C-101",
      partCode: "P-101",
      actorRole: "MARKETING"
    });

    assert.equal(result.ok, true);
  });

  test("blocks Marketing/Sales from setting the first T0 date", () => {
    const createResult = validateMoldTrialProjectCreate({
      projectCode: "MP-INTAKE-101",
      customerCode: "C-101",
      partCode: "P-101",
      moldCode: "M-101",
      planningPmId: "pm-1",
      firstPlannedTrialDate: "2026-08-01",
      actorRole: "MARKETING"
    });

    assert.equal(createResult.ok, false);
    assert.equal(createResult.issues.at(-1)?.field, "actorRole");

    const scheduleResult = validateFirstPlannedTrialSchedule({
      actorRole: "MARKETING",
      moldCode: "M-101",
      plannedDate: "2026-08-01",
      projectStatus: "Intake"
    });

    assert.equal(scheduleResult.ok, false);
    assert.equal(scheduleResult.issues[0]?.field, "actorRole");
  });

  test("allows Planning PM to schedule first T0 from intake", () => {
    const result = validateFirstPlannedTrialSchedule({
      actorRole: "PM",
      moldCode: "M-101",
      plannedDate: "2026-08-01",
      projectStatus: "Intake",
      planningPmId: "pm-1"
    });

    assert.equal(result.ok, true);
  });

  test("blocks first T0 scheduling when mold code is blank", () => {
    const result = validateFirstPlannedTrialSchedule({
      actorRole: "PM",
      moldCode: "",
      plannedDate: "2026-08-01",
      projectStatus: "Intake",
      planningPmId: "pm-1"
    });

    assert.equal(result.ok, false);
    assert.equal(result.issues[0]?.field, "moldCode");
  });

  test("AT-008 rejects trial issue creation without the required issue fields", () => {
    const result = validateTrialIssueCreate({});

    assert.equal(result.ok, false);
    // R1: owner and due date are no longer required — the server routes to a
    // department inbox and applies a default due window.
    assert.deepEqual(
      result.issues.map((issue) => issue.field),
      ["title", "issueType", "source", "severity", "status"]
    );
  });

  test("R1 accepts trial issue creation without a named owner or due date (blame-free intake)", () => {
    const withoutOwnerOrDueDate = validateTrialIssueCreate({
      title: "Flash at gate",
      issueType: "Mold Design Issue",
      source: "Internal Trial",
      severity: "Medium",
      status: "Open"
    });
    const withOwnerAndDueDate = validateTrialIssueCreate({
      title: "Flash at gate",
      issueType: "Mold Design Issue",
      source: "Internal Trial",
      severity: "Medium",
      status: "Open",
      ownerUserId: "pm-1",
      dueDate: "2026-03-08"
    });

    assert.equal(withoutOwnerOrDueDate.ok, true);
    assert.equal(withOwnerAndDueDate.ok, true);
  });

  test("AT-008A allows Marketing/Sales to create client-feedback issue", () => {
    const result = validateTrialIssueCreate({
      title: "Client feedback: surface mark",
      issueType: "Bad Customer Feedback",
      source: "Marketing Client Feedback",
      severity: "Medium",
      status: "Open",
      ownerUserId: "marketing-1",
      dueDate: "2026-03-08",
      actorRole: "MARKETING"
    });

    assert.equal(result.ok, true);
  });

  test("AT-008B blocks Marketing/Sales from creating internal technical issue source", () => {
    const result = validateTrialIssueCreate({
      title: "Internal process issue",
      issueType: "Injection Process Issue",
      source: "Injection Process",
      severity: "Medium",
      status: "Open",
      ownerUserId: "marketing-1",
      dueDate: "2026-03-08",
      actorRole: "MARKETING"
    });

    assert.equal(result.ok, false);
    assert.deepEqual(result.issues.map((issue) => issue.field), ["source", "issueType"]);
  });

  test("rejects TrialIssue creation as Closed without simple closure fields", () => {
    const result = validateTrialIssueCreate({
      title: "Issue created already closed",
      issueType: "Mold Design Issue",
      source: "Internal Trial",
      severity: "Medium",
      status: "Closed",
      ownerUserId: "pm-1",
      dueDate: "2026-03-08",
      actorRole: "PM"
    });

    assert.equal(result.ok, false);
    assert.deepEqual(
      result.issues.map((issue) => issue.field),
      ["fixSummary", "fixTimeMinutes", "closedAt", "closedById", "nonOwnerCloseReason"]
    );
  });

  test("AT-009 prevents TrialIssue closure without fix summary, fix time, and closed date", () => {
    const result = validateTrialIssueClosure({
      status: "Closed",
      actorRole: "PM",
      ownerUserId: "assy-1",
      closedById: "pm-1",
      nonOwnerCloseReason: "PM oversight after correction review."
    });

    assert.equal(result.ok, false);
    assert.deepEqual(
      result.issues.map((issue) => issue.field),
      ["fixSummary", "fixTimeMinutes", "closedAt"]
    );
  });

  test("allows issue owner to close own issue with simple closure fields", () => {
    const result = validateTrialIssueClosure({
      status: "Closed",
      issueType: "Assembly / Fitting Issue",
      fixSummary: "Polished shutoff and rechecked fit.",
      fixTimeMinutes: 95,
      closedAt: "2026-03-18T08:00:00.000Z",
      closedById: "assy-1",
      ownerUserId: "assy-1",
      actorRole: "ASSEMBLY"
    });

    assert.equal(result.ok, true);
  });

  test("PM and GM closing another user's issue requires a non-owner reason", () => {
    const missingReason = validateTrialIssueClosure({
      status: "Closed",
      fixSummary: "Venting correction verified during follow-up.",
      fixTimeMinutes: 60,
      closedAt: "2026-04-02",
      closedById: "pm-1",
      ownerUserId: "assy-1",
      actorRole: "PM"
    });

    assert.equal(missingReason.ok, false);
    assert.equal(missingReason.issues.at(-1)?.field, "nonOwnerCloseReason");

    const gmResult = validateTrialIssueClosure({
      status: "Closed",
      fixSummary: "Reviewed completed correction with PM.",
      fixTimeMinutes: 30,
      closedAt: "2026-04-02",
      closedById: "gm-1",
      ownerUserId: "assy-1",
      nonOwnerCloseReason: "GM close after PM escalation.",
      actorRole: "GM"
    });

    assert.equal(gmResult.ok, true);
  });

  test("closure no longer requires root cause, corrective action, or verification", () => {
    const result = validateTrialIssueLifecycleUpdate({
      status: "Closed",
      issueType: "Mold Design Issue",
      fixSummary: "Re-cut gate insert and confirmed sample fit.",
      fixTimeMinutes: 120,
      closedAt: "2026-04-02",
      closedById: "pm-1",
      ownerUserId: "assy-1",
      nonOwnerCloseReason: "PM verified the owner completed the correction.",
      actorRole: "PM",
      changedFields: ["status", "closedAt", "closedById", "fixSummary", "fixTimeMinutes", "nonOwnerCloseReason"]
    });

    assert.equal(result.ok, true);
  });

  test("blocks Marketing/Sales and Viewer from issue lifecycle edits", () => {
    const marketingResult = validateTrialIssueLifecycleUpdate({
      status: "In Progress",
      issueType: "Bad Customer Feedback",
      rootCause: "Texture mismatch.",
      actorRole: "MARKETING",
      changedFields: ["rootCause"]
    });

    assert.equal(marketingResult.ok, false);
    assert.equal(marketingResult.issues[0]?.field, "actorRole");

    const viewerResult = validateTrialIssueLifecycleUpdate({
      status: "Waiting Verification",
      actorRole: "VIEWER",
      changedFields: ["status"]
    });

    assert.equal(viewerResult.ok, false);
    assert.equal(viewerResult.issues[0]?.field, "actorRole");
  });

  test("allows Assembly to acknowledge correction only in its lane", () => {
    const allowed = validateTrialIssueLifecycleUpdate({
      status: "In Progress",
      issueType: "Assembly / Fitting Issue",
      assemblyAcknowledgedAt: "2026-07-02",
      assemblyEstimatedFinishDate: "2026-07-08",
      assemblyAcknowledgedById: "assy-1",
      actorRole: "ASSEMBLY",
      changedFields: ["assemblyAcknowledgedAt", "assemblyEstimatedFinishDate", "assemblyAcknowledgedById"]
    });

    assert.equal(allowed.ok, true);

    const blocked = validateTrialIssueLifecycleUpdate({
      status: "In Progress",
      issueType: "Assembly / Fitting Issue",
      correctiveAction: "Polish shutoff.",
      actorRole: "ASSEMBLY",
      changedFields: ["correctiveAction"]
    });

    assert.equal(blocked.ok, false);
    assert.equal(blocked.issues[0]?.field, "correctiveAction");
  });

  test("allows Technical PM root-cause edits and QC verification edits in their lanes", () => {
    const technicalResult = validateTrialIssueLifecycleUpdate({
      status: "In Progress",
      issueType: "Mold Design Issue",
      rootCause: "Venting insufficient near rib.",
      correctiveAction: "Add venting and polish.",
      actorRole: "PM",
      changedFields: ["rootCause", "correctiveAction", "status"]
    });

    assert.equal(technicalResult.ok, true);

    const qcResult = validateTrialIssueLifecycleUpdate({
      status: "Verified",
      issueType: "QC / Dimension Issue",
      verificationResult: "Inspection report passed.",
      actorRole: "QC",
      changedFields: ["verificationResult", "status"]
    });

    assert.equal(qcResult.ok, true);
  });

  test("AT-006A allows actual trial finalization with result only", () => {
    const result = validateCompletedTrialFinalization({
      trialCode: "T0",
      plannedDate: "2026-03-01",
      actualDate: "2026-03-01",
      status: "Completed",
      result: "Approved"
    });

    assert.equal(result.ok, true);
  });

  test("rejects non-approved, pending, or invalid trial result without an issue linked to the same trial", () => {
    for (const trialResult of [
      "Conditional",
      "Not Approved / Rework Required",
      "Pending QC",
      "Pending Customer Feedback",
      "Invalid Trial"
    ] as const) {
      const result = validateCompletedTrialFinalization({
        trialCode: "T0",
        plannedDate: "2026-03-01",
        actualDate: "2026-03-01",
        status: "Completed",
        result: trialResult
      });

      assert.equal(result.ok, false);
      assert.equal(result.issues[0]?.field, "result");
      assert.equal(result.issues[0]?.message, "Add at least one issue under this trial before saving a non-approved result.");
    }
  });

  test("allows non-approved trial finalization when an issue exists under the same trial", () => {
    const result = validateCompletedTrialFinalization(
      {
        trialCode: "T0",
        plannedDate: "2026-03-01",
        actualDate: "2026-03-01",
        status: "Completed",
        result: "Not Approved / Rework Required"
      },
      { linkedIssueCount: 1 }
    );

    assert.equal(result.ok, true);
  });

  test("does not allow unrelated project issues, outcome notes, or new-trial reasons to satisfy non-approved result", () => {
    const unrelatedIssue = validateCompletedTrialFinalization(
      {
        trialCode: "T0",
        plannedDate: "2026-03-01",
        actualDate: "2026-03-01",
        status: "Completed",
        result: "Not Approved / Rework Required"
      },
      { linkedIssueCount: 0, otherTrialIssueCount: 1 }
    );
    const withOutcomeNote = validateCompletedTrialFinalization({
      trialCode: "T0",
      plannedDate: "2026-03-01",
      actualDate: "2026-03-01",
      status: "Completed",
      result: "Invalid Trial",
      outcomeNote: "Machine alarm invalidated samples; issue will be logged after PM review."
    });
    const withNewTrialReason = validateCompletedTrialFinalization({
      trialCode: "T0",
      plannedDate: "2026-03-01",
      actualDate: "2026-03-01",
      status: "Completed",
      result: "Pending QC",
      nextPlannedTrialDate: "2026-03-08",
      planReasonCategory: "QC Failure"
    });

    assert.equal(unrelatedIssue.ok, false);
    assert.equal(withOutcomeNote.ok, false);
    assert.equal(withNewTrialReason.ok, false);
  });

  test("AT-015B rejects new planned trial without date or reason category", () => {
    const trial: TrialEvent = {
      trialCode: "T1",
      status: "Planned",
      requestedById: "pm-1",
      sourceArea: "Planning"
    };

    const result = validateNewPlannedTrial(trial);

    assert.equal(result.ok, false);
    assert.deepEqual(
      result.issues.map((issue) => issue.field),
      ["plannedDate", "planReasonCategory"]
    );
  });

  test("requires requester and source area on planned trials after the initial plan", () => {
    const result = validateNewPlannedTrial({
      trialCode: "T1",
      plannedDate: "2026-03-20",
      status: "Planned",
      planReasonCategory: "Internal Rework",
      planReasonDetail: "Texture correction needs verification."
    });

    assert.equal(result.ok, false);
    assert.deepEqual(result.issues.map((issue) => issue.field), ["requestedById", "sourceArea"]);
  });

  test("allows non-design-change planned trial with blank reason detail", () => {
    const result = validateNewPlannedTrial(
      {
        trialCode: "T1",
        plannedDate: "2026-03-20",
        status: "Planned",
        planReasonCategory: "Internal Rework",
        requestedById: "pm-1",
        sourceArea: "Technical"
      },
      { actorRole: "PM" }
    );

    assert.equal(result.ok, true);
  });

  test("AT-015D blocks Marketing/Sales from scheduling new planned trials", () => {
    const result = validateNewPlannedTrial(
      {
        trialCode: "T1",
        plannedDate: "2026-03-20",
        status: "Planned",
        planReasonCategory: "Customer Design Change",
        planReasonDetail: "Customer feedback requires another run.",
        requestedById: "sales-1",
        sourceArea: "Marketing"
      },
      { actorRole: "MARKETING" }
    );

    assert.equal(result.ok, false);
    assert.equal(result.issues[0]?.field, "actorRole");
  });

  test("missed trial requires reason fields and new planned date unless blocked or paused", () => {
    const activeResult = validateMissedTrialEvent(
      {
        plannedDate: "2026-03-20"
      },
      "Active"
    );

    assert.equal(activeResult.ok, false);
    assert.deepEqual(
      activeResult.issues.map((issue) => issue.field),
      ["newPlannedDate", "reasonCategory", "responsibleArea", "explanation"]
    );

    const blockedResult = validateMissedTrialEvent(
      {
        plannedDate: "2026-03-20",
        reasonCategory: "Internal Decision Pending",
        responsibleArea: "Planning",
        explanation: "Waiting on PM decision before replanning."
      },
      "Blocked"
    );

    assert.equal(blockedResult.ok, true);

    const milestoneResult = validateMissedTrialEvent(
      {
        plannedDate: "2026-03-20",
        reasonCategory: "Internal Decision Pending",
        responsibleArea: "Planning",
        explanation: "Waiting on PM decision before replanning."
      },
      "Blocked",
      { requireNewPlannedDate: true }
    );

    assert.equal(milestoneResult.ok, false);
    assert.deepEqual(milestoneResult.issues.map((issue) => issue.field), ["newPlannedDate"]);
  });
});
