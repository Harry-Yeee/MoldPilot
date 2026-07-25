import { constants, createReadStream, type ReadStream } from "node:fs";
import {
  chmod,
  copyFile,
  mkdir,
  open,
  readdir,
  stat,
  unlink,
  writeFile
} from "node:fs/promises";
import path from "node:path";
import { buildStorageKey, resolveStoragePath } from "@/domain/mold-trial/attachments";
import {
  countNextUploadChunk,
  UPLOAD_TIMEOUT_MS
} from "@/domain/security/upload-security";

/**
 * On-disk storage for file attachments. Single-Mac, LAN-only deployment: files
 * live under a local directory keyed by `MOLDPILOT_STORAGE_DIR` (default
 * `./storage/uploads` relative to the project root). The pure key/path logic
 * lives in `@/domain/mold-trial/attachments` so it can be unit-tested; this
 * module is the thin filesystem wrapper.
 */

export function attachmentStorageRoot(): string {
  const configured = process.env.MOLDPILOT_STORAGE_DIR;
  const root = configured != null && configured.trim().length > 0 ? configured : path.join("storage", "uploads");
  return path.isAbsolute(root)
    ? root
    : path.resolve(/* turbopackIgnore: true */ process.cwd(), root);
}

export function attachmentQuarantineRoot(): string {
  const configured = process.env.MOLDPILOT_QUARANTINE_DIR;
  if (configured != null && configured.trim().length > 0) {
    return path.isAbsolute(configured)
      ? configured
      : path.resolve(/* turbopackIgnore: true */ process.cwd(), configured);
  }
  return path.resolve(attachmentStorageRoot(), "..", "quarantine");
}

async function ensurePrivateDirectory(directory: string): Promise<void> {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await chmod(directory, 0o700);
}

function quarantinePath(id: string): string {
  const safeId = id.replace(/[^a-zA-Z0-9-]/g, "");
  if (safeId.length === 0) {
    throw new Error("Invalid quarantine identifier.");
  }
  return path.join(attachmentQuarantineRoot(), `${safeId}.upload`);
}

export async function writeBufferToQuarantine(input: {
  id: string;
  data: Buffer | Uint8Array;
}): Promise<{ absolutePath: string; sizeBytes: number }> {
  const root = attachmentQuarantineRoot();
  await ensurePrivateDirectory(root);
  const absolutePath = quarantinePath(input.id);
  const buffer = Buffer.isBuffer(input.data) ? input.data : Buffer.from(input.data);
  await writeFile(absolutePath, buffer, { flag: "wx", mode: 0o600 });
  return { absolutePath, sizeBytes: buffer.byteLength };
}

export async function streamBodyToQuarantine(input: {
  id: string;
  body: ReadableStream<Uint8Array> | null;
  maxBytes: number;
  timeoutMs?: number;
}): Promise<{ absolutePath: string; sizeBytes: number }> {
  if (input.body == null) {
    throw new Error("Upload body is missing.");
  }

  const root = attachmentQuarantineRoot();
  await ensurePrivateDirectory(root);
  const absolutePath = quarantinePath(input.id);
  const handle = await open(absolutePath, "wx", 0o600);
  const reader = input.body.getReader();
  const timeoutMs = input.timeoutMs ?? UPLOAD_TIMEOUT_MS;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let sizeBytes = 0;

  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => reject(new Error("Upload timed out.")), timeoutMs);
  });

  try {
    while (true) {
      const next = await Promise.race([reader.read(), timeoutPromise]);
      if (next.done) {
        break;
      }
      const counted = countNextUploadChunk(sizeBytes, next.value.byteLength, input.maxBytes);
      if (!counted.ok) {
        throw new Error(counted.message);
      }
      sizeBytes = counted.sizeBytes;
      let offset = 0;
      while (offset < next.value.byteLength) {
        const written = await handle.write(
          next.value,
          offset,
          next.value.byteLength - offset
        );
        if (written.bytesWritten <= 0) {
          throw new Error("Upload could not be written.");
        }
        offset += written.bytesWritten;
      }
    }
    await handle.sync();
    return { absolutePath, sizeBytes };
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    await handle.close().catch(() => undefined);
    await unlink(absolutePath).catch(() => undefined);
    throw error;
  } finally {
    if (timeout != null) {
      clearTimeout(timeout);
    }
    await handle.close().catch(() => undefined);
  }
}

