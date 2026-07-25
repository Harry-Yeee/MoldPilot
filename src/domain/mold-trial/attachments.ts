/**
 * Pure, unit-testable validation and path logic for file attachments.
 *
 * No Prisma, no filesystem, no Next.js imports — every rule here is a plain
 * function over typed values so the server action, download route, and tests can
 * all share one source of truth. The DB enum shapes (`FileType`,
 * `FileVisibility`) are mirrored as string-literal unions so this module never
 * has to import the generated Prisma client.
 */

import path from "node:path";

/** Prisma `FileType` enum values (DB form). */
export type AttachmentFileType =
  | "TRIAL_PHOTO"
  | "QC_REPORT"
  | "PROCESS_SHEET_PDF"
  | "CUSTOMER_REPORT_PDF"
  | "DESIGN_CHANGE"
  | "DRAWING"
  | "VIDEO"
  | "OTHER";

/** Prisma `FileVisibility` enum values (DB form). */
export type AttachmentVisibility = "INTERNAL" | "TECHNICAL" | "RESTRICTED" | "CUSTOMER_SAFE";

/** File types a user may choose when uploading from the generic uploader. */
export const uploadableFileTypes: readonly AttachmentFileType[] = [
  "TRIAL_PHOTO",
  "QC_REPORT",
  "CUSTOMER_REPORT_PDF",
  "DRAWING",
  "DESIGN_CHANGE",
  "OTHER"
];

/** Visibility levels a user may choose when uploading. */
export const selectableVisibilities: readonly AttachmentVisibility[] = [
  "INTERNAL",
  "TECHNICAL",
  "RESTRICTED",
  "CUSTOMER_SAFE"
];

const MEGABYTE = 1024 * 1024;
export const IMAGE_SIZE_LIMIT_BYTES = 10 * MEGABYTE;
export const DOCUMENT_SIZE_LIMIT_BYTES = 25 * MEGABYTE;
/** CAD/drawing files (STEP/IGES/DWG/DXF/PDF) and video get a large cap. */
export const CAD_SIZE_LIMIT_BYTES = 300 * MEGABYTE;
export const VIDEO_SIZE_LIMIT_BYTES = 300 * MEGABYTE;
/** Catch-all bucket (docs + slides + zip) sits between documents and CAD. */
export const OTHER_SIZE_LIMIT_BYTES = 100 * MEGABYTE;

/** Longest display filename we retain (extension included). */
export const MAX_FILE_NAME_LENGTH = 120;

/**
 * The allowlist. Each entry maps a canonical content type to its safe, dotless
 * extension. Both the declared content type AND the client filename extension
 * are checked against this list; a mismatch between the two is rejected. The
 * client-supplied filename is never used to build a storage path.
 */
type AllowedTypeEntry = {
  contentType: string;
  extension: string;
  /** Alternate content types clients/browsers may send for the same extension. */
  contentTypeAliases?: readonly string[];
  /**
   * Extra extension spellings that resolve to this same entry (e.g. `step` for a
   * `stp` entry, `jpeg` for `jpg`). Used both to accept the alternate extension
   * and to treat it as matching when cross-checking against the content type.
   */
  extensionAliases?: readonly string[];
};

/** Generic content types browsers send for files they don't recognize (CAD). */
const GENERIC_CONTENT_TYPES: readonly string[] = ["application/octet-stream", "application/x-step"];

const imageTypes: readonly AllowedTypeEntry[] = [
  { contentType: "image/jpeg", extension: "jpg", contentTypeAliases: ["image/jpg"], extensionAliases: ["jpeg"] },
  { contentType: "image/png", extension: "png" },
  { contentType: "image/webp", extension: "webp" },
  { contentType: "image/heic", extension: "heic", contentTypeAliases: ["image/heif"] }
];

const pdfType: AllowedTypeEntry = { contentType: "application/pdf", extension: "pdf" };

const officeDocTypes: readonly AllowedTypeEntry[] = [
  {
    contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    extension: "xlsx"
  },
  { contentType: "application/vnd.ms-excel", extension: "xls" },
  {
    contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    extension: "docx"
  },
  { contentType: "text/csv", extension: "csv", contentTypeAliases: ["application/csv"] }
];

