import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  DUPLICATE_SUBMISSION_WINDOW_MS,
  isDuplicateAttachmentSubmission,
  isDuplicateIssueSubmission,
  isDuplicateMeasurementReportSubmission,
  isDuplicateMissedTrialSubmission,
  isDuplicateTrialSubmission,
  isWithinDuplicateWindow,
  type ExistingAttachmentSubmission,
  type ExistingIssueSubmission,
  type ExistingMeasurementReportSubmission,
  type ExistingMissedTrialSubmission,
  type ExistingTrialSubmission
} from "../../src/domain/mold-trial/submission-guards.ts";

const now = new Date("2026-07-16T12:00:00.000Z");
/** A timestamp `msAgo` before `now`. */
function ago(msAgo: number): Date {
  return new Date(now.getTime() - msAgo);
}

describe("isWithinDuplicateWindow", () => {
  test("a just-now timestamp is inside the window", () => {
    assert.equal(isWithinDuplicateWindow(now, now), true);
    assert.equal(isWithinDuplicateWindow(ago(1), now), true);
    assert.equal(isWithinDuplicateWindow(ago(19_999), now), true);
  });

  test("exactly at the window edge is inside; one ms past is outside", () => {
    assert.equal(isWithinDuplicateWindow(ago(DUPLICATE_SUBMISSION_WINDOW_MS), now), true);
    assert.equal(isWithinDuplicateWindow(ago(DUPLICATE_SUBMISSION_WINDOW_MS + 1), now), false);
  });

  test("older than the window is outside", () => {
    assert.equal(isWithinDuplicateWindow(ago(60_000), now), false);
  });

  test("a custom window length is honoured", () => {
    assert.equal(isWithinDuplicateWindow(ago(4_000), now, 5_000), true);
    assert.equal(isWithinDuplicateWindow(ago(6_000), now, 5_000), false);
  });

  test("null, unparseable, or future timestamps are never inside", () => {
    assert.equal(isWithinDuplicateWindow(null, now), false);
    assert.equal(isWithinDuplicateWindow(undefined, now), false);
    assert.equal(isWithinDuplicateWindow("not-a-date", now), false);
    // future-dated (clock skew) → negative elapsed → not a duplicate
    assert.equal(isWithinDuplicateWindow(new Date(now.getTime() + 5_000), now), false);
  });

  test("accepts ISO strings and epoch millis as well as Date objects", () => {
    assert.equal(isWithinDuplicateWindow(ago(1_000).toISOString(), now.toISOString()), true);
    assert.equal(isWithinDuplicateWindow(ago(1_000).getTime(), now.getTime()), true);
  });
});

describe("isDuplicateIssueSubmission", () => {
  const existing: ExistingIssueSubmission = {
    moldTrialProjectId: "project-1",
    createdById: "user-1",
    title: "Short shot on cavity 2",
    createdAt: ago(3_000)
  };
  const candidate = {
    moldTrialProjectId: "project-1",
    createdById: "user-1",
    title: "Short shot on cavity 2"
  };

  test("same project + creator + title inside the window is a duplicate", () => {
    assert.equal(isDuplicateIssueSubmission(existing, candidate, now), true);
  });

  test("whitespace and case differences still match (double-tap of one form)", () => {
    assert.equal(
      isDuplicateIssueSubmission(existing, { ...candidate, title: "  Short   shot ON cavity 2 " }, now),
      true
    );
  });

  test("a different title is NOT a duplicate (passes through to creation)", () => {
    assert.equal(isDuplicateIssueSubmission(existing, { ...candidate, title: "Flash on parting line" }, now), false);
  });

  test("same title on a different project is NOT a duplicate", () => {
    assert.equal(isDuplicateIssueSubmission(existing, { ...candidate, moldTrialProjectId: "project-2" }, now), false);
  });

  test("same title from a different creator is NOT a duplicate", () => {
    assert.equal(isDuplicateIssueSubmission(existing, { ...candidate, createdById: "user-2" }, now), false);
  });

  test("outside the window is NOT a duplicate", () => {
    assert.equal(isDuplicateIssueSubmission({ ...existing, createdAt: ago(60_000) }, candidate, now), false);
  });

  test("a blank candidate title never matches, and null existing is never a duplicate", () => {
    assert.equal(isDuplicateIssueSubmission({ ...existing, title: "   " }, { ...candidate, title: "   " }, now), false);
    assert.equal(isDuplicateIssueSubmission(null, candidate, now), false);
  });
});

