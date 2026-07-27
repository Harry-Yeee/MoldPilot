import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import {
  appRoot,
  defaultPlatformRoot,
  manifestPath,
  missingPlatformRequiredFiles,
  platformSkewMessage,
  readPlatformRequiredFiles
} from "../fixtures/platform-required-files.ts";

const packageTestPath = path.join(
  appRoot,
  "tests",
  "domain",
  "platform-production-package.test.ts"
);

function packageTestSource(): string {
  return readFileSync(packageTestPath, "utf8");
}

function crossRepoReadTargets(source: string): string[] {
  const opsTargets = [...source.matchAll(/\bread\("([^"]+)"\)/g)].map(
    (match) => `ops/${match[1]}`
  );
  const platformTargets = [
    ...source.matchAll(/\breadPlatform\("([^"]+)"\)/g)
  ].map((match) => match[1]);
  return [...new Set([...opsTargets, ...platformTargets])].sort();
}

describe("platform required-file manifest", () => {
  it("lists every platform file the release gate reads", () => {
    const targets = crossRepoReadTargets(packageTestSource());
    const manifest = readPlatformRequiredFiles();

    assert.ok(
      targets.length > 20,
      `expected the package gate to read many platform files, found ${targets.length}`
    );
    for (const target of targets) {
      assert.ok(
        manifest.includes(target),
        `platform-production-package.test.ts reads ${target}, but scripts/platform-required-files.txt does not list it. The deploy preflight would let that skew through.`
      );
    }
    for (const entry of manifest) {
      assert.ok(
        targets.includes(entry),
        `scripts/platform-required-files.txt lists ${entry}, but platform-production-package.test.ts never reads it. Remove the stale entry or restore the read.`
      );
    }
  });

  it("keeps manifest entries relative, unique, and inside the platform checkout", () => {
    const manifest = readPlatformRequiredFiles();

    assert.deepEqual(
      manifest,
      [...new Set(manifest)],
      "scripts/platform-required-files.txt contains duplicate entries"
    );
    for (const entry of manifest) {
      assert.ok(
        !path.isAbsolute(entry),
        `manifest entry must be relative to the platform root: ${entry}`
      );
      assert.ok(
        !entry.split("/").includes(".."),
        `manifest entry must not escape the platform root: ${entry}`
      );
    }
  });

  it(
    "resolves every manifest entry in the platform checkout",
    {
      // The platform root is the parent of this app checkout, so this can only
      // be judged where MoldPilot really sits inside LJ_ERP. In a sibling or
      // flattened layout the parent is not a platform checkout at all and every
      // entry would be "missing" for a reason that says nothing about skew.
      // scripts/platform-preflight-check.sh reports that layout separately.
      skip: existsSync(path.join(defaultPlatformRoot, "ops"))
        ? false
        : `${defaultPlatformRoot} has no ops/ directory, so it is not an LJ_ERP platform checkout and manifest freshness cannot be judged from here. Re-run where MoldPilot sits inside the platform checkout.`
    },
    () => {
      const missing = missingPlatformRequiredFiles();
      assert.deepEqual(missing, [], platformSkewMessage(missing));
    }
  );

  it("keeps the deploy scripts wired to the shared manifest", () => {
    const preflight = readFileSync(
      path.join(appRoot, "scripts", "platform-preflight-check.sh"),
      "utf8"
    );
    const firstDeploy = readFileSync(
      path.join(appRoot, "scripts", "server-first-deploy-macos.sh"),
      "utf8"
    );
    const deploy = readFileSync(
      path.join(appRoot, "scripts", "server-deploy-macos.sh"),
      "utf8"
    );

    assert.ok(existsSync(manifestPath));
    assert.match(preflight, /platform-required-files\.txt/);
    assert.match(preflight, /is missing \$MISSING_COUNT file\(s\) required by this app release/);
    assert.match(preflight, /D3\.1\.1 \(7ade001\)/);

    for (const [name, source, laterWork] of [
      [
        "server-first-deploy-macos.sh",
        firstDeploy,
        [
          "command -v brew",
          '"$BREW_BIN" update',
          "server-bootstrap-macos.sh",
          "sudo install"
        ]
      ],
      [
        "server-deploy-macos.sh",
        deploy,
        [
          'mkdir "$LOCK_DIR"',
          "pnpm install --frozen-lockfile",
          "CI=true pnpm test",
          "launchctl bootout"
        ]
      ]
    ] as const) {
      const preflightAt = source.indexOf('bash "$PLATFORM_PREFLIGHT"');
      assert.ok(
        preflightAt > 0,
        `${name} must invoke the platform preflight script`
      );
      for (const marker of laterWork) {
        const workAt = source.indexOf(marker);
        assert.ok(workAt > 0, `${name} no longer contains ${marker}`);
        assert.ok(
          preflightAt < workAt,
          `${name} must preflight the platform checkout before ${marker}`
        );
      }
    }
  });
});
