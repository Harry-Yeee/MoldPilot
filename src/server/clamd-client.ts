import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Socket } from "node:net";
import {
  CLAMD_INSTREAM_COMMAND,
  CLAMD_INSTREAM_TERMINATOR,
  CLAMD_MAX_RESPONSE_BYTES,
  CLAMD_PING_COMMAND,
  createClamdChunkHeader,
  parseClamdPingResponse,
  parseClamdScanResponse,
  writeWithBackpressure,
  type BackpressureWriter
} from "../domain/security/clamd-protocol.ts";
import {
  CLAMD_STREAM_CHUNK_BYTES,
  type ClamdConfiguration,
  type MalwareScanResult
} from "../domain/security/scanner-config.ts";

class ClamdUnavailableError extends Error {}
class ClamdProtocolError extends Error {}

function socketWriter(socket: Socket): BackpressureWriter {
  return socket as unknown as BackpressureWriter;
}

type ClamdLifecycleState =
  | "active"
  | "response-complete"
  | "closing"
  | "closed";

export class ClamdSocketLifecycle {
  readonly socket: Socket;
  private state: ClamdLifecycleState = "active";
  private failure: ClamdUnavailableError | null = null;
  private readonly failureWaiters = new Set<
    (error: ClamdUnavailableError) => void
  >();
  private listenersRemoved = false;

  constructor(socket: Socket) {
    this.socket = socket;
    socket.on("error", this.onError);
    socket.on("end", this.onEnd);
    socket.on("close", this.onClose);
  }

  private readonly onError = (): void => {
    this.recordFailure("Clamd transport failed.");
    this.beginClose();
  };

  private readonly onEnd = (): void => {
    if (this.state === "active") {
      this.recordFailure("Clamd disconnected before completing the response.");
      this.beginClose();
    }
  };

  private readonly onClose = (): void => {
    if (this.state === "active") {
      this.recordFailure("Clamd connection closed before completing the response.");
    }
    this.state = "closed";
    this.removeLifecycleListeners();
  };

  private recordFailure(message: string): ClamdUnavailableError {
    if (this.failure == null) {
      this.failure = new ClamdUnavailableError(message);
      for (const waiter of [...this.failureWaiters]) {
        waiter(this.failure);
      }
      this.failureWaiters.clear();
    }
    return this.failure;
  }

  private beginClose(): void {
    if (this.state === "closing" || this.state === "closed") {
      return;
    }
    this.state = "closing";
    this.socket.destroy();
  }

  private removeLifecycleListeners(): void {
    if (this.listenersRemoved) {
      return;
    }
    this.listenersRemoved = true;
    this.socket.off("error", this.onError);
    this.socket.off("end", this.onEnd);
    this.socket.off("close", this.onClose);
  }

  async run<T>(operation: () => Promise<T>): Promise<T> {
    if (this.failure != null) {
      throw this.failure;
    }
    if (this.state === "closing" || this.state === "closed") {
      throw new ClamdUnavailableError("Clamd transport is unavailable.");
    }

    return new Promise<T>((resolve, reject) => {
      let settled = false;
      const cleanup = (): void => {
        this.failureWaiters.delete(onFailure);
      };
      const succeed = (value: T): void => {
        if (settled) {
          return;
        }
        settled = true;
        cleanup();
        resolve(value);
      };
      const fail = (error: unknown): void => {
        if (settled) {
          return;
        }
        settled = true;
        cleanup();
        reject(error);
      };
      const onFailure = (error: ClamdUnavailableError): void => fail(error);

      this.failureWaiters.add(onFailure);
      if (this.failure != null) {
        onFailure(this.failure);
        return;
      }

      try {
        operation().then(succeed, fail);
      } catch (error) {
        fail(error);
      }
    });
  }

  async write(chunk: Uint8Array): Promise<void> {
    try {
      await this.run(() =>
        writeWithBackpressure(socketWriter(this.socket), chunk)
      );
    } catch (error) {
      if (error instanceof ClamdUnavailableError) {
        throw error;
      }
      const unavailable = this.recordFailure("Clamd transport write failed.");
      this.beginClose();
      throw unavailable;
    }
  }

  markResponseComplete(): void {
    if (this.state === "active" && this.failure == null) {
      this.state = "response-complete";
    }
  }

  abort(message: string): ClamdUnavailableError {
    const unavailable = this.recordFailure(message);
    this.beginClose();
    return unavailable;
  }

  destroy(): void {
    this.beginClose();
  }
}

async function connectClamd(
  configuration: ClamdConfiguration,
  registerTransport?: (transport: ClamdSocketLifecycle) => void
): Promise<ClamdSocketLifecycle> {
  const socket = new Socket();
  const transport = new ClamdSocketLifecycle(socket);
  registerTransport?.(transport);
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let onConnect: (() => void) | undefined;

  try {
    await transport.run(
      () =>
        new Promise<void>((resolve, reject) => {
          onConnect = resolve;
          socket.once("connect", onConnect);
          timeout = setTimeout(
            () =>
              reject(
                new ClamdUnavailableError("Clamd connection timed out.")
              ),
            configuration.connectTimeoutMs
          );
          try {
            socket.connect({
              host: configuration.host,
              port: configuration.port
            });
          } catch {
            reject(new ClamdUnavailableError("Clamd connection failed."));
          }
        })
    );
    return transport;
  } catch (error) {
    transport.destroy();
    throw error instanceof ClamdUnavailableError
      ? error
      : new ClamdUnavailableError("Clamd connection failed.");
  } finally {
    if (timeout != null) {
      clearTimeout(timeout);
    }
    if (onConnect != null) {
      socket.off("connect", onConnect);
    }
  }
}

