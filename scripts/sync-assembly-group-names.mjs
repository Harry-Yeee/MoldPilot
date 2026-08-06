#!/usr/bin/env node
/**
 * Re-point the assembly working groups at the CURRENT reviewed roster: each
 * `assembly-*` child group's `kpiLeaderId` and display name, and nothing else.
 *
 * Why this exists. `pnpm prisma:bootstrap` is the only writer of these rows, and
 * it refuses to run on a database that already has users, projects, or activity
 * (`assertFreshProductionBootstrap`) — correctly, because it would overwrite
 * live credentials. A live factory database therefore keeps whatever group names
 * its first bootstrap wrote, which is how the retired dev names (钟组 / 裴组)
 * outlived the dev roster. This is the narrow, restartable counterpart: master
 * data only, derived from the same fixture and the same pure naming helper the
 * bootstrap uses.
 *
 * What it will NOT do: create groups, touch users, projects, issues, activity
 * logs, permissions, or any group outside the `assembly` parent. It fails loudly
 * instead of guessing — a missing group means the database was never
 * bootstrapped, and a missing or archived leader means the roster and the
 * database disagree about who works here (fix the roster or the account first).
 *
 * THIS SCRIPT HAS NO PRODUCTION-MODE REFUSAL, AND MUST NOT GAIN ONE. It is the
 * only supported way to correct these master-data rows on the Mac mini, where
 * `MOLDPILOT_DEPLOYMENT_MODE=production` and `pnpm prisma:bootstrap` /
 * `scripts/dev-refresh.sh` both refuse by contract. It imports exactly one thing
 * from `src/domain/security/deployment-mode.ts` — the pure `.env` text parser
 * `environmentFileValue` — and deliberately calls none of that module's
 * `assert*DeploymentAllowed` guards.
 *
 * WHERE THE CONNECTION COMES FROM (2026-08-06 incident fix). This used to be
 * `import "dotenv/config"`, which resolves `.env` from `process.cwd()` and
 * NEVER overrides a `DATABASE_URL` already exported into the environment. Every
 * other thing that runs on the mini does the opposite — `backup.sh`,
 * `backup-verify.sh`, `run-production-macos.sh` and `server-deploy-macos.sh` all
 * anchor the file to the project root and `set -a; source .env`, so the
 * protected file WINS. This script now follows that established pattern:
 * `<repo>/.env` (or `MOLDPILOT_ENV_FILE`) is authoritative, an inherited
 * `DATABASE_URL` that disagrees is reported and ignored, and the resolved
 * host:port/database is printed at startup — never the credentials — so the
 * operator can always see which database was touched.
 *
 *   pnpm prisma:sync-assembly-groups --diagnose  # read-only report, exit 3 on deltas
 *   pnpm prisma:sync-assembly-groups --dry-run   # same report, always exit 0
 *   pnpm prisma:sync-assembly-groups             # apply, then re-read and verify
 *
 * Exit codes: 0 in sync / applied, 1 apply refused or verification failed,
 * 2 misconfigured (no DATABASE_URL, no fixture leaders, bad flag), 3 --diagnose
 * found deltas.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { assemblyGroupDisplayName } from "../src/domain/mold-trial/assembly-groups.ts";
import { validateFactoryUserRoster } from "../src/domain/mold-trial/factory-user-roster.ts";
import { environmentFileValue } from "../src/domain/security/deployment-mode.ts";

const PROJECT_ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const FIXTURE_PATH = path.join(PROJECT_ROOT, "prisma", "fixtures", "factory-users-2026-07-27.json");
const ASSEMBLY_PARENT_CODE = "assembly";
const TAG = "[sync-assembly-groups]";

export const EXIT_OK = 0;
export const EXIT_FAILED = 1;
export const EXIT_MISCONFIGURED = 2;
export const EXIT_DELTAS = 3;

// --- Pure layer: everything below is I/O-free and unit-tested ----------------

/**
 * Argument parsing. `--diagnose` and `--dry-run` render the same read-only
 * report; they differ only in exit code, because `--dry-run` is documented as a
 * preview step in front of an apply and a non-zero preview would read as a
 * failure to the operator.
 *
 * @param {readonly string[]} argv
 * @returns {{ mode: "apply" | "diagnose" | "dry-run" | "help", unknown: string[] }}
 */