export async function releaseQuarantinedAttachment(input: {
  quarantinePath: string;
  id: string;
  extension: string;
}): Promise<{ storageKey: string; sizeBytes: number }> {
  const storageKey = buildStorageKey(input.id, input.extension);
  const absolutePath = resolveStoragePath(attachmentStorageRoot(), storageKey);
  if (absolutePath == null) {
    throw new Error("Refusing to release attachment outside the storage root.");
  }

  await ensurePrivateDirectory(path.dirname(absolutePath));
  await copyFile(input.quarantinePath, absolutePath, constants.COPYFILE_EXCL);
  await chmod(absolutePath, 0o600);
  const released = await stat(absolutePath);
  await unlink(input.quarantinePath);
  return { storageKey, sizeBytes: released.size };
}

export async function removeQuarantinedAttachment(absolutePath: string): Promise<void> {
  const root = attachmentQuarantineRoot();
  const resolved = path.resolve(absolutePath);
  const relative = path.relative(root, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative) || relative.length === 0) {
    return;
  }
  await unlink(resolved).catch(() => undefined);
}

export async function removeStoredAttachment(storageKey: string): Promise<void> {
  const absolutePath = resolveAttachmentPath(storageKey);
  if (absolutePath != null) {
    await unlink(absolutePath).catch(() => undefined);
  }
}

export async function cleanupAbandonedQuarantineFiles(
  olderThan = new Date(Date.now() - 24 * 60 * 60 * 1000)
): Promise<number> {
  const root = attachmentQuarantineRoot();
  let names: string[];
  try {
    names = await readdir(root);
  } catch {
    return 0;
  }

  let removed = 0;
  for (const name of names) {
    if (!name.endsWith(".upload")) {
      continue;
    }
    const absolutePath = path.join(root, name);
    const details = await stat(absolutePath).catch(() => null);
    if (details?.isFile() && details.mtime < olderThan) {
      await unlink(absolutePath).catch(() => undefined);
      removed += 1;
    }
  }
  return removed;
}

/**
 * Persist bytes for a new attachment. Generates the storage key from a
 * server-supplied id + validated extension (never the client filename), creates
 * the shard directory, and writes the file. Returns the stored key + size.
 */
export async function writeAttachmentFile(input: {
  id: string;
  extension: string;
  data: Buffer | Uint8Array;
}): Promise<{ storageKey: string; sizeBytes: number }> {
  const storageKey = buildStorageKey(input.id, input.extension);
  const absolutePath = resolveStoragePath(attachmentStorageRoot(), storageKey);

  if (absolutePath == null) {
    throw new Error("Refusing to write attachment outside the storage root.");
  }

  await ensurePrivateDirectory(path.dirname(absolutePath));
  const buffer = Buffer.isBuffer(input.data) ? input.data : Buffer.from(input.data);
  await writeFile(absolutePath, buffer, { flag: "wx", mode: 0o600 });

  return { storageKey, sizeBytes: buffer.byteLength };
}

/**
 * Resolve a stored key to an absolute path, verifying it stays inside the root.
 * Returns null when the key would escape the root (traversal guard).
 */
export function resolveAttachmentPath(storageKey: string): string | null {
  return resolveStoragePath(attachmentStorageRoot(), storageKey);
}

/**
 * Open a read stream for a stored attachment. Throws when the key escapes the
 * root or the file is missing/not a regular file. Pass a `range` (inclusive
 * byte bounds) to stream only that slice — used for HTTP Range / 206 responses
 * so `<video>` seeking works. Returns the total file size regardless of range.
 */
export async function openAttachmentStream(
  storageKey: string,
  range?: { start: number; end: number }
): Promise<{ stream: ReadStream; sizeBytes: number }> {
  const absolutePath = resolveAttachmentPath(storageKey);

  if (absolutePath == null) {
    throw new Error("Attachment path is outside the storage root.");
  }

  const stats = await stat(absolutePath);
  if (!stats.isFile()) {
    throw new Error("Attachment is not a regular file.");
  }

  const stream =
    range == null
      ? createReadStream(absolutePath)
      : createReadStream(absolutePath, { start: range.start, end: range.end });

  return { stream, sizeBytes: stats.size };
}
