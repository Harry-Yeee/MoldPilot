import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import {
  PRODUCTION_TRAINING_CONFIRMATION,
  assertLocalPilotDeploymentAllowed,
  assertTrainingExamplesDeploymentAllowed
} from "../../src/domain/security/deployment-mode.ts";
import {
  parseSessionCookieSecureMode,
  shouldUseSecureSessionCookie,
  validateProductionAuthenticationEnvironment,
  validateProductionSessionSecret
} from "../../src/domain/security/session-cookie.ts";
import {
  seedManagedUserUpdate,
  seededUserCreateCredentials
} from "../../src/domain/security/seed-user-policy.ts";

function source(relativePath: string): string {
  return readFileSync(new URL(`../../${relativePath}`, import.meta.url), "utf8");
}

const productionSessionSecret = "8f4e7c2a".repeat(8);

describe("production session-cookie configuration", () => {
  it("defaults missing or blank cookie mode to auto", () => {
    assert.equal(parseSessionCookieSecureMode(undefined), "auto");
    assert.equal(parseSessionCookieSecureMode("   "), "auto");
  });

  it("resolves auto from the configured HTTP or HTTPS base URL", () => {
    assert.equal(
      shouldUseSecureSessionCookie({
        NODE_ENV: "production",
        MOLDPILOT_BASE_URL: "http://192.0.2.10:3000",
        MOLDPILOT_SESSION_COOKIE_SECURE: "auto"
      }),
      false
    );
    assert.equal(
      shouldUseSecureSessionCookie({
        NODE_ENV: "production",
        MOLDPILOT_BASE_URL: "https://moldpilot.factory.test",
        MOLDPILOT_SESSION_COOKIE_SECURE: "auto"
      }),
      true
    );
  });

  it("supports explicit true and false", () => {
    assert.equal(shouldUseSecureSessionCookie({ MOLDPILOT_SESSION_COOKIE_SECURE: "true" }), true);
    assert.equal(shouldUseSecureSessionCookie({ MOLDPILOT_SESSION_COOKIE_SECURE: "false" }), false);
  });

  it("rejects unsupported cookie modes", () => {
    assert.throws(
      () => parseSessionCookieSecureMode("1"),
      /Expected auto, true, or false/
    );
  });

  it("falls back to Secure=true when production has no base URL", () => {
    assert.equal(shouldUseSecureSessionCookie({ NODE_ENV: "production" }), true);
    assert.equal(shouldUseSecureSessionCookie({ NODE_ENV: "development" }), false);
  });

  it("validates production mode and rejects scheme/cookie mismatches", () => {
    const http = validateProductionAuthenticationEnvironment({
      NODE_ENV: "production",
      MOLDPILOT_DEPLOYMENT_MODE: "production",
      MOLDPILOT_SESSION_SECRET: productionSessionSecret,
      MOLDPILOT_BASE_URL: "http://moldpilot.factory.test:3000",
      MOLDPILOT_SESSION_COOKIE_SECURE: "auto"
    });
    assert.equal(http.cookieSecure, false);
    assert.match(http.warning ?? "", /does not encrypt credentials or cookies/);

    assert.throws(
      () =>
        validateProductionAuthenticationEnvironment({
          MOLDPILOT_DEPLOYMENT_MODE: "production",
          MOLDPILOT_SESSION_SECRET: productionSessionSecret,
          MOLDPILOT_BASE_URL: "https://moldpilot.factory.test",
          MOLDPILOT_SESSION_COOKIE_SECURE: "false"
        }),
      /HTTPS .* requires Secure session cookies/
    );
    assert.throws(
      () =>
        validateProductionAuthenticationEnvironment({
          MOLDPILOT_DEPLOYMENT_MODE: "production",
          MOLDPILOT_SESSION_SECRET: productionSessionSecret,
          MOLDPILOT_BASE_URL: "http://moldpilot.factory.test:3000",
          MOLDPILOT_SESSION_COOKIE_SECURE: "true"
        }),
      /HTTP .* cannot use Secure session cookies/
    );
    assert.throws(
      () =>
        validateProductionAuthenticationEnvironment({
          MOLDPILOT_BASE_URL: "http://moldpilot.factory.test:3000",
          MOLDPILOT_SESSION_COOKIE_SECURE: "auto"
        }),
      /MOLDPILOT_DEPLOYMENT_MODE=production/
    );
  });

  it("rejects short and known development production session secrets", () => {
    assert.throws(
      () => validateProductionSessionSecret("short"),
      /at least 32 characters/
    );
    assert.throws(
      () =>
        validateProductionSessionSecret(
          "moldpilot-local-pilot-session-secret"
        ),
      /known development value/
    );
    assert.doesNotThrow(() =>
      validateProductionSessionSecret(productionSessionSecret)
    );
  });
});

