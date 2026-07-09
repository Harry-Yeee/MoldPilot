/**
 * Pure, unit-testable logic for the trial-issue photo feature.
 *
 * No React, no DOM, no Prisma — just the state math the `ImageCaptureField`
 * reducer and the count/aggregation helpers need, so the component and tests can
 * share one source of truth. Browser-only work (canvas downscale, `File`
 * construction) lives in the client component; everything here is plain values.
 */

/** One photo queued in the capture field, before the form is submitted. */
export type PendingPhoto = {
  /** Stable client id (never sent to the server) used as the React key. */
  id: string;
  /** Display name shown under the thumbnail. */
  name: string;
  /** Object URL for the thumbnail preview; the caller revokes it on removal. */
  previewUrl: string;
  /** Byte size of the processed file (post-downscale). */
  sizeBytes: number;
};

/** Append pending photos, ignoring an empty batch (keeps identity stable). */
export function addPendingPhotos(
  current: readonly PendingPhoto[],
  added: readonly PendingPhoto[]
): PendingPhoto[] {
  if (added.length === 0) {
    return [...current];
  }
  return [...current, ...added];
}

/** Remove the pending photo with the given id (no-op when absent). */
export function removePendingPhoto(current: readonly PendingPhoto[], id: string): PendingPhoto[] {
  return current.filter((photo) => photo.id !== id);
}

/**
 * Longest side after downscaling to fit within `maxLongestSide`, preserving
 * aspect ratio. Images already within the bound are returned unchanged (never
 * upscaled). Non-finite or non-positive inputs collapse to `{ width: 0, height: 0 }`
 * so the caller can skip processing a broken decode.
 */
export function scaledDimensions(
  width: number,
  height: number,
  maxLongestSide: number
): { width: number; height: number } {
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    !Number.isFinite(maxLongestSide) ||
    width <= 0 ||
    height <= 0 ||
    maxLongestSide <= 0
  ) {
    return { width: 0, height: 0 };
  }

  const longest = Math.max(width, height);
  if (longest <= maxLongestSide) {
    return { width: Math.round(width), height: Math.round(height) };
  }

  const scale = maxLongestSide / longest;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale))
  };
}

/**
 * Aggregate photo counts per issue id from a flat list of (issueId) rows. Used
 * both to drive the row/header count chip and to keep the my-plate query mapping
 * testable without a database. Ids not present in the input map to 0 via
 * {@link photoCountFor}.
 */
export function countPhotosByIssue(
  rows: readonly { issueId: string }[]
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const row of rows) {
    counts.set(row.issueId, (counts.get(row.issueId) ?? 0) + 1);
  }
  return counts;
}

/** Photo count for one issue id, defaulting to 0 when the id is absent. */
export function photoCountFor(counts: ReadonlyMap<string, number>, issueId: string): number {
  return counts.get(issueId) ?? 0;
}
