"use client";

import { useEffect, useId, type ReactNode } from "react";
import { useI18n } from "@/i18n/language-provider";

export type BottomSheetProps = {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
};

/**
 * A dialog that slides up from the bottom on small screens and presents as a
 * centered modal from the `md` breakpoint up. Closes on Escape and backdrop
 * click. Built for heavy use by the upcoming mobile task page.
 */
export function BottomSheet({ open, onClose, title, children }: BottomSheetProps) {
  const titleId = useId();
  const { t } = useI18n();

  useEffect(() => {
    if (!open) {
      return;
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [open, onClose]);

  if (!open) {
    return null;
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-[rgba(24,34,48,0.34)] md:items-center"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={
          "flex max-h-[90vh] w-full flex-col overflow-hidden border border-neutral-400 bg-white shadow-card " +
          "rounded-t-lg [animation:bottomSheetIn_0.2s_ease-out] " +
          "md:max-h-[min(760px,calc(100vh-32px))] md:w-[min(560px,calc(100vw-32px))] md:rounded-lg " +
          "md:[animation:none]"
        }
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-4 border-b border-neutral-200 px-4 py-3.5 sm:px-[18px]">
          <h3 id={titleId} className="text-base">
            {title}
          </h3>
          <button
            type="button"
            aria-label={t("common.close")}
            onClick={onClose}
            className="inline-flex h-[34px] w-[34px] items-center justify-center rounded-lg border border-neutral-400 bg-white font-bold text-brand-600 hover:bg-neutral-100"
          >
            x
          </button>
        </div>
        <div className="overflow-auto p-4 sm:p-[18px]">{children}</div>
      </div>
    </div>
  );
}
