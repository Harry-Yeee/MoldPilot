import "dotenv/config";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { validateFactoryUserRoster } from "../src/domain/mold-trial/factory-user-roster.ts";
import { assemblyGroupDisplayName } from "../src/domain/mold-trial/assembly-groups.ts";

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
 *   pnpm prisma:sync-assembly-groups             # apply
 *   pnpm prisma:sync-assembly-groups --dry-run   # show what would change
 */

const dryRun = process.argv.slice(2).includes("--dry-run");
const connectionString = process.env.DATABASE_URL;
assert.ok(connectionString, "DATABASE_URL is required.");

const fixturePath = path.join(
  process.cwd(),
  "prisma",
  "fixtures",
  "factory-users-2026-07-27.json"
);
const roster = validateFactoryUserRoster(
  JSON.parse(readFileSync(fixturePath, "utf8"))
);
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString })
});

function fail(message) {
  throw new Error(`Assembly group sync failed: ${message}`);
}

/** Roster leaders of the assembly crews, keyed by their KPI team code. */
const assemblyLeaders = new Map(
  roster.people
    .filter(
      (person) =>
        person.teamLeader &&
        typeof person.kpiTeamCode === "string" &&
        person.kpiTeamCode.startsWith("assembly-")
    )
    .map((person) => [person.kpiTeamCode, person])
);

if (assemblyLeaders.size === 0) {
  fail(`${path.basename(fixturePath)} designates no assembly team leader`);
}

try {
  const changes = [];

  for (const [code, person] of [...assemblyLeaders].sort(([left], [right]) =>
    left.localeCompare(right)
  )) {
    const group = await prisma.departmentGroup.findUnique({
      where: { code },
      select: {
        id: true,
        name: true,
        kpiLeaderId: true,
        parentGroup: { select: { code: true } }
      }
    });
    if (group == null) {
      fail(`department group ${code} does not exist — run pnpm prisma:bootstrap on a fresh database first`);
    }
    if (group.parentGroup?.code !== "assembly") {
      fail(`department group ${code} is not a child of the assembly department`);
    }

    const leader = await prisma.user.findUnique({
      where: { username: person.username },
      select: { id: true, status: true, displayName: true, chineseName: true }
    });
    if (leader == null) {
      fail(`roster leader ${person.username} has no account in this database`);
    }
    if (leader.status !== "ACTIVE") {
      fail(`roster leader ${person.username} is ${leader.status} in this database`);
    }

    const name = assemblyGroupDisplayName(code, {
      displayName: person.displayName,
      chineseName: person.chineseName
    });
    const nameChanged = group.name !== name;
    const leaderChanged = group.kpiLeaderId !== leader.id;

    if (!nameChanged && !leaderChanged) {
      console.log(`${code}: already in sync (${group.name}, leader ${person.username})`);
      continue;
    }

    console.log(
      `${code}: ${group.name} -> ${name}` +
        (leaderChanged ? `, leader -> ${person.username} (${person.chineseName ?? person.displayName})` : "")
    );
    changes.push({ code, groupId: group.id, name, kpiLeaderId: leader.id });
  }

  if (changes.length === 0) {
    console.log("Assembly groups already match the reviewed roster; nothing to write.");
  } else if (dryRun) {
    console.log(`--dry-run: ${changes.length} group(s) would be updated. Re-run without --dry-run to apply.`);
  } else {
    for (const change of changes) {
      await prisma.departmentGroup.update({
        where: { id: change.groupId },
        data: { name: change.name, kpiLeaderId: change.kpiLeaderId }
      });
    }
    console.log(`Updated ${changes.length} assembly group(s) from ${path.basename(fixturePath)}.`);
  }
} finally {
  await prisma.$disconnect();
}
