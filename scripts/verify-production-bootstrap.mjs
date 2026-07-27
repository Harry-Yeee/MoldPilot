import "dotenv/config";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { validateFactoryUserRoster } from "../src/domain/mold-trial/factory-user-roster.ts";
import { clientOwnerUsernameByChineseName } from "../src/domain/mold-trial/client-owner-mapping.ts";
import { verifyPassword } from "../src/server/passwords.ts";

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
  throw new Error(`Production bootstrap verification failed: ${message}`);
}

try {
  const [
    users,
    projectCount,
    trialCount,
    issueCount,
    activityCount,
    overrideCount,
    customerCount,
    machineCount,
    templateCount,
    fakeSupportCustomerCount
  ] = await Promise.all([
    prisma.user.findMany({
      include: {
        role: true,
        departmentGroup: true
      }
    }),
    prisma.moldTrialProject.count(),
    prisma.trialEvent.count(),
    prisma.trialIssue.count(),
    prisma.activityLog.count(),
    prisma.userPermissionOverride.count(),
    prisma.customer.count(),
    prisma.injectionMachine.count(),
    prisma.processSheetTemplate.count(),
    prisma.customer.count({
      where: {
        code: {
          in: [
            "C-027",
            "C-028",
            "C-029",
            "C-030",
            "C-031",
            "C-032",
            "C-033",
            "C-034",
            "C-035",
            "C-036",
            "C-037",
            "C-INTAKE",
            "C-PILOT",
            "C-E2E",
            "C-WF"
          ]
        }
      }
    })
  ]);

  const expectedUsernames = new Set([
    "admin",
    ...roster.people.map((person) => person.username)
  ]);
  if (users.length !== expectedUsernames.size) {
    fail(`expected ${expectedUsernames.size} users, found ${users.length}`);
  }

  const usersByUsername = Object.fromEntries(
    users.map((user) => [user.username, user])
  );
  for (const username of expectedUsernames) {
    if (usersByUsername[username] == null) {
      fail(`missing user ${username}`);
    }
  }
  for (const user of users) {
    if (!expectedUsernames.has(user.username)) {
      fail(`unexpected user ${user.username}`);
    }
    if (user.status !== "ACTIVE" || !user.forcePasswordChange) {
      fail(`${user.username} is not active in forced-password-change state`);
    }
  }

  const admin = usersByUsername.admin;
  if (
    admin.role.code !== "admin" ||
    !admin.isDefaultAdmin ||
    admin.passwordHash == null ||
    !verifyPassword("admin", admin.passwordHash)
  ) {
    fail("protected Admin identity or temporary credential is invalid");
  }

  for (const person of roster.people) {
    const user = usersByUsername[person.username];
    if (
      user.displayName !== person.displayName ||
      user.chineseName !== person.chineseName ||
      user.role.code !== person.roleCode.toLowerCase() ||
      user.locale !== person.locale ||
      (user.departmentGroup?.code ?? null) !== person.kpiTeamCode ||
      user.passwordHash == null ||
      !verifyPassword("123456", user.passwordHash)
    ) {
      fail(`profile, KPI membership, or temporary credential mismatch for ${person.username}`);
    }
    if (
      person.teamLeader &&
      user.departmentGroup?.kpiLeaderId !== user.id
    ) {
      fail(`${person.username} is not the leader of ${person.kpiTeamCode}`);
    }
  }

  const operationalCounts = {
    projects: projectCount,
    trials: trialCount,
    issues: issueCount,
    activityLogs: activityCount
  };
  for (const [label, count] of Object.entries(operationalCounts)) {
    if (count !== 0) {
      fail(`expected zero ${label}, found ${count}`);
    }
  }
  if (overrideCount !== roster.permissionExceptions.length) {
    fail(`permission override count is ${overrideCount}`);
  }
  if (fakeSupportCustomerCount !== 0) {
    fail(`found ${fakeSupportCustomerCount} demo/support customers`);
  }
  if (customerCount === 0 || machineCount < 25 || templateCount === 0) {
    fail("production client, machine, or process-template master data is incomplete");
  }

  for (const [chineseName, username] of Object.entries(
    clientOwnerUsernameByChineseName
  )) {
    const ownerCount = await prisma.customer.count({
      where: {
        ownerUser: {
          username,
          chineseName
        }
      }
    });
    if (ownerCount === 0) {
      fail(`no clients are assigned to ${username} / ${chineseName}`);
    }
  }

  console.log(
    `Production bootstrap verified: ${users.length} active accounts, ` +
      `${customerCount} clients, ${machineCount} machines, ${templateCount} template, ` +
      "and zero demo operational records."
  );
} finally {
  await prisma.$disconnect();
}