const presentationTypes: readonly AllowedTypeEntry[] = [
  {
    contentType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    extension: "pptx"
  },
  { contentType: "application/vnd.ms-powerpoint", extension: "ppt" }
];

const zipType: AllowedTypeEntry = {
  contentType: "application/zip",
  extension: "zip",
  contentTypeAliases: ["application/x-zip-compressed", "application/octet-stream"]
};

/**
 * CAD / drawing formats. Browsers almost never know these MIME types, so each
 * entry lists the (rare) canonical content type plus `application/octet-stream`
 * as an alias; validation for the FileTypes that use these treats an
 * empty/generic declared type as acceptable and matches primarily on extension.
 */
const cadTypes: readonly AllowedTypeEntry[] = [
  { contentType: "model/step", extension: "stp", contentTypeAliases: GENERIC_CONTENT_TYPES, extensionAliases: ["step"] },
  { contentType: "model/iges", extension: "igs", contentTypeAliases: GENERIC_CONTENT_TYPES, extensionAliases: ["iges"] },
  { contentType: "image/vnd.dwg", extension: "dwg", contentTypeAliases: [...GENERIC_CONTENT_TYPES, "application/acad"] },
  { contentType: "image/vnd.dxf", extension: "dxf", contentTypeAliases: [...GENERIC_CONTENT_TYPES, "application/dxf"] },
  { contentType: "application/pdf", extension: "pdf" }
];

const videoTypes: readonly AllowedTypeEntry[] = [
  { contentType: "video/mp4", extension: "mp4" },
  { contentType: "video/quicktime", extension: "mov" }
];

type FileTypeRule = {
  allowed: readonly AllowedTypeEntry[];
  maxSizeBytes: number;
  /**
   * When true, validate primarily by extension: an empty or generic
   * (octet-stream) declared content type is accepted, and the canonical content
   * type is resolved from the matched extension entry. Used for CAD FileTypes
   * where the browser reliably knows only the filename, never the MIME.
   */
  extensionValidated?: boolean;
};

const imageRule: FileTypeRule = { allowed: imageTypes, maxSizeBytes: IMAGE_SIZE_LIMIT_BYTES };
const documentRule: FileTypeRule = {
  allowed: [pdfType, ...officeDocTypes, ...presentationTypes],
  maxSizeBytes: DOCUMENT_SIZE_LIMIT_BYTES
};
const cadRule: FileTypeRule = {
  allowed: cadTypes,
  maxSizeBytes: CAD_SIZE_LIMIT_BYTES,
  extensionValidated: true
};
const videoRule: FileTypeRule = { allowed: videoTypes, maxSizeBytes: VIDEO_SIZE_LIMIT_BYTES };
const otherRule: FileTypeRule = {
  allowed: [pdfType, ...officeDocTypes, ...presentationTypes, zipType],
  maxSizeBytes: OTHER_SIZE_LIMIT_BYTES
};

/**
 * Per-FileType rules.
 * - TRIAL_PHOTO: images (≤10 MB).
 * - QC_REPORT / PROCESS_SHEET_PDF / CUSTOMER_REPORT_PDF: pdf/office/csv/slides (≤25 MB).
 * - DRAWING / DESIGN_CHANGE: native CAD + drawing formats + pdf (≤300 MB), validated by extension.
 * - VIDEO: mp4/mov (≤300 MB).
 * - OTHER: docs + slides + zip (≤100 MB).
 */
const rulesByFileType: Record<AttachmentFileType, FileTypeRule> = {
  TRIAL_PHOTO: imageRule,
  QC_REPORT: documentRule,
  PROCESS_SHEET_PDF: documentRule,
  CUSTOMER_REPORT_PDF: documentRule,
  DESIGN_CHANGE: cadRule,
  DRAWING: cadRule,
  VIDEO: videoRule,
  OTHER: otherRule
};

