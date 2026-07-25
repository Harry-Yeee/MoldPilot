import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  MAX_ZIP_ENTRY_COUNT,
  countNextUploadChunk,
  scannerAllowsRelease,
  shouldRetainQuarantineForScanStatus,
  validateDetectedFileSignature,
  validateUploadOrigin,
  validateZipEntry,
  validateZipManifest
} from "../../src/domain/security/upload-security.ts";

const bytes = (value: string): Uint8Array => Buffer.from(value, "latin1");

describe("secure upload signatures", () => {
  it("accepts matching PDF content and rejects a spoofed PDF", () => {
    assert.equal(
      validateDetectedFileSignature({
        fileName: "report.pdf",
        extension: "pdf",
        detectedExtension: "pdf",
        prefix: bytes("%PDF-1.7")
      }).ok,
      true
    );
    assert.equal(
      validateDetectedFileSignature({
        fileName: "report.pdf",
        extension: "pdf",
        detectedExtension: "exe",
        prefix: bytes("MZ")
      }).ok,
      false
    );
  });

  it("rejects executable double extensions", () => {
    assert.equal(
      validateDetectedFileSignature({
        fileName: "drawing.exe.pdf",
        extension: "pdf",
        detectedExtension: "pdf",
        prefix: bytes("%PDF-1.7")
      }).ok,
      false
    );
    assert.equal(
      validateDetectedFileSignature({
        fileName: "drawing.revision.2.pdf",
        extension: "pdf",
        detectedExtension: "pdf",
        prefix: bytes("%PDF-1.7")
      }).ok,
      true
    );
  });

  it("checks text CAD signatures rather than trusting a generic MIME", () => {
    assert.equal(
      validateDetectedFileSignature({
        fileName: "tool.step",
        extension: "stp",
        detectedExtension: null,
        prefix: bytes("ISO-10303-21;\nHEADER;")
      }).ok,
      true
    );
    assert.equal(
      validateDetectedFileSignature({
        fileName: "tool.step",
        extension: "stp",
        detectedExtension: null,
        prefix: bytes("<script>alert(1)</script>")
      }).ok,
      false
    );
  });
});

describe("streaming byte limits", () => {
  it("counts received chunks and rejects bytes beyond the per-type cap", () => {
    assert.deepEqual(countNextUploadChunk(0, 6, 10), { ok: true, sizeBytes: 6 });
    assert.deepEqual(countNextUploadChunk(6, 4, 10), { ok: true, sizeBytes: 10 });
    assert.equal(countNextUploadChunk(10, 1, 10).ok, false);
  });

  it("rejects invalid or overflowing counters", () => {
    assert.equal(countNextUploadChunk(-1, 1, 10).ok, false);
    assert.equal(countNextUploadChunk(Number.MAX_SAFE_INTEGER, 1, Number.MAX_SAFE_INTEGER).ok, false);
  });
});

describe("secure ZIP inspection", () => {
  it("rejects traversal, encrypted files, nested archives, and compression bombs", () => {
    const base = {
      compressedSize: 100,
      uncompressedSize: 200,
      encrypted: false,
      symbolicLink: false
    };
    assert.equal(validateZipEntry({ ...base, fileName: "../escape.txt" }).ok, false);
    assert.equal(validateZipEntry({ ...base, fileName: "safe.txt", encrypted: true }).ok, false);
    assert.equal(validateZipEntry({ ...base, fileName: "nested.zip" }).ok, false);
    assert.equal(
      validateZipEntry({
        ...base,
        fileName: "huge.txt",
        compressedSize: 1,
        uncompressedSize: 2 * 1024 * 1024
      }).ok,
      false
    );
  });

  it("requires the Office package to match its declared extension", () => {
    const safe = (fileName: string) => ({
      fileName,
      compressedSize: 100,
      uncompressedSize: 200,
      encrypted: false,
      symbolicLink: false
    });
    assert.equal(
      validateZipManifest("xlsx", [safe("[Content_Types].xml"), safe("xl/workbook.xml")]).ok,
      true
    );
    assert.equal(
      validateZipManifest("xlsx", [safe("[Content_Types].xml"), safe("word/document.xml")]).ok,
      false
    );
    assert.equal(
      validateZipManifest("docx", [safe("[Content_Types].xml"), safe("word/vbaProject.bin")]).ok,
      false
    );
  });

  it("rejects archives with excessive entry counts", () => {
    const entries = Array.from({ length: MAX_ZIP_ENTRY_COUNT + 1 }, (_, index) => ({
      fileName: `row-${index}.txt`,
      compressedSize: 1,
      uncompressedSize: 1,
      encrypted: false,
      symbolicLink: false
    }));
    assert.equal(validateZipManifest("zip", entries).ok, false);
  });
});

describe("upload origin checks", () => {
  it("requires the custom header, exact origin, and pinned host", () => {
    const valid = {
      configuredBaseUrl: "https://moldpilot.factory.test",
      requestUrl: "http://127.0.0.1:3000/api/uploads",
      originHeader: "https://moldpilot.factory.test",
      hostHeader: "moldpilot.factory.test",
      uploadHeader: "1"
    };
    assert.equal(validateUploadOrigin(valid).ok, true);
    assert.equal(validateUploadOrigin({ ...valid, uploadHeader: null }).ok, false);
    assert.equal(validateUploadOrigin({ ...valid, originHeader: "https://evil.test" }).ok, false);
    assert.equal(validateUploadOrigin({ ...valid, hostHeader: "127.0.0.1:3000" }).ok, false);
  });
});

describe("malware scanner release policy", () => {
  it("releases only an explicit clean result", () => {
    assert.equal(scannerAllowsRelease("clean"), true);
    assert.equal(scannerAllowsRelease("infected"), false);
    assert.equal(scannerAllowsRelease("unavailable"), false);
    assert.equal(scannerAllowsRelease("error"), false);
  });

  it("retains scanner outages for quarantine review but not rejected malware", () => {
    assert.equal(shouldRetainQuarantineForScanStatus("unavailable"), true);
    assert.equal(shouldRetainQuarantineForScanStatus("error"), true);
    assert.equal(shouldRetainQuarantineForScanStatus("infected"), false);
    assert.equal(shouldRetainQuarantineForScanStatus("clean"), false);
  });
});
