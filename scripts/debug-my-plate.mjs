#!/usr/bin/env node
/**
 * Read-only diagnostic: why does an issue show (or not show) on a user's task list?
 *
 * Usage:
 *   node scripts/debug-my-plate.mjs zhong
 *
 * Prints the target user's identity/role, the 15 most recent trial issues with
 * their ownership fields, and — using the REAL production section-membership
 * functions from src/domain/mold-trial/my-plate.ts — the verdict for each
 * section of the task list, plus a likely-cause hint for misses.
 * Makes no writes.
 *
 * ROSTER: works against ANY roster, but the DEFAULT argument is the legacy dev
 * seed username `zhong`. On a bootstrapped DB (`pnpm prisma:bootstrap`) pass a
 * real username from the reviewed factory roster instead.
 */
import "dotenv/config";

import {
  belongsToAssemblyAcknowledgeSection,
  belongsToAssemblySelfCheckSection,
  belongsToDepartmentInboxSection,
  belongsToMyOpenIssuesSection,
  belongsToPmConfirmReadySection
} from "../src/domain/mold-trial/my-plate.ts";

const roleCodeMap = {
  gm: "GM",
  pm: "PM",
  marketing: "MARKETING",
  injection: "INJECTION",
  assembly: "ASSEMBLY",
  qc: "QC",
  design: "DESIGN",
  viewer: "VIEWER",
  admin: "ADMIN"
};

const username = process.argv[2] ?? "zhong";

const { PrismaClient } = await import("@prisma/client");
const { PrismaPg } = await import("@prisma/adapter-pg");
const connectionString =
  process.env.DATABASE_URL ?? "postgresql://moldpilot:moldpilot@localhost:5432/moldpilot?schema=public";
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

try {
  const user = await prisma.user.findUnique({
    where: { username },
    include: { role: true, departmentGroup: true }
  });

  if (user == null) {
    console.error(`[FAIL] No user with username "${username}".`);
    process.exit(1);
  }

  const roleCode = roleCodeMap[user.role.code];
  const viewer = { userId: user.id, roleCode };

  console.log(`User      : ${user.displayName} (${user.username})  id=${user.id}`);
  console.log(`Role      : db code "${user.role.code}" -> roleCode ${roleCode ?? "!! UNMAPPED !!"}`);
  console.log(`Dept group: ${user.departmentGroup?.code ?? "(none)"}`);
  console.log(`Status    : ${user.status}`);
  console.log("");

  const issues = await prisma.trialIssue.findMany({
    orderBy: { createdAt: "desc" },
    take: 15,
    include: {
      ownerUser: { select: { username: true } },
      ownerGroup: { select: { code: true } },
      moldTrialProject: { select: { projectCode: true, planningPmId: true, technicalPmId: true } }
    }
  });

  console.log(`Most recent ${issues.length} trial issues (newest first):`);
  console.log("");

  for (const issue of issues) {
    const record = {
      status: issue.status,
      ownerUserId: issue.ownerUserId,
      issueType: issue.issueType,
      ownerGroupCode: issue.ownerGroup?.code ?? null,
      assemblyAcknowledgedAt: issue.assemblyAcknowledgedAt,
      assemblySelfCheckedAt: issue.assemblySelfCheckedAt,
      pmReadyConfirmedAt: issue.pmReadyConfirmedAt,
      projectPlanningPmId: issue.moldTrialProject.planningPmId,
      projectTechnicalPmId: issue.moldTrialProject.technicalPmId
    };

    const inMyOpen = belongsToMyOpenIssuesSection(viewer, record);
    const inDepartmentInbox = belongsToDepartmentInboxSection(viewer, record);
    const inAck = belongsToAssemblyAcknowledgeSection(viewer, record);
    const inSelfCheck = belongsToAssemblySelfCheckSection(viewer, record);
    const inPmReady = belongsToPmConfirmReadySection(viewer, record);
    const anywhere = inMyOpen || inDepartmentInbox || inAck || inSelfCheck || inPmReady;

    console.log(`[${anywhere ? "SHOWS" : "  -  "}] ${issue.moldTrialProject.projectCode} · "${issue.title}"`);
    console.log(
      `        status=${issue.status}  type=${issue.issueType}  ownerUser=${issue.ownerUser?.username ?? "(NULL)"}  ownerGroup=${issue.ownerGroup?.code ?? "(null)"}  created=${issue.createdAt.toISOString().slice(0, 10)}`
    );
    console.log(
      `        sections for ${username}: myOpenIssues=${inMyOpen} departmentInbox=${inDepartmentInbox} assemblyAcknowledge=${inAck} assemblySelfCheck=${inSelfCheck} pmConfirmReady=${inPmReady}`
    );

    if (!anywhere) {
      const hints = [];
      if (issue.ownerUserId == null) {
        hints.push("owner USER is NULL but the group does not match this user's inbox rules");
      } else if (issue.ownerUserId !== user.id) {
        hints.push(`owner is a different user (${issue.ownerUser?.username ?? issue.ownerUserId})`);
      }
      if (["VERIFIED", "CLOSED"].includes(issue.status)) {
        hints.push(`status ${issue.status} is excluded from open lists`);
      }
      if (roleCode !== "ASSEMBLY" && issue.ownerGroup?.code === "assembly") {
        hints.push(`owned by assembly GROUP but ${username} role is ${roleCode}, group sections need ASSEMBLY role`);
      }
      if (hints.length > 0) {
        console.log(`        hint: ${hints.join("; ")}`);
      }
    }

    console.log("");
  }

  const ownedOpenCount = await prisma.trialIssue.count({
    where: { ownerUserId: user.id, status: { notIn: ["VERIFIED", "CLOSED"] } }
  });
  console.log(`Open issues with ownerUserId=${username}: ${ownedOpenCount}`);
  console.log("If an issue you expected is [ - ] above, the 'hint' line is the reason the task page skips it.");
} finally {
  await prisma.$disconnect();
}