async function readClamdResponse(
  transport: ClamdSocketLifecycle,
  timeoutMs: number
): Promise<Buffer> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let onData: ((chunk: Buffer) => void) | undefined;

  try {
    return await transport.run(
      () =>
        new Promise<Buffer>((resolve, reject) => {
          const chunks: Buffer[] = [];
          let byteLength = 0;
          let settled = false;

          const finish = (error?: Error, response?: Buffer): void => {
            if (settled) {
              return;
            }
            settled = true;
            if (error != null) {
              reject(error);
            } else {
              resolve(response ?? Buffer.alloc(0));
            }
          };
          onData = (chunk: Buffer): void => {
            byteLength += chunk.byteLength;
            if (byteLength > CLAMD_MAX_RESPONSE_BYTES) {
              finish(new ClamdProtocolError("Clamd response was too large."));
              return;
            }

            chunks.push(chunk);
            const response = Buffer.concat(chunks, byteLength);
            const terminator = response.indexOf(0);
            if (terminator >= 0) {
              if (terminator !== response.byteLength - 1) {
                finish(
                  new ClamdProtocolError(
                    "Clamd response framing was malformed."
                  )
                );
                return;
              }
              transport.markResponseComplete();
              finish(undefined, response);
            }
          };
          timeout = setTimeout(() => {
            finish(new ClamdUnavailableError("Clamd response timed out."));
          }, timeoutMs);

          transport.socket.on("data", onData);
        })
    );
  } finally {
    if (timeout != null) {
      clearTimeout(timeout);
    }
    if (onData != null) {
      transport.socket.off("data", onData);
    }
  }
}

async function withTotalTimeout<T>(
  operation: () => Promise<T>,
  timeoutMs: number,
  cancel: () => void
): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => {
      cancel();
      reject(new ClamdUnavailableError("Clamd operation timed out."));
    }, timeoutMs);
  });

  try {
    return await Promise.race([operation(), timeoutPromise]);
  } finally {
    if (timeout != null) {
      clearTimeout(timeout);
    }
  }
}

export async function pingClamd(
  configuration: ClamdConfiguration
): Promise<void> {
  const resource: { transport: ClamdSocketLifecycle | null } = {
    transport: null
  };
  try {
    await withTotalTimeout(
      async () => {
        const transport = await connectClamd(
          configuration,
          (createdTransport) => {
            resource.transport = createdTransport;
          }
        );
        await transport.run(async () => {
          await transport.write(CLAMD_PING_COMMAND);
          const response = await readClamdResponse(
            transport,
            configuration.healthTimeoutMs
          );
          if (!parseClamdPingResponse(response)) {
            throw new ClamdProtocolError("Clamd PING response was malformed.");
          }
        });
      },
      configuration.healthTimeoutMs,
      () => {
        resource.transport?.abort("Clamd health operation timed out.");
      }
    );
  } finally {
    resource.transport?.destroy();
  }
}

export async function scanFileWithClamd(
  filePath: string,
  configuration: ClamdConfiguration
): Promise<MalwareScanResult> {
  const resources: {
    transport: ClamdSocketLifecycle | null;
    fileStream: ReturnType<typeof createReadStream> | null;
  } = {
    transport: null,
    fileStream: null
  };

  try {
    const details = await stat(filePath);
    if (!details.isFile() || details.size <= 0 || details.size > configuration.maxStreamBytes) {
      throw new ClamdProtocolError("File exceeds the configured clamd stream limit.");
    }

    const parsed = await withTotalTimeout(
      async () => {
        const transport = await connectClamd(
          configuration,
          (createdTransport) => {
            resources.transport = createdTransport;
          }
        );
        return transport.run(async () => {
          await transport.write(CLAMD_INSTREAM_COMMAND);

          resources.fileStream = createReadStream(filePath, {
            highWaterMark: CLAMD_STREAM_CHUNK_BYTES
          });
          let streamedBytes = 0;
          for await (const chunk of resources.fileStream) {
            const bytes = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
            streamedBytes += bytes.byteLength;
            if (streamedBytes > configuration.maxStreamBytes) {
              throw new ClamdProtocolError(
                "File grew beyond the configured stream limit."
              );
            }
            await transport.write(
              createClamdChunkHeader(
                bytes.byteLength,
                CLAMD_STREAM_CHUNK_BYTES
              )
            );
            await transport.write(bytes);
          }

          await transport.write(CLAMD_INSTREAM_TERMINATOR);
          const response = await readClamdResponse(
            transport,
            configuration.responseTimeoutMs
          );
          return parseClamdScanResponse(response);
        });
      },
      configuration.totalScanTimeoutMs,
      () => {
        resources.fileStream?.destroy();
        resources.transport?.abort("Clamd scan operation timed out.");
      }
    );

    if (parsed === "clean") {
      return { status: "clean", scanner: "clamd", detail: "Scan completed." };
    }
    if (parsed === "infected") {
      return {
        status: "infected",
        scanner: "clamd",
        detail: "Scanner rejected the file."
      };
    }
    return {
      status: "error",
      scanner: "clamd",
      detail: "Scanner did not return a usable result."
    };
  } catch (error) {
    return {
      status: error instanceof ClamdUnavailableError ? "unavailable" : "error",
      scanner: "clamd",
      detail:
        error instanceof ClamdUnavailableError
          ? "Scanner is temporarily unavailable."
          : "Scanner did not return a usable result."
    };
  } finally {
    resources.fileStream?.destroy();
    resources.transport?.destroy();
  }
}
