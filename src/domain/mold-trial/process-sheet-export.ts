/**
 * The browser-side guard on the process-sheet export download.
 *
 * PURE, and deliberately shared: the client button and the tests apply the same
 * four checks, so "the download looked fine but the file was empty" cannot be a
 * difference of opinion between them.
 */

/** The OOXML spreadsheet MIME type — the one Excel, WPS and LibreOffice claim. */
export const PROCESS_SHEET_WORKBOOK_CONTENT_TYPE =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/**
 * Every .xlsx is a ZIP, and every ZIP starts with the four-byte local-file-header
 * magic. Four bytes, not two: "PK" alone also matches a text file that happens to
 * begin with those letters.
 */
export const PROCESS_SHEET_WORKBOOK_SIGNATURE = "PK\u0003\u0004";

export type ProcessSheetWorkbookDownloadCandidate = {
  responseOk: boolean;
  contentType: string | null;
  sizeBytes: number;
  signature: string;
};

export type ProcessSheetWorkbookDownloadValidation =
  | { ok: true }
  | { ok: false; message: string };

/**
 * Guard the browser download trigger so an error response, empty body, or
 * non-workbook payload never becomes a misleading zero-byte customer file.
 */
export function validateProcessSheetWorkbookDownload(
  candidate: ProcessSheetWorkbookDownloadCandidate
): ProcessSheetWorkbookDownloadValidation {
  if (!candidate.responseOk) {
    return { ok: false, message: "The protected Excel download was rejected." };
  }

  if (
    candidate.contentType?.split(";", 1)[0]?.trim().toLowerCase() !==
    PROCESS_SHEET_WORKBOOK_CONTENT_TYPE
  ) {
    return { ok: false, message: "The downloaded attachment is not an Excel workbook." };
  }

  if (!Number.isFinite(candidate.sizeBytes) || candidate.sizeBytes <= 0) {
    return { ok: false, message: "The downloaded Excel workbook is empty." };
  }

  if (candidate.signature !== PROCESS_SHEET_WORKBOOK_SIGNATURE) {
    return { ok: false, message: "The downloaded attachment is not a valid Excel workbook." };
  }

  return { ok: true };
}
