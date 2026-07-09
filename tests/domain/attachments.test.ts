import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  buildStorageKey,
  CAD_SIZE_LIMIT_BYTES,
  canDownloadAttachment,
  contentDispositionFor,
  defaultVisibilityForFileType,
  DOCUMENT_SIZE_LIMIT_BYTES,
  extensionBadge,
  extensionFromFileName,
  IMAGE_SIZE_LIMIT_BYTES,
  isVideoContentType,
  nextImageIndex,
  OTHER_SIZE_LIMIT_BYTES,
  parseRangeHeader,
  prevImageIndex,
  resolveStoragePath,
  sanitizeFileName,
  validateAttachmentUpload,
  VIDEO_SIZE_LIMIT_BYTES,
  type AttachmentVisibility
} from "../../src/domain/mold-trial/attachments.ts";

describe("attachment upload validation", () => {
  test("accepts a JPEG photo within the image size cap", () => {
    const result = validateAttachmentUpload({
      fileType: "TRIAL_PHOTO",
      declaredContentType: "image/jpeg",
      fileName: "shot.jpg",
      sizeBytes: 2 * 1024 * 1024
    });

    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.contentType, "image/jpeg");
      assert.equal(result.extension, "jpg");
      assert.equal(result.safeFileName, "shot.jpg");
    }
  });

  test("accepts a PNG and WebP and HEIC photo", () => {
    for (const [contentType, extension] of [
      ["image/png", "png"],
      ["image/webp", "webp"],
      ["image/heic", "heic"]
    ] as const) {
      const result = validateAttachmentUpload({
        fileType: "TRIAL_PHOTO",
        declaredContentType: contentType,
        fileName: `photo.${extension}`,
        sizeBytes: 1024
      });
      assert.equal(result.ok, true, `${contentType} should be accepted`);
    }
  });

  test("rejects a PDF uploaded as a TRIAL_PHOTO", () => {
    const result = validateAttachmentUpload({
      fileType: "TRIAL_PHOTO",
      declaredContentType: "application/pdf",
      fileName: "report.pdf",
      sizeBytes: 1024
    });

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.issues[0]?.field, "contentType");
    }
  });

  test("rejects a photo over the 10 MB image cap", () => {
    const result = validateAttachmentUpload({
      fileType: "TRIAL_PHOTO",
      declaredContentType: "image/png",
      fileName: "huge.png",
      sizeBytes: IMAGE_SIZE_LIMIT_BYTES + 1
    });

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.ok(result.issues.some((issue) => issue.field === "sizeBytes"));
    }
  });

  test("accepts pdf/xlsx/xls/docx/csv for QC_REPORT within the 25 MB cap", () => {
    for (const [contentType, extension] of [
      ["application/pdf", "pdf"],
      ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "xlsx"],
      ["application/vnd.ms-excel", "xls"],
      ["application/vnd.openxmlformats-officedocument.wordprocessingml.document", "docx"],
      ["text/csv", "csv"]
    ] as const) {
      const result = validateAttachmentUpload({
        fileType: "QC_REPORT",
        declaredContentType: contentType,
        fileName: `data.${extension}`,
        sizeBytes: 5 * 1024 * 1024
      });
      assert.equal(result.ok, true, `${contentType} should be accepted for QC_REPORT`);
      if (result.ok) {
        assert.equal(result.extension, extension);
      }
    }
  });

  test("rejects a document over the 25 MB cap", () => {
    const result = validateAttachmentUpload({
      fileType: "CUSTOMER_REPORT_PDF",
      declaredContentType: "application/pdf",
      fileName: "big.pdf",
      sizeBytes: DOCUMENT_SIZE_LIMIT_BYTES + 1
    });

    assert.equal(result.ok, false);
  });

  test("rejects an image uploaded as a QC_REPORT", () => {
    const result = validateAttachmentUpload({
      fileType: "QC_REPORT",
      declaredContentType: "image/png",
      fileName: "chart.png",
      sizeBytes: 1024
    });

    assert.equal(result.ok, false);
  });

  test("rejects an empty (zero-byte) file", () => {
    const result = validateAttachmentUpload({
      fileType: "QC_REPORT",
      declaredContentType: "application/pdf",
      fileName: "empty.pdf",
      sizeBytes: 0
    });

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.ok(result.issues.some((issue) => issue.field === "sizeBytes"));
    }
  });

  test("rejects a filename extension that mismatches the declared content type", () => {
    const result = validateAttachmentUpload({
      fileType: "QC_REPORT",
      declaredContentType: "application/pdf",
      fileName: "report.xlsx",
      sizeBytes: 1024
    });

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.ok(result.issues.some((issue) => issue.field === "file"));
    }
  });

  test("treats a .jpeg extension as matching image/jpeg", () => {
    const result = validateAttachmentUpload({
      fileType: "TRIAL_PHOTO",
      declaredContentType: "image/jpeg",
      fileName: "photo.jpeg",
      sizeBytes: 1024
    });

    assert.equal(result.ok, true);
    if (result.ok) {
      // Canonical extension is normalized to jpg on the stored filename.
      assert.equal(result.extension, "jpg");
      assert.equal(result.safeFileName, "photo.jpg");
    }
  });

  test("ignores a charset parameter on the declared content type", () => {
    const result = validateAttachmentUpload({
      fileType: "OTHER",
      declaredContentType: "text/csv; charset=utf-8",
      fileName: "list.csv",
      sizeBytes: 512
    });

    assert.equal(result.ok, true);
  });

  test("accepts pptx/ppt for QC_REPORT and CUSTOMER_REPORT_PDF", () => {
    for (const fileType of ["QC_REPORT", "CUSTOMER_REPORT_PDF"] as const) {
      for (const [contentType, extension] of [
        ["application/vnd.openxmlformats-officedocument.presentationml.presentation", "pptx"],
        ["application/vnd.ms-powerpoint", "ppt"]
      ] as const) {
        const result = validateAttachmentUpload({
          fileType,
          declaredContentType: contentType,
          fileName: `deck.${extension}`,
          sizeBytes: 3 * 1024 * 1024
        });
        assert.equal(result.ok, true, `${extension} should be accepted for ${fileType}`);
        if (result.ok) {
          assert.equal(result.extension, extension);
        }
      }
    }
  });

  test("rejects a .zip for QC_REPORT but accepts it for OTHER", () => {
    const qcResult = validateAttachmentUpload({
      fileType: "QC_REPORT",
      declaredContentType: "application/zip",
      fileName: "bundle.zip",
      sizeBytes: 1024
    });
    assert.equal(qcResult.ok, false, ".zip is not allowed for QC_REPORT");

    const otherResult = validateAttachmentUpload({
      fileType: "OTHER",
      declaredContentType: "application/zip",
      fileName: "bundle.zip",
      sizeBytes: 1024
    });
    assert.equal(otherResult.ok, true, ".zip is allowed for OTHER");
    if (otherResult.ok) {
      assert.equal(otherResult.extension, "zip");
    }
  });

  test("accepts an octet-stream .zip for OTHER (generic browser MIME)", () => {
    const result = validateAttachmentUpload({
      fileType: "OTHER",
      declaredContentType: "application/octet-stream",
      fileName: "bundle.zip",
      sizeBytes: 1024
    });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.contentType, "application/zip");
    }
  });

  test("accepts CAD extensions for DRAWING with a generic/empty declared MIME", () => {
    for (const [fileName, expectedExt, expectedType] of [
      ["housing.stp", "stp", "model/step"],
      ["housing.step", "stp", "model/step"],
      ["frame.igs", "igs", "model/iges"],
      ["frame.iges", "igs", "model/iges"],
      ["plate.dwg", "dwg", "image/vnd.dwg"],
      ["plate.dxf", "dxf", "image/vnd.dxf"],
      ["drawing.pdf", "pdf", "application/pdf"]
    ] as const) {
      for (const declared of ["", "application/octet-stream"]) {
        const result = validateAttachmentUpload({
          fileType: "DRAWING",
          declaredContentType: declared,
          fileName,
          sizeBytes: 50 * 1024 * 1024
        });
        assert.equal(result.ok, true, `${fileName} (declared "${declared}") should be accepted`);
        if (result.ok) {
          assert.equal(result.extension, expectedExt);
          assert.equal(result.contentType, expectedType);
        }
      }
    }
  });

  test("accepts the same CAD formats for DESIGN_CHANGE", () => {
    const result = validateAttachmentUpload({
      fileType: "DESIGN_CHANGE",
      declaredContentType: "application/octet-stream",
      fileName: "rev-b.step",
      sizeBytes: 1024
    });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.contentType, "model/step");
    }
  });

  test("accepts a CAD file up to the 300 MB cap and rejects beyond it", () => {
    const atCap = validateAttachmentUpload({
      fileType: "DRAWING",
      declaredContentType: "application/octet-stream",
      fileName: "huge.stp",
      sizeBytes: CAD_SIZE_LIMIT_BYTES
    });
    assert.equal(atCap.ok, true);

    const overCap = validateAttachmentUpload({
      fileType: "DRAWING",
      declaredContentType: "application/octet-stream",
      fileName: "huge.stp",
      sizeBytes: CAD_SIZE_LIMIT_BYTES + 1
    });
    assert.equal(overCap.ok, false);
    if (!overCap.ok) {
      assert.ok(overCap.issues.some((issue) => issue.field === "sizeBytes"));
    }
  });

  test("rejects a non-CAD extension for DRAWING (allowlist philosophy)", () => {
    const result = validateAttachmentUpload({
      fileType: "DRAWING",
      declaredContentType: "application/octet-stream",
      fileName: "notes.txt",
      sizeBytes: 1024
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.ok(result.issues.some((issue) => issue.field === "file"));
    }
  });

  test("rejects a .stp attempted as a QC_REPORT", () => {
    const result = validateAttachmentUpload({
      fileType: "QC_REPORT",
      declaredContentType: "application/octet-stream",
      fileName: "model.stp",
      sizeBytes: 1024
    });
    assert.equal(result.ok, false);
  });

  test("rejects a CAD file whose concrete MIME conflicts with its extension", () => {
    // A real image/png declared for a .stp is a genuine conflict, not a generic MIME.
    const result = validateAttachmentUpload({
      fileType: "DRAWING",
      declaredContentType: "image/png",
      fileName: "model.stp",
      sizeBytes: 1024
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.ok(result.issues.some((issue) => issue.field === "contentType"));
    }
  });

  test("accepts mp4 and mov for VIDEO within the 300 MB cap", () => {
    for (const [contentType, extension] of [
      ["video/mp4", "mp4"],
      ["video/quicktime", "mov"]
    ] as const) {
      const result = validateAttachmentUpload({
        fileType: "VIDEO",
        declaredContentType: contentType,
        fileName: `clip.${extension}`,
        sizeBytes: 20 * 1024 * 1024
      });
      assert.equal(result.ok, true, `${contentType} should be accepted for VIDEO`);
      if (result.ok) {
        assert.equal(result.extension, extension);
      }
    }
  });

  test("rejects a video over the 300 MB cap and an image uploaded as VIDEO", () => {
    const overCap = validateAttachmentUpload({
      fileType: "VIDEO",
      declaredContentType: "video/mp4",
      fileName: "long.mp4",
      sizeBytes: VIDEO_SIZE_LIMIT_BYTES + 1
    });
    assert.equal(overCap.ok, false);

    const wrongType = validateAttachmentUpload({
      fileType: "VIDEO",
      declaredContentType: "image/png",
      fileName: "frame.png",
      sizeBytes: 1024
    });
    assert.equal(wrongType.ok, false);
  });

  test("TRIAL_PHOTO remains images-only within the 10 MB cap", () => {
    const ok = validateAttachmentUpload({
      fileType: "TRIAL_PHOTO",
      declaredContentType: "image/jpeg",
      fileName: "shot.jpg",
      sizeBytes: 8 * 1024 * 1024
    });
    assert.equal(ok.ok, true);

    const overCap = validateAttachmentUpload({
      fileType: "TRIAL_PHOTO",
      declaredContentType: "image/jpeg",
      fileName: "shot.jpg",
      sizeBytes: IMAGE_SIZE_LIMIT_BYTES + 1
    });
    assert.equal(overCap.ok, false);
  });

  test("OTHER accepts docs/slides up to 100 MB and rejects beyond it", () => {
    const atCap = validateAttachmentUpload({
      fileType: "OTHER",
      declaredContentType: "application/pdf",
      fileName: "manual.pdf",
      sizeBytes: OTHER_SIZE_LIMIT_BYTES
    });
    assert.equal(atCap.ok, true);

    const overCap = validateAttachmentUpload({
      fileType: "OTHER",
      declaredContentType: "application/pdf",
      fileName: "manual.pdf",
      sizeBytes: OTHER_SIZE_LIMIT_BYTES + 1
    });
    assert.equal(overCap.ok, false);
  });
});

