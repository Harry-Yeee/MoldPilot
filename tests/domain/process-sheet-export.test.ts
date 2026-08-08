import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

import {
  PROCESS_SHEET_WORKBOOK_CONTENT_TYPE,
  PROCESS_SHEET_WORKBOOK_SIGNATURE,
  validateProcessSheetWorkbookDownload
} from "../../src/domain/mold-trial/process-sheet-export.ts";

describe("Process Sheet Excel export", () => {
  test("accepts only a successful, non-empty workbook response with the ZIP signature", () => {
    assert.equal(
      PROCESS_SHEET_WORKBOOK_CONTENT_TYPE,
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    assert.equal(PROCESS_SHEET_WORKBOOK_SIGNATURE, "PK\u0003\u0004");

    assert.deepEqual(
      validateProcessSheetWorkbookDownload({
        responseOk: true,
        contentType: PROCESS_SHEET_WORKBOOK_CONTENT_TYPE,
        sizeBytes: 12_345,
        signature: PROCESS_SHEET_WORKBOOK_SIGNATURE
      }),
      { ok: true }
    );
    // A charset suffix is still the same type.
    assert.deepEqual(
      validateProcessSheetWorkbookDownload({
        responseOk: true,
        contentType: `${PROCESS_SHEET_WORKBOOK_CONTENT_TYPE}; charset=utf-8`,
        sizeBytes: 12_345,
        signature: PROCESS_SHEET_WORKBOOK_SIGNATURE
      }),
      { ok: true }
    );

    for (const candidate of [
      {
        responseOk: false,
        contentType: PROCESS_SHEET_WORKBOOK_CONTENT_TYPE,
        sizeBytes: 12_345,
        signature: PROCESS_SHEET_WORKBOOK_SIGNATURE
      },
      {
        responseOk: true,
        contentType: "text/plain",
        sizeBytes: 12_345,
        signature: PROCESS_SHEET_WORKBOOK_SIGNATURE
      },
      // The retired PDF path must not be waved through by the new guard.
      {
        responseOk: true,
        contentType: "application/pdf",
        sizeBytes: 12_345,
        signature: "%PDF-"
      },
      {
        responseOk: true,
        contentType: PROCESS_SHEET_WORKBOOK_CONTENT_TYPE,
        sizeBytes: 0,
        signature: ""
      },
      {
        responseOk: true,
        contentType: PROCESS_SHEET_WORKBOOK_CONTENT_TYPE,
        sizeBytes: 12_345,
        signature: "error"
      }
    ]) {
      assert.equal(validateProcessSheetWorkbookDownload(candidate).ok, false);
    }
  });

  test("server export stores one customer-safe attachment with complete workbook metadata and audit details", () => {
    const actionSource = readFileSync(
      new URL("../../src/server/mold-trial-actions.ts", import.meta.url),
      "utf8"
    );
    const exportSource = actionSource.slice(
      actionSource.indexOf("export async function exportProcessSheetWorkbook"),
      actionSource.indexOf("export async function addNewPlannedTrial")
    );

    assert.match(exportSource, /const attachmentId = randomUUID\(\)/);
    assert.match(exportSource, /const workbookBuffer = buildXlsxWorkbook\(/);
    assert.match(exportSource, /buildProcessSheetWorkbook\(\{/);
    assert.match(exportSource, /writeAttachmentFile\(\{\s*id: attachmentId,\s*extension: "xlsx",\s*data: workbookBuffer/);
    assert.match(exportSource, /id: attachmentId,[\s\S]*entityType: "PROCESS_SHEET_EXPORT"/);
    assert.match(exportSource, /contentType: PROCESS_SHEET_WORKBOOK_CONTENT_TYPE/);
    assert.match(exportSource, /sizeBytes,[\s\S]*visibility: "CUSTOMER_SAFE"/);
    assert.match(exportSource, /attachmentId: attachment\.id,[\s\S]*fileName,[\s\S]*sizeBytes:[\s\S]*visibility:/);
    assert.match(exportSource, /\.xlsx`/);
    assert.doesNotMatch(exportSource, /createSimplePdfBuffer/);
    assert.doesNotMatch(exportSource, /application\/pdf/);
    assert.doesNotMatch(exportSource, /generated["',/]process-sheet-exports/);
    assert.doesNotMatch(exportSource, /writeFile\(|mkdir\(/);
  });

  test("the stored permission code, FileType and activity action stay on their pre-Excel values", () => {
    // Renaming any of these three means a production data migration for a string
    // no user reads. The 2026-08-08 #2 decision is that only labels change.
    const actionSource = readFileSync(
      new URL("../../src/server/mold-trial-actions.ts", import.meta.url),
      "utf8"
    );
    const pageSource = readFileSync(
      new URL("../../src/app/projects/[projectCode]/page.tsx", import.meta.url),
      "utf8"
    );
    const exportSource = actionSource.slice(
      actionSource.indexOf("export async function exportProcessSheetWorkbook"),
      actionSource.indexOf("export async function addNewPlannedTrial")
    );

    assert.match(exportSource, /getActor\("trial\.process_sheet\.export_pdf"\)/);
    assert.match(exportSource, /fileType: "PROCESS_SHEET_PDF"/);
    assert.match(exportSource, /action: "exported_process_sheet_pdf"/);
    assert.match(pageSource, /writeAllowed\("trial\.process_sheet\.export_pdf"\)/);
  });

  test("client export downloads through the protected route and refreshes Customer Files", () => {
    const buttonSource = readFileSync(
      new URL("../../src/app/projects/[projectCode]/export-process-sheet-excel-button.tsx", import.meta.url),
      "utf8"
    );
    const validationIndex = buttonSource.indexOf("const validation = validateProcessSheetWorkbookDownload");
    const objectUrlIndex = buttonSource.indexOf("URL.createObjectURL(blob)");

    assert.match(buttonSource, /useActionState\(exportProcessSheetWorkbook, initialExportState\)/);
    assert.match(buttonSource, /const attachmentId = state\.attachmentId/);
    assert.match(buttonSource, /fetch\(`\/api\/attachments\/\$\{attachmentId\}`/);
    assert.match(buttonSource, /credentials: "same-origin"/);
    assert.match(buttonSource, /const blob = await response\.blob\(\)/);
    assert.ok(
      validationIndex >= 0 && objectUrlIndex > validationIndex,
      "workbook validation must run before a download URL is made"
    );
    assert.match(buttonSource, /if \(!validation\.ok\) \{\s*throw new Error\(validation\.message\)/);
    assert.match(buttonSource, /const fileName = state\.fileName/);
    assert.match(buttonSource, /downloadLink\.download = fileName/);
    assert.match(buttonSource, /downloadLink\.click\(\)/);
    assert.match(buttonSource, /router\.refresh\(\)/);
    assert.match(buttonSource, /data-process-sheet-excel-export="true"/);
    assert.doesNotMatch(buttonSource, /window\.open\(/);
  });

  test("protected attachment route supplies downloadable response headers", () => {
    const routeSource = readFileSync(
      new URL("../../src/app/api/attachments/[id]/route.ts", import.meta.url),
      "utf8"
    );

    assert.match(routeSource, /canDownloadAttachment\(attachment\.visibility, permissionCodes\)/);
    assert.match(routeSource, /"Content-Type": attachment\.contentType/);
    assert.match(routeSource, /"Content-Length": String\(opened\.sizeBytes\)/);
    assert.match(routeSource, /"Content-Disposition": contentDisposition/);
    assert.match(routeSource, /"X-Content-Type-Options": "nosniff"/);
  });

  test("the attachment Content-Disposition is RFC 5987 encoded so a CJK filename survives", () => {
    const attachmentsSource = readFileSync(
      new URL("../../src/domain/mold-trial/attachments.ts", import.meta.url),
      "utf8"
    );

    assert.match(attachmentsSource, /filename\*=UTF-8''\$\{encoded\}/);
    assert.match(attachmentsSource, /const encoded = encodeURIComponent\(safe\)/);
    // xlsx must be an allowed office type, or the stored export would be a
    // content type the attachment rules do not recognise.
    assert.match(
      attachmentsSource,
      /contentType: "application\/vnd\.openxmlformats-officedocument\.spreadsheetml\.sheet",\s*extension: "xlsx"/
    );
  });

  test("the retired PDF writer is gone", () => {
    assert.throws(
      () => readFileSync(new URL("../../src/server/simple-pdf.ts", import.meta.url), "utf8"),
      /ENOENT/
    );
    assert.throws(
      () =>
        readFileSync(
          new URL("../../src/app/projects/[projectCode]/export-process-sheet-pdf-button.tsx", import.meta.url),
          "utf8"
        ),
      /ENOENT/
    );
  });
});
