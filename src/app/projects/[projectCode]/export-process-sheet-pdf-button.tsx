"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui";
import { validateProcessSheetPdfDownload } from "@/domain/mold-trial/process-sheet-export";
import { useI18n } from "@/i18n/language-provider";
import {
  exportProcessSheetPdf,
  type ProcessSheetPdfExportState
} from "@/server/mold-trial-actions";

const initialExportState: ProcessSheetPdfExportState = {
  success: false,
  attachmentId: null,
  fileName: null,
  error: null
};

type ExportPhase = "idle" | "exporting" | "downloading" | "downloaded" | "error";

export function ExportProcessSheetPdfButton({ projectCode }: { projectCode: string }) {
  const { t } = useI18n();
  const router = useRouter();
  const [state, formAction, pending] = useActionState(exportProcessSheetPdf, initialExportState);
  const [phase, setPhase] = useState<ExportPhase>("idle");
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const handledAttachmentId = useRef<string | null>(null);

  useEffect(() => {
    if (!state.success || state.attachmentId == null || state.fileName == null) {
      return;
    }

    if (handledAttachmentId.current === state.attachmentId) {
      return;
    }
    const attachmentId = state.attachmentId;
    const fileName = state.fileName;
    handledAttachmentId.current = attachmentId;

    let active = true;

    async function downloadGeneratedPdf() {
      setPhase("downloading");
      setDownloadError(null);

      try {
        const response = await fetch(`/api/attachments/${attachmentId}`, {
          cache: "no-store",
          credentials: "same-origin"
        });
        const blob = await response.blob();
        const signatureBytes = new Uint8Array(await blob.slice(0, 5).arrayBuffer());
        const validation = validateProcessSheetPdfDownload({
          responseOk: response.ok,
          contentType: response.headers.get("content-type"),
          sizeBytes: blob.size,
          signature: new TextDecoder("ascii").decode(signatureBytes)
        });

        if (!validation.ok) {
          throw new Error(validation.message);
        }

        const objectUrl = URL.createObjectURL(blob);
        const downloadLink = document.createElement("a");
        downloadLink.href = objectUrl;
        downloadLink.download = fileName;
        downloadLink.hidden = true;
        downloadLink.dataset.processSheetPdfDownload = "true";
        document.body.append(downloadLink);
        downloadLink.click();
        downloadLink.remove();
        window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1_000);

        if (active) {
          setPhase("downloaded");
          window.history.replaceState(null, "", "#process-sheet-heading");
          router.refresh();
        }
      } catch (error) {
        if (active) {
          setDownloadError(error instanceof Error ? error.message : t("project.customerPdfDownloadFailed"));
          setPhase("error");
        }
      }
    }

    void downloadGeneratedPdf();

    return () => {
      active = false;
    };
  }, [router, state, t]);

  const visiblePhase = state.error != null && !pending ? "error" : phase;
  const busy =
    pending ||
    (visiblePhase !== "error" && (phase === "exporting" || phase === "downloading"));
  const buttonLabel =
    visiblePhase === "downloading"
      ? t("project.downloadingCustomerPdf")
      : busy
        ? t("project.exportingCustomerPdf")
        : t("project.exportCustomerPdf");
  const errorMessage = downloadError ?? state.error;

  return (
    <form
      action={formAction}
      className="flex flex-col items-end gap-1.5"
      onSubmit={() => {
        setPhase("exporting");
        setDownloadError(null);
      }}
    >
      <input type="hidden" name="projectCode" value={projectCode} />
      <Button
        type="submit"
        disabled={busy}
        data-process-sheet-pdf-export="true"
        aria-busy={busy}
      >
        {buttonLabel}
      </Button>
      <div className="max-w-72 text-right text-xs" aria-live="polite">
        {visiblePhase === "downloaded" && state.fileName != null ? (
          <span className="text-status-completed">
            {t("project.customerPdfDownloaded")} {state.fileName} {t("project.customerPdfSaved")}
          </span>
        ) : null}
        {visiblePhase === "error" && errorMessage != null ? (
          <span className="text-status-missed">{errorMessage}</span>
        ) : null}
      </div>
    </form>
  );
}
