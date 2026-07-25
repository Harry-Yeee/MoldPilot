import { open } from "node:fs/promises";
import { fileTypeFromFile } from "file-type";
import yauzl from "yauzl";
import {
  scannerAllowsRelease,
  shouldRetainQuarantineForScanStatus,
  validateDetectedFileSignature,
  validateZipManifest,
  type ZipEntryMetadata
} from "@/domain/security/upload-security";
import {
  validateAttachmentUpload,
  type AttachmentFileType,
  type AttachmentValidationResult
} from "@/domain/mold-trial/attachments";
import {
  removeQuarantinedAttachment,
  writeBufferToQuarantine
} from "@/server/attachment-storage";
import { scanQuarantinedFile } from "@/server/malware-scanner";

export type SecureUploadInspection =
  | {
      ok: true;
      validation: Extract<AttachmentValidationResult, { ok: true }>;
      scanner: string;
    }
  | {
      ok: false;
      message: string;
      status: 400 | 422 | 503;
      retainQuarantine?: boolean;
    };

async function readPrefix(filePath: string, length = 8192): Promise<Uint8Array> {
  const handle = await open(filePath, "r");
  try {
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await handle.read(buffer, 0, length, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

function isSymbolicLink(externalFileAttributes: number): boolean {
  const unixMode = (externalFileAttributes >>> 16) & 0xffff;
  return (unixMode & 0xf000) === 0xa000;
}

async function zipEntries(filePath: string): Promise<ZipEntryMetadata[]> {
  return new Promise((resolve, reject) => {
    yauzl.open(
      filePath,
      { autoClose: true, decodeStrings: true, lazyEntries: true, validateEntrySizes: true },
      (openError, zipFile) => {
        if (openError != null || zipFile == null) {
          reject(openError ?? new Error("Archive could not be opened."));
          return;
        }

        const entries: ZipEntryMetadata[] = [];
        zipFile.on("error", reject);
        zipFile.on("entry", (entry) => {
          entries.push({
            fileName: entry.fileName,
            compressedSize: entry.compressedSize,
            uncompressedSize: entry.uncompressedSize,
            encrypted: (entry.generalPurposeBitFlag & 0x1) !== 0,
            symbolicLink: isSymbolicLink(entry.externalFileAttributes)
          });
          zipFile.readEntry();
        });
        zipFile.on("end", () => resolve(entries));
        zipFile.readEntry();
      }
    );
  });
}

export async function inspectAndScanQuarantinedAttachment(input: {
  quarantinePath: string;
  fileType: AttachmentFileType;
  declaredContentType: string;
  fileName: string;
  sizeBytes: number;
}): Promise<SecureUploadInspection> {
  const validation = validateAttachmentUpload({
    fileType: input.fileType,
    declaredContentType: input.declaredContentType,
    fileName: input.fileName,
    sizeBytes: input.sizeBytes
  });
  if (!validation.ok) {
    return {
      ok: false,
      message: validation.issues[0]?.message ?? "File metadata is not allowed.",
      status: 400
    };
  }

  const [detected, prefix] = await Promise.all([
    fileTypeFromFile(input.quarantinePath).catch(() => undefined),
    readPrefix(input.quarantinePath)
  ]);
  const signature = validateDetectedFileSignature({
    fileName: validation.safeFileName,
    extension: validation.extension,
    detectedExtension: detected?.ext ?? null,
    prefix
  });
  if (!signature.ok) {
    return { ok: false, message: signature.message, status: 422 };
  }

  if (["docx", "pptx", "xlsx", "zip"].includes(validation.extension)) {
    try {
      const manifest = validateZipManifest(
        validation.extension,
        await zipEntries(input.quarantinePath)
      );
      if (!manifest.ok) {
        return { ok: false, message: manifest.message, status: 422 };
      }
    } catch {
      return { ok: false, message: "Archive structure could not be safely inspected.", status: 422 };
    }
  }

  const scan = await scanQuarantinedFile(input.quarantinePath);
  console.info(
    JSON.stringify({
      event: "attachment_scan",
      scanner: scan.scanner,
      status: scan.status,
      sizeBytes: input.sizeBytes,
      fileType: input.fileType
    })
  );
  if (!scannerAllowsRelease(scan.status)) {
    return {
      ok: false,
      message:
        scan.status === "infected"
          ? "The file was rejected by the malware scanner."
          : "File scanning is temporarily unavailable. The upload was not stored.",
      status: scan.status === "infected" ? 422 : 503,
      retainQuarantine: shouldRetainQuarantineForScanStatus(scan.status)
    };
  }

  return { ok: true, validation, scanner: scan.scanner ?? "unknown" };
}

export async function quarantineAndInspectBuffer(input: {
  id: string;
  data: Buffer | Uint8Array;
  fileType: AttachmentFileType;
  declaredContentType: string;
  fileName: string;
}): Promise<
  | {
      ok: true;
      quarantinePath: string;
      sizeBytes: number;
      validation: Extract<AttachmentValidationResult, { ok: true }>;
    }
  | { ok: false; message: string }
> {
  const staged = await writeBufferToQuarantine({ id: input.id, data: input.data });
  const inspected = await inspectAndScanQuarantinedAttachment({
    quarantinePath: staged.absolutePath,
    fileType: input.fileType,
    declaredContentType: input.declaredContentType,
    fileName: input.fileName,
    sizeBytes: staged.sizeBytes
  });
  if (!inspected.ok) {
    if (!inspected.retainQuarantine) {
      await removeQuarantinedAttachment(staged.absolutePath);
    }
    return { ok: false, message: inspected.message };
  }
  return {
    ok: true,
    quarantinePath: staged.absolutePath,
    sizeBytes: staged.sizeBytes,
    validation: inspected.validation
  };
}
