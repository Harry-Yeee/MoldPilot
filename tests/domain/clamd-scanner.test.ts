import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { EventEmitter, once } from "node:events";
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { createServer, Socket, type Server } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import {
  CLAMD_INSTREAM_COMMAND,
  CLAMD_INSTREAM_TERMINATOR,
  CLAMD_PING_COMMAND,
  createClamdChunkHeader,
  frameClamdChunk,
  parseClamdPingResponse,
  parseClamdScanResponse,
  writeWithBackpressure,
  type BackpressureWriter
} from "../../src/domain/security/clamd-protocol.ts";
import {
  loadClamdConfiguration,
  resolveScannerMode,
  validateContainerScannerEnvironment,
  type ClamdConfiguration
} from "../../src/domain/security/scanner-config.ts";
import {
  ClamdSocketLifecycle,
  pingClamd,
  scanFileWithClamd
} from "../../src/server/clamd-client.ts";
import { scanFileWithLocalCommand } from "../../src/server/local-malware-scanner.ts";

class FakeBackpressureWriter extends EventEmitter implements BackpressureWriter {
  readonly writes: Uint8Array[] = [];

  write(chunk: Uint8Array): boolean {
    this.writes.push(chunk);
    return false;
  }
}

function testConfiguration(port: number, overrides: Partial<ClamdConfiguration> = {}): ClamdConfiguration {
  return {
    host: "127.0.0.1",
    port,
    connectTimeoutMs: 200,
    healthTimeoutMs: 400,
    responseTimeoutMs: 200,
    totalScanTimeoutMs: 1_000,
    maxStreamBytes: 1024 * 1024,
    ...overrides
  };
}

async function listen(server: Server): Promise<number> {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (address == null || typeof address === "string") {
    throw new Error("Fake clamd server did not bind a TCP port.");
  }
  return address.port;
}

async function closeServer(server: Server): Promise<void> {
  server.close();
  await once(server, "close");
}

function respondAfterCompleteInstream(
  socket: Socket,
  response: Buffer,
  captured: Buffer[]
): void {
  let received = Buffer.alloc(0);
  socket.on("data", (chunk: Buffer) => {
    received = Buffer.concat([received, chunk]);
    if (!received.subarray(0, CLAMD_INSTREAM_COMMAND.byteLength).equals(CLAMD_INSTREAM_COMMAND)) {
      return;
    }

    let offset = CLAMD_INSTREAM_COMMAND.byteLength;
    const payloads: Buffer[] = [];
    while (received.byteLength >= offset + 4) {
      const length = received.readUInt32BE(offset);
      if (length === 0) {
        captured.push(...payloads);
        socket.end(response);
        return;
      }
      if (received.byteLength < offset + 4 + length) {
        return;
      }
      payloads.push(received.subarray(offset + 4, offset + 4 + length));
      offset += 4 + length;
    }
  });
}

describe("clamd protocol framing", () => {
  it("uses null-framed commands and four-byte big-endian stream chunks", () => {
    assert.equal(CLAMD_INSTREAM_COMMAND.toString("latin1"), "zINSTREAM\0");
    assert.equal(CLAMD_PING_COMMAND.toString("latin1"), "zPING\0");
    assert.deepEqual([...createClamdChunkHeader(0x0102, 65_536)], [0, 0, 1, 2]);
    assert.deepEqual(
      [...frameClamdChunk(Buffer.from("abc"), 65_536)],
      [0, 0, 0, 3, 97, 98, 99]
    );
    assert.deepEqual([...CLAMD_INSTREAM_TERMINATOR], [0, 0, 0, 0]);
    assert.throws(() => createClamdChunkHeader(65_537, 65_536), /length is invalid/);
    assert.throws(() => createClamdChunkHeader(-1, 65_536), /length is invalid/);
  });

  it("waits for drain when the socket applies backpressure", async () => {
    const writer = new FakeBackpressureWriter();
    let completed = false;
    const pending = writeWithBackpressure(writer, Buffer.from("chunk")).then(() => {
      completed = true;
    });

    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(completed, false);
    assert.equal(writer.writes.length, 1);

    writer.emit("drain");
    await pending;
    assert.equal(completed, true);
  });

  it("accepts only exact clean/PONG responses and maps FOUND to infected", () => {
    assert.equal(parseClamdPingResponse(Buffer.from("PONG\0")), true);
    assert.equal(parseClamdPingResponse(Buffer.from("PONG\n")), false);
    assert.equal(parseClamdScanResponse(Buffer.from("stream: OK\0")), "clean");
    assert.equal(
      parseClamdScanResponse(Buffer.from("stream: Win.Test.EICAR_HDB-1 FOUND\0")),
      "infected"
    );
    assert.equal(parseClamdScanResponse(Buffer.from("stream: OK\n")), "error");
    assert.equal(
      parseClamdScanResponse(Buffer.from("INSTREAM size limit exceeded. ERROR\0")),
      "error"
    );
    assert.equal(parseClamdScanResponse(Buffer.from("stream: OK\0extra")), "error");
  });
});