export function attachmentSizeLimitBytes(fileType: AttachmentFileType): number {
  return rulesByFileType[fileType].maxSizeBytes;
}

export function isImageContentType(contentType: string): boolean {
  const normalized = normalizeContentType(contentType);
  return imageTypes.some(
    (entry) =>
      entry.contentType === normalized || (entry.contentTypeAliases ?? []).includes(normalized)
  );
}

/** True for stored video content types (mp4, quicktime); drives inline + Range. */
export function isVideoContentType(contentType: string): boolean {
  return normalizeContentType(contentType).startsWith("video/");
}

/** Every extension spelling (canonical + aliases) an entry answers to. */
function entryExtensions(entry: AllowedTypeEntry): readonly string[] {
  return [entry.extension, ...(entry.extensionAliases ?? [])];
}

/**
 * Next gallery index with wraparound (last -> first). Shared by the Lightbox
 * viewer so the navigation math lives in one tested place. `length <= 1` always
 * returns 0 (single-image galleries have no meaningful "next"). Out-of-range or
 * non-finite `current` values are normalized into `[0, length)`.
 */
export function nextImageIndex(current: number, length: number): number {
  if (length <= 1) {
    return 0;
  }
  const safeCurrent = Number.isFinite(current) ? Math.trunc(current) : 0;
  return (((safeCurrent + 1) % length) + length) % length;
}

/**
 * Previous gallery index with wraparound (first -> last). Mirror of
 * `nextImageIndex`; see that function for the normalization rules.
 */
export function prevImageIndex(current: number, length: number): number {
  if (length <= 1) {
    return 0;
  }
  const safeCurrent = Number.isFinite(current) ? Math.trunc(current) : 0;
  return (((safeCurrent - 1) % length) + length) % length;
}

function normalizeContentType(raw: string): string {
  // Strip any "; charset=..." parameters and lowercase the media type.
  return raw.split(";")[0]?.trim().toLowerCase() ?? "";
}

function entryForContentType(
  rule: FileTypeRule,
  contentType: string
): AllowedTypeEntry | null {
  return (
    rule.allowed.find(
      (entry) =>
        entry.contentType === contentType || (entry.contentTypeAliases ?? []).includes(contentType)
    ) ?? null
  );
}

/** Match a rule entry by (dotless, lowercased) filename extension. */
function entryForExtension(rule: FileTypeRule, extension: string): AllowedTypeEntry | null {
  if (extension.length === 0) {
    return null;
  }
  return rule.allowed.find((entry) => entryExtensions(entry).includes(extension)) ?? null;
}

/** Extension (dotless, lowercased) parsed from a filename, or "" when none. */
export function extensionFromFileName(fileName: string): string {
  const base = fileName.split(/[\\/]/).pop() ?? fileName;
  const dot = base.lastIndexOf(".");
  if (dot <= 0 || dot === base.length - 1) {
    return "";
  }
  return base.slice(dot + 1).toLowerCase();
}

export type AttachmentValidationIssue = {
  field: "file" | "fileType" | "contentType" | "sizeBytes";
  message: string;
};

export type AttachmentValidationInput = {
  fileType: AttachmentFileType;
  /** Content type the client declared (e.g. from the upload's MIME type). */
  declaredContentType: string;
  /** Original client filename (used only to cross-check the extension). */
  fileName: string;
  sizeBytes: number;
};

export type AttachmentValidationResult =
  | {
      ok: true;
      /** Canonical content type to store (never the raw client value). */
      contentType: string;
      /** Safe dotless extension derived from the validated content type. */
      extension: string;
      /** Sanitized display filename. */
      safeFileName: string;
    }
  | { ok: false; issues: AttachmentValidationIssue[] };

