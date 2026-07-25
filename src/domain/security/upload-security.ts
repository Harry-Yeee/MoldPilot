import path from "node:path";

export const MAX_ZIP_ENTRY_COUNT = 2_000;
export const MAX_ZIP_PATH_DEPTH = 16;
export const MAX_ZIP_EXPANDED_BYTES = 512 * 1024 * 1024;
export const MAX_ZIP_COMPRESSION_RATIO = 100;
export const UPLOAD_TIMEOUT_MS = 5 * 60 * 1000;
export const MAX_CONCURRENT_UPLOADS_PER_USER = 2;

const dangerousInnerExtensions = new Set([
  "app",
  "bat",
  "cmd",
  "com",
  "cpl",
  "dll",
  "dmg",
  "exe",
  "hta",
  "html",
  "jar",
  "js",
  "jse",
  "lnk",
  "msi",
  "msp",
  "ps1",
  "scr",
  "sh",
  "url",
  "vbe",
  "vbs",
  "wsf"
]);

const nestedArchiveExtensions = new Set([
  "7z",
  "bz2",
  "cab",
  "gz",
  "iso",
  "rar",
  "tar",
  "tgz",
  "xz",
  "zip"
]);

const zipContainerExtensions = new Set(["docx", "pptx", "xlsx", "zip"]);
const oleContainerExtensions = new Set(["ppt", "xls"]);

export type FileSignatureInput = {
  fileName: string;
  extension: string;
  detectedExtension: string | null;
  prefix: Uint8Array;
};

export type UploadSecurityResult =
  | { ok: true }
  | { ok: false; message: string };

export type UploadByteCountResult =
  | { ok: true; sizeBytes: number }
  | { ok: false; message: string };

export function countNextUploadChunk(
  currentBytes: number,
  chunkBytes: number,
  maxBytes: number
): UploadByteCountResult {
  if (
    !Number.isSafeInteger(currentBytes) ||
    currentBytes < 0 ||
    !Number.isSafeInteger(chunkBytes) ||
    chunkBytes < 0 ||
    !Number.isSafeInteger(maxBytes) ||
    maxBytes <= 0
  ) {
    return { ok: false, message: "Upload size is invalid." };
  }
  const sizeBytes = currentBytes + chunkBytes;
  if (!Number.isSafeInteger(sizeBytes) || sizeBytes > maxBytes) {
    return { ok: false, message: "Upload exceeds the permitted size." };
  }
  return { ok: true, sizeBytes };
}

export type MalwareScanStatus = "clean" | "infected" | "unavailable" | "error";

export function scannerAllowsRelease(status: MalwareScanStatus): boolean {
  return status === "clean";
}

export function shouldRetainQuarantineForScanStatus(status: MalwareScanStatus): boolean {
  return status === "unavailable" || status === "error";
}

function asciiPrefix(prefix: Uint8Array): string {
  return Buffer.from(prefix).toString("latin1");
}

function startsWithBytes(prefix: Uint8Array, expected: readonly number[]): boolean {
  return expected.every((value, index) => prefix[index] === value);
}

export function hasSuspiciousDoubleExtension(fileName: string): boolean {
  const base = path.basename(fileName).toLowerCase();
  const parts = base.split(".").filter((part) => part.length > 0);
  if (parts.length < 3) {
    return false;
  }

  return parts.slice(0, -1).some((part) => dangerousInnerExtensions.has(part));
}

function detectedExtensionMatches(extension: string, detectedExtension: string | null): boolean {
  if (detectedExtension == null) {
    return false;
  }

  const acceptedByExtension: Record<string, readonly string[]> = {
    docx: ["docx", "zip"],
    heic: ["heic", "heif"],
    jpg: ["jpg"],
    mov: ["mov", "mp4"],
    mp4: ["mp4", "m4v"],
    ppt: ["cfb"],
    pptx: ["pptx", "zip"],
    xls: ["cfb"],
    xlsx: ["xlsx", "zip"],
    zip: ["zip"]
  };

  return (acceptedByExtension[extension] ?? [extension]).includes(detectedExtension);
}

function looksLikeText(prefix: Uint8Array): boolean {
  if (prefix.length === 0 || prefix.includes(0)) {
    return false;
  }

  let printable = 0;
  for (const byte of prefix) {
    if (byte === 9 || byte === 10 || byte === 13 || (byte >= 32 && byte <= 126) || byte >= 128) {
      printable += 1;
    }
  }
  return printable / prefix.length >= 0.9;
}

function customSignatureMatches(extension: string, prefix: Uint8Array): boolean {
  const ascii = asciiPrefix(prefix);
  const trimmed = ascii.replace(/^\uFEFF/, "").trimStart();

  switch (extension) {
    case "csv":
      return looksLikeText(prefix);
    case "dwg":
      return /^AC10\d{2}/.test(ascii);
    case "dxf":
      return (
        ascii.startsWith("AutoCAD Binary DXF") ||
        /^\s*0\s*(?:\r?\n)+\s*SECTION\b/i.test(ascii)
      );
    case "igs":
      return looksLikeText(prefix) && (ascii[72] === "S" || /\bS\s+\d+\s*$/m.test(ascii));
    case "pdf":
      return ascii.startsWith("%PDF-");
    case "stp":
      return trimmed.startsWith("ISO-10303-21;");
    default:
      return false;
  }
}

