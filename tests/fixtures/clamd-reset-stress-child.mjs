import { once } from "node:events";
import {
  mkdtempSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  CLAMD_INSTREAM_COMMAND
} from "../../src/domain/security/clamd-protocol.ts";
import {
  scanFileWithClamd
} from "../../src/server/clamd-client.ts";

const attempts = 30;
const temporaryRoot = mkdtempSync(
  path.join(tmpdir(), "moldpilot-clamd-reset-stress-")
);
const filePath = path.join(temporaryRoot, "eight-megabyte.pdf");
writeFileSync(
  filePath,
  Buffer.concat([
    Buffer.from("%PDF-1.7\n", "ascii"),
    Buffer.alloc(8 * 1024 * 1024, 0x41)
  ])
);

let resetCount = 0;
const server = createServer((socket) => {
  let received = Buffer.alloc(0);
  let resetScheduled = false;

  socket.on("data", (chunk) => {
    if (resetScheduled) {
      return;
    }

    received = Buffer.concat([received, chunk]);
    if (received.byteLength < CLAMD_INSTREAM_COMMAND.byteLength) {
      return;
    }
    if (
      !received
        .subarray(0, CLAMD_INSTREAM_COMMAND.byteLength)
        .equals(CLAMD_INSTREAM_COMMAND)
    ) {
      throw new Error("Stress server did not receive INSTREAM.");
    }

    resetScheduled = true;
    resetCount += 1;
    socket.resetAndDestroy();
  });
});

try {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (address == null || typeof address === "string") {
    throw new Error("Stress server did not bind a TCP port.");
  }

  const statuses = [];
  for (let index = 0; index < attempts; index += 1) {
    const result = await scanFileWithClamd(filePath, {
      host: "127.0.0.1",
      port: address.port,
      connectTimeoutMs: 500,
      healthTimeoutMs: 1_000,
      responseTimeoutMs: 1_000,
      totalScanTimeoutMs: 5_000,
      maxStreamBytes: 16 * 1024 * 1024
    });
    statuses.push(result.status);
  }

  if (
    resetCount !== attempts ||
    statuses.some((status) => status !== "unavailable")
  ) {
    throw new Error(
      `Expected ${attempts} controlled unavailable results; resets=${resetCount}, statuses=${statuses.join(",")}.`
    );
  }

  process.stdout.write(
    JSON.stringify({
      attempts,
      resets: resetCount,
      unavailable: statuses.filter((status) => status === "unavailable").length
    })
  );
} finally {
  server.close();
  if (server.listening) {
    await once(server, "close");
  }
  rmSync(temporaryRoot, { force: true, recursive: true });
}
