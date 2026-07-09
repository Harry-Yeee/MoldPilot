import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  canUploadMeasurementReport,
  isMeasurementReportAttachment,
  measurementReportFileName,
  measurementReportState,
  newestMeasurementReport,
  type MeasurementReportAttachment
} from "../../src/domain/mold-trial/measurement-report.ts";
import type { TrialStatusDbValue } from "../../src/domain/mold-trial/my-plate.ts";

const TRIAL_ID = "trial-1";

function report(overrides: Partial<MeasurementReportAttachment> = {}): MeasurementReportAttachment {
  return {
    id: "att-1",
    entityType: "TRIAL_EVENT",
    entityId: TRIAL_ID,
    fileType: "QC_REPORT",
    deletedAt: null,
    uploadedAt: new Date("2026-07-01T10:00:00.000Z"),
    uploaderName: "Gong",
    visibility: "CUSTOMER_SAFE",
    ...overrides
  };
}

describe("canUploadMeasurementReport", () => {
  test("allows only completed and pending-follow-up trials", () => {
    assert.equal(canUploadMeasurementReport("COMPLETED"), true);
    assert.equal(canUploadMeasurementReport("PENDING_FOLLOW_UP"), true);
  });

  test("rejects planned, missed, and terminal trials", () => {
    const rejected: TrialStatusDbValue[] = [
      "PLANNED",
      "AT_RISK",
      "AUTO_MISSED_REASON_REQUIRED",
      "DELAYED",
      "ABORTED",
      "CANCELLED",
      "SKIPPED"
    ];
    for (const status of rejected) {
      assert.equal(canUploadMeasurementReport(status), false, status);
    }
  });
});

describe("isMeasurementReportAttachment", () => {
  test("accepts a live QC_REPORT filed against the trial event", () => {
    assert.equal(isMeasurementReportAttachment(report(), TRIAL_ID), true);
  });

  test("rejects a soft-deleted report", () => {
    assert.equal(
      isMeasurementReportAttachment(report({ deletedAt: new Date() }), TRIAL_ID),
      false
    );
  });

  test("rejects a non-QC_REPORT file type", () => {
    assert.equal(isMeasurementReportAttachment(report({ fileType: "TRIAL_PHOTO" }), TRIAL_ID), false);
  });

  test("rejects a QC_REPORT filed against a different entity type", () => {
    assert.equal(isMeasurementReportAttachment(report({ entityType: "TRIAL_ISSUE" }), TRIAL_ID), false);
  });

  test("rejects a report belonging to another trial", () => {
    assert.equal(isMeasurementReportAttachment(report({ entityId: "other" }), TRIAL_ID), false);
  });
});

describe("measurementReportState", () => {
  test("NOT_REQUIRED for a planned trial even if a stray report exists", () => {
    const state = measurementReportState({ status: "PLANNED" }, TRIAL_ID, [report()]);
    assert.equal(state.kind, "NOT_REQUIRED");
  });

  test("MISSING for a completed trial with no matching report", () => {
    const state = measurementReportState({ status: "COMPLETED" }, TRIAL_ID, []);
    assert.equal(state.kind, "MISSING");
  });

  test("MISSING when the only candidate was soft-deleted", () => {
    const state = measurementReportState({ status: "COMPLETED" }, TRIAL_ID, [
      report({ deletedAt: new Date("2026-07-02T00:00:00.000Z") })
    ]);
    assert.equal(state.kind, "MISSING");
  });

  test("UPLOADED carries id, date, uploader, and visibility", () => {
    const state = measurementReportState({ status: "COMPLETED" }, TRIAL_ID, [report()]);
    assert.equal(state.kind, "UPLOADED");
    if (state.kind === "UPLOADED") {
      assert.equal(state.attachmentId, "att-1");
      assert.equal(state.uploadedBy, "Gong");
      assert.equal(state.visibility, "CUSTOMER_SAFE");
      assert.equal(state.uploadedAt.toISOString(), "2026-07-01T10:00:00.000Z");
    }
  });

  test("PENDING_FOLLOW_UP still resolves to UPLOADED", () => {
    const state = measurementReportState({ status: "PENDING_FOLLOW_UP" }, TRIAL_ID, [report()]);
    assert.equal(state.kind, "UPLOADED");
  });

  test("newest wins when several reports exist for the trial", () => {
    const older = report({ id: "old", uploadedAt: new Date("2026-07-01T10:00:00.000Z"), uploaderName: "First" });
    const newer = report({ id: "new", uploadedAt: new Date("2026-07-03T10:00:00.000Z"), uploaderName: "Second" });
    const state = measurementReportState({ status: "COMPLETED" }, TRIAL_ID, [older, newer]);
    assert.equal(state.kind, "UPLOADED");
    if (state.kind === "UPLOADED") {
      assert.equal(state.attachmentId, "new");
      assert.equal(state.uploadedBy, "Second");
    }
  });

  test("equal timestamps break the tie on the later id", () => {
    const at = new Date("2026-07-03T10:00:00.000Z");
    const a = report({ id: "att-a", uploadedAt: at });
    const b = report({ id: "att-b", uploadedAt: at });
    const state = measurementReportState({ status: "COMPLETED" }, TRIAL_ID, [a, b]);
    assert.equal(state.kind, "UPLOADED");
    if (state.kind === "UPLOADED") {
      assert.equal(state.attachmentId, "att-b");
    }
  });
});

describe("newestMeasurementReport", () => {
  test("returns null when nothing matches", () => {
    assert.equal(newestMeasurementReport([report({ entityId: "other" })], TRIAL_ID), null);
  });

  test("ignores deleted and mismatched candidates while picking the newest live one", () => {
    const live = report({ id: "live", uploadedAt: new Date("2026-07-02T00:00:00.000Z") });
    const result = newestMeasurementReport(
      [
        report({ id: "deleted", deletedAt: new Date(), uploadedAt: new Date("2026-07-09T00:00:00.000Z") }),
        report({ id: "wrong-trial", entityId: "other", uploadedAt: new Date("2026-07-10T00:00:00.000Z") }),
        live
      ],
      TRIAL_ID
    );
    assert.equal(result?.id, "live");
  });
});

describe("measurementReportFileName", () => {
  test("composes projectCode_trialCode_measurement-report.ext", () => {
    assert.equal(
      measurementReportFileName({ projectCode: "MP-2026-014", trialCode: "T1", extension: "pdf" }),
      "MP-2026-014_T1_measurement-report.pdf"
    );
  });

  test("sanitizes unsafe characters in the codes", () => {
    assert.equal(
      measurementReportFileName({ projectCode: "MP 2026/014", trialCode: "T 1", extension: "xlsx" }),
      "MP-2026-014_T-1_measurement-report.xlsx"
    );
  });

  test("falls back to placeholders and drops a blank extension", () => {
    assert.equal(
      measurementReportFileName({ projectCode: "", trialCode: "", extension: "" }),
      "project_trial_measurement-report"
    );
  });
});
