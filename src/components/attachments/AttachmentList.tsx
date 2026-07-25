"use client";

/* eslint-disable @next/next/no-img-element -- Authenticated attachment URLs cannot be fetched by the Next image optimizer. */

import { useState } from "react";
import { Button, EmptyState, StatusBadge } from "@/components/ui";
import { Lightbox, type LightboxImage } from "@/components/attachments/Lightbox";
import type { AttachmentListItem } from "@/components/attachments/types";
import {
  extensionBadge,
  isImageContentType,
  isVideoContentType,
  sanitizeFileName
} from "@/domain/mold-trial/attachments";
import {
  attachmentLabels,
  fileTypeLabels,
  fileVisibilityLabels,
  formatFileSize,
  lightboxLabels,
  pickLabel,
  type Locale
} from "@/domain/mold-trial/labels";
import { deleteAttachment } from "@/server/attachment-actions";

export type AttachmentListProps = {
  attachments: readonly AttachmentListItem[];
  /** Current viewer id, so the uploader-may-delete rule can render the button. */
  currentUserId: string;
  /** True when the viewer holds attachment.delete (admin-style delete). */
  canAdminDelete: boolean;
  redirectTo: string;
  locale: Locale;
};

function attachmentSrc(id: string): string {
  return `/api/attachments/${id}`;
}

function formatDate(value: Date | string): string {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "2-digit", year: "numeric" }).format(
    new Date(value)
  );
}

function labelOrCode(labels: Record<string, { en: string; zh: string }>, code: string, locale: Locale): string {
  const label = labels[code];
  return label == null ? code.replaceAll("_", " ") : pickLabel(label, locale);
}

/**
 * Lists attachments as two groups: image content types render as a lazy-loaded
 * thumbnail grid that opens a shared fullscreen {@link Lightbox}; non-image files
 * keep the labelled row layout below. This is the single stateful parent for the
 * viewer — it holds the open index and passes its own image array down, so issue
 * galleries can reuse the same Lightbox with a different array. Download links go
 * to the permission-checked streaming route; delete posts to the soft-delete
 * action (which re-checks the uploader-or-admin rule server-side).
 */