describe("isDuplicateTrialSubmission", () => {
  const existing: ExistingTrialSubmission = {
    moldTrialProjectId: "project-1",
    plannedDate: "2026-08-01",
    trialCode: "EXTRA",
    createdAt: ago(2_000)
  };
  const candidate = { moldTrialProjectId: "project-1", plannedDate: "2026-08-01", trialCode: "EXTRA" };

  test("same project + planned day + trial code inside the window is a duplicate", () => {
    assert.equal(isDuplicateTrialSubmission(existing, candidate, now), true);
  });

  test("compares planned date by day, ignoring the time component", () => {
    assert.equal(
      isDuplicateTrialSubmission(
        { ...existing, plannedDate: new Date("2026-08-01T00:00:00.000Z") },
        { ...candidate, plannedDate: new Date("2026-08-01T09:30:00.000Z") },
        now
      ),
      true
    );
  });

  test("a different planned day is NOT a duplicate", () => {
    assert.equal(isDuplicateTrialSubmission(existing, { ...candidate, plannedDate: "2026-08-02" }, now), false);
  });

  test("a different trial code is NOT a duplicate", () => {
    assert.equal(isDuplicateTrialSubmission(existing, { ...candidate, trialCode: "T2" }, now), false);
  });

  test("same key on a different project is NOT a duplicate", () => {
    assert.equal(isDuplicateTrialSubmission(existing, { ...candidate, moldTrialProjectId: "project-2" }, now), false);
  });

  test("outside the window, a null planned date, or null existing is NOT a duplicate", () => {
    assert.equal(isDuplicateTrialSubmission({ ...existing, createdAt: ago(30_000) }, candidate, now), false);
    assert.equal(isDuplicateTrialSubmission(existing, { ...candidate, plannedDate: null }, now), false);
    assert.equal(isDuplicateTrialSubmission(null, candidate, now), false);
  });
});

describe("isDuplicateMissedTrialSubmission", () => {
  const existing: ExistingMissedTrialSubmission = {
    trialEventId: "trial-1",
    newPlannedDate: "2026-08-10",
    createdAt: ago(1_000)
  };
  const candidate = { trialEventId: "trial-1", newPlannedDate: "2026-08-10" };

  test("same trial + new planned day inside the window is a duplicate", () => {
    assert.equal(isDuplicateMissedTrialSubmission(existing, candidate, now), true);
  });

  test("a different trial is NOT a duplicate", () => {
    assert.equal(isDuplicateMissedTrialSubmission(existing, { ...candidate, trialEventId: "trial-2" }, now), false);
  });

  test("a different new planned day is NOT a duplicate", () => {
    assert.equal(isDuplicateMissedTrialSubmission(existing, { ...candidate, newPlannedDate: "2026-08-11" }, now), false);
  });

  test("outside the window or null existing is NOT a duplicate", () => {
    assert.equal(isDuplicateMissedTrialSubmission({ ...existing, createdAt: ago(25_000) }, candidate, now), false);
    assert.equal(isDuplicateMissedTrialSubmission(null, candidate, now), false);
  });
});

describe("isDuplicateAttachmentSubmission", () => {
  const existing: ExistingAttachmentSubmission = {
    entityId: "issue-1",
    uploadedById: "user-1",
    fileName: "photo.jpg",
    sizeBytes: 12_345,
    uploadedAt: ago(2_000)
  };
  const candidate = { entityId: "issue-1", uploadedById: "user-1", fileName: "photo.jpg", sizeBytes: 12_345 };

  test("same target + uploader + fileName + size inside the window is a duplicate", () => {
    assert.equal(isDuplicateAttachmentSubmission(existing, candidate, now), true);
  });

  test("a different fileName is NOT a duplicate", () => {
    assert.equal(isDuplicateAttachmentSubmission(existing, { ...candidate, fileName: "photo-2.jpg" }, now), false);
  });

  test("a different byte size is NOT a duplicate", () => {
    assert.equal(isDuplicateAttachmentSubmission(existing, { ...candidate, sizeBytes: 999 }, now), false);
  });

  test("a different target entity or uploader is NOT a duplicate", () => {
    assert.equal(isDuplicateAttachmentSubmission(existing, { ...candidate, entityId: "issue-2" }, now), false);
    assert.equal(isDuplicateAttachmentSubmission(existing, { ...candidate, uploadedById: "user-2" }, now), false);
  });

  test("outside the window or null existing is NOT a duplicate", () => {
    assert.equal(isDuplicateAttachmentSubmission({ ...existing, uploadedAt: ago(40_000) }, candidate, now), false);
    assert.equal(isDuplicateAttachmentSubmission(null, candidate, now), false);
  });
});

describe("isDuplicateMeasurementReportSubmission", () => {
  const existing: ExistingMeasurementReportSubmission = {
    entityId: "trial-1",
    uploadedById: "user-1",
    sizeBytes: 50_000,
    uploadedAt: ago(3_000)
  };
  const candidate = { entityId: "trial-1", uploadedById: "user-1", sizeBytes: 50_000 };

  test("same trial + uploader + size inside the window is a duplicate re-tap", () => {
    assert.equal(isDuplicateMeasurementReportSubmission(existing, candidate, now), true);
  });

  test("a different byte size (a genuine replacement file) is NOT a duplicate", () => {
    assert.equal(isDuplicateMeasurementReportSubmission(existing, { ...candidate, sizeBytes: 51_000 }, now), false);
  });

  test("a different trial or uploader is NOT a duplicate", () => {
    assert.equal(isDuplicateMeasurementReportSubmission(existing, { ...candidate, entityId: "trial-2" }, now), false);
    assert.equal(isDuplicateMeasurementReportSubmission(existing, { ...candidate, uploadedById: "user-9" }, now), false);
  });

  test("outside the window or null existing is NOT a duplicate", () => {
    assert.equal(isDuplicateMeasurementReportSubmission({ ...existing, uploadedAt: ago(21_000) }, candidate, now), false);
    assert.equal(isDuplicateMeasurementReportSubmission(null, candidate, now), false);
  });
});