describe("filename sanitization", () => {
  test("strips directory separators, keeping only the base name", () => {
    assert.equal(sanitizeFileName("../../etc/passwd", undefined), "passwd");
    assert.equal(sanitizeFileName("C:\\Windows\\evil.pdf", "pdf"), "evil.pdf");
    assert.equal(sanitizeFileName("/tmp/nested/report.pdf", "pdf"), "report.pdf");
  });

  test("removes control characters and quotes", () => {
    const cleaned = sanitizeFileName('re"po rt.pdf', "pdf");
    assert.ok(!cleaned.includes('"'));
    assert.ok(!/[ -]/.test(cleaned));
    assert.ok(cleaned.endsWith(".pdf"));
  });

  test("falls back to a safe name when the input reduces to nothing", () => {
    assert.equal(sanitizeFileName("///", "pdf"), "file.pdf");
    assert.equal(sanitizeFileName("", undefined), "file");
  });

  test("appends the validated extension when it is missing or wrong", () => {
    assert.equal(sanitizeFileName("report", "pdf"), "report.pdf");
    assert.equal(sanitizeFileName("report.txt", "pdf"), "report.pdf");
  });

  test("caps overly long names while preserving the extension", () => {
    const longName = `${"a".repeat(400)}.pdf`;
    const capped = sanitizeFileName(longName, "pdf");
    assert.ok(capped.length <= 120);
    assert.ok(capped.endsWith(".pdf"));
  });
});