export function AttachmentList({
  attachments,
  currentUserId,
  canAdminDelete,
  redirectTo,
  locale
}: AttachmentListProps) {
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  // Ids of video rows whose inline player is currently expanded.
  const [playingIds, setPlayingIds] = useState<ReadonlySet<string>>(new Set());

  const togglePlaying = (id: string): void => {
    setPlayingIds((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  if (attachments.length === 0) {
    return <EmptyState message={pickLabel(attachmentLabels.noFiles, locale)} />;
  }

  const imageAttachments = attachments.filter((attachment) => isImageContentType(attachment.contentType));
  const fileAttachments = attachments.filter((attachment) => !isImageContentType(attachment.contentType));
  const lightboxImages: LightboxImage[] = imageAttachments.map((attachment) => ({
    id: attachment.id,
    fileName: sanitizeFileName(attachment.fileName),
    uploadedByName: attachment.uploaderName,
    uploadedAt: new Date(attachment.uploadedAt).toISOString(),
    src: attachmentSrc(attachment.id)
  }));

  const canDeleteAttachment = (attachment: AttachmentListItem): boolean =>
    canAdminDelete || attachment.uploadedById === currentUserId;

  return (
    <div className="grid gap-4">
      {imageAttachments.length === 0 ? null : (
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(112px,1fr))] gap-3">
          {imageAttachments.map((attachment, index) => {
            const altText = sanitizeFileName(attachment.fileName);
            const canDelete = canDeleteAttachment(attachment);

            return (
              <li key={attachment.id} className="flex flex-col gap-1">
                <div className="group relative aspect-square overflow-hidden rounded-lg border border-neutral-200">
                  <button
                    type="button"
                    onClick={() => setOpenIndex(index)}
                    aria-label={`${pickLabel(lightboxLabels.open, locale)}: ${altText}`}
                    className="block h-full w-full focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500"
                  >
                    <img
                      src={attachmentSrc(attachment.id)}
                      alt={altText}
                      loading="lazy"
                      className="h-full w-full object-cover transition-transform group-hover:scale-105"
                    />
                  </button>
                  {attachment.visibility === "INTERNAL" ? null : (
                    <StatusBadge tone="paused" className="absolute left-1 top-1 shadow-sm">
                      {labelOrCode(fileVisibilityLabels, attachment.visibility, locale)}
                    </StatusBadge>
                  )}
                  <div className="absolute right-1 top-1 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                    <a
                      href={attachmentSrc(attachment.id)}
                      download
                      aria-label={pickLabel(attachmentLabels.download, locale)}
                      className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-neutral-400 bg-white text-sm font-bold text-brand-600 no-underline hover:bg-neutral-100"
                    >
                      &#8595;
                    </a>
                    {canDelete ? (
                      <form action={deleteAttachment}>
                        <input type="hidden" name="attachmentId" value={attachment.id} />
                        <input type="hidden" name="redirectTo" value={redirectTo} />
                        <button
                          type="submit"
                          aria-label={pickLabel(attachmentLabels.delete, locale)}
                          className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-status-missed bg-white text-sm font-bold text-status-missed hover:bg-status-missed hover:text-white"
                        >
                          x
                        </button>
                      </form>
                    ) : null}
                  </div>
                </div>
                <p
                  className="m-0 truncate text-[0.75rem] leading-tight text-neutral-500"
                  title={`${attachment.fileName} — ${attachment.uploaderName} · ${formatDate(attachment.uploadedAt)}`}
                >
                  {attachment.uploaderName} · {formatDate(attachment.uploadedAt)}
                </p>
              </li>
            );
          })}
        </ul>
      )}

      {fileAttachments.length === 0 ? null : (
        <ul className="grid gap-2">
          {fileAttachments.map((attachment) => {
            const canDelete = canDeleteAttachment(attachment);
            const isVideo = isVideoContentType(attachment.contentType);
            const isPlaying = playingIds.has(attachment.id);

            return (
              <li
                key={attachment.id}
                className="grid gap-3 rounded-lg border border-neutral-200 px-3 py-2.5"
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex min-w-0 flex-col gap-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusBadge tone="paused" className="tabular-nums">
                        {extensionBadge(attachment.fileName)}
                      </StatusBadge>
                      <a
                        href={attachmentSrc(attachment.id)}
                        className="truncate font-bold text-brand-600 no-underline hover:underline"
                      >
                        {attachment.fileName}
                      </a>
                      <StatusBadge tone="planned">{labelOrCode(fileTypeLabels, attachment.fileType, locale)}</StatusBadge>
                      <StatusBadge tone="paused">
                        {labelOrCode(fileVisibilityLabels, attachment.visibility, locale)}
                      </StatusBadge>
                    </div>
                    <p className="m-0 text-[0.8125rem] text-neutral-500">
                      {attachment.uploaderName} · {formatDate(attachment.uploadedAt)} ·{" "}
                      {formatFileSize(attachment.sizeBytes)}
                    </p>
                  </div>

                  <div className="flex items-center gap-2">
                    {isVideo ? (
                      <button
                        type="button"
                        onClick={() => togglePlaying(attachment.id)}
                        aria-expanded={isPlaying}
                        className="inline-flex min-h-9 items-center justify-center rounded-lg border border-neutral-400 bg-white px-3.5 text-sm font-bold text-brand-600 hover:bg-neutral-100"
                      >
                        {pickLabel(attachmentLabels.play, locale)}
                      </button>
                    ) : null}
                    <a
                      href={attachmentSrc(attachment.id)}
                      className="inline-flex min-h-9 items-center justify-center rounded-lg border border-neutral-400 bg-white px-3.5 text-sm font-bold text-brand-600 no-underline hover:bg-neutral-100"
                    >
                      {pickLabel(attachmentLabels.download, locale)}
                    </a>
                    {canDelete ? (
                      <form action={deleteAttachment}>
                        <input type="hidden" name="attachmentId" value={attachment.id} />
                        <input type="hidden" name="redirectTo" value={redirectTo} />
                        <Button type="submit" variant="danger">
                          {pickLabel(attachmentLabels.delete, locale)}
                        </Button>
                      </form>
                    ) : null}
                  </div>
                </div>

                {isVideo && isPlaying ? (
                  <video
                    controls
                    preload="metadata"
                    src={attachmentSrc(attachment.id)}
                    className="max-h-[70vh] w-full rounded-lg bg-black"
                  >
                    {attachment.fileName}
                  </video>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

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