/**
 * Validate an upload against the per-FileType allowlist and size cap.
 *
 * Two matching strategies, chosen per FileType:
 * - MIME-first (images, docs, slides, video): the declared content type must be
 *   on the allowlist for this FileType, and the client filename extension (if
 *   present) must match that content type. This keeps the strict ext↔type
 *   mismatch rejection where the browser reliably knows the MIME.
 * - Extension-first (CAD FileTypes: DRAWING / DESIGN_CHANGE): the filename
 *   extension picks the entry. Browsers send generic (`application/octet-stream`)
 *   or empty content types for CAD, so an empty/generic declared type is accepted
 *   and only a *conflicting* concrete MIME (a real, non-generic type that maps to
 *   a different extension) is rejected.
 *
 * Returns the canonical content type + safe extension to persist. For CAD, the
 * canonical content type comes from the matched extension entry, not the raw
 * (usually octet-stream) client value.
 */
export function validateAttachmentUpload(input: AttachmentValidationInput): AttachmentValidationResult {
  const issues: AttachmentValidationIssue[] = [];
  const rule = rulesByFileType[input.fileType];
  const declared = normalizeContentType(input.declaredContentType);
  const declaredExtension = extensionFromFileName(input.fileName);

  const entry = rule.extensionValidated
    ? resolveExtensionFirst(rule, declared, declaredExtension, issues)
    : resolveMimeFirst(rule, input.declaredContentType, declared, declaredExtension, issues);

  if (!Number.isFinite(input.sizeBytes) || input.sizeBytes <= 0) {
    issues.push({ field: "sizeBytes", message: "File appears to be empty." });
  } else if (input.sizeBytes > rule.maxSizeBytes) {
    issues.push({
      field: "sizeBytes",
      message: `File exceeds the ${Math.round(rule.maxSizeBytes / MEGABYTE)} MB limit for this file type.`
    });
  }

  if (issues.length > 0 || entry == null) {
    return { ok: false, issues };
  }

  return {
    ok: true,
    contentType: entry.contentType,
    extension: entry.extension,
    safeFileName: sanitizeFileName(input.fileName, entry.extension)
  };
}

/** MIME-first matching: declared content type is authoritative. */
function resolveMimeFirst(
  rule: FileTypeRule,
  rawDeclared: string,
  declared: string,
  declaredExtension: string,
  issues: AttachmentValidationIssue[]
): AllowedTypeEntry | null {
  const entry = declared.length === 0 ? null : entryForContentType(rule, declared);

  if (entry == null) {
    issues.push({
      field: "contentType",
      message: `Content type ${rawDeclared || "(none)"} is not allowed for this file type.`
    });
    return null;
  }

  if (declaredExtension.length > 0 && !entryExtensions(entry).includes(declaredExtension)) {
    issues.push({
      field: "file",
      message: `File extension .${declaredExtension} does not match its declared type.`
    });
  }

  return entry;
}

/**
 * Extension-first matching (CAD). The extension picks the entry; a generic or
 * empty declared MIME is fine. A concrete, non-generic declared MIME that maps
 * to a *different* extension is a real conflict and is rejected.
 */
function resolveExtensionFirst(
  rule: FileTypeRule,
  declared: string,
  declaredExtension: string,
  issues: AttachmentValidationIssue[]
): AllowedTypeEntry | null {
  const entry = entryForExtension(rule, declaredExtension);

  if (entry == null) {
    issues.push({
      field: "file",
      message: `File extension .${declaredExtension || "(none)"} is not allowed for this file type.`
    });
    return null;
  }

  const declaredIsGeneric = declared.length === 0 || GENERIC_CONTENT_TYPES.includes(declared);
  const declaredMatchesEntry =
    entry.contentType === declared || (entry.contentTypeAliases ?? []).includes(declared);

  if (!declaredIsGeneric && !declaredMatchesEntry) {
    issues.push({
      field: "contentType",
      message: `Content type ${declared} does not match extension .${declaredExtension}.`
    });
  }

  return entry;
}

/**
 * Sanitize a client filename for safe display and safe use in a
 * Content-Disposition header. Strips directory separators and control
 * characters, collapses whitespace, caps length, and guarantees a non-empty
 * result ending in the validated extension when one is supplied.
 */
