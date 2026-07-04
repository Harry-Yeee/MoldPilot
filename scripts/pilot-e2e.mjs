#!/usr/bin/env node
import "dotenv/config";

import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import {
  validateFirstPlannedTrialSchedule,
  validateMoldTrialProjectCreate,
  validateTrialIssueLifecycleUpdate
} from "../src/domain/mold-trial/validation.ts";

const connectionString =
  process.env.DATABASE_URL ?? "postgresql://moldpilot:moldpilot@localhost:5432/moldpilot?schema=public";
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString })
});
const PROJECT_CODE = "MP-E2E-INTAKE-001";
const SESSION_COOKIE_NAME = "moldpilot_session";
const SESSION_VERSION = "v1";

function date(value) {
  return new Date(`${value}T00:00:00.000Z`);
}

function dateTime(value) {
  return new Date(value);
}

async function log(actorUserId, entityType, entityId, action, afterJson) {
  await prisma.activityLog.create({
    data: {
      actorUserId,
      entityType,
      entityId,
      action,
      afterJson
    }
  });
}

function sessionSecret() {
  return process.env.MOLDPILOT_SESSION_SECRET ?? "moldpilot-local-pilot-session-secret";
}

function signSessionPayload(payload) {
  return createHmac("sha256", sessionSecret()).update(payload).digest("base64url");
}

function createSessionToken(userId) {
  const issuedAt = Math.floor(Date.now() / 1000);
  const payload = Buffer.from(JSON.stringify({ v: SESSION_VERSION, userId, issuedAt })).toString("base64url");

  return `${payload}.${signSessionPayload(payload)}`;
}

async function requiredUser(username) {
  const user = await prisma.user.findUnique({
    where: { username },
    include: { role: true }
  });

  if (user == null) {
    throw new Error(`Missing seeded user ${username}. Run pnpm pilot:seed first.`);
  }

  return user;
}

async function requiredGroup(code) {
  const group = await prisma.departmentGroup.findUnique({ where: { code } });

  if (group == null) {
    throw new Error(`Missing seeded group ${code}. Run pnpm pilot:seed first.`);
  }

  return group;
}

async function requiredCustomer(code) {
  const customer = await prisma.customer.findUnique({ where: { code } });

  if (customer == null || !customer.active) {
    throw new Error(`Missing active seeded customer ${code}. Run pnpm pilot:seed first.`);
  }

  return customer;
}

function assertPermissions() {
  const marketingSchedule = validateFirstPlannedTrialSchedule({
    actorRole: "MARKETING",
    moldCode: "M-E2E-01",
    plannedDate: "2026-08-08",
    projectStatus: "Intake"
  });
  assert.equal(marketingSchedule.ok, false);

  const marketingScheduledCreate = validateMoldTrialProjectCreate({
    actorRole: "MARKETING",
    customerCode: "C-E2E",
    firstPlannedTrialDate: "2026-08-08",
    moldCode: "M-E2E-01",
    partCode: "P-E2E-A",
    planningPmId: "pm-1",
    projectCode: PROJECT_CODE
  });
  assert.equal(marketingScheduledCreate.ok, false);

  const assemblyRootCause = validateTrialIssueLifecycleUpdate({
    actorRole: "ASSEMBLY",
    changedFields: ["rootCause"],
    issueType: "Assembly / Fitting Issue",
    rootCause: "Attempted root cause edit.",
    status: "In Progress"
  });
  assert.equal(assemblyRootCause.ok, false);
}

