import { createReadStream, type ReadStream } from "node:fs";
import { mkdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { buildStorageKey, resolveStoragePath } from "@/domain/mold-trial/attachments";

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
  return path.isAbsolute(root) ? root : path.resolve(process.cwd(), root);
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

  await mkdir(path.dirname(absolutePath), { recursive: true });
  const buffer = Buffer.isBuffer(input.data) ? input.data : Buffer.from(input.data);
  await writeFile(absolutePath, buffer);

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