describe("canDownloadAttachment", () => {
  const internalOnly = new Set(["attachment.download.internal"]);
  const customerOnly = new Set(["attachment.download.customer_safe"]);
  const both = new Set(["attachment.download.internal", "attachment.download.customer_safe"]);
  const none = new Set<string>();
  const internalVisibilities: AttachmentVisibility[] = ["INTERNAL", "TECHNICAL", "RESTRICTED"];

  test("internal/technical/restricted require attachment.download.internal", () => {
    for (const visibility of internalVisibilities) {
      assert.equal(canDownloadAttachment(visibility, internalOnly), true, `${visibility} with internal`);
      assert.equal(canDownloadAttachment(visibility, both), true, `${visibility} with both`);
      assert.equal(canDownloadAttachment(visibility, customerOnly), false, `${visibility} with customer-only`);
      assert.equal(canDownloadAttachment(visibility, none), false, `${visibility} with none`);
    }
  });

  test("customer-safe is allowed by either internal or customer-safe permission", () => {
    assert.equal(canDownloadAttachment("CUSTOMER_SAFE", customerOnly), true);
    assert.equal(canDownloadAttachment("CUSTOMER_SAFE", internalOnly), true);
    assert.equal(canDownloadAttachment("CUSTOMER_SAFE", both), true);
    assert.equal(canDownloadAttachment("CUSTOMER_SAFE", none), false);
  });

  test("marketing (customer-safe only) cannot download restricted files", () => {
    assert.equal(canDownloadAttachment("RESTRICTED", customerOnly), false);
    assert.equal(canDownloadAttachment("CUSTOMER_SAFE", customerOnly), true);
  });

  test("accepts an array of permission codes as well as a Set", () => {
    assert.equal(canDownloadAttachment("INTERNAL", ["attachment.download.internal"]), true);
    assert.equal(canDownloadAttachment("CUSTOMER_SAFE", ["attachment.download.customer_safe"]), true);
    assert.equal(canDownloadAttachment("RESTRICTED", ["attachment.download.customer_safe"]), false);
  });
});

