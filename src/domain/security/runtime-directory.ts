import { randomUUID } from "node:crypto";
import { stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

export async function verifyExistingWritableDirectory(directory: string): Promise<void> {
  const details = await stat(directory);
  if (!details.isDirectory()) {
    throw new Error("Configured runtime path is not a directory.");
  }

  const probePath = path.join(
    directory,
    `.moldpilot-readiness-${process.pid}-${randomUUID()}`
  );

  try {
    await writeFile(probePath, "", { flag: "wx", mode: 0o600 });
  } finally {
    await unlink(probePath).catch(() => undefined);
  }
}
