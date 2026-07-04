#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, readFileSync } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import process from "node:process";

const DEFAULT_DATABASE_URL = "postgresql://moldpilot:moldpilot@localhost:5432/moldpilot?schema=public";
const args = new Set(process.argv.slice(2));
const setupOnly = args.has("--setup-only");
const skipDocker = args.has("--no-docker");
const showHelp = args.has("--help") || args.has("-h");

if (showHelp) {
  console.log(`MoldPilot local pilot runner

Usage:
  pnpm pilot:setup
  pnpm pilot:start

Options:
  --setup-only  Prepare .env, PostgreSQL, Prisma, migrations, and seed, then exit.
  --no-docker   Do not start Docker PostgreSQL. Use the DATABASE_URL in .env.

The website is available only while the dev server is running.
Keep the terminal open after the script prints http://localhost:3000.
`);
  process.exit(0);
}

function commandVersion(command, commandArgs = ["--version"]) {
  const result = spawnSync(command, commandArgs, { encoding: "utf8" });

  if (result.error != null || result.status !== 0) {
    return null;
  }

  return (result.stdout || result.stderr).trim();
}

function runStep(label, command, commandArgs, options = {}) {
  console.log(`\n==> ${label}`);
  const result = spawnSync(command, commandArgs, {
    env: process.env,
    stdio: "inherit",
    ...options
  });

  if (result.error != null) {
    throw new Error(`${label} failed: ${result.error.message}`);
  }

  if (result.status !== 0) {
    throw new Error(`${label} failed with exit code ${result.status ?? 1}.`);
  }
}

function ensureLocalBinary(path, installHint) {
  if (!existsSync(path)) {
    throw new Error(`${path} was not found. ${installHint}`);
  }
}

function offlineCacheDir() {
  return process.env.MOLDPILOT_OFFLINE_DIR ?? path.join(os.homedir(), ".moldpilot-offline");
}

function offlineCachePresent(dir) {
  return existsSync(path.join(dir, "pnpm-store")) || existsSync(path.join(dir, "moldpilot-pnpm-store.tgz"));
}

function dependencyInstallHint() {
  // Cache lives outside the repo by default; a legacy in-repo copy is honored too.
  const legacyDir = path.resolve(".moldpilot-offline");
  if (
    offlineCachePresent(offlineCacheDir()) ||
    (process.env.MOLDPILOT_OFFLINE_DIR == null && offlineCachePresent(legacyDir))
  ) {
    return "Run `pnpm offline:install`, then rerun `./scripts/run-local-pilot.sh`.";
  }

  return "Run `pnpm install`, then rerun `./scripts/run-local-pilot.sh`.";
}

