"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui";
import { validateProcessSheetWorkbookDownload } from "@/domain/mold-trial/process-sheet-export";
import { translateWorkflowMessage } from "@/i18n";
import { useI18n } from "@/i18n/language-provider";
import {
  exportProcessSheetWorkbook,
  type ProcessSheetWorkbookExportState
} from "@/server/mold-trial-actions";

const initialExportState: ProcessSheetWorkbookExportState = {
  success: false,
  attachmentId: null,
  fileName: null,
  error: null
};

type ExportPhase = "idle" | "exporting" | "downloading" | "downloaded" | "error";

/**
 * Export the Digital Process Sheet as the factory's own 技术参数表 workbook.
 *
 * The permission CODE behind this button is still `trial.process_sheet.export_pdf`
 * (see the 2026-08-08 #2 development-log entry): the format changed, the grant
 * did not, and renaming a permission code means another production data
 * migration for zero user-visible gain. Only the LABEL says Excel.
 */
export function ExportProcessSheetExcelButton({ projectCode }: { projectCode: string }) {
  const { dictionary, t } = useI18n();
  const router = useRouter();
  const [state, formAction, pending] = useActionState(exportProcessSheetWorkbook, initialExportState);
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

    async function downloadGeneratedWorkbook() {
      setPhase("downloading");
      setDownloadError(null);

      try {
        const response = await fetch(`/api/attachments/${attachmentId}`, {
          cache: "no-store",
          credentials: "same-origin"
        });
        const blob = await response.blob();
        // The ZIP local-file-header magic, read as bytes: an .xlsx that does not
        // start with PK\x03\x04 is not a workbook, whatever the headers claim.
        const signatureBytes = new Uint8Array(await blob.slice(0, 4).arrayBuffer());
        const validation = validateProcessSheetWorkbookDownload({
          responseOk: response.ok,
          contentType: response.headers.get("content-type"),
          sizeBytes: blob.size,
          signature: String.fromCharCode(...signatureBytes)
        });

        if (!validation.ok) {
          throw new Error(validation.message);
        }

        const objectUrl = URL.createObjectURL(blob);
        const downloadLink = document.createElement("a");
        downloadLink.href = objectUrl;
        downloadLink.download = fileName;
        downloadLink.hidden = true;
        downloadLink.dataset.processSheetExcelDownload = "true";
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
          const message = error instanceof Error ? error.message : t("project.excelDownloadFailed");
          setDownloadError(translateWorkflowMessage(dictionary, message) ?? message);
          setPhase("error");
        }
      }
    }

    void downloadGeneratedWorkbook();

    return () => {
      active = false;
    };
  }, [dictionary, router, state, t]);

  const visiblePhase = state.error != null && !pending ? "error" : phase;
  const busy =
    pending ||
    (visiblePhase !== "error" && (phase === "exporting" || phase === "downloading"));
  const buttonLabel =
    visiblePhase === "downloading"
      ? t("project.downloadingExcel")
      : busy
        ? t("project.exportingExcel")
        : t("project.exportExcel");
  const errorMessage =
    downloadError ??
    (state.error == null ? null : (translateWorkflowMessage(dictionary, state.error) ?? state.error));

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
        data-process-sheet-excel-export="true"
        aria-busy={busy}
      >
        {buttonLabel}
      </Button>
      <div className="max-w-72 text-right text-xs" aria-live="polite">
        {visiblePhase === "downloaded" && state.fileName != null ? (
          <span className="text-status-completed">
            {t("project.excelDownloaded")} {state.fileName} {t("project.excelSaved")}
          </span>
        ) : null}
        {visiblePhase === "error" && errorMessage != null ? (
          <span className="text-status-missed">{errorMessage}</span>
        ) : null}
      </div>
    </form>
  );
}