export function parseSyncArguments(argv) {
  let mode = "apply";
  const unknown = [];

  for (const argument of argv) {
    if (argument === "--diagnose") {
      mode = "diagnose";
    } else if (argument === "--dry-run") {
      mode = "dry-run";
    } else if (argument === "--help" || argument === "-h") {
      mode = "help";
    } else {
      unknown.push(argument);
    }
  }

  return { mode, unknown };
}

/** True when a mode may write. The single gate every write path goes through. */
export function modeWrites(mode) {
  return mode === "apply";
}

/**
 * The connection string this run will use, and WHERE it came from. The env file
 * wins over the inherited environment (the `set -a; source .env` semantics every
 * other mini script uses); an inherited value that disagrees is surfaced so a
 * stale exported `DATABASE_URL` can never redirect the run in silence.
 *
 * @param {{ envFileContents: string | null | undefined, inheritedDatabaseUrl: string | null | undefined }} input
 * @returns {{ connectionString: string | null, source: "env-file" | "environment" | "none",
 *            inherited: string | null, overrodeEnvironment: boolean }}
 */
export function resolveDatabaseUrl({ envFileContents, inheritedDatabaseUrl }) {
  const trim = (value) => (typeof value === "string" && value.trim().length > 0 ? value.trim() : null);
  const inherited = trim(inheritedDatabaseUrl);
  const fromFile = envFileContents == null ? null : trim(environmentFileValue(envFileContents, "DATABASE_URL"));

  if (fromFile != null) {
    return {
      connectionString: fromFile,
      source: "env-file",
      inherited,
      overrodeEnvironment: inherited != null && inherited !== fromFile
    };
  }

  return {
    connectionString: inherited,
    source: inherited == null ? "none" : "environment",
    inherited,
    overrodeEnvironment: false
  };
}

/**
 * `host:port/database` — the identity of the database, with the credentials
 * dropped on the floor. Printed at startup and in every report header.
 */
