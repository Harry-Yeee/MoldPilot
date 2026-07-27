// Shared reader for scripts/platform-required-files.txt.
//
// The manifest names every file in the sibling LJ_ERP platform checkout that
// this app release reads at gate time. scripts/platform-preflight-check.sh
// consumes the same file from bash, so the deploy scripts and the test suite
// cannot disagree about what "the platform is up to date" means.

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const fixturesDirectory = path.dirname(fileURLToPath(import.meta.url));

export const appRoot = path.resolve(fixturesDirectory, "../..");

// Resolved exactly like tests/domain/platform-production-package.test.ts and
// scripts/platform-preflight-check.sh: the platform checkout is the directory
// that contains this app checkout. No environment override, in any of the
// three, on purpose.
export const defaultPlatformRoot = path.resolve(appRoot, "..");

export const manifestPath = path.join(
  appRoot,
  "scripts",
  "platform-required-files.txt"
);

export const platformPinnedRelease = "D3.1.1 (7ade001)";

export function readPlatformRequiredFiles(): string[] {
  return readFileSync(manifestPath, "utf8")
    .split("\n")
    .map((line) => line.replace(/#.*$/, "").trim())
    .filter((line) => line.length > 0);
}

export function missingPlatformRequiredFiles(
  platformRoot: string = defaultPlatformRoot
): string[] {
  return readPlatformRequiredFiles().filter(
    (relativePath) => !existsSync(path.join(platformRoot, relativePath))
  );
}

export function platformSkewMessage(
  missing: string[],
  platformRoot: string = defaultPlatformRoot
): string {
  return [
    `Platform checkout at ${platformRoot} is missing ${missing.length}`,
    `file(s) required by this app release (first: ${missing[0]}).`,
    "It is likely behind.",
    `Fix: git -C "${platformRoot}" pull, then re-run.`,
    `App release pins platform >= ${platformPinnedRelease}.`
  ].join(" ");
}
