import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

import { validateProcessSheetPdfDownload } from "../../src/domain/mold-trial/process-sheet-export.ts";

describe("Process Sheet PDF export", () => {
  test("accepts only a successful, non-empty PDF response with a PDF signature", () => {
    assert.deepEqual(
      validateProcessSheetPdfDownload({
        responseOk: true,
        contentType: "application/pdf",
        sizeBytes: 12_345,
        signature: "%PDF-"
      }),
      { ok: true }
    );

    for (const candidate of [
      { responseOk: false, contentType: "application/pdf", sizeBytes: 12_345, signature: "%PDF-" },
      { responseOk: true, contentType: "text/plain", sizeBytes: 12_345, signature: "%PDF-" },
      { responseOk: true, contentType: "application/pdf", sizeBytes: 0, signature: "" },
      { responseOk: true, contentType: "application/pdf", sizeBytes: 12_345, signature: "error" }
    ]) {
      assert.equal(validateProcessSheetPdfDownload(candidate).ok, false);
    }
  });

  test("server export stores one customer-safe attachment with complete PDF metadata and audit details", () => {
    const actionSource = readFileSync(
      new URL("../../src/server/mold-trial-actions.ts", import.meta.url),
      "utf8"
    );
    const exportSource = actionSource.slice(
      actionSource.indexOf("export async function exportProcessSheetPdf"),
      actionSource.indexOf("export async function addNewPlannedTrial")
    );

    assert.match(exportSource, /const attachmentId = randomUUID\(\)/);
    assert.match(exportSource, /const pdfBuffer = await createSimplePdfBuffer\(exportText\)/);
    assert.match(exportSource, /writeAttachmentFile\(\{\s*id: attachmentId,\s*extension: "pdf",\s*data: pdfBuffer/);
    assert.match(exportSource, /id: attachmentId,[\s\S]*entityType: "PROCESS_SHEET_EXPORT"/);
    assert.match(exportSource, /fileType: "PROCESS_SHEET_PDF"/);
    assert.match(exportSource, /contentType: "application\/pdf"/);
    assert.match(exportSource, /sizeBytes,[\s\S]*visibility: "CUSTOMER_SAFE"/);
    assert.match(exportSource, /action: "exported_process_sheet_pdf"/);
    assert.match(exportSource, /attachmentId: attachment\.id,[\s\S]*fileName,[\s\S]*sizeBytes:[\s\S]*visibility:/);
    assert.doesNotMatch(exportSource, /generated["',/]process-sheet-exports/);
    assert.doesNotMatch(exportSource, /writeFile\(|mkdir\(/);
  });

  test("client export downloads through the protected route and refreshes Customer Files", () => {
    const buttonSource = readFileSync(
      new URL("../../src/app/projects/[projectCode]/export-process-sheet-pdf-button.tsx", import.meta.url),
      "utf8"
    );
    const validationIndex = buttonSource.indexOf("const validation = validateProcessSheetPdfDownload");
    const objectUrlIndex = buttonSource.indexOf("URL.createObjectURL(blob)");

    assert.match(buttonSource, /useActionState\(exportProcessSheetPdf, initialExportState\)/);
    assert.match(buttonSource, /const attachmentId = state\.attachmentId/);
    assert.match(buttonSource, /fetch\(`\/api\/attachments\/\$\{attachmentId\}`/);
    assert.match(buttonSource, /credentials: "same-origin"/);
    assert.match(buttonSource, /const blob = await response\.blob\(\)/);
    assert.ok(validationIndex >= 0 && objectUrlIndex > validationIndex, "PDF validation must run before a download URL is made");
    assert.match(buttonSource, /if \(!validation\.ok\) \{\s*throw new Error\(validation\.message\)/);
    assert.match(buttonSource, /const fileName = state\.fileName/);
    assert.match(buttonSource, /downloadLink\.download = fileName/);
    assert.match(buttonSource, /downloadLink\.click\(\)/);
    assert.match(buttonSource, /router\.refresh\(\)/);
    assert.doesNotMatch(buttonSource, /window\.open\(/);
  });

  test("protected attachment route supplies downloadable PDF response headers", () => {
    const routeSource = readFileSync(
      new URL("../../src/app/api/attachments/[id]/route.ts", import.meta.url),
      "utf8"
    );

    assert.match(routeSource, /canDownloadAttachment\(attachment\.visibility, permissionCodes\)/);
    assert.match(routeSource, /"Content-Type": attachment\.contentType/);
    assert.match(routeSource, /"Content-Length": String\(opened\.sizeBytes\)/);
    assert.match(routeSource, /"Content-Disposition": contentDisposition/);
  });
});
