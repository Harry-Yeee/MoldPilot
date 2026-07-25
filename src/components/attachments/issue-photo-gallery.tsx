"use client";

/* eslint-disable @next/next/no-img-element -- Authenticated issue-photo URLs cannot use the Next image optimizer. */

import { useState } from "react";
import { Lightbox, type LightboxImage } from "@/components/attachments/Lightbox";
import { sanitizeFileName } from "@/domain/mold-trial/attachments";
import { issuePhotoLabels, lightboxLabels, pickLabel, type Locale } from "@/domain/mold-trial/labels";

/** One issue photo, already display-shaped by the server query. */
export type IssuePhoto = {
  id: string;
  fileName: string;
  uploaderName: string;
  uploadedAt: string;
};

export type IssuePhotoGalleryProps = {
  photos: readonly IssuePhoto[];
  locale: Locale;
};

function attachmentSrc(id: string): string {
  return `/api/attachments/${id}`;
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "2-digit", year: "numeric" }).format(new Date(value));
}

/**
 * Read-only thumbnail grid for one issue's photos that opens the SHARED
 * {@link Lightbox} viewer with this issue's own image array. Used on the desktop
 * project detail issue view and (unchanged) inside the /me expanded issue card —
 * viewing photos is allowed everywhere; only creation is desktop-only. Owns the
 * Lightbox open index locally so each gallery is independent. Images stream lazily
 * from the permission-checked download route (inline disposition).
 */
export function IssuePhotoGallery({ photos, locale }: IssuePhotoGalleryProps) {
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  if (photos.length === 0) {
    return null;
  }

  const lightboxImages: LightboxImage[] = photos.map((photo) => ({
    id: photo.id,
    fileName: sanitizeFileName(photo.fileName),
    uploadedByName: photo.uploaderName,
    uploadedAt: new Date(photo.uploadedAt).toISOString(),
    src: attachmentSrc(photo.id)
  }));

  return (
    <div className="grid gap-1">
      <span className="text-[0.75rem] font-bold text-neutral-500">{pickLabel(issuePhotoLabels.photos, locale)}</span>
      <ul className="grid grid-cols-[repeat(auto-fill,minmax(72px,1fr))] gap-2">
        {photos.map((photo, index) => {
          const altText = sanitizeFileName(photo.fileName);
          return (
            <li key={photo.id} className="flex flex-col gap-1">
              <button
                type="button"
                onClick={() => setOpenIndex(index)}
                aria-label={`${pickLabel(lightboxLabels.open, locale)}: ${altText}`}
                className="group relative block aspect-square overflow-hidden rounded-lg border border-neutral-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500"
              >
                <img
                  src={attachmentSrc(photo.id)}
                  alt={altText}
                  loading="lazy"
                  className="h-full w-full object-cover transition-transform group-hover:scale-105"
                />
              </button>
              <span
                className="truncate text-[0.6875rem] leading-tight text-neutral-500"
                title={`${photo.uploaderName} · ${formatDate(photo.uploadedAt)}`}
              >
                {photo.uploaderName} · {formatDate(photo.uploadedAt)}
              </span>
            </li>
          );
        })}
      </ul>

      <Lightbox
        images={lightboxImages}
        openIndex={openIndex}
        onClose={() => setOpenIndex(null)}
        onNavigate={setOpenIndex}
        locale={locale}
      />
    </div>
  );
}

/**
 * Small photo-count chip for an issue row/header when photos exist. Pure display;
 * renders nothing at zero so callers can drop it in unconditionally.
 */
export function IssuePhotoCountChip({ count, locale }: { count: number; locale: Locale }) {
  if (count <= 0) {
    return null;
  }
  return (
    <span
      className="inline-flex items-center gap-1 rounded-lg bg-neutral-100 px-2 py-0.5 text-[0.75rem] font-bold text-neutral-600 tabular-nums"
      title={`${count} ${pickLabel(issuePhotoLabels.photoCount, locale)}`}
    >
      <span aria-hidden>▦</span>
      {count}
    </span>
  );
}