describe("storage key + path resolution", () => {
  test("builds a sharded, extension-suffixed key from an id", () => {
    const key = buildStorageKey("abcd1234-5678-90ab-cdef-1234567890ab", "pdf");
    assert.equal(key, "attachments/ab/abcd1234-5678-90ab-cdef-1234567890ab.pdf");
  });

  test("strips unsafe characters from the id and extension", () => {
    const key = buildStorageKey("../../evil", "p/d f");
    assert.ok(!key.includes(".."));
    assert.ok(!key.includes("/d f"));
  });

  test("resolves a valid key to a path inside the root", () => {
    const root = "/srv/moldpilot/storage";
    const resolved = resolveStoragePath(root, "attachments/ab/file.pdf");
    assert.ok(resolved != null);
    assert.ok(resolved.startsWith(root));
  });

  test("rejects a traversal key that would escape the root", () => {
    const root = "/srv/moldpilot/storage";
    assert.equal(resolveStoragePath(root, "../../etc/passwd"), null);
    assert.equal(resolveStoragePath(root, "attachments/../../secret"), null);
    assert.equal(resolveStoragePath(root, "/etc/passwd"), null);
  });

  test("rejects a key that resolves to the root directory itself", () => {
    assert.equal(resolveStoragePath("/srv/storage", "."), null);
  });

  test("a built key always stays inside the root", () => {
    const root = "/srv/storage";
    const key = buildStorageKey("11112222-3333-4444-5555-666677778888", "png");
    const resolved = resolveStoragePath(root, key);
    assert.ok(resolved != null);
    assert.ok(resolved.startsWith(root));
  });
});

