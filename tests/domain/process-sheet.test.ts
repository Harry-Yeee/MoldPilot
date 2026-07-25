import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import {
  buildCustomerSafeProcessSheetExport,
  compareInjectionMachineNo,
  copyPreviousTrialProcessSheetValues,
  defaultProcessSheetParameters,
  injectionMachineMatchesQuery,
  isNumericInjectionMachineNo,
  isProcessSheetSummaryParameter,
  isProcessSheetColumnEditable,
  nextProcessSheetInputIndex,
  normalizeInjectionMachineNo,
  PROCESS_SHEET_SUMMARY_PARAMETER_KEYS,
  snapshotInjectionMachine
} from "../../src/domain/mold-trial/process-sheet.ts";
import { validateTrialIssueClosure } from "../../src/domain/mold-trial/validation.ts";

describe("Digital process sheet domain helpers", () => {
  test("Injection Machine search matches numeric No., brand, and clamping force", () => {
    const machine = {
      machineNo: "10",
      displayName: "Legacy Generated Label",
      brand: "Lianchuang",
      model: "LC-408",
      tonnage: 408
    };

    assert.equal(injectionMachineMatchesQuery(machine, "10"), true);
    assert.equal(injectionMachineMatchesQuery(machine, "408"), true);
    assert.equal(injectionMachineMatchesQuery(machine, "408t"), true);
    assert.equal(injectionMachineMatchesQuery(machine, "lian"), true);
    assert.equal(injectionMachineMatchesQuery(machine, "legacy"), false);
    assert.equal(injectionMachineMatchesQuery(machine, "LC-408"), false);
    assert.equal(injectionMachineMatchesQuery(machine, "missing"), false);
  });

  test("Injection Machine No. is numeric-only and sorts numerically", () => {
    assert.equal(normalizeInjectionMachineNo(" 10 "), "10");
    assert.equal(isNumericInjectionMachineNo("10"), true);
    assert.equal(isNumericInjectionMachineNo("12#"), false);
    assert.equal(isNumericInjectionMachineNo("MACHINE-01"), false);
    assert.equal(isNumericInjectionMachineNo("ABC"), false);

    const machines = [{ machineNo: "10" }, { machineNo: "2" }, { machineNo: "1" }];

    assert.deepEqual(machines.sort(compareInjectionMachineNo).map((machine) => machine.machineNo), ["1", "2", "10"]);
  });

  test("selected Injection Machine snapshots preserve No. and clamping force", () => {
    assert.deepEqual(
      snapshotInjectionMachine({
        machineNo: "10",
        brand: "Lianchuang",
        tonnage: 408
      }),
      {
        machineNoSnapshot: "10",
        machineTonnageSnapshot: "408T",
        machineDisplayText: "No. 10 / 408T / Lianchuang"
      }
    );
  });

  test("pilot preflight selects machine active state before filtering imports", () => {
    const preflightSource = readFileSync(new URL("../../scripts/pilot-preflight.mjs", import.meta.url), "utf8");

    assert.match(preflightSource, /shotCapacityG: true,\s*active: true/);
    assert.match(preflightSource, /importedMachines\.filter\(\(machine\) => machine\.active\)/);
  });

  test("Admin Machines UI and server action enforce numeric-only No.", () => {
    const adminPageSource = readFileSync(new URL("../../src/app/admin/page.tsx", import.meta.url), "utf8");
    const adminActionsSource = readFileSync(new URL("../../src/server/admin-actions.ts", import.meta.url), "utf8");

    assert.match(adminPageSource, /name="machineNo"[^>]+pattern="\[0-9\]\+"/);
    assert.match(adminActionsSource, /!isNumericInjectionMachineNo\(machineNo\)/);
    assert.match(adminActionsSource, /Machine No\. must be numeric only\./);
  });

  test("project creation snapshots a process-sheet template for new projects", () => {
    const actionsSource = readFileSync(new URL("../../src/server/mold-trial-actions.ts", import.meta.url), "utf8");

    assert.match(actionsSource, /processSheetTemplateSnapshotForCustomer\(selectedCustomer\)/);
    assert.match(actionsSource, /processSheetTemplateId: processSheetTemplate\?\.id \?\? null/);
    assert.match(actionsSource, /processSheetTemplateCode: processSheetTemplate\?\.code \?\? null/);
  });

  test("machine seed uses the reviewed JSON fixture instead of the unscanned legacy XLS", () => {
    const seedSource = readFileSync(new URL("../../prisma/seed.ts", import.meta.url), "utf8");
    const fixture = JSON.parse(
      readFileSync(
        new URL("../../prisma/fixtures/injection-machines-2026-07-02.json", import.meta.url),
        "utf8"
      )
    ) as Array<{ machineNo: string; clampingForce: number }>;

    assert.match(seedSource, /const machineDefinitions = loadReviewedInjectionMachines\(\)/);
    assert.doesNotMatch(seedSource, /const machineDefinitions = loadWorkbookInjectionMachines\(\)/);
    assert.equal(fixture.length, 26);
    assert.equal(fixture.every((row) => /^\d+$/.test(row.machineNo)), true);
    assert.equal(fixture.find((row) => row.machineNo === "10")?.clampingForce, 408);
  });

  test("default process-sheet templates do not create editable Trial Summary parameters", () => {
    const seedSource = readFileSync(new URL("../../prisma/seed.ts", import.meta.url), "utf8");
    const sections = new Set<string>(defaultProcessSheetParameters.map((parameter) => parameter.section));
    const parameterKeys = new Set<string>(defaultProcessSheetParameters.map((parameter) => parameter.parameterKey));

    assert.equal(sections.has("Trial Summary"), false);

    for (const summaryKey of PROCESS_SHEET_SUMMARY_PARAMETER_KEYS) {
      assert.equal(parameterKeys.has(summaryKey), false);
      assert.equal(isProcessSheetSummaryParameter(summaryKey), true);
    }

    assert.equal(isProcessSheetSummaryParameter("cycle_time"), false);
    assert.match(seedSource, /PROCESS_SHEET_SUMMARY_PARAMETER_KEYS/);
    assert.match(seedSource, /processSheetParameter\.updateMany/);
    assert.match(seedSource, /active: false/);
  });

  test("only the current process-sheet trial column is editable", () => {
    assert.equal(
      isProcessSheetColumnEditable({
        trialEventId: "t0",
        currentEditableTrialEventId: "t1"
      }),
      false
    );
    assert.equal(
      isProcessSheetColumnEditable({
        trialEventId: "t1",
        currentEditableTrialEventId: "t1"
      }),
      true
    );
  });

  test("process-sheet Enter and Shift+Enter navigation stays inside editable fields", () => {
    assert.equal(nextProcessSheetInputIndex({ currentIndex: 0, fieldCount: 4 }), 1);
    assert.equal(nextProcessSheetInputIndex({ currentIndex: 3, fieldCount: 4 }), 3);
    assert.equal(nextProcessSheetInputIndex({ currentIndex: 2, fieldCount: 4, shiftKey: true }), 1);
    assert.equal(nextProcessSheetInputIndex({ currentIndex: 0, fieldCount: 4, shiftKey: true }), 0);
    assert.equal(nextProcessSheetInputIndex({ currentIndex: 0, fieldCount: 0 }), -1);
  });

  test("Copy Previous Trial fills blanks only until overwrite is explicitly confirmed", () => {
    const blankOnly = copyPreviousTrialProcessSheetValues({
      currentMachineId: "",
      previousMachineId: "machine-10",
      currentValues: {
        cycleTime: "",
        holdPressure: "existing",
        summaryNextAction: ""
      },
      previousValues: {
        cycleTime: "42",
        holdPressure: "80",
        summaryNextAction: "Run correction check"
      },
      copyableKeys: ["cycleTime", "holdPressure"]
    });

    assert.equal(blankOnly.machineId, "machine-10");
    assert.equal(blankOnly.values.cycleTime, "42");
    assert.equal(blankOnly.values.holdPressure, "existing");
    assert.equal(blankOnly.values.summaryNextAction, "");
    assert.deepEqual(blankOnly.skippedExistingKeys, ["holdPressure"]);
    assert.equal(blankOnly.changedCount, 2);

    const overwrite = copyPreviousTrialProcessSheetValues({
      currentMachineId: "machine-9",
      previousMachineId: "machine-10",
      currentValues: blankOnly.values,
      previousValues: {
        cycleTime: "42",
        holdPressure: "80",
        summaryNextAction: "Run correction check"
      },
      copyableKeys: ["cycleTime", "holdPressure"],
      overwrite: true
    });

    assert.equal(overwrite.machineId, "machine-10");
    assert.equal(overwrite.values.holdPressure, "80");
    assert.equal(overwrite.values.summaryNextAction, "");
    assert.deepEqual(overwrite.overwrittenKeys, ["injectionMachineId", "holdPressure"]);
  });

  test("process-sheet editor handles save feedback, keyboard navigation, and copy without trial workflow fields", () => {
    const editorSource = readFileSync(
      new URL("../../src/app/projects/[projectCode]/process-sheet-editor.tsx", import.meta.url),
      "utf8"
    );
    const detailPageSource = readFileSync(new URL("../../src/app/projects/[projectCode]/page.tsx", import.meta.url), "utf8");
    const actionSource = readFileSync(new URL("../../src/server/mold-trial-actions.ts", import.meta.url), "utf8");
    const saveCoreSource = actionSource.slice(
      actionSource.indexOf("async function saveTrialProcessSheetValuesCore"),
      actionSource.indexOf("export async function saveTrialProcessSheetValues")
    );
    const saveActionSource = actionSource.slice(
      actionSource.indexOf("export async function saveTrialProcessSheetValues"),
      actionSource.indexOf("export async function exportProcessSheetPdf")
    );

    assert.match(editorSource, /process\.currentEditing/);
    assert.match(editorSource, /common\.unsavedChanges/);
    assert.match(editorSource, /process\.saving/);
    assert.match(editorSource, /process\.copyPreviousTrial/);
    assert.match(editorSource, /common\.confirmOverwrite/);
    assert.match(editorSource, /event\.preventDefault\(\)/);
    assert.match(editorSource, /nextProcessSheetInputIndex/);
    assert.match(editorSource, /window\.history\.replaceState\(null, "", "#process-sheet-heading"\)/);
    assert.match(editorSource, /isProcessSheetSummaryParameter/);
    assert.doesNotMatch(editorSource, /TrialIssue|mainIssuesSummary|nextAction|assemblySelfCheck|pmReady|verificationResult/);
    assert.match(detailPageSource, /isProcessSheetSummaryParameter/);
    assert.doesNotMatch(detailPageSource, /processSummaryWrap/);
    assert.doesNotMatch(detailPageSource, /processIssueGroups/);
    assert.doesNotMatch(detailPageSource, /No trial rows available for process-sheet summary/);
    assert.match(saveActionSource, /export async function saveTrialProcessSheetValues/);
    assert.match(saveCoreSource, /isProcessSheetSummaryParameter/);
    assert.match(actionSource, /await getActor\("trial\.process_sheet\.edit"\)/);
    assert.match(actionSource, /action: "saved_trial_process_sheet"/);
    assert.doesNotMatch(saveCoreSource, /trialEvent\.create/);
  });

  test("customer-safe PDF text omits internal/private issue fields and duplicated manual Trial Summary process rows", () => {
    const exportText = buildCustomerSafeProcessSheetExport({
      projectIdentifier: "M-PILOT-01",
      trialSummaries: ["T0: Not Approved / Rework Required"],
      processRows: [
        {
          label: "Press Tonnage",
          values: ["408"],
          customerVisible: true
        },
        {
          label: "Trial Result",
          values: ["Manual duplicated trial result"],
          customerVisible: true
        },
        {
          label: "Major Issues",
          values: ["Manual duplicated major issue"],
          customerVisible: true
        },
        {
          label: "Correction Summary",
          values: ["Manual duplicated correction"],
          customerVisible: true
        },
        {
          label: "Next Action",
          values: ["Manual duplicated next action"],
          customerVisible: true
        },
        {
          label: "Internal Private Note",
          values: ["Bill owns the internal correction follow-up"],
          customerVisible: true
        }
      ],
      issues: [
        {
          title: "Gate insert correction",
          status: "In Progress",
          correctionSummary: "Correction in progress",
          rootCause: "Unapproved internal root cause",
          rootCauseApproved: false,
          internalOwner: "Technical",
          assemblySelfCheckNote: "Assembly self-check passed"
        }
      ],
      nextStep: "Run T1 after correction readiness."
    });

    assert.match(exportText, /Press Tonnage/);
    assert.match(exportText, /Correction in progress/);
    assert.doesNotMatch(exportText, /Manual duplicated trial result/);
    assert.doesNotMatch(exportText, /Manual duplicated major issue/);
    assert.doesNotMatch(exportText, /Manual duplicated correction/);
    assert.doesNotMatch(exportText, /Manual duplicated next action/);
    assert.doesNotMatch(exportText, /Bill owns/);
    assert.doesNotMatch(exportText, /Unapproved internal root cause/);
    assert.doesNotMatch(exportText, /Assembly self-check passed/);
  });

  test("Assembly self-check does not close an issue or satisfy closure requirements", () => {
    const result = validateTrialIssueClosure({
      status: "Closed",
      issueType: "Assembly / Fitting Issue",
      assemblySelfCheckedAt: "2026-07-02",
      assemblySelfCheckedById: "assy-1",
      assemblySelfCheckNote: "Checked by Assembly",
      closedAt: null,
      closedById: "assy-1",
      ownerUserId: "assy-1",
      actorRole: "ASSEMBLY"
    });

    assert.equal(result.ok, false);
    assert.deepEqual(
      result.issues.map((issue) => issue.field),
      ["fixSummary", "fixTimeMinutes", "closedAt"]
    );
  });
});