function envDatabaseUrl() {
  if (process.env.DATABASE_URL != null && process.env.DATABASE_URL.trim().length > 0) {
    return process.env.DATABASE_URL;
  }

  if (!existsSync(".env")) {
    return DEFAULT_DATABASE_URL;
  }

  const envText = readFileSync(".env", "utf8");
  const line = envText
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .find((entry) => entry.startsWith("DATABASE_URL="));

  if (line == null) {
    return DEFAULT_DATABASE_URL;
  }

  return line
    .slice("DATABASE_URL=".length)
    .trim()
    .replace(/^"/, "")
    .replace(/"$/, "");
}

function parseDatabaseUrl(databaseUrl) {
  try {
    const parsed = new URL(databaseUrl);
    return {
      host: parsed.hostname,
      port: Number.parseInt(parsed.port || "5432", 10)
    };
  } catch {
    return null;
  }
}

function waitForTcp(host, port, timeoutMs = 30000) {
  const startedAt = Date.now();

  return new Promise((resolve) => {
    const attempt = () => {
      const socket = net.createConnection({ host, port });
      let settled = false;

      const finish = (ok) => {
        if (settled) {
          return;
        }

        settled = true;
        socket.removeAllListeners();
        socket.destroy();

        if (ok) {
          resolve(true);
          return;
        }

        if (Date.now() - startedAt >= timeoutMs) {
          resolve(false);
          return;
        }

        setTimeout(attempt, 500);
      };

      socket.setTimeout(1000);
      socket.once("connect", () => finish(true));
      socket.once("timeout", () => finish(false));
      socket.once("error", () => finish(false));
    };

    attempt();
  });
}

async function fetchDashboard() {
  try {
    const response = await fetch("http://localhost:3000", { signal: AbortSignal.timeout(2000) });
    const body = await response.text();

    return {
      ok: response.status === 200 && body.includes("Mold Trial Tracker"),
      status: response.status
    };
  } catch {
    return null;
  }
}

async function assertPortAvailable() {
  const dashboard = await fetchDashboard();

  if (dashboard?.ok) {
    console.log("\nMoldPilot is already running.");
    console.log("Open http://localhost:3000 in Chrome.");
    process.exit(0);
  }

  const available = await new Promise((resolve) => {
    const server = net.createServer();

    server.once("error", () => resolve(false));
    server.once("listening", () => {
      server.close(() => resolve(true));
    });
    server.listen(3000, "127.0.0.1");
  });

  if (!available) {
    throw new Error("Port 3000 is already in use by another app. Stop that app, then rerun `pnpm pilot:start`.");
  }
}

async function main() {
  console.log("MoldPilot local pilot runner\n");

  if (!existsSync(".env")) {
    if (!existsSync(".env.example")) {
      throw new Error(".env is missing and .env.example was not found.");
    }

    copyFileSync(".env.example", ".env");
    console.log("Created .env from .env.example.");
  } else {
    console.log("Found .env.");
  }

  ensureLocalBinary("./node_modules/.bin/prisma", dependencyInstallHint());
  ensureLocalBinary("./node_modules/.bin/next", dependencyInstallHint());

  const databaseUrl = envDatabaseUrl();
  const database = parseDatabaseUrl(databaseUrl);

  if (database == null) {
    throw new Error("DATABASE_URL is not a valid PostgreSQL URL. Update .env, then rerun this command.");
  }

  if (!skipDocker) {
    const dockerVersion = commandVersion("docker");

    if (dockerVersion == null) {
      console.log("Docker was not found on PATH.");
      console.log("Using the DATABASE_URL from .env. Make sure Postgres.app, Homebrew PostgreSQL, or your custom PostgreSQL is running.");
    } else {
      console.log(`Docker detected: ${dockerVersion}`);
      runStep("Start Docker PostgreSQL", "docker", ["compose", "up", "-d", "postgres"]);
    }
  }

  console.log(`\nWaiting for PostgreSQL at ${database.host}:${database.port}...`);
  const reachable = await waitForTcp(database.host, database.port);

  if (!reachable) {
    throw new Error(
      `PostgreSQL is not reachable at ${database.host}:${database.port}. Start Docker Desktop and run \`pnpm pilot:db\`, or update DATABASE_URL in .env.`
    );
  }

  console.log("PostgreSQL is reachable.");

  runStep("Generate Prisma Client", "./node_modules/.bin/prisma", ["generate"]);
  runStep("Apply Prisma migrations", "./node_modules/.bin/prisma", ["migrate", "dev"]);
  runStep("Seed and verify MP-PILOT-001", "./node_modules/.bin/prisma", ["db", "seed"]);
  runStep("Verify pilot fixture", process.execPath, ["scripts/pilot-preflight.mjs", "--check-seed"]);

  if (setupOnly) {
    console.log("\nLocal pilot setup is ready.");
    console.log("Run `pnpm pilot:start` and keep that terminal open, then open http://localhost:3000 in Chrome.");
    return;
  }

  await assertPortAvailable();

  console.log("\nStarting MoldPilot at http://localhost:3000");
  console.log("Keep this terminal open. Press Ctrl+C to stop the website.\n");
  runStep("Start Next.js dev server", "./node_modules/.bin/next", ["dev"]);
}

main().catch((error) => {
  console.error(`\n[FAIL] ${error instanceof Error ? error.message : String(error)}`);
  console.error("\nTry `pnpm pilot:preflight` for a detailed environment report.");
  process.exit(1);
});
