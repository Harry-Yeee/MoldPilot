export type ProcessSheetPdfDownloadCandidate = {
  responseOk: boolean;
  contentType: string | null;
  sizeBytes: number;
  signature: string;
};

export type ProcessSheetPdfDownloadValidation =
  | { ok: true }
  | { ok: false; message: string };

/**
 * Guard the browser download trigger so an error response, empty body, or
 * non-PDF payload never becomes a misleading zero-byte customer file.
 */
export function validateProcessSheetPdfDownload(
  candidate: ProcessSheetPdfDownloadCandidate
): ProcessSheetPdfDownloadValidation {
  if (!candidate.responseOk) {
    return { ok: false, message: "The protected PDF download was rejected." };
  }

  if (candidate.contentType?.split(";", 1)[0]?.trim().toLowerCase() !== "application/pdf") {
    return { ok: false, message: "The downloaded attachment is not a PDF." };
  }

  if (!Number.isFinite(candidate.sizeBytes) || candidate.sizeBytes <= 0) {
    return { ok: false, message: "The downloaded PDF is empty." };
  }

  if (candidate.signature !== "%PDF-") {
    return { ok: false, message: "The downloaded attachment is not a valid PDF." };
  }

  return { ok: true };
}