describe("content disposition + extension parsing", () => {
  test("images get inline disposition", () => {
    const header = contentDispositionFor("image/jpeg", "photo.jpg");
    assert.ok(header.startsWith("inline"));
    assert.ok(header.includes('filename="photo.jpg"'));
  });

  test("documents get attachment disposition with sanitized filename", () => {
    const header = contentDispositionFor("application/pdf", "../report.pdf");
    assert.ok(header.startsWith("attachment"));
    assert.ok(header.includes('filename="report.pdf"'));
  });

  test("non-ASCII filenames are RFC 5987 encoded with an ASCII fallback", () => {
    const header = contentDispositionFor("application/pdf", "报告.pdf");
    assert.ok(header.includes("filename*=UTF-8''"));
  });

  test("extensionFromFileName returns a dotless lowercase extension or empty", () => {
    assert.equal(extensionFromFileName("a.PDF"), "pdf");
    assert.equal(extensionFromFileName("noext"), "");
    assert.equal(extensionFromFileName(".hidden"), "");
    assert.equal(extensionFromFileName("trailingdot."), "");
  });
});

describe("lightbox index math", () => {
  test("next advances by one within range", () => {
    assert.equal(nextImageIndex(0, 5), 1);
    assert.equal(nextImageIndex(3, 5), 4);
  });

  test("next wraps from the last index back to the first", () => {
    assert.equal(nextImageIndex(4, 5), 0);
    assert.equal(nextImageIndex(9, 10), 0);
  });

  test("prev steps back by one within range", () => {
    assert.equal(prevImageIndex(4, 5), 3);
    assert.equal(prevImageIndex(1, 5), 0);
  });

  test("prev wraps from the first index around to the last", () => {
    assert.equal(prevImageIndex(0, 5), 4);
    assert.equal(prevImageIndex(0, 10), 9);
  });

  test("single-image galleries always resolve to index 0 in both directions", () => {
    assert.equal(nextImageIndex(0, 1), 0);
    assert.equal(prevImageIndex(0, 1), 0);
  });

  test("empty or non-positive lengths resolve to index 0", () => {
    assert.equal(nextImageIndex(0, 0), 0);
    assert.equal(prevImageIndex(0, 0), 0);
    assert.equal(nextImageIndex(2, -3), 0);
  });

  test("out-of-range and non-finite current indices are normalized", () => {
    assert.equal(nextImageIndex(7, 5), 3);
    assert.equal(prevImageIndex(-1, 5), 3);
    assert.equal(nextImageIndex(Number.NaN, 5), 1);
    assert.equal(prevImageIndex(Number.POSITIVE_INFINITY, 5), 4);
  });

  test("a full forward cycle returns to the origin", () => {
    const length = 4;
    let index = 0;
    for (let step = 0; step < length; step += 1) {
      index = nextImageIndex(index, length);
    }
    assert.equal(index, 0);
  });
});

