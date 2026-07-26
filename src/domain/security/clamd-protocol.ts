import { Buffer } from "node:buffer";

export const CLAMD_INSTREAM_COMMAND = Buffer.from("zINSTREAM\0", "ascii");
export const CLAMD_PING_COMMAND = Buffer.from("zPING\0", "ascii");
export const CLAMD_INSTREAM_TERMINATOR = Buffer.alloc(4);
export const CLAMD_MAX_RESPONSE_BYTES = 4_096;

export type ClamdParsedScanResult = "clean" | "infected" | "error";

export type BackpressureWriter = {
  write(chunk: Uint8Array): boolean;
  once(event: "close" | "drain" | "error", listener: (error?: Error) => void): unknown;
  off(event: "close" | "drain" | "error", listener: (error?: Error) => void): unknown;
};

export function createClamdChunkHeader(length: number, maximumChunkBytes: number): Buffer {
  if (
    !Number.isSafeInteger(length) ||
    length < 0 ||
    length > maximumChunkBytes ||
    maximumChunkBytes <= 0 ||
    maximumChunkBytes > 0xffff_ffff
  ) {
    throw new Error("Clamd stream chunk length is invalid.");
  }

  const header = Buffer.alloc(4);
  header.writeUInt32BE(length, 0);
  return header;
}

export function frameClamdChunk(chunk: Uint8Array, maximumChunkBytes: number): Buffer {
  return Buffer.concat([
    createClamdChunkHeader(chunk.byteLength, maximumChunkBytes),
    Buffer.from(chunk)
  ]);
}

export async function writeWithBackpressure(
  writer: BackpressureWriter,
  chunk: Uint8Array
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    let settled = false;

    const cleanup = (): void => {
      writer.off("drain", onDrain);
      writer.off("error", onError);
      writer.off("close", onClose);
    };
    const finish = (error?: Error): void => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      if (error == null) {
        resolve();
      } else {
        reject(error);
      }
    };
    const onDrain = (): void => finish();
    const onError = (error?: Error): void =>
      finish(error ?? new Error("Clamd connection failed."));
    const onClose = (): void => finish(new Error("Clamd connection closed."));

    writer.once("error", onError);
    writer.once("close", onClose);

    try {
      if (writer.write(chunk)) {
        finish();
      } else {
        writer.once("drain", onDrain);
      }
    } catch (error) {
      finish(error instanceof Error ? error : new Error("Clamd write failed."));
    }
  });
}

export function parseClamdPingResponse(response: Uint8Array): boolean {
  return Buffer.from(response).equals(Buffer.from("PONG\0", "ascii"));
}

export function parseClamdScanResponse(response: Uint8Array): ClamdParsedScanResult {
  const bytes = Buffer.from(response);
  if (bytes.equals(Buffer.from("stream: OK\0", "ascii"))) {
    return "clean";
  }

  const text = bytes.toString("utf8");
  if (/^stream: [^\0\r\n]+ FOUND\0$/.test(text)) {
    return "infected";
  }
  return "error";
}
