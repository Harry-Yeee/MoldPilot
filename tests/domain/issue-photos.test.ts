import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  MAX_ISSUE_PHOTO_BATCH_BYTES,
  MAX_ISSUE_PHOTO_COUNT,
  addPendingPhotos,
  countPhotosByIssue,
  photoCountFor,
  removePendingPhoto,
  scaledDimensions,
  validateIssuePhotoBatch,
  type PendingPhoto
} from "../../src/domain/mold-trial/issue-photos.ts";

function photo(id: string): PendingPhoto {
  return { id, name: `${id}.jpg`, previewUrl: `blob:${id}`, sizeBytes: 1024 };
}

describe("pending-photo reducer", () => {
  test("adds photos onto the end preserving order", () => {
    const next = addPendingPhotos([photo("a")], [photo("b"), photo("c")]);
    assert.deepEqual(
      next.map((p) => p.id),
      ["a", "b", "c"]
    );
  });

  test("adding an empty batch returns a copy with the same contents", () => {
    const current = [photo("a")];
    const next = addPendingPhotos(current, []);
    assert.deepEqual(
      next.map((p) => p.id),
      ["a"]
    );
    assert.notEqual(next, current);
  });

  test("removes the photo with the given id", () => {
    const next = removePendingPhoto([photo("a"), photo("b"), photo("c")], "b");
    assert.deepEqual(
      next.map((p) => p.id),
      ["a", "c"]
    );
  });

  test("removing an absent id is a no-op", () => {
    const next = removePendingPhoto([photo("a")], "z");
    assert.deepEqual(
      next.map((p) => p.id),
      ["a"]
    );
  });
});

describe("scaledDimensions", () => {
  test("downscales a landscape image so the longest side hits the cap", () => {
    const result = scaledDimensions(4000, 3000, 1600);
    assert.equal(result.width, 1600);
    assert.equal(result.height, 1200);
  });

  test("downscales a portrait image by its (taller) height", () => {
    const result = scaledDimensions(3000, 4000, 1600);
    assert.equal(result.width, 1200);
    assert.equal(result.height, 1600);
  });

  test("leaves an already-small image unchanged and never upscales", () => {
    const result = scaledDimensions(800, 600, 1600);
    assert.deepEqual(result, { width: 800, height: 600 });
  });

  test("a square image at the boundary is unchanged", () => {
    const result = scaledDimensions(1600, 1600, 1600);
    assert.deepEqual(result, { width: 1600, height: 1600 });
  });

  test("invalid dimensions collapse to zero so the caller can skip processing", () => {
    assert.deepEqual(scaledDimensions(0, 100, 1600), { width: 0, height: 0 });
    assert.deepEqual(scaledDimensions(Number.NaN, 100, 1600), { width: 0, height: 0 });
    assert.deepEqual(scaledDimensions(100, 100, 0), { width: 0, height: 0 });
  });
});

describe("photo count aggregation", () => {
  test("counts photos per issue id", () => {
    const counts = countPhotosByIssue([
      { issueId: "i1" },
      { issueId: "i1" },
      { issueId: "i2" }
    ]);
    assert.equal(photoCountFor(counts, "i1"), 2);
    assert.equal(photoCountFor(counts, "i2"), 1);
  });

  test("an issue with no photos reports zero", () => {
    const counts = countPhotosByIssue([{ issueId: "i1" }]);
    assert.equal(photoCountFor(counts, "missing"), 0);
  });

  test("an empty input yields an empty map", () => {
    const counts = countPhotosByIssue([]);
    assert.equal(counts.size, 0);
    assert.equal(photoCountFor(counts, "any"), 0);
  });
});

describe("issue photo batch validation", () => {
  test("accepts up to three photos within the combined byte limit", () => {
    assert.deepEqual(
      validateIssuePhotoBatch([
        MAX_ISSUE_PHOTO_BATCH_BYTES / 3,
        MAX_ISSUE_PHOTO_BATCH_BYTES / 3,
        MAX_ISSUE_PHOTO_BATCH_BYTES / 3
      ]),
      { ok: true }
    );
  });

  test("rejects more than three photos even when each one is small", () => {
    const result = validateIssuePhotoBatch(
      Array.from({ length: MAX_ISSUE_PHOTO_COUNT + 1 }, () => 1)
    );
    assert.equal(result.ok, false);
  });

  test("rejects a batch over the combined byte limit", () => {
    const result = validateIssuePhotoBatch([MAX_ISSUE_PHOTO_BATCH_BYTES, 1]);
    assert.equal(result.ok, false);
  });
});