export function sanitizeFileName(fileName: string, extension?: string): string {
  const base = (fileName.split(/[\\/]/).pop() ?? "").normalize("NFC");
  // Remove C0 control chars + DEL, then characters unsafe in headers/paths.
  const cleaned = base
    .replace(/[\x00-\x1f\x7f]/g, "")
    .replace(/["\\]/g, "")
    .replace(/\s+/g, " ")
    .trim();

  let safe = cleaned.length === 0 ? "file" : cleaned;

  if (extension != null && extension.length > 0) {
    const currentExtension = extensionFromFileName(safe);
    if (currentExtension !== extension) {
      const withoutExtension = currentExtension.length > 0 ? safe.slice(0, safe.lastIndexOf(".")) : safe;
      const trimmedBase = withoutExtension.trim();
      safe = `${trimmedBase.length === 0 ? "file" : trimmedBase}.${extension}`;
    }
  }

  if (safe.length <= MAX_FILE_NAME_LENGTH) {
    return safe;
  }

  // Cap length while preserving the extension.
  const currentExtension = extensionFromFileName(safe);
  if (currentExtension.length === 0) {
    return safe.slice(0, MAX_FILE_NAME_LENGTH);
  }
  const suffix = `.${currentExtension}`;
  return `${safe.slice(0, MAX_FILE_NAME_LENGTH - suffix.length)}${suffix}`;
}

/**
 * Build the storage key (relative path within the root) from a generated id and
 * a validated extension. The key is server-generated — the client filename is
 * never used — so it cannot contain traversal segments. Files are sharded into a
 * two-char prefix directory to avoid huge flat directories.
 */
export function buildStorageKey(id: string, extension: string): string {
  const safeId = id.replace(/[^a-zA-Z0-9-]/g, "");
  const safeExtension = extension.replace(/[^a-z0-9]/g, "");
  const prefix = safeId.slice(0, 2) || "00";
  const name = safeExtension.length > 0 ? `${safeId}.${safeExtension}` : safeId;
  return path.posix.join("attachments", prefix, name);
}

/**
 * Resolve a storage key to an absolute path and verify it stays inside the root
 * directory. Returns null when the resolved path would escape the root (e.g. a
 * key containing `..`), so callers can reject traversal attempts. Pure: no fs.
 */
export function resolveStoragePath(rootDir: string, storageKey: string): string | null {
  const root = path.resolve(rootDir);
  const resolved = path.resolve(root, storageKey);
  const relative = path.relative(root, resolved);

  if (relative.length === 0) {
    // Resolved to the root directory itself — not a file.
    return null;
  }

  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    return null;
  }

  return resolved;
}

/**
 * Access rule for downloading an attachment. INTERNAL/TECHNICAL/RESTRICTED
 * require `attachment.download.internal`. CUSTOMER_SAFE is additionally allowed
 * with `attachment.download.customer_safe` (Marketing has that one) — anyone who
 * can see internal files can also see customer-safe files.
 */
export function canDownloadAttachment(
  visibility: AttachmentVisibility,
  permissionCodes: ReadonlySet<string> | readonly string[]
): boolean {
  const has = (code: string): boolean =>
    Array.isArray(permissionCodes)
      ? (permissionCodes as readonly string[]).includes(code)
      : (permissionCodes as ReadonlySet<string>).has(code);

  const hasInternal = has("attachment.download.internal");

  if (visibility === "CUSTOMER_SAFE") {
    return hasInternal || has("attachment.download.customer_safe");
  }

  return hasInternal;
}

/**
 * Content-Disposition for a download: images and video render inline (video so
 * the inline <video> player can stream/seek it), everything else downloads as an
 * attachment with the sanitized filename. RFC 5987-encodes the filename so
 * non-ASCII names survive the header safely.
 */
export function contentDispositionFor(contentType: string, fileName: string): string {
  const safe = sanitizeFileName(fileName);
  const asciiFallback = safe.replace(/[^\x20-\x7e]/g, "_");
  const encoded = encodeURIComponent(safe);
  const inline = isImageContentType(contentType) || isVideoContentType(contentType);
  const disposition = inline ? "inline" : "attachment";
  return `${disposition}; filename="${asciiFallback}"; filename*=UTF-8''${encoded}`;
}

/**
 * Parsed result of an HTTP `Range` request header for a resource of `sizeBytes`.
 * - `full`: no/invalid/unsupported range — caller serves the whole body (200).
 * - `partial`: a single satisfiable byte range — caller serves 206 with
 *   `[start, end]` inclusive and `length` bytes.
 * - `unsatisfiable`: a syntactically valid range that starts beyond the resource
 *   — caller serves 416.
 */
export type RangeParseResult =
  | { kind: "full" }
  | { kind: "partial"; start: number; end: number; length: number }
  | { kind: "unsatisfiable" };

/**
 * Parse a single HTTP byte range against a known resource size. Supports exactly
 * the three forms `<video>` needs — `bytes=start-end`, `bytes=start-` (open end,
 * clamped to `size-1`), and `bytes=-suffix` (last N bytes). Anything else
 * (missing header, non-`bytes` unit, multiple comma-separated ranges, or
 * malformed bounds) resolves to `full` so the caller falls back to a normal 200.
 * A start past the end of the resource is `unsatisfiable` (416).
 *
 * Pure: no I/O, so the download route and tests share one implementation.
 */
export function parseRangeHeader(rangeHeader: string | null | undefined, sizeBytes: number): RangeParseResult {
  if (rangeHeader == null || !Number.isFinite(sizeBytes) || sizeBytes <= 0) {
    return { kind: "full" };
  }

  const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim());
  if (match == null) {
    // Missing prefix, wrong unit, or multiple ranges (contains a comma) → 200.
    return { kind: "full" };
  }

  const startText = match[1] ?? "";
  const endText = match[2] ?? "";

  // "bytes=-" with both sides empty is malformed.
  if (startText.length === 0 && endText.length === 0) {
    return { kind: "full" };
  }

  let start: number;
  let end: number;

  if (startText.length === 0) {
    // Suffix range: last `suffix` bytes.
    const suffix = Number.parseInt(endText, 10);
    if (suffix <= 0) {
      return { kind: "full" };
    }
    start = Math.max(0, sizeBytes - suffix);
    end = sizeBytes - 1;
  } else {
    start = Number.parseInt(startText, 10);
    // Open-ended end is clamped to the last byte.
    end = endText.length === 0 ? sizeBytes - 1 : Number.parseInt(endText, 10);
    // Clamp an end that runs past the resource to its last byte.
    if (end > sizeBytes - 1) {
      end = sizeBytes - 1;
    }
  }

  if (start > sizeBytes - 1) {
    return { kind: "unsatisfiable" };
  }

  if (end < start) {
    return { kind: "full" };
  }

  return { kind: "partial", start, end, length: end - start + 1 };
}