export function validateDetectedFileSignature(
  input: FileSignatureInput
): UploadSecurityResult {
  if (hasSuspiciousDoubleExtension(input.fileName)) {
    return { ok: false, message: "Filename contains a blocked executable double extension." };
  }

  if (zipContainerExtensions.has(input.extension)) {
    const zipHeader =
      startsWithBytes(input.prefix, [0x50, 0x4b, 0x03, 0x04]) ||
      startsWithBytes(input.prefix, [0x50, 0x4b, 0x05, 0x06]) ||
      startsWithBytes(input.prefix, [0x50, 0x4b, 0x07, 0x08]);
    if (!zipHeader || !detectedExtensionMatches(input.extension, input.detectedExtension)) {
      return { ok: false, message: "File content does not match its ZIP/Office extension." };
    }
    return { ok: true };
  }

  if (oleContainerExtensions.has(input.extension)) {
    const isOle = startsWithBytes(input.prefix, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
    return isOle && detectedExtensionMatches(input.extension, input.detectedExtension)
      ? { ok: true }
      : { ok: false, message: "File content does not match its legacy Office extension." };
  }

  if (["csv", "dwg", "dxf", "igs", "pdf", "stp"].includes(input.extension)) {
    return customSignatureMatches(input.extension, input.prefix)
      ? { ok: true }
      : { ok: false, message: "File signature does not match its extension." };
  }

  return detectedExtensionMatches(input.extension, input.detectedExtension)
    ? { ok: true }
    : { ok: false, message: "Detected file content does not match its extension." };
}

export type ZipEntryMetadata = {
  fileName: string;
  compressedSize: number;
  uncompressedSize: number;
  encrypted: boolean;
  symbolicLink: boolean;
};

export function validateZipEntry(entry: ZipEntryMetadata): UploadSecurityResult {
  const normalized = entry.fileName.replaceAll("\\", "/");
  const segments = normalized.split("/").filter((segment) => segment.length > 0);

  if (
    normalized.startsWith("/") ||
    /^[a-z]:\//i.test(normalized) ||
    segments.some((segment) => segment === "..")
  ) {
    return { ok: false, message: "Archive contains an unsafe path." };
  }
  if (segments.length > MAX_ZIP_PATH_DEPTH) {
    return { ok: false, message: "Archive path nesting is too deep." };
  }
  if (entry.encrypted) {
    return { ok: false, message: "Encrypted archives cannot be scanned." };
  }
  if (entry.symbolicLink) {
    return { ok: false, message: "Archive symbolic links are not allowed." };
  }

  const extension = path.posix.extname(normalized).slice(1).toLowerCase();
  if (nestedArchiveExtensions.has(extension)) {
    return { ok: false, message: "Nested archives are not allowed." };
  }

  if (
    entry.uncompressedSize > 1024 * 1024 &&
    (entry.compressedSize <= 0 ||
      entry.uncompressedSize / entry.compressedSize > MAX_ZIP_COMPRESSION_RATIO)
  ) {
    return { ok: false, message: "Archive entry has an unsafe compression ratio." };
  }

  return { ok: true };
}

export function validateZipManifest(
  outerExtension: string,
  entries: readonly ZipEntryMetadata[]
): UploadSecurityResult {
  if (entries.length > MAX_ZIP_ENTRY_COUNT) {
    return { ok: false, message: "Archive contains too many entries." };
  }

  let expandedBytes = 0;
  for (const entry of entries) {
    const result = validateZipEntry(entry);
    if (!result.ok) {
      return result;
    }
    expandedBytes += entry.uncompressedSize;
    if (expandedBytes > MAX_ZIP_EXPANDED_BYTES) {
      return { ok: false, message: "Archive expands beyond the safe limit." };
    }
  }

  const names = entries.map((entry) => entry.fileName.replaceAll("\\", "/").toLowerCase());
  if (names.some((name) => name.endsWith("vbaproject.bin"))) {
    return { ok: false, message: "Macro-enabled Office content is not allowed." };
  }

  const requiredPrefix: Record<string, string | null> = {
    docx: "word/",
    pptx: "ppt/",
    xlsx: "xl/",
    zip: null
  };
  const prefix = requiredPrefix[outerExtension];
  if (
    prefix != null &&
    (!names.includes("[content_types].xml") || !names.some((name) => name.startsWith(prefix)))
  ) {
    return { ok: false, message: "Office package structure does not match its extension." };
  }

  return { ok: true };
}

export type UploadOriginInput = {
  configuredBaseUrl: string | null;
  requestUrl: string;
  originHeader: string | null;
  hostHeader: string | null;
  uploadHeader: string | null;
};

export function validateUploadOrigin(input: UploadOriginInput): UploadSecurityResult {
  if (input.uploadHeader !== "1" || input.originHeader == null) {
    return { ok: false, message: "Upload request origin could not be verified." };
  }

  try {
    const fallbackOrigin = new URL(input.requestUrl).origin;
    const expectedOrigin =
      input.configuredBaseUrl == null || input.configuredBaseUrl.trim().length === 0
        ? fallbackOrigin
        : new URL(input.configuredBaseUrl).origin;
    const expectedHost = new URL(expectedOrigin).host;

    if (new URL(input.originHeader).origin !== expectedOrigin || input.hostHeader !== expectedHost) {
      return { ok: false, message: "Upload request origin is not allowed." };
    }
    return { ok: true };
  } catch {
    return { ok: false, message: "Upload request origin could not be verified." };
  }
}