describe("production-safe launch and seed behavior", () => {
  it("refuses the local pilot before migrations or seed in production deployment mode", () => {
    assert.throws(
      () =>
        assertLocalPilotDeploymentAllowed(
          {},
          'DATABASE_URL="postgresql://example"\nMOLDPILOT_DEPLOYMENT_MODE="production"\n'
        ),
      /no migration or seed was run/i
    );

    const temporaryProject = mkdtempSync(path.join(tmpdir(), "moldpilot-production-launch-"));
    try {
      writeFileSync(
        path.join(temporaryProject, ".env"),
        "MOLDPILOT_DEPLOYMENT_MODE=production\n",
        "utf8"
      );
      const launcher = fileURLToPath(new URL("../../scripts/local-pilot.mjs", import.meta.url));
      const result = spawnSync(process.execPath, [launcher, "--setup-only"], {
        cwd: temporaryProject,
        encoding: "utf8",
        env: { ...process.env, MOLDPILOT_DEPLOYMENT_MODE: "" }
      });
      const output = `${result.stdout}${result.stderr}`;
      assert.notEqual(result.status, 0);
      assert.match(output, /server-deploy-macos\.sh/);
      assert.doesNotMatch(output, /Apply Prisma migrations|Seed and verify/);
    } finally {
      rmSync(temporaryProject, { force: true, recursive: true });
    }

    const command = source("run-moldpilot.command");
    assert.ok(command.indexOf("MOLDPILOT_DEPLOYMENT_MODE") < command.indexOf("run-local-pilot.sh"));
    assert.match(command, /No migration or seed was run/);
  });

  it("requires an exact explicit confirmation before creating production training examples", () => {
    const productionEnvironment = {
      MOLDPILOT_DEPLOYMENT_MODE: "production"
    };

    assert.throws(
      () =>
        assertTrainingExamplesDeploymentAllowed(
          productionEnvironment,
          "",
          undefined
        ),
      /No demo data was written/
    );
    assert.throws(
      () =>
        assertTrainingExamplesDeploymentAllowed(
          productionEnvironment,
          "",
          "yes"
        ),
      /No demo data was written/
    );
    assert.deepEqual(
      assertTrainingExamplesDeploymentAllowed(
        productionEnvironment,
        "",
        PRODUCTION_TRAINING_CONFIRMATION
      ),
      { production: true }
    );
    assert.deepEqual(
      assertTrainingExamplesDeploymentAllowed({}, "", undefined),
      { production: false }
    );
  });

  it("documents the production training confirmation without weakening the default refusal", () => {
    const script = source("scripts/create-training-examples.mjs");

    assert.match(script, /--production-confirm/);
    assert.match(script, /assertTrainingExamplesDeploymentAllowed/);
    assert.match(script, /PRODUCTION TRAINING/);
    assert.doesNotMatch(script, /MOLDPILOT_DEPLOYMENT_MODE\s*=\s*["']development/);
  });

  it("checks production authentication configuration before stopping the service", () => {
    const bootstrap = source("scripts/server-bootstrap-macos.sh");
    const deploy = source("scripts/server-deploy-macos.sh");
    const runner = source("scripts/run-production-macos.sh");

    assert.match(bootstrap, /MOLDPILOT_DEPLOYMENT_MODE="production"/);
    assert.match(bootstrap, /MOLDPILOT_SESSION_COOKIE_SECURE="auto"/);
    assert.match(bootstrap, /check-production-config\.mjs/);
    assert.ok(
      deploy.indexOf("check-production-config.mjs") <
        deploy.indexOf("Stopping the running application")
    );
    assert.match(runner, /check-production-config\.mjs/);
  });

  it("provides one guarded Mac mini first-deployment command", () => {
    const firstDeploy = source("scripts/server-first-deploy-macos.sh");
    const bootstrap = source("scripts/server-bootstrap-macos.sh");
    const originUpdater = source("scripts/update-production-origin.mjs");

    assert.match(firstDeploy, /--base-url/);
    assert.match(firstDeploy, /--trusted-cidr/);
    assert.match(firstDeploy, /--restore-archive/);
    assert.match(firstDeploy, /--restore-sha256/);
    assert.match(firstDeploy, /--install-prerequisites/);
    assert.match(firstDeploy, /server-bootstrap-macos\.sh/);
    assert.doesNotMatch(firstDeploy, /curl[\s\S]{0,120}\|\s*(?:bash|sh)/);

    assert.match(bootstrap, /MOLDPILOT_BOOTSTRAP_BASE_URL/);
    assert.match(bootstrap, /MOLDPILOT_BOOTSTRAP_RESTORE_ARCHIVE/);
    assert.match(bootstrap, /Bootstrap restore requires an empty public schema/);
    assert.match(bootstrap, /Restore dump SHA-256 mismatch/);
    assert.ok(
      bootstrap.indexOf("Restoring the verified production bootstrap database") <
        bootstrap.indexOf("Applying production migrations")
    );
    assert.match(originUpdater, /renameSync\(temporaryPath, envPath\)/);
    assert.doesNotMatch(originUpdater, /DATABASE_URL.*=/);
  });

  it("atomically updates only deployment-origin settings in an existing environment", () => {
    const temporaryProject = mkdtempSync(path.join(tmpdir(), "moldpilot-origin-update-"));
    try {
      const envPath = path.join(temporaryProject, ".env");
      const databaseUrl = "postgresql://moldpilot:keep-this-secret@127.0.0.1:5432/moldpilot";
      writeFileSync(
        envPath,
        [
          `DATABASE_URL="${databaseUrl}"`,
          'MOLDPILOT_SESSION_SECRET="keep-this-session-secret"',
          'MOLDPILOT_BASE_URL="https://192.168.0.178"',
          'MOLDPILOT_SESSION_COOKIE_SECURE="auto"',
          'MOLDPILOT_TRUST_PROXY="1"',
          'MOLDPILOT_TRUSTED_CIDR="192.168.0.0/24"',
          ""
        ].join("\n"),
        { encoding: "utf8", mode: 0o600 }
      );

      const updater = fileURLToPath(
        new URL("../../scripts/update-production-origin.mjs", import.meta.url)
      );
      const result = spawnSync(
        process.execPath,
        [
          updater,
          "--env",
          envPath,
          "--base-url",
          "https://192.168.0.11",
          "--trusted-cidr",
          "192.168.0.0/24"
        ],
        { encoding: "utf8" }
      );
      const updated = readFileSync(envPath, "utf8");

      assert.equal(result.status, 0, result.stderr);
      assert.match(updated, new RegExp(databaseUrl.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
      assert.match(updated, /MOLDPILOT_SESSION_SECRET="keep-this-session-secret"/);
      assert.match(updated, /MOLDPILOT_BASE_URL="https:\/\/192\.168\.0\.11"/);
      assert.doesNotMatch(updated, /192\.168\.0\.178/);
    } finally {
      rmSync(temporaryProject, { force: true, recursive: true });
    }
  });

  it("preserves all existing credential lifecycle fields during seed-managed profile updates", () => {
    const existing = {
      username: "bill",
      displayName: "Changed locally",
      passwordHash: "changed-password-hash",
      forcePasswordChange: false,
      passwordUpdatedAt: new Date("2026-07-20T08:00:00.000Z"),
      lastLoginAt: new Date("2026-07-24T09:30:00.000Z")
    };
    const update = seedManagedUserUpdate({
      displayName: "Bill",
      chineseName: "王比尔",
      roleId: "role-pm",
      isDefaultAdmin: false
    });
    const reseeded = { ...existing, ...update };

    assert.equal("passwordHash" in update, false);
    assert.equal("forcePasswordChange" in update, false);
    assert.equal("passwordUpdatedAt" in update, false);
    assert.equal("lastLoginAt" in update, false);
    assert.equal(reseeded.passwordHash, existing.passwordHash);
    assert.equal(reseeded.forcePasswordChange, existing.forcePasswordChange);
    assert.equal(reseeded.passwordUpdatedAt, existing.passwordUpdatedAt);
    assert.equal(reseeded.lastLoginAt, existing.lastLoginAt);
  });

  it("still initializes newly created seed users with temporary credentials", () => {
    assert.deepEqual(seededUserCreateCredentials("temporary-password-hash", true), {
      passwordHash: "temporary-password-hash",
      forcePasswordChange: true,
      passwordUpdatedAt: null,
      lastLoginAt: null
    });

    const seed = source("prisma/seed.ts");
    assert.match(seed, /seededUserCreateCredentials\(hashPassword\(password\), forcePasswordChange\)/);
    assert.match(seed, /\["bill", "Bill", null, "pm", false, "123456", true\]/);
  });

  it("keeps the forced-password-change credential update and audit path intact", () => {
    const actions = source("src/server/auth-actions.ts");
    assert.match(actions, /verifyPassword\(currentPassword, user\.passwordHash\)/);
    assert.match(actions, /passwordHash: nextPasswordHash/);
    assert.match(actions, /forcePasswordChange: false/);
    assert.match(actions, /passwordUpdatedAt: new Date\(\)/);
    assert.match(actions, /action: "user_changed_credentials"/);
    assert.match(actions, /await setSessionCookie\(updated\.id\)/);
  });
});