/**
 * Short, uppercase extension badge for the file list (e.g. `.stp` → "STEP",
 * `.xlsx` → "XLSX"). Case-insensitive; a filename with no extension yields the
 * generic "FILE". A few extensions are normalized to their common display label
 * (stp→STEP, igs→IGS/IGES pair) so a native CAD file is identifiable at a glance.
 */
export function extensionBadge(fileName: string): string {
  const extension = extensionFromFileName(fileName);
  if (extension.length === 0) {
    return "FILE";
  }
  const label: Record<string, string> = {
    stp: "STEP",
    step: "STEP",
    igs: "IGS",
    iges: "IGS",
    jpeg: "JPG"
  };
  return (label[extension] ?? extension).toUpperCase();
}

/**
 * Default visibility for a freshly-selected FileType. Native CAD and video
 * (DRAWING / DESIGN_CHANGE / VIDEO) default to TECHNICAL to protect IP; every
 * other type keeps the conservative INTERNAL default. CUSTOMER_SAFE is never a
 * default — it must be an explicit user choice.
 */
export function defaultVisibilityForFileType(fileType: AttachmentFileType): AttachmentVisibility {
  if (fileType === "DRAWING" || fileType === "DESIGN_CHANGE" || fileType === "VIDEO") {
    return "TECHNICAL";
  }
  return "INTERNAL";
}
