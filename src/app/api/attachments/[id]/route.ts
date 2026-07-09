import { Readable } from "node:stream";
import type { ReadableStream as NodeWebReadableStream } from "node:stream/web";
import {
  canDownloadAttachment,
  contentDispositionFor,
  isVideoContentType,
  parseRangeHeader
} from "@/domain/mold-trial/attachments";
import { prisma } from "@/lib/prisma";
import { openAttachmentStream } from "@/server/attachment-storage";
import { getOptionalCurrentUser } from "@/server/current-user";
import { getEffectivePermissionCodes } from "@/server/permissions";

export const dynamic = "force-dynamic";

function toWebStream(stream: Awaited<ReturnType<typeof openAttachmentStream>>["stream"]): BodyInit {
  return Readable.toWeb(stream) as unknown as NodeWebReadableStream<Uint8Array> as unknown as BodyInit;
}

/**
 * Stream a stored attachment. Auth is required; soft-deleted files 404;
 * visibility is enforced via `canDownloadAttachment`. Images + video stream
 * inline, everything else downloads with a sanitized filename. Video honours the
 * HTTP `Range` header (206 Partial Content + `Accept-Ranges: bytes`) so Safari /
 * iOS can seek inside the inline <video> player. The storage layer verifies the
 * resolved path stays inside the storage root.
 */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const user = await getOptionalCurrentUser({ allowPasswordChangeRequired: true });
  if (user == null) {
    return new Response("Unauthorized", { status: 401 });
  }

  const { id } = await context.params;

  const attachment = await prisma.fileAttachment.findUnique({
    where: { id },
    select: {
      id: true,
      fileName: true,
      storageKey: true,
      contentType: true,
      visibility: true,
      deletedAt: true,
      sizeBytes: true
    }
  });

  // Soft-deleted or missing attachments are indistinguishable to the client.
  if (attachment == null || attachment.deletedAt != null) {
    return new Response("Not found", { status: 404 });
  }

  const permissionCodes = new Set(await getEffectivePermissionCodes(user.id));
  if (!canDownloadAttachment(attachment.visibility, permissionCodes)) {
    return new Response("Forbidden", { status: 403 });
  }

  const isVideo = isVideoContentType(attachment.contentType);
  const contentDisposition = contentDispositionFor(attachment.contentType, attachment.fileName);
  // Only honour Range on video; other types download whole.
  const range = isVideo
    ? parseRangeHeader(request.headers.get("range"), attachment.sizeBytes)
    : { kind: "full" as const };

  if (range.kind === "unsatisfiable") {
    return new Response("Range Not Satisfiable", {
      status: 416,
      headers: {
        "Content-Range": `bytes */${attachment.sizeBytes}`,
        "Accept-Ranges": "bytes"
      }
    });
  }

  let opened: Awaited<ReturnType<typeof openAttachmentStream>>;
  try {
    opened =
      range.kind === "partial"
        ? await openAttachmentStream(attachment.storageKey, { start: range.start, end: range.end })
        : await openAttachmentStream(attachment.storageKey);
  } catch {
    // File row exists but bytes are missing/unreadable on disk.
    return new Response("Not found", { status: 404 });
  }

  if (range.kind === "partial") {
    return new Response(toWebStream(opened.stream), {
      status: 206,
      headers: {
        "Content-Type": attachment.contentType,
        "Content-Length": String(range.length),
        "Content-Range": `bytes ${range.start}-${range.end}/${opened.sizeBytes}`,
        "Accept-Ranges": "bytes",
        "Content-Disposition": contentDisposition,
        "Cache-Control": "private, no-store"
      }
    });
  }

  const headers: Record<string, string> = {
    "Content-Type": attachment.contentType,
    "Content-Length": String(opened.sizeBytes),
    "Content-Disposition": contentDisposition,
    "Cache-Control": "private, no-store"
  };
  // Advertise range support on video so clients know they may seek.
  if (isVideo) {
    headers["Accept-Ranges"] = "bytes";
  }

  return new Response(toWebStream(opened.stream), { status: 200, headers });
}