describe("parseRangeHeader", () => {
  const size = 1000;

  test("no header returns full (200)", () => {
    assert.deepEqual(parseRangeHeader(null, size), { kind: "full" });
    assert.deepEqual(parseRangeHeader(undefined, size), { kind: "full" });
  });

  test("bytes=0-499 returns that partial slice", () => {
    assert.deepEqual(parseRangeHeader("bytes=0-499", size), {
      kind: "partial",
      start: 0,
      end: 499,
      length: 500
    });
  });

  test("bytes=500- reads to the end of the resource", () => {
    assert.deepEqual(parseRangeHeader("bytes=500-", size), {
      kind: "partial",
      start: 500,
      end: 999,
      length: 500
    });
  });

  test("an end past the resource is clamped to size-1", () => {
    assert.deepEqual(parseRangeHeader("bytes=0-100000", size), {
      kind: "partial",
      start: 0,
      end: 999,
      length: 1000
    });
  });

  test("a suffix range returns the last N bytes", () => {
    assert.deepEqual(parseRangeHeader("bytes=-200", size), {
      kind: "partial",
      start: 800,
      end: 999,
      length: 200
    });
  });

  test("a suffix larger than the resource clamps the start to 0", () => {
    assert.deepEqual(parseRangeHeader("bytes=-5000", size), {
      kind: "partial",
      start: 0,
      end: 999,
      length: 1000
    });
  });

  test("invalid, non-bytes, or multi-range headers fall back to full (200)", () => {
    for (const header of [
      "bytes=abc-def",
      "items=0-499",
      "bytes=0-499,600-799",
      "bytes=-",
      "0-499",
      "bytes=",
      "bytes=10-5"
    ]) {
      assert.deepEqual(parseRangeHeader(header, size), { kind: "full" }, header);
    }
  });

  test("a start beyond the resource is unsatisfiable (416)", () => {
    assert.deepEqual(parseRangeHeader("bytes=1000-1500", size), { kind: "unsatisfiable" });
    assert.deepEqual(parseRangeHeader("bytes=2000-", size), { kind: "unsatisfiable" });
  });

  test("a zero or negative resource size is always full", () => {
    assert.deepEqual(parseRangeHeader("bytes=0-10", 0), { kind: "full" });
  });
});

describe("extensionBadge", () => {
  test("maps known extensions case-insensitively to an uppercase label", () => {
    assert.equal(extensionBadge("model.stp"), "STEP");
    assert.equal(extensionBadge("MODEL.STEP"), "STEP");
    assert.equal(extensionBadge("frame.igs"), "IGS");
    assert.equal(extensionBadge("frame.IGES"), "IGS");
    assert.equal(extensionBadge("plate.dwg"), "DWG");
    assert.equal(extensionBadge("plate.DXF"), "DXF");
    assert.equal(extensionBadge("report.pdf"), "PDF");
    assert.equal(extensionBadge("data.xlsx"), "XLSX");
    assert.equal(extensionBadge("memo.docx"), "DOCX");
    assert.equal(extensionBadge("deck.pptx"), "PPTX");
    assert.equal(extensionBadge("bundle.zip"), "ZIP");
    assert.equal(extensionBadge("clip.mp4"), "MP4");
    assert.equal(extensionBadge("clip.MOV"), "MOV");
  });

  test("returns FILE when there is no extension", () => {
    assert.equal(extensionBadge("noext"), "FILE");
    assert.equal(extensionBadge(".hidden"), "FILE");
    assert.equal(extensionBadge("trailingdot."), "FILE");
  });
});

describe("defaultVisibilityForFileType", () => {
  test("CAD and video default to TECHNICAL", () => {
    assert.equal(defaultVisibilityForFileType("DRAWING"), "TECHNICAL");
    assert.equal(defaultVisibilityForFileType("DESIGN_CHANGE"), "TECHNICAL");
    assert.equal(defaultVisibilityForFileType("VIDEO"), "TECHNICAL");
  });

  test("photos and other types default to INTERNAL", () => {
    assert.equal(defaultVisibilityForFileType("TRIAL_PHOTO"), "INTERNAL");
    assert.equal(defaultVisibilityForFileType("QC_REPORT"), "INTERNAL");
    assert.equal(defaultVisibilityForFileType("CUSTOMER_REPORT_PDF"), "INTERNAL");
    assert.equal(defaultVisibilityForFileType("OTHER"), "INTERNAL");
  });

  test("CUSTOMER_SAFE is never a default", () => {
    for (const fileType of [
      "TRIAL_PHOTO",
      "QC_REPORT",
      "PROCESS_SHEET_PDF",
      "CUSTOMER_REPORT_PDF",
      "DESIGN_CHANGE",
      "DRAWING",
      "VIDEO",
      "OTHER"
    ] as const) {
      assert.notEqual(defaultVisibilityForFileType(fileType), "CUSTOMER_SAFE");
    }
  });
});

describe("isVideoContentType", () => {
  test("true for video/* content types", () => {
    assert.equal(isVideoContentType("video/mp4"), true);
    assert.equal(isVideoContentType("video/quicktime"), true);
    assert.equal(isVideoContentType("video/mp4; codecs=avc1"), true);
  });

  test("false for non-video content types", () => {
    assert.equal(isVideoContentType("image/png"), false);
    assert.equal(isVideoContentType("application/pdf"), false);
    assert.equal(isVideoContentType(""), false);
  });
});
