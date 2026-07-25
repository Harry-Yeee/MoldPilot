import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { describe, it } from "node:test";
import {
  evaluateRuntimeReadiness,
  liveHealthPayload,
  runtimeReadinessHttpStatus
} from "../../src/domain/security/runtime-health.ts";
import { verifyExistingWritableDirectory } from "../../src/domain/security/runtime-directory.ts";

function source(relativePath: string): string {
  return readFileSync(new URL(`../../${relativePath}`, import.meta.url), "utf8");
}

function readyCheck(): Promise<void> {
  return Promise.resolve();
}

describe("container health contracts", () => {
  it("keeps liveness minimal and independent from PostgreSQL", () => {
    assert.deepEqual(liveHealthPayload, { status: "ok" });

    const route = source("src/app/api/health/live/route.ts");
    assert.match(route, /status: 200/);
    assert.match(route, /Cache-Control.*no-store/);
    assert.match(route, /dynamic = "force-dynamic"/);
    assert.doesNotMatch(route, /prisma|DATABASE_URL|queryRaw/i);
  });

  it("reports readiness success only when every component succeeds", async () => {
    const report = await evaluateRuntimeReadiness({
      database: readyCheck,
      storage: readyCheck,
      quarantine: readyCheck
    });

    assert.deepEqual(report, {
      status: "ready",
      components: {
        database: "ready",
        storage: "ready",
        quarantine: "ready"
      }
    });
    assert.equal(runtimeReadinessHttpStatus(report), 200);
  });

  it("returns a non-sensitive 503 report when PostgreSQL is unavailable", async () => {
    const report = await evaluateRuntimeReadiness({
      database: async () => {
        throw new Error("postgresql://secret-user:secret-password@production-db/internal");
      },
      storage: readyCheck,
      quarantine: readyCheck
    });

    assert.equal(runtimeReadinessHttpStatus(report), 503);
    assert.deepEqual(report.components, {
      database: "unavailable",
      storage: "ready",
      quarantine: "ready"
    });
    assert.doesNotMatch(JSON.stringify(report), /secret|password|postgresql|production-db/i);
  });

  it("returns 503 for missing or unwritable persistent storage", async () => {
    const temporaryRoot = mkdtempSync(path.join(tmpdir(), "moldpilot-runtime-health-"));
    const writable = path.join(temporaryRoot, "writable");
    const missing = path.join(temporaryRoot, "missing");
    mkdirSync(writable);

    try {
      await verifyExistingWritableDirectory(writable);
      await assert.rejects(() => verifyExistingWritableDirectory(missing));

      const report = await evaluateRuntimeReadiness({
        database: readyCheck,
        storage: () => verifyExistingWritableDirectory(missing),
        quarantine: () => verifyExistingWritableDirectory(writable)
      });
      assert.equal(runtimeReadinessHttpStatus(report), 503);
      assert.equal(report.components.storage, "unavailable");
      assert.equal(report.components.quarantine, "ready");

      const permissionDenied = await evaluateRuntimeReadiness({
        database: readyCheck,
        storage: async () => {
          throw Object.assign(new Error("permission denied"), { code: "EACCES" });
        },
        quarantine: readyCheck
      });
      assert.equal(runtimeReadinessHttpStatus(permissionDenied), 503);
      assert.equal(permissionDenied.components.storage, "unavailable");
      assert.doesNotMatch(JSON.stringify(permissionDenied), /permission|EACCES/i);
    } finally {
      rmSync(temporaryRoot, { force: true, recursive: true });
    }
  });
});

describe("container startup and image design", () => {
  it("rejects missing required production variables before starting Next", () => {
    const entrypoint = new URL("../../scripts/container-entrypoint.sh", import.meta.url);
    const result = spawnSync("sh", [entrypoint.pathname], {
      encoding: "utf8",
      env: { NODE_ENV: "production", PATH: process.env.PATH ?? "" }
    });

    assert.notEqual(result.status, 0);
    assert.match(`${result.stdout}${result.stderr}`, /MOLDPILOT_DEPLOYMENT_MODE is required/);
    assert.doesNotMatch(`${result.stdout}${result.stderr}`, /server\.js/);
  });

  it("never migrates, seeds, or resets from the production entrypoint", () => {
    const entrypoint = source("scripts/container-entrypoint.sh");
    const validator = source("scripts/check-container-runtime.mjs");
    const combined = `${entrypoint}\n${validator}`;

    assert.match(entrypoint, /exec "\$@"/);
    assert.doesNotMatch(combined, /prisma\s+(?:db\s+seed|migrate|reset)|pilot:seed|prisma:seed/i);
    assert.doesNotMatch(combined, /check-malware-scanner|clamd?scan/i);
  });

  it("builds a non-root standalone final image with a Node fetch health check", () => {
    const dockerfile = source("Dockerfile");
    const runnerStage = dockerfile.slice(dockerfile.indexOf("FROM ${NODE_IMAGE} AS runner"));
    assert.match(
      dockerfile,
      /ARG NODE_IMAGE=node:24\.18\.0-bookworm-slim@sha256:[a-f0-9]{64}/
    );
    assert.match(dockerfile, /pnpm install --frozen-lockfile/);
    assert.equal(
      (dockerfile.match(/apt-get install --yes --no-install-recommends openssl/g) ?? []).length,
      2
    );
    assert.ok(dockerfile.indexOf("prisma generate") < dockerfile.indexOf("pnpm build"));
    assert.match(dockerfile, /FROM \$\{NODE_IMAGE\} AS runner/);
    assert.match(dockerfile, /USER 10001:10001/);
    assert.match(dockerfile, /HOSTNAME="0\.0\.0\.0"/);
    assert.match(dockerfile, /HEALTHCHECK[\s\S]*fetch\('http:\/\/127\.0\.0\.1:3000\/api\/health\/live'/);
    assert.doesNotMatch(runnerStage, /(?:ENTRYPOINT|CMD)[^\n]*(?:migrate|seed|reset)/i);

    const nextConfig = source("next.config.mjs");
    assert.match(nextConfig, /output: "standalone"/);
    assert.doesNotMatch(nextConfig, /node_modules\/\.pnpm\/\*\*/);
  });

  it("keeps secrets, business data, and local artifacts out of the Docker context", () => {
    const dockerignore = source(".dockerignore");
    for (const ignored of [".git", ".next", "node_modules", ".env", "storage", "RAW", "generated", ".pnpm-store"]) {
      assert.match(dockerignore, new RegExp(`^${ignored.replace(".", "\\.")}$`, "m"));
    }
    assert.match(dockerignore, /^!\.env\.example$/m);
  });

  it("uses an isolated internal smoke environment and scopes destructive cleanup", () => {
    const compose = source("docker-compose.d1-smoke.yml");
    const smoke = source("scripts/docker-d1-smoke.sh");

    assert.match(compose, /image: postgres:16-bookworm/);
    assert.match(compose, /internal: true/);
    assert.doesNotMatch(compose, /ports:/);
    assert.match(smoke, /moldpilot-d1-smoke-\$SMOKE_SUFFIX/);
    assert.match(smoke, /compose down --volumes --remove-orphans/);
    assert.match(smoke, /Refusing.*production/i);
    assert.doesNotMatch(source("scripts/run-production-macos.sh"), /docker compose down[^\n]*--volumes|docker compose down[^\n]*-v/);
  });
});