export function describeDatabaseTarget(connectionString) {
  try {
    const url = new URL(connectionString);
    const host = url.hostname.length > 0 ? url.hostname : "(no host)";
    const database = url.pathname.replace(/^\//, "");

    return `${host}:${url.port.length > 0 ? url.port : "5432"}/${database.length > 0 ? database : "(no database)"}`;
  } catch {
    return "(unparseable DATABASE_URL)";
  }
}

/**
 * @typedef {object} DiagnosisGroupRow The `assembly-*` DepartmentGroup as read.
 * @property {string} name
 * @property {boolean} active
 * @property {string | null} kpiLeaderId
 * @property {string | null} parentGroupCode
 * @property {null | { id: string, username: string, chineseName: string | null, status: string }} leader
 */

/**
 * @typedef {object} DiagnosisInput
 * @property {string} code
 * @property {DiagnosisGroupRow | null} group          null when the code has no DepartmentGroup row.
 * @property {null | { username: string, displayName: string, chineseName: string | null }} expectedLeader
 *   The fixture's designated leader for this code, or null when the fixture has none.
 * @property {null | { id: string, username: string, chineseName: string | null, status: string }} expectedLeaderAccount
 *   That leader's account in THIS database, or null when the account is absent.
 */

/**
 * The verdict for one `assembly-*` code. Exactly five states, in precedence
 * order, so a row that is wrong in two ways still reports the blocking problem
 * first while `nameChanged` / `leaderChanged` carry the full delta:
 *
 *   GROUP MISSING   the code has no row, or its row is not a child of `assembly`
 *                   — this database was never bootstrapped. Apply refuses.
 *   FIXTURE MISSING a group exists that the reviewed roster designates no leader
 *                   for. Reported, never written: the script only ever touches
 *                   codes the fixture names.
 *   NEEDS LEADER    the designated leader is absent, archived, or is not the
 *                   account currently on `kpiLeaderId`. Apply refuses on absent
 *                   or archived (roster and database disagree about who works
 *                   here); it repoints when the account is present and ACTIVE.
 *   NEEDS RENAME    right leader, stale display name — the 钟组 / 裴组 case.
 *   MATCHES         nothing to do.
 *
 * Naming is delegated to `assemblyGroupDisplayName`; this function decides
 * nothing about names.
 *
 * @param {DiagnosisInput} input
 */
export function diagnoseAssemblyGroupRow({ code, group, expectedLeader, expectedLeaderAccount }) {
  const expectedName = expectedLeader == null ? null : assemblyGroupDisplayName(code, expectedLeader);
  const nameChanged = group != null && expectedName != null && group.name !== expectedName;
  const leaderChanged =
    group != null && expectedLeaderAccount != null && group.kpiLeaderId !== expectedLeaderAccount.id;

  const row = {
    code,
    verdict: "MATCHES",
    expectedName,
    expectedLeaderUsername: expectedLeader?.username ?? null,
    nameChanged,
    leaderChanged,
    /** Writable rows are the ones an apply may fix without guessing. */
    writable: false,
    /** A blocking disagreement between the roster and the database. */
    blocking: null,
    details: []
  };

  if (group == null) {
    row.verdict = "GROUP MISSING";
    row.blocking = `department group ${code} does not exist — run pnpm prisma:bootstrap on a fresh database first`;
    return row;
  }
  if (group.parentGroupCode !== ASSEMBLY_PARENT_CODE) {
    row.verdict = "GROUP MISSING";
    row.blocking = `department group ${code} is not a child of the assembly department`;
    return row;
  }
  if (!group.active) {
    row.details.push("group is INACTIVE — the intake picker will not offer it");
  }
  if (expectedLeader == null) {
    row.verdict = "FIXTURE MISSING";
    row.details.push(`${path.basename(FIXTURE_PATH)} designates no leader for ${code}; left untouched`);
    return row;
  }
  if (expectedLeaderAccount == null) {
    row.verdict = "NEEDS LEADER";
    row.blocking = `roster leader ${expectedLeader.username} has no account in this database`;
    return row;
  }
  if (expectedLeaderAccount.status !== "ACTIVE") {
    row.verdict = "NEEDS LEADER";
    row.blocking = `roster leader ${expectedLeader.username} is ${expectedLeaderAccount.status} in this database`;
    return row;
  }

  if (nameChanged) {
    row.details.push(`name ${group.name} -> ${expectedName}`);
  }
  if (leaderChanged) {
    row.details.push(
      `leader ${group.leader?.username ?? "(none)"} -> ${expectedLeader.username}` +
        ` (${expectedLeader.chineseName ?? expectedLeader.displayName})`
    );
  }
  if (leaderChanged) {
    row.verdict = "NEEDS LEADER";
    row.writable = true;
  } else if (nameChanged) {
    row.verdict = "NEEDS RENAME";
    row.writable = true;
  }

  return row;
}

/**
 * One summary line's worth of arithmetic over the diagnosed rows.
 *
 * @param {readonly ReturnType<typeof diagnoseAssemblyGroupRow>[]} rows
 */
export function summarizeAssemblyGroupDiagnosis(rows) {
  const counts = { MATCHES: 0, "NEEDS RENAME": 0, "NEEDS LEADER": 0, "GROUP MISSING": 0, "FIXTURE MISSING": 0 };
  for (const row of rows) {
    counts[row.verdict] += 1;
  }

  const deltas = rows.filter((row) => row.verdict !== "MATCHES" && row.verdict !== "FIXTURE MISSING").length;

  return {
    total: rows.length,
    counts,
    /** Rows an apply would write. */
    writable: rows.filter((row) => row.writable).length,
    /** Rows an apply must refuse. */
    blocked: rows.filter((row) => row.blocking != null).length,
    deltas,
    allMatch: deltas === 0
  };
}

/** CJK characters occupy two terminal cells; the report is unreadable otherwise. */
export function displayWidth(text) {
  let width = 0;
  for (const character of text) {
    const code = character.codePointAt(0);
    const wide =
      (code >= 0x1100 && code <= 0x115f) ||
      (code >= 0x2e80 && code <= 0x303e) ||
      (code >= 0x3041 && code <= 0x33ff) ||
      (code >= 0x3400 && code <= 0x4dbf) ||
      (code >= 0x4e00 && code <= 0x9fff) ||
      (code >= 0xa000 && code <= 0xa4cf) ||
      (code >= 0xac00 && code <= 0xd7a3) ||
      (code >= 0xf900 && code <= 0xfaff) ||
      (code >= 0xfe30 && code <= 0xfe6f) ||
      (code >= 0xff00 && code <= 0xff60) ||
      (code >= 0xffe0 && code <= 0xffe6) ||
      (code >= 0x20000 && code <= 0x3fffd);
    width += wide ? 2 : 1;
  }

  return width;
}

/** Renders `cells` as a fixed-width table with a header rule. Pure. */
export function renderTable(header, rows) {
  const all = [header, ...rows];
  const widths = header.map((_, column) =>
    all.reduce((widest, cells) => Math.max(widest, displayWidth(cells[column] ?? "")), 0)
  );
  const line = (cells) =>
    cells
      .map((cell, column) => `${cell ?? ""}${" ".repeat(Math.max(0, widths[column] - displayWidth(cell ?? "")))}`)
      .join("  ")
      .trimEnd();

  return [line(header), widths.map((width) => "-".repeat(width)).join("  "), ...rows.map(line)];
}

// --- I/O layer ---------------------------------------------------------------

function describeAccount(account) {
  if (account == null) {
    return "(none)";
  }
  const chineseName = account.chineseName == null ? "" : ` (${account.chineseName})`;
  return `${account.username}${chineseName} ${account.status}`;
}

function reportRows(rows) {
  const table = renderTable(
    ["CODE", "DB NAME", "DB LEADER", "FIXTURE NAME", "FIXTURE LEADER", "VERDICT"],
    rows.map(({ row, group, expectedLeader, expectedLeaderAccount }) => [
      row.code,
      group == null ? "(no group)" : `${group.name}${group.active ? "" : " [inactive]"}`,
      group == null ? "-" : describeAccount(group.leader),
      row.expectedName ?? "-",
      expectedLeader == null
        ? "-"
        : `${expectedLeader.username}${expectedLeader.chineseName == null ? "" : ` (${expectedLeader.chineseName})`}` +
          `${expectedLeaderAccount == null ? " [no account]" : ""}`,
      row.verdict
    ])
  );

  for (const line of table) {
    console.log(`  ${line}`);
  }

  const annotated = rows.filter(({ row }) => row.details.length > 0 || row.blocking != null);
  if (annotated.length > 0) {
    console.log("");
    for (const { row } of annotated) {
      for (const detail of row.details) {
        console.log(`  ${row.code}: ${detail}`);
      }
      if (row.blocking != null) {
        console.log(`  ${row.code}: BLOCKED — ${row.blocking}`);
      }
    }
  }
}

function printHelp() {
  console.log(`MoldPilot assembly group sync

  pnpm prisma:sync-assembly-groups --diagnose   Read-only report. Exit 0 in sync, 3 on deltas.
  pnpm prisma:sync-assembly-groups --dry-run    Same report as a preview. Always exit 0.
  pnpm prisma:sync-assembly-groups              Apply, then re-read and verify.

Rewrites name + kpiLeaderId on the assembly-* child groups ONLY, from
prisma/fixtures/factory-users-2026-07-27.json. Creates nothing; touches no user,
project, issue or activity row. Safe to run on the production mini.

Connection: ${path.join(PROJECT_ROOT, ".env")} wins over an exported DATABASE_URL.
Point MOLDPILOT_ENV_FILE at another file to use it instead.`);
}

async function main() {
  const { mode, unknown } = parseSyncArguments(process.argv.slice(2));

  if (unknown.length > 0) {
    console.error(`${TAG} [fail] Unknown argument: ${unknown.join(" ")}`);
    console.error(`${TAG}        Try --diagnose, --dry-run, or --help.`);
    return EXIT_MISCONFIGURED;
  }
  if (mode === "help") {
    printHelp();
    return EXIT_OK;
  }

  // -- 1. Connection, resolved the way every other mini script resolves it ----
  const envFile = process.env.MOLDPILOT_ENV_FILE?.trim() || path.join(PROJECT_ROOT, ".env");
  const envFileExists = existsSync(envFile);
  const resolved = resolveDatabaseUrl({
    envFileContents: envFileExists ? readFileSync(envFile, "utf8") : null,
    inheritedDatabaseUrl: process.env.DATABASE_URL
  });

  console.log(`${TAG} repo      : ${PROJECT_ROOT}`);
  console.log(`${TAG} env file  : ${envFile}${envFileExists ? "" : "  [MISSING]"}`);

  if (resolved.connectionString == null) {
    console.error(
      `${TAG} [fail] DATABASE_URL is not set in ${envFile}${envFileExists ? "" : " (file does not exist)"}` +
        " and is not exported in this shell. Nothing was read or written."
    );
    return EXIT_MISCONFIGURED;
  }

  console.log(
    `${TAG} database  : ${describeDatabaseTarget(resolved.connectionString)}` +
      `  (DATABASE_URL from ${resolved.source === "env-file" ? "the env file" : "the shell environment"})`
  );
  if (resolved.source === "environment") {
    console.log(
      `${TAG} NOTE      : no DATABASE_URL in the env file, so this shell's exported value is being used.`
    );
  }
  if (resolved.overrodeEnvironment) {
    console.log(
      `${TAG} NOTE      : this shell also exports DATABASE_URL for` +
        ` ${describeDatabaseTarget(resolved.inherited)} — IGNORED, the env file wins.`
    );
  }

  // -- 2. Fixture ------------------------------------------------------------
  const roster = validateFactoryUserRoster(JSON.parse(readFileSync(FIXTURE_PATH, "utf8")));
  const assemblyLeaders = new Map(
    roster.people
      .filter(
        (person) =>
          person.teamLeader &&
          typeof person.kpiTeamCode === "string" &&
          person.kpiTeamCode.startsWith(`${ASSEMBLY_PARENT_CODE}-`)
      )
      .map((person) => [person.kpiTeamCode, person])
  );

  console.log(`${TAG} fixture   : ${FIXTURE_PATH}`);
  console.log(`${TAG} leaders   : ${assemblyLeaders.size} assembly team leader(s) in the fixture`);

  if (assemblyLeaders.size === 0) {
    console.error(
      `${TAG} [fail] ${path.basename(FIXTURE_PATH)} designates NO assembly team leader` +
        " (a person with teamLeader=true and kpiTeamCode starting with `assembly-`)."
    );
    console.error(`${TAG}        There is nothing this script could sync. Fix the roster fixture first.`);
    console.error(`${TAG}        Nothing was written.`);
    return EXIT_MISCONFIGURED;
  }

  // -- 3. Read the database (every mode reads; only apply writes) ------------
  const { PrismaClient } = await import("@prisma/client");
  const { PrismaPg } = await import("@prisma/adapter-pg");
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: resolved.connectionString }) });

  const groupSelect = {
    id: true,
    code: true,
    name: true,
    active: true,
    kpiLeaderId: true,
    parentGroup: { select: { code: true } },
    kpiLeader: { select: { id: true, username: true, chineseName: true, status: true } }
  };

  async function readRows() {
    const [children, leaderAccounts] = await Promise.all([
      prisma.departmentGroup.findMany({
        where: { parentGroup: { code: ASSEMBLY_PARENT_CODE } },
        select: groupSelect,
        orderBy: [{ code: "asc" }]
      }),
      prisma.user.findMany({
        where: { username: { in: [...assemblyLeaders.values()].map((person) => person.username) } },
        select: { id: true, username: true, chineseName: true, status: true }
      })
    ]);

    // A fixture code whose group is absent from the child list may still exist
    // under the wrong parent (or none) — look it up so the verdict can say so.
    const byCode = new Map(children.map((group) => [group.code, group]));
    const orphanCodes = [...assemblyLeaders.keys()].filter((code) => !byCode.has(code));
    if (orphanCodes.length > 0) {
      const orphans = await prisma.departmentGroup.findMany({
        where: { code: { in: orphanCodes } },
        select: groupSelect
      });
      for (const group of orphans) {
        byCode.set(group.code, group);
      }
    }

    const accountByUsername = new Map(leaderAccounts.map((account) => [account.username, account]));
    const codes = [...new Set([...assemblyLeaders.keys(), ...byCode.keys()])].sort((left, right) =>
      left.localeCompare(right)
    );

    return codes.map((code) => {
      const group = byCode.get(code) ?? null;
      const expectedLeader = assemblyLeaders.get(code) ?? null;
      const expectedLeaderAccount =
        expectedLeader == null ? null : (accountByUsername.get(expectedLeader.username) ?? null);
      const shaped =
        group == null
          ? null
          : {
              name: group.name,
              active: group.active,
              kpiLeaderId: group.kpiLeaderId,
              parentGroupCode: group.parentGroup?.code ?? null,
              leader: group.kpiLeader
            };

      return {
        id: group?.id ?? null,
        group: shaped,
        expectedLeader,
        expectedLeaderAccount,
        row: diagnoseAssemblyGroupRow({ code, group: shaped, expectedLeader, expectedLeaderAccount })
      };
    });
  }

  try {
    const rows = await readRows();
    const summary = summarizeAssemblyGroupDiagnosis(rows.map((entry) => entry.row));

    console.log("");
    reportRows(rows);
    console.log("");

    // -- 4a. Read-only modes ------------------------------------------------
    if (!modeWrites(mode)) {
      if (summary.allMatch) {
        console.log(
          `${TAG} [ok] ${summary.total} group(s) checked on` +
            ` ${describeDatabaseTarget(resolved.connectionString)}, all match the reviewed roster.` +
            " Nothing to do." +
            (summary.counts["FIXTURE MISSING"] > 0
              ? ` (${summary.counts["FIXTURE MISSING"]} group(s) the roster names no leader for are never touched.)`
              : "")
        );
        return EXIT_OK;
      }

      console.log(
        `${TAG} [deltas] ${summary.deltas} of ${summary.total} group(s) on` +
          ` ${describeDatabaseTarget(resolved.connectionString)} differ from the reviewed roster` +
          ` (${summary.writable} fixable by this script, ${summary.blocked} blocked). Run` +
          " `pnpm prisma:sync-assembly-groups` to apply."
      );
      return mode === "diagnose" ? EXIT_DELTAS : EXIT_OK;
    }

    // -- 4b. Apply ----------------------------------------------------------
    const blocked = rows.filter((entry) => entry.row.blocking != null);
    if (blocked.length > 0) {
      for (const entry of blocked) {
        console.error(`${TAG} [fail] ${entry.row.code}: ${entry.row.blocking}`);
      }
      console.error(`${TAG}        Refusing to guess. NOTHING WAS WRITTEN.`);
      return EXIT_FAILED;
    }

    const changes = rows.filter((entry) => entry.row.writable);
    if (changes.length === 0) {
      console.log(
        `${TAG} [ok] Assembly groups already match the reviewed roster; nothing to do.` +
          ` (${summary.total} group(s) checked on ${describeDatabaseTarget(resolved.connectionString)}.)`
      );
      return EXIT_OK;
    }

    for (const entry of changes) {
      const before = { name: entry.group.name, leader: entry.group.leader?.username ?? "(none)" };
      await prisma.departmentGroup.update({
        where: { id: entry.id },
        data: { name: entry.row.expectedName, kpiLeaderId: entry.expectedLeaderAccount.id }
      });
      console.log(
        `${TAG} [applied] ${entry.row.code}: name ${before.name} -> ${entry.row.expectedName};` +
          ` leader ${before.leader} -> ${entry.expectedLeaderAccount.username}`
      );
    }

    // Re-read: the whole point of the 2026-08-06 incident is that "it ran" and
    // "the database changed" were never the same statement.
    const after = await readRows();
    const afterSummary = summarizeAssemblyGroupDiagnosis(after.map((entry) => entry.row));
    if (!afterSummary.allMatch) {
      console.error("");
      reportRows(after);
      console.error("");
      console.error(
        `${TAG} [fail] Wrote ${changes.length} group(s) but ${afterSummary.deltas} still differ on re-read` +
          ` of ${describeDatabaseTarget(resolved.connectionString)}. Investigate before trusting the picker.`
      );
      return EXIT_FAILED;
    }

    console.log("");
    console.log(
      `${TAG} [ok] Updated ${changes.length} assembly group(s) on` +
        ` ${describeDatabaseTarget(resolved.connectionString)} from ${path.basename(FIXTURE_PATH)},` +
        " re-read and verified. The picker reads the database per request — no restart needed."
    );
    return EXIT_OK;
  } finally {
    await prisma.$disconnect();
  }
}

const invokedDirectly =
  process.argv[1] != null && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  process.exitCode = await main().catch((error) => {
    console.error(`${TAG} [fail] ${error instanceof Error ? error.message : String(error)}`);
    return EXIT_FAILED;
  });
}