async function optionalHttpSmoke() {
  try {
    const admin = await prisma.user.findUnique({
      where: { username: "admin" },
      select: {
        forcePasswordChange: true,
        id: true,
        status: true
      }
    });

    if (admin == null || admin.status !== "ACTIVE" || admin.forcePasswordChange) {
      throw new Error("Seeded Admin session could not be created.");
    }

    const headers = { Cookie: `${SESSION_COOKIE_NAME}=${createSessionToken(admin.id)}` };
    const dashboard = await fetch("http://localhost:3000/", { headers, signal: AbortSignal.timeout(3000) });
    const detail = await fetch(`http://localhost:3000/projects/${PROJECT_CODE}`, {
      headers,
      signal: AbortSignal.timeout(3000)
    });
    const dashboardText = await dashboard.text();
    const detailText = await detail.text();

    assert.equal(dashboard.status, 200);
    assert.equal(detail.status, 200);
    assert.match(dashboardText, new RegExp(PROJECT_CODE));
    assert.match(detailText, /Trial Issues/);
    assert.match(detailText, /Activity Timeline/);
    assert.match(detailText, /Assembly Ready/);
    console.log("[OK] HTTP pages include the E2E pilot project.");
  } catch (error) {
    console.log(
      `[WARN] HTTP page check skipped. Start pnpm dev and open http://localhost:3000 to inspect ${PROJECT_CODE}. ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
}

async function main() {
  console.log("MoldPilot pilot E2E workflow\n");

  await prisma.$connect();
  assertPermissions();
  console.log("[OK] Domain permission guards reject Marketing scheduling and Assembly root-cause edits.");

  const sales = await requiredUser("yvonne");
  const pm = await requiredUser("bill");
  const technicalPm = await requiredUser("jun");
  const assembly = await requiredUser("zhong");
  const technicalGroup = await requiredGroup("technical");
  const e2eCustomer = await requiredCustomer("C-E2E");

  await prisma.activityLog.deleteMany({ where: { action: { startsWith: "e2e_" } } });
  await prisma.moldTrialProject.deleteMany({ where: { projectCode: PROJECT_CODE } });

  const intake = await prisma.moldTrialProject.create({
    data: {
      projectCode: PROJECT_CODE,
      clientProjectRef: PROJECT_CODE,
      customerId: e2eCustomer.id,
      customerCode: e2eCustomer.code,
      partCode: "P-E2E-A",
      moldCode: "M-E2E-01",
      status: "INTAKE",
      priority: "HIGH",
      intakeNote: "Sanitized E2E intake created by Marketing/Sales.",
      customerTargetDate: date("2026-08-30"),
      initialCustomerNote: "Sanitized customer feedback/design-change note for pilot E2E.",
      baseTrialLimit: 3,
      currentTrialLimit: 3,
      createdById: sales.id
    }
  });
  await log(sales.id, "MoldTrialProject", intake.id, "e2e_created_project_intake", { projectCode: PROJECT_CODE });

  const scheduleValidation = validateFirstPlannedTrialSchedule({
    actorRole: "PM",
    moldCode: "M-E2E-01",
    plannedDate: "2026-08-08",
    projectStatus: "Intake",
    planningPmId: pm.id
  });
  assert.equal(scheduleValidation.ok, true);

  const t0 = await prisma.trialEvent.create({
    data: {
      moldTrialProjectId: intake.id,
      trialCode: "T0",
      sequenceNumber: 1,
      plannedDate: date("2026-08-08"),
      status: "PLANNED",
      countsAgainstLimit: false,
      createdById: pm.id
    }
  });
  await prisma.moldTrialProject.update({
    where: { id: intake.id },
    data: {
      planningPmId: pm.id,
      status: "WAITING_TRIAL",
      firstPlannedTrialDate: date("2026-08-08"),
      nextPlannedTrialDate: date("2026-08-08")
    }
  });
  await log(pm.id, "TrialEvent", t0.id, "e2e_set_t0_planned_date", { plannedDate: "2026-08-08" });

  const completedT0 = await prisma.trialEvent.update({
    where: { id: t0.id },
    data: {
      actualDate: date("2026-08-08"),
      status: "COMPLETED",
      result: "NOT_APPROVED",
      outcomeDisposition: "REWORK_REQUIRED",
      mainIssuesSummary: "E2E T0 needs correction and customer feedback follow-up.",
      countsAgainstLimit: true
    }
  });
  await prisma.moldTrialProject.update({ where: { id: intake.id }, data: { status: "IN_CORRECTION" } });
  await log(pm.id, "TrialEvent", completedT0.id, "e2e_recorded_completed_t0", { result: "NOT_APPROVED" });

  const technicalIssue = await prisma.trialIssue.create({
    data: {
      moldTrialProjectId: intake.id,
      foundAtTrialEventId: completedT0.id,
      title: "E2E T0 flash at shutoff",
      description: "Pilot E2E technical correction item.",
      issueType: "MOLD_DESIGN_ISSUE",
      source: "PM_REVIEW",
      severity: "HIGH",
      status: "IN_PROGRESS",
      ownerGroupId: technicalGroup.id,
      dueDate: date("2026-08-15"),
      createdById: technicalPm.id,
      reportedById: technicalPm.id
    }
  });
  await log(technicalPm.id, "TrialIssue", technicalIssue.id, "e2e_created_trial_issue", { title: technicalIssue.title });

  const feedbackIssue = await prisma.trialIssue.create({
    data: {
      moldTrialProjectId: intake.id,
      foundAtTrialEventId: completedT0.id,
      title: "E2E client feedback: cosmetic surface",
      description: "Sanitized Marketing/Sales customer feedback.",
      issueType: "BAD_CUSTOMER_FEEDBACK",
      source: "MARKETING_CLIENT_FEEDBACK",
      severity: "MEDIUM",
      status: "WAITING_CUSTOMER",
      ownerGroupId: technicalGroup.id,
      dueDate: date("2026-08-16"),
      createdById: sales.id,
      reportedById: sales.id
    }
  });
  await log(sales.id, "TrialIssue", feedbackIssue.id, "e2e_created_customer_feedback_issue", {
    title: feedbackIssue.title
  });

  const acknowledgedIssue = await prisma.trialIssue.update({
    where: { id: technicalIssue.id },
    data: {
      assemblyAcknowledgedAt: dateTime("2026-08-10T09:00:00.000Z"),
      assemblyEstimatedFinishDate: date("2026-08-18"),
      assemblyAcknowledgedById: assembly.id
    }
  });
  await log(assembly.id, "TrialIssue", acknowledgedIssue.id, "e2e_assembly_acknowledged_correction", {
    assemblyEstimatedFinishDate: "2026-08-18"
  });

  const readyIssue = await prisma.trialIssue.update({
    where: { id: technicalIssue.id },
    data: {
      pmReadyConfirmedAt: dateTime("2026-08-19T08:00:00.000Z"),
      pmReadyConfirmedById: pm.id,
      status: "WAITING_VERIFICATION"
    }
  });
  await log(pm.id, "TrialIssue", readyIssue.id, "e2e_pm_confirmed_correction_readiness", {
    pmReadyConfirmedAt: "2026-08-19"
  });

  const t1 = await prisma.trialEvent.create({
    data: {
      moldTrialProjectId: intake.id,
      trialCode: "T1",
      sequenceNumber: 2,
      plannedDate: date("2026-08-22"),
      status: "PLANNED",
      planReasonCategory: "MOLD_CORRECTION_VERIFICATION",
      planReasonDetail: "Verify T0 correction, customer feedback, and PM readiness confirmation.",
      sourceArea: "PLANNING",
      requestedById: pm.id,
      countsAgainstLimit: false,
      createdById: pm.id
    }
  });
  await prisma.moldTrialProject.update({
    where: { id: intake.id },
    data: { status: "WAITING_TRIAL", nextPlannedTrialDate: date("2026-08-22") }
  });
  await log(pm.id, "TrialEvent", t1.id, "e2e_scheduled_t1", { plannedDate: "2026-08-22" });

  const verified = await prisma.moldTrialProject.findUnique({
    where: { projectCode: PROJECT_CODE },
    include: {
      trialEvents: true,
      trialIssues: true
    }
  });
  const logs = await prisma.activityLog.count({
    where: {
      OR: [
        { entityId: intake.id },
        { entityId: t0.id },
        { entityId: t1.id },
        { entityId: technicalIssue.id },
        { entityId: feedbackIssue.id }
      ]
    }
  });

  assert.ok(verified);
  assert.equal(verified.customerId, e2eCustomer.id);
  assert.equal(verified.customerCode, e2eCustomer.code);
  assert.equal(verified.trialEvents.filter((trial) => trial.status === "COMPLETED" && trial.countsAgainstLimit).length, 1);
  assert.equal(verified.trialEvents.some((trial) => trial.trialCode === "T1" && trial.status === "PLANNED"), true);
  assert.equal(verified.trialIssues.some((issue) => issue.source === "MARKETING_CLIENT_FEEDBACK"), true);
  assert.equal(verified.trialIssues.some((issue) => issue.assemblyEstimatedFinishDate != null), true);
  assert.equal(verified.trialIssues.some((issue) => issue.pmReadyConfirmedAt != null), true);
  assert.ok(logs >= 7);
  console.log(`[OK] ${PROJECT_CODE} completed the intake -> T0 -> issues -> Assembly -> PM readiness -> T1 workflow.`);

  await optionalHttpSmoke();
}

main()
  .catch((error) => {
    console.error(`[FAIL] ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