describe("clamd streaming client", () => {
  it("streams from disk without using a whole-file read", () => {
    const clientSource = readFileSync(
      new URL("../../src/server/clamd-client.ts", import.meta.url),
      "utf8"
    );

    assert.match(clientSource, /createReadStream/);
    assert.match(clientSource, /highWaterMark: CLAMD_STREAM_CHUNK_BYTES/);
    assert.doesNotMatch(clientSource, /\breadFile(?:Sync)?\b/);
    assert.doesNotMatch(
      clientSource,
      /uncaughtException|unhandledRejection/
    );
  });

  it("keeps lifecycle error handling active while no individual write is running", async () => {
    for (const code of ["ECONNRESET", "EPIPE"]) {
      const socket = new Socket();
      const baselineListeners = {
        error: socket.listenerCount("error"),
        end: socket.listenerCount("end"),
        close: socket.listenerCount("close")
      };
      const lifecycle = new ClamdSocketLifecycle(socket);
      const idleOperation = lifecycle.run(
        () => new Promise<void>(() => undefined)
      );

      assert.equal(socket.listenerCount("error"), baselineListeners.error + 1);
      assert.equal(socket.listenerCount("end"), baselineListeners.end + 1);
      assert.equal(socket.listenerCount("close"), baselineListeners.close + 1);

      socket.emit(
        "error",
        Object.assign(new Error("forced transport failure"), { code })
      );
      await assert.rejects(idleOperation, /Clamd transport failed/);

      if (socket.listenerCount("close") > 0) {
        socket.emit("close", true);
      }
      assert.equal(socket.listenerCount("error"), baselineListeners.error);
      assert.equal(socket.listenerCount("end"), baselineListeners.end);
      assert.equal(socket.listenerCount("close"), baselineListeners.close);
      lifecycle.destroy();
    }
  });

  it("keeps lifecycle listeners through response completion until close", () => {
    const socket = new Socket();
    const baselineListeners = {
      error: socket.listenerCount("error"),
      end: socket.listenerCount("end"),
      close: socket.listenerCount("close")
    };
    const lifecycle = new ClamdSocketLifecycle(socket);

    lifecycle.markResponseComplete();
    assert.equal(socket.listenerCount("error"), baselineListeners.error + 1);
    assert.equal(socket.listenerCount("end"), baselineListeners.end + 1);
    assert.equal(socket.listenerCount("close"), baselineListeners.close + 1);

    lifecycle.destroy();
    if (socket.listenerCount("close") > baselineListeners.close) {
      socket.emit("close", false);
    }
    assert.equal(socket.listenerCount("error"), baselineListeners.error);
    assert.equal(socket.listenerCount("end"), baselineListeners.end);
    assert.equal(socket.listenerCount("close"), baselineListeners.close);
  });

  it("streams file chunks and maps an exact clean response to clean", async () => {
    const temporaryRoot = mkdtempSync(path.join(tmpdir(), "moldpilot-clamd-clean-"));
    const filePath = path.join(temporaryRoot, "clean.pdf");
    const contents = Buffer.concat([
      Buffer.from("%PDF-1.7\n"),
      Buffer.alloc(150_000, 0x41)
    ]);
    writeFileSync(filePath, contents);

    const captured: Buffer[] = [];
    const server = createServer((socket) => {
      respondAfterCompleteInstream(socket, Buffer.from("stream: OK\0"), captured);
    });
    const port = await listen(server);

    try {
      const result = await scanFileWithClamd(filePath, testConfiguration(port));
      assert.equal(result.status, "clean");
      assert.equal(result.scanner, "clamd");
      assert.equal(Buffer.concat(captured).equals(contents), true);
      assert.equal(captured.length >= 3, true);
      assert.equal(captured.every((chunk) => chunk.byteLength <= 65_536), true);
    } finally {
      await closeServer(server);
      rmSync(temporaryRoot, { force: true, recursive: true });
    }
  });

  it("maps FOUND to infected without exposing the daemon response", async () => {
    const temporaryRoot = mkdtempSync(path.join(tmpdir(), "moldpilot-clamd-found-"));
    const filePath = path.join(temporaryRoot, "test.csv");
    writeFileSync(filePath, "test");

    const server = createServer((socket) => {
      respondAfterCompleteInstream(
        socket,
        Buffer.from("stream: Win.Test.EICAR_HDB-1 FOUND\0"),
        []
      );
    });
    const port = await listen(server);

    try {
      const result = await scanFileWithClamd(filePath, testConfiguration(port));
      assert.equal(result.status, "infected");
      assert.equal(result.detail, "Scanner rejected the file.");
      assert.doesNotMatch(result.detail, /EICAR|FOUND|stream:/i);
    } finally {
      await closeServer(server);
      rmSync(temporaryRoot, { force: true, recursive: true });
    }
  });

  it("maps a reset immediately after INSTREAM to unavailable", async () => {
    const temporaryRoot = mkdtempSync(
      path.join(tmpdir(), "moldpilot-clamd-instream-reset-")
    );
    const filePath = path.join(temporaryRoot, "test.pdf");
    writeFileSync(filePath, Buffer.concat([
      Buffer.from("%PDF-1.7\n"),
      Buffer.alloc(1024 * 1024, 0x41)
    ]));

    const server = createServer((socket) => {
      let received = Buffer.alloc(0);
      let reset = false;
      socket.on("data", (chunk: Buffer) => {
        if (reset) {
          return;
        }
        received = Buffer.concat([received, chunk]);
        if (received.byteLength < CLAMD_INSTREAM_COMMAND.byteLength) {
          return;
        }
        assert.equal(
          received
            .subarray(0, CLAMD_INSTREAM_COMMAND.byteLength)
            .equals(CLAMD_INSTREAM_COMMAND),
          true
        );
        reset = true;
        socket.resetAndDestroy();
      });
    });
    const port = await listen(server);

    try {
      const result = await scanFileWithClamd(
        filePath,
        testConfiguration(port, { maxStreamBytes: 2 * 1024 * 1024 })
      );
      assert.equal(result.status, "unavailable");
      assert.doesNotMatch(JSON.stringify(result), /ECONNRESET|127\.0\.0\.1/);
    } finally {
      await closeServer(server);
      rmSync(temporaryRoot, { force: true, recursive: true });
    }
  });

  it("maps a reset between streamed chunks to unavailable", async () => {
    const temporaryRoot = mkdtempSync(
      path.join(tmpdir(), "moldpilot-clamd-between-chunks-reset-")
    );
    const filePath = path.join(temporaryRoot, "test.pdf");
    writeFileSync(filePath, Buffer.concat([
      Buffer.from("%PDF-1.7\n"),
      Buffer.alloc(8 * 1024 * 1024, 0x42)
    ]));

    let resetAfterFirstChunk = false;
    const server = createServer((socket) => {
      let received = Buffer.alloc(0);
      socket.on("data", (chunk: Buffer) => {
        if (resetAfterFirstChunk) {
          return;
        }
        received = Buffer.concat([received, chunk]);
        const headerOffset = CLAMD_INSTREAM_COMMAND.byteLength;
        if (received.byteLength < headerOffset + 4) {
          return;
        }
        assert.equal(
          received.subarray(0, headerOffset).equals(CLAMD_INSTREAM_COMMAND),
          true
        );
        const firstChunkLength = received.readUInt32BE(headerOffset);
        if (received.byteLength < headerOffset + 4 + firstChunkLength) {
          return;
        }
        resetAfterFirstChunk = true;
        setImmediate(() => socket.resetAndDestroy());
      });
    });
    const port = await listen(server);

    try {
      const result = await scanFileWithClamd(
        filePath,
        testConfiguration(port, {
          maxStreamBytes: 16 * 1024 * 1024,
          totalScanTimeoutMs: 5_000
        })
      );
      assert.equal(resetAfterFirstChunk, true);
      assert.equal(result.status, "unavailable");
      assert.doesNotMatch(JSON.stringify(result), /ECONNRESET|EPIPE/);
    } finally {
      await closeServer(server);
      rmSync(temporaryRoot, { force: true, recursive: true });
    }
  });

  it("fails closed for ERROR, malformed, oversized response, timeout, unavailable, and oversized input", async () => {
    const temporaryRoot = mkdtempSync(path.join(tmpdir(), "moldpilot-clamd-errors-"));
    const filePath = path.join(temporaryRoot, "test.pdf");
    writeFileSync(filePath, "%PDF-1.7\nbody");

    const malformedServer = createServer((socket) => {
      respondAfterCompleteInstream(socket, Buffer.from("stream: MAYBE\0"), []);
    });
    const malformedPort = await listen(malformedServer);
    const errorServer = createServer((socket) => {
      respondAfterCompleteInstream(
        socket,
        Buffer.from("INSTREAM size limit exceeded. ERROR\0"),
        []
      );
    });
    const errorPort = await listen(errorServer);
    const oversizedResponseServer = createServer((socket) => {
      respondAfterCompleteInstream(socket, Buffer.alloc(5_000, 0x41), []);
    });
    const oversizedResponsePort = await listen(oversizedResponseServer);
    const timeoutServer = createServer((socket) => {
      socket.on("data", () => undefined);
    });
    const timeoutPort = await listen(timeoutServer);
    const prematureCloseServer = createServer((socket) => {
      socket.once("data", () => socket.end());
    });
    const prematureClosePort = await listen(prematureCloseServer);
    const unavailableServer = createServer();
    const unavailablePort = await listen(unavailableServer);
    await closeServer(unavailableServer);

    try {
      const malformed = await scanFileWithClamd(
        filePath,
        testConfiguration(malformedPort)
      );
      assert.equal(malformed.status, "error");

      const daemonError = await scanFileWithClamd(
        filePath,
        testConfiguration(errorPort)
      );
      assert.equal(daemonError.status, "error");

      const oversizedResponse = await scanFileWithClamd(
        filePath,
        testConfiguration(oversizedResponsePort)
      );
      assert.equal(oversizedResponse.status, "error");

      const timedOut = await scanFileWithClamd(
        filePath,
        testConfiguration(timeoutPort, {
          responseTimeoutMs: 25,
          totalScanTimeoutMs: 100
        })
      );
      assert.equal(timedOut.status, "unavailable");

      const disconnected = await scanFileWithClamd(
        filePath,
        testConfiguration(prematureClosePort)
      );
      assert.equal(disconnected.status, "unavailable");

      const unavailable = await scanFileWithClamd(
        filePath,
        testConfiguration(unavailablePort)
      );
      assert.equal(unavailable.status, "unavailable");

      const oversized = await scanFileWithClamd(
        filePath,
        testConfiguration(malformedPort, { maxStreamBytes: 2 })
      );
      assert.equal(oversized.status, "error");

      for (const result of [
        malformed,
        daemonError,
        oversizedResponse,
        timedOut,
        disconnected,
        unavailable,
        oversized
      ]) {
        assert.doesNotMatch(
          JSON.stringify(result),
          /127\.0\.0\.1|test\.pdf|ECONN|stack|stream: MAYBE/i
        );
      }
    } finally {
      await closeServer(malformedServer);
      await closeServer(errorServer);
      await closeServer(oversizedResponseServer);
      await closeServer(timeoutServer);
      await closeServer(prematureCloseServer);
      rmSync(temporaryRoot, { force: true, recursive: true });
    }
  });

  it("uses bounded exact PING/PONG health checks", async () => {
    const healthyServer = createServer((socket) => {
      socket.once("data", (chunk: Buffer) => {
        assert.equal(chunk.equals(CLAMD_PING_COMMAND), true);
        socket.end(Buffer.from("PONG\0"));
      });
    });
    const healthyPort = await listen(healthyServer);
    const malformedServer = createServer((socket) => {
      socket.once("data", () => socket.end(Buffer.from("PONG\n")));
    });
    const malformedPort = await listen(malformedServer);

    try {
      await pingClamd(testConfiguration(healthyPort));
      await assert.rejects(() => pingClamd(testConfiguration(malformedPort)));
    } finally {
      await closeServer(healthyServer);
      await closeServer(malformedServer);
    }
  });

  it("turns a PING reset into a controlled unavailable rejection", async () => {
    const server = createServer((socket) => {
      socket.once("data", (chunk: Buffer) => {
        assert.equal(chunk.equals(CLAMD_PING_COMMAND), true);
        socket.resetAndDestroy();
      });
    });
    const port = await listen(server);

    try {
      await assert.rejects(
        () => pingClamd(testConfiguration(port)),
        /Clamd (?:transport|connection|disconnected)/
      );
    } finally {
      await closeServer(server);
    }
  });

  it("survives repeated mid-stream resets in a crash-observable child process", () => {
    const fixture = new URL(
      "../fixtures/clamd-reset-stress-child.mjs",
      import.meta.url
    );
    const child = spawnSync(
      process.execPath,
      ["--unhandled-rejections=strict", fixture.pathname],
      {
        encoding: "utf8",
        timeout: 30_000
      }
    );

    assert.equal(
      child.status,
      0,
      `Reset stress child crashed.\nstdout: ${child.stdout}\nstderr: ${child.stderr}`
    );
    assert.deepEqual(JSON.parse(child.stdout), {
      attempts: 30,
      resets: 30,
      unavailable: 30
    });
    assert.doesNotMatch(
      child.stderr,
      /ECONNRESET|EPIPE|uncaught|unhandled|MaxListeners/i
    );
    assert.doesNotMatch(
      readFileSync(fixture, "utf8"),
      /process\.(?:on|once)\(\s*["'](?:uncaughtException|unhandledRejection)/
    );
  });
});

describe("scanner configuration and local compatibility", () => {
  it("defaults native deployments to local but requires explicit private clamd in containers", () => {
    assert.equal(resolveScannerMode({}), "local");
    assert.equal(resolveScannerMode({ MOLDPILOT_SCANNER_MODE: "clamd" }), "clamd");
    assert.throws(
      () => resolveScannerMode({}, { requireExplicit: true }),
      /must be local or clamd/
    );

    const environment = {
      MOLDPILOT_SCANNER_MODE: "clamd",
      MOLDPILOT_CLAMD_HOST: "clamav",
      MOLDPILOT_CLAMD_PORT: "3310",
      MOLDPILOT_CLAMD_CONNECT_TIMEOUT_MS: "3000",
      MOLDPILOT_CLAMD_HEALTH_TIMEOUT_MS: "5000",
      MOLDPILOT_CLAMD_RESPONSE_TIMEOUT_MS: "10000",
      MOLDPILOT_CLAMD_SCAN_TIMEOUT_MS: "600000",
      MOLDPILOT_CLAMD_MAX_STREAM_BYTES: String(320 * 1024 * 1024),
      MOLDPILOT_READINESS_TIMEOUT_MS: "7000"
    };
    assert.equal(validateContainerScannerEnvironment(environment).host, "clamav");
    assert.throws(
      () =>
        validateContainerScannerEnvironment({
          ...environment,
          MOLDPILOT_SCANNER_COMMAND: "/opt/homebrew/bin/clamscan"
        }),
      /must not configure a local scanner/
    );
    assert.throws(
      () =>
        loadClamdConfiguration({
          ...environment,
          MOLDPILOT_CLAMD_SCAN_TIMEOUT_MS: "1000"
        }),
      /must be an integer/
    );
  });

  it("keeps the local command backend compatible and fail closed by exit code", async () => {
    const temporaryRoot = mkdtempSync(path.join(tmpdir(), "moldpilot-local-scan-"));
    const filePath = path.join(temporaryRoot, "sample.pdf");
    const cleanScanner = path.join(temporaryRoot, "clean-scanner");
    const infectedScanner = path.join(temporaryRoot, "infected-scanner");
    writeFileSync(filePath, "%PDF-1.7\n");
    writeFileSync(cleanScanner, "#!/bin/sh\nexit 0\n");
    writeFileSync(infectedScanner, "#!/bin/sh\nexit 1\n");
    chmodSync(cleanScanner, 0o755);
    chmodSync(infectedScanner, 0o755);

    try {
      assert.equal(
        (await scanFileWithLocalCommand(filePath, cleanScanner, 1_000)).status,
        "clean"
      );
      assert.equal(
        (await scanFileWithLocalCommand(filePath, infectedScanner, 1_000)).status,
        "infected"
      );
    } finally {
      rmSync(temporaryRoot, { force: true, recursive: true });
    }
  });
});
