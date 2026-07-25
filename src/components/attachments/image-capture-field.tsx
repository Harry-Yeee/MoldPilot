"use client";

/* eslint-disable @next/next/no-img-element -- Pending photo previews are local blob URLs. */

import { useEffect, useId, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import {
  addPendingPhotos,
  MAX_ISSUE_PHOTO_COUNT,
  removePendingPhoto,
  scaledDimensions,
  type PendingPhoto
} from "@/domain/mold-trial/issue-photos";
import { issuePhotoLabels, pickLabel, type Locale } from "@/domain/mold-trial/labels";

export type ImageCaptureFieldProps = {
  /** Form field name the processed files are submitted under (e.g. "photos"). */
  name: string;
  locale: Locale;
  /** Disables the picker + remove buttons (e.g. while the form is submitting). */
  disabled?: boolean;
};

/** Longest side, in px, we downscale a photo to before upload. */
const MAX_LONGEST_SIDE = 1600;
/** Re-encode quality for the downscaled JPEG. */
const JPEG_QUALITY = 0.8;

let pendingPhotoSeq = 0;
function nextPendingId(): string {
  pendingPhotoSeq += 1;
  return `pending-${pendingPhotoSeq}`;
}

/**
 * Decode + downscale one image file to a JPEG whose longest side is ≤
 * {@link MAX_LONGEST_SIDE}. Images already within the bound are re-encoded (kept
 * small and consistent). HEIC that the browser cannot decode falls through to
 * the original file so the server-side 10 MB cap is the only gate. Returns the
 * original file if the canvas/blob pipeline fails for any reason.
 */
async function downscaleImage(file: File): Promise<File> {
  // createImageBitmap handles orientation and most browser-decodable formats.
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    // HEIC or an undecodable image — upload the original, rely on the size cap.
    return file;
  }

  try {
    const { width, height } = scaledDimensions(bitmap.width, bitmap.height, MAX_LONGEST_SIDE);
    if (width === 0 || height === 0) {
      return file;
    }

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (context == null) {
      return file;
    }
    context.drawImage(bitmap, 0, 0, width, height);

    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob((result) => resolve(result), "image/jpeg", JPEG_QUALITY);
    });
    if (blob == null) {
      return file;
    }

    const baseName = file.name.replace(/\.[^.]+$/, "");
    const outName = `${baseName.length > 0 ? baseName : "photo"}.jpg`;
    return new File([blob], outName, { type: "image/jpeg", lastModified: Date.now() });
  } finally {
    bitmap.close();
  }
}

/**
 * Photo picker for the desktop issue forms. Renders a clear "Add photos" button
 * over a hidden `<input type="file" accept="image/*" multiple>`, downscales each
 * chosen image client-side, and keeps a pending-thumbnail strip with per-photo
 * remove. The PROCESSED files are written back onto the same input via a
 * `DataTransfer`, so they submit inside the SAME form (and the same server
 * action) as the issue fields — no separate upload request. A short busy state
 * covers the async downscale so a click never looks like it did nothing.
 */
export function ImageCaptureField({ name, locale, disabled = false }: ImageCaptureFieldProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const buttonId = useId();
  const [pending, setPending] = useState<PendingPhoto[]>([]);
  // Processed File objects, index-aligned with `pending` by id.
  const filesById = useRef<Map<string, File>>(new Map());
  const [busy, setBusy] = useState(false);
  // While the parent form is submitting, freeze the picker so photos can't change.
  const { pending: formSubmitting } = useFormStatus();

  // Keep the real input's FileList in sync with the processed files so a normal
  // form submit carries exactly the pending set.
  function syncInputFiles(order: readonly PendingPhoto[]): void {
    const input = inputRef.current;
    if (input == null) {
      return;
    }
    const transfer = new DataTransfer();
    for (const photo of order) {
      const file = filesById.current.get(photo.id);
      if (file != null) {
        transfer.items.add(file);
      }
    }
    input.files = transfer.files;
  }

  // Revoke all object URLs on unmount.
  useEffect(() => {
    return () => {
      for (const photo of pending) {
        URL.revokeObjectURL(photo.previewUrl);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function onPick(selected: FileList | null): Promise<void> {
    if (selected == null || selected.length === 0) {
      return;
    }
    // Snapshot the picked files, then immediately restore the input to only the
    // already-processed set: the raw (large, pre-downscale) originals must never
    // be what a mid-processing submit would send.
    const remainingSlots = Math.max(0, MAX_ISSUE_PHOTO_COUNT - pending.length);
    const chosen = Array.from(selected).slice(0, remainingSlots);
    if (chosen.length === 0) {
      return;
    }
    syncInputFiles(pending);
    setBusy(true);
    try {
      const added: PendingPhoto[] = [];
      for (const original of chosen) {
        const processed = await downscaleImage(original);
        const id = nextPendingId();
        filesById.current.set(id, processed);
        added.push({
          id,
          name: original.name.length > 0 ? original.name : "photo",
          previewUrl: URL.createObjectURL(processed),
          sizeBytes: processed.size
        });
      }
      setPending((current) => {
        const next = addPendingPhotos(current, added);
        syncInputFiles(next);
        return next;
      });
    } finally {
      setBusy(false);
    }
  }

  function onRemove(id: string): void {
    setPending((current) => {
      const target = current.find((photo) => photo.id === id);
      if (target != null) {
        URL.revokeObjectURL(target.previewUrl);
      }
      filesById.current.delete(id);
      const next = removePendingPhoto(current, id);
      syncInputFiles(next);
      return next;
    });
  }

  const controlsDisabled = disabled || busy || formSubmitting;

  return (
    <div className="grid gap-2">
      <input
        ref={inputRef}
        id={buttonId}
        name={name}
        type="file"
        accept="image/*"
        multiple
        disabled={disabled}
        className="sr-only"
        onChange={(event) => {
          void onPick(event.target.files);
        }}
      />

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={controlsDisabled}
          onClick={() => inputRef.current?.click()}
          className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-neutral-400 bg-white px-3.5 text-sm font-bold text-brand-600 hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <span aria-hidden>+</span>
          {pickLabel(issuePhotoLabels.addPhotos, locale)}
        </button>
        {busy || formSubmitting ? (
          <span className="text-sm font-bold text-neutral-500">{pickLabel(issuePhotoLabels.processing, locale)}</span>
        ) : pending.length > 0 ? (
          <span className="text-sm font-bold text-neutral-500 tabular-nums">
            {pending.length} {pickLabel(issuePhotoLabels.photoCount, locale)}
          </span>
        ) : null}
      </div>

      {pending.length === 0 ? (
        <p className="m-0 text-[0.8125rem] text-neutral-500">{pickLabel(issuePhotoLabels.photoHint, locale)}</p>
      ) : (
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(80px,1fr))] gap-2">
          {pending.map((photo) => (
            <li key={photo.id} className="relative aspect-square overflow-hidden rounded-lg border border-neutral-300">
              <img src={photo.previewUrl} alt={photo.name} className="h-full w-full object-cover" />
              <button
                type="button"
                disabled={controlsDisabled}
                onClick={() => onRemove(photo.id)}
                aria-label={`${pickLabel(issuePhotoLabels.removePhoto, locale)}: ${photo.name}`}
                className="absolute right-1 top-1 inline-flex h-7 w-7 items-center justify-center rounded-lg border border-status-missed bg-white text-sm font-bold text-status-missed hover:bg-status-missed hover:text-white disabled:opacity-60"
              >
                x
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
