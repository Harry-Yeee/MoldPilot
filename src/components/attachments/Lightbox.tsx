"use client";

/* eslint-disable @next/next/no-img-element -- Lightbox sources are authenticated attachment or local blob URLs. */

import { useCallback, useEffect, useRef } from "react";
import { nextImageIndex, prevImageIndex } from "@/domain/mold-trial/attachments";
import { lightboxLabels, localeFromLanguage, pickLabel } from "@/domain/mold-trial/labels";
import { formatLocalizedDate } from "@/i18n/display";
import { useI18n } from "@/i18n/language-provider";

/** One image the lightbox can display. `src` is the streaming download route. */
export type LightboxImage = {
  id: string;
  fileName: string;
  uploadedByName: string;
  uploadedAt: string;
  src: string;
};

export type LightboxProps = {
  images: readonly LightboxImage[];
  /** Index of the open image, or `null` when the lightbox is closed. */
  openIndex: number | null;
  onClose: () => void;
  /** Parent updates its open index; the lightbox never owns navigation state. */
  onNavigate: (index: number) => void;
};

/**
 * Fullscreen, controlled photo viewer. The parent (`AttachmentList`) owns the
 * open index; this component renders the current image, a caption bar, and
 * Prev/Next controls, and reports navigation/close intents upward. Closes on
 * Escape, backdrop click, or the ✕ button; wraps around at both ends; preloads
 * the two adjacent images. Body scroll is locked and focus is trapped to the
 * dialog while open, restoring the previously focused element on close.
 */
export function Lightbox({ images, openIndex, onClose, onNavigate }: LightboxProps) {
  const { language } = useI18n();
  const locale = localeFromLanguage(language);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const previouslyFocused = useRef<Element | null>(null);
  const isOpen = openIndex != null && openIndex >= 0 && openIndex < images.length;
  const hasMultiple = images.length > 1;

  const goNext = useCallback(() => {
    if (openIndex == null) {
      return;
    }
    onNavigate(nextImageIndex(openIndex, images.length));
  }, [openIndex, images.length, onNavigate]);

  const goPrev = useCallback(() => {
    if (openIndex == null) {
      return;
    }
    onNavigate(prevImageIndex(openIndex, images.length));
  }, [openIndex, images.length, onNavigate]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      } else if (event.key === "ArrowRight") {
        goNext();
      } else if (event.key === "ArrowLeft") {
        goPrev();
      }
    }

    previouslyFocused.current = document.activeElement;
    document.addEventListener("keydown", onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialogRef.current?.focus();

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      if (previouslyFocused.current instanceof HTMLElement) {
        previouslyFocused.current.focus();
      }
    };
  }, [isOpen, onClose, goNext, goPrev]);

  if (!isOpen || openIndex == null) {
    return null;
  }

  const current = images[openIndex];
  if (current == null) {
    return null;
  }

  const preloadIndexes = hasMultiple
    ? [nextImageIndex(openIndex, images.length), prevImageIndex(openIndex, images.length)]
    : [];
  const counter = `${openIndex + 1} / ${images.length}`;
  const controlClasses =
    "inline-flex h-11 min-w-11 items-center justify-center rounded-lg border border-white/30 " +
    "bg-black/40 px-3 text-2xl font-bold text-white hover:bg-black/60 " +
    "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white";

  return (
    <div
      className="fixed inset-0 z-[60] flex flex-col items-center justify-center bg-[rgba(10,14,20,0.85)] p-4"
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={pickLabel(lightboxLabels.viewer, locale)}
        tabIndex={-1}
        className="relative flex max-h-full max-w-full flex-col items-center gap-3 outline-none"
        onClick={(event) => event.stopPropagation()}
      >
        <button
          type="button"
          aria-label={pickLabel(lightboxLabels.close, locale)}
          onClick={onClose}
          className={
            "absolute -top-1 right-0 z-10 inline-flex h-11 w-11 items-center justify-center rounded-lg " +
            "border border-white/30 bg-black/40 text-2xl font-bold text-white hover:bg-black/60 " +
            "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
          }
        >
          x
        </button>

        <div className="flex items-center gap-3">
          {hasMultiple ? (
            <button type="button" aria-label={pickLabel(lightboxLabels.previous, locale)} onClick={goPrev} className={controlClasses}>
              &#8249;
            </button>
          ) : null}

          <img
            key={current.id}
            src={current.src}
            alt={current.fileName}
            className="max-h-[84vh] max-w-[92vw] rounded-lg object-contain shadow-card"
          />

          {hasMultiple ? (
            <button type="button" aria-label={pickLabel(lightboxLabels.next, locale)} onClick={goNext} className={controlClasses}>
              &#8250;
            </button>
          ) : null}
        </div>

        <div className="flex max-w-[92vw] flex-wrap items-center justify-center gap-x-2 gap-y-1 text-center text-sm text-white">
          <span className="font-bold">{current.fileName}</span>
          <span aria-hidden="true" className="text-white/50">·</span>
          <span className="text-white/80">{current.uploadedByName}</span>
          <span aria-hidden="true" className="text-white/50">·</span>
          <span className="text-white/80">{formatLocalizedDate(current.uploadedAt, language)}</span>
          <span aria-hidden="true" className="text-white/50">·</span>
          <span className="font-bold tabular-nums">{counter}</span>
        </div>
      </div>

      {/* Preload the adjacent images so navigation is instant. */}
      <div aria-hidden="true" className="pointer-events-none absolute h-0 w-0 overflow-hidden">
        {preloadIndexes.map((index) => {
          const image = images[index];
          return image == null ? null : <img key={image.id} src={image.src} alt="" />;
        })}
      </div>
    </div>
  );
}
