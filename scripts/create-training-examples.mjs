#!/usr/bin/env node
/**
 * Training-session demo data ("MP-DEMO-" projects).
 *
 *   pnpm training:examples            # build the three demo projects
 *   pnpm training:examples -- --reset # delete MP-DEMO- data first, then rebuild
 *   pnpm training:examples -- --reset-only
 *
 * PURPOSE — the pre-launch training session walks the workflows the v2 posters in
 * `docs/07-training/` teach (roles-responsibilities STAGE 1-6, claiming, scores).
 * This script writes the three example projects a trainer needs on screen:
 *
 *   MP-DEMO-001  完整流程 — one COMPLETE journey, intake to final approval:
 *                intake -> planned T0 -> Injection confirms date + machine ->
 *                trial run + process values -> defect filed (title + photo) ->
 *                我来处理 claimed -> fixed -> assembly acknowledge + self-check ->
 *                PM confirms ready + plans T1 -> QC verifies at T1 ->
 *                measurement reports uploaded -> T1 result Approved -> issue closed.
 *   MP-DEMO-002  待确认 — a T0 date PENDING Injection confirmation, created ~19h
 *                ago so the Injection leader opens /me and sees ONE live task with
 *                an amber "~5h left" chip (inj.date_confirm = 24h).
 *   MP-DEMO-003  整改中 — a fresh UNCLAIMED department-inbox defect with a photo
 *                (the 我来处理 claim demo, ~42h left on the 48h clock) PLUS one
 *                already-claimed defect waiting for the assembly acknowledge +
 *                self-check demo (amber ~4h left on the 24h clock), with the
 *                verification trial already planned and confirmed.
 *
 * ROSTER — nothing is hardcoded. Every actor is resolved AT RUNTIME by ROLE from
 * whatever roster `pnpm prisma:bootstrap` loaded (prisma/fixtures/factory-users-*.json
 * via `prisma/seed.ts`): the first ACTIVE user of that role ordered by username.
 * ADMIN / GM / VIEWER are never actors — no operational row is admin-attributed.
 *
 * SHAPES — projects, trials, issues, process values, attachments and ActivityLog
 * rows use the same field/action shapes the server actions write
 * (`created_project_intake`, `set_first_t0_planned_date`, `confirmed_trial_date`,
 * `recorded_completed_trial`, `saved_trial_process_sheet`, `created_trial_issue`,
 * `claimed_department_inbox_issue`, `updated_trial_issue`, `closed_trial_issue`,
 * `uploaded_attachment`, `uploaded_measurement_report`), so `/me` task channels,
 * the project timeline, the KPI Scores tab and the /score page all render.
 *
 * REAL FILES — every attachment writes real bytes (a valid 1x1 JPEG for photos, a
 * minimal valid PDF for measurement reports) through the same key/path convention
 * as `src/server/attachment-storage.ts`, so galleries, the lightbox and downloads
 * work. `--reset` removes those files from disk again.
 *
 * SAFETY — production requires the exact explicit confirmation phrase shown by
 * `--help`; otherwise it refuses before opening Prisma. `--reset` touches ONLY
 * MP-DEMO- projects, their cascade children, their ActivityLog rows and their
 * files. Nothing else is read for writing and no master data is deleted.
 *
 * TIME — timestamps are day offsets counted back from the run day (scenario 1
 * spreads over ~3 weeks) plus hour offsets from `now` for the two live countdown
 * chips. Ordering is monotonic by construction and asserted with `ordered()`.
 * Run the session in the second half of a month (the launch session is
 * 2026-07-27) to keep the whole 3-week journey inside ONE KPI month; ordering and
 * every /me channel are correct on any run day either way.
 */
import "dotenv/config";

import { existsSync, readFileSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import process from "node:process";

import {
  PRODUCTION_TRAINING_CONFIRMATION,
  assertTrainingExamplesDeploymentAllowed
} from "../src/domain/security/deployment-mode.ts";
import { buildStorageKey, resolveStoragePath } from "../src/domain/mold-trial/attachments.ts";
import { measurementReportFileName } from "../src/domain/mold-trial/measurement-report.ts";
import {
  computeDefaultIssueDueDate,
  defaultOwnerGroupCodeForIssueType
} from "../src/domain/mold-trial/issue-routing.ts";
import {
  DEFAULT_PROCESS_SHEET_TEMPLATE_CODE,
  compareInjectionMachineNo,
  isProcessSheetSummaryParameter,
  snapshotInjectionMachine
} from "../src/domain/mold-trial/process-sheet.ts";

const args = new Set(process.argv.slice(2));
const RESET = args.has("--reset") || args.has("--reset-only");
const RESET_ONLY = args.has("--reset-only");
const PREFIX = "MP-DEMO-";
const DEMO_CUSTOMER_CODE = "MP-DEMO";

function optionValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 && index + 1 < process.argv.length
    ? process.argv[index + 1]
    : undefined;
}

if (args.has("--help") || args.has("-h")) {
  console.log(`MoldPilot training examples (MP-DEMO-)

Usage:
  pnpm training:examples                 build MP-DEMO-001/002/003
  pnpm training:examples -- --reset      delete MP-DEMO- data, then rebuild
  pnpm training:examples -- --reset-only delete MP-DEMO- data and stop
  pnpm training:examples -- --production-confirm "${PRODUCTION_TRAINING_CONFIRMATION}"
                                         explicitly allow MP-DEMO data in production

Requires a seeded database (pnpm prisma:bootstrap for the factory roster, or
pnpm prisma:seed in development). Production refuses before opening Prisma
unless the exact confirmation phrase is supplied.`);
  process.exit(0);
}

// --- Gate 1: production requires an exact, visible operator confirmation -----
let deploymentAllowance;
try {
  deploymentAllowance = assertTrainingExamplesDeploymentAllowed(
    process.env,
    existsSync(".env") ? readFileSync(".env", "utf8") : "",
    optionValue("--production-confirm")
  );
} catch (error) {
  console.error(`\n[FAIL] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
if (deploymentAllowance.production) {
  console.warn(
    `[PRODUCTION TRAINING] Confirmed: only ${PREFIX} projects, their files, and the ${DEMO_CUSTOMER_CODE} demo client may be created.`
  );
}

const { PrismaClient } = await import("@prisma/client");
const { PrismaPg } = await import("@prisma/adapter-pg");
const connectionString =
  process.env.DATABASE_URL ?? "postgresql://moldpilot:moldpilot@localhost:5432/moldpilot?schema=public";
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

// ---------------------------------------------------------------------------
// Time helpers
// ---------------------------------------------------------------------------
const now = new Date();
const y = now.getUTCFullYear();
const m = now.getUTCMonth();
const runDay = now.getUTCDate();

/** A Date `daysBeforeRun` days before the run day at `hour`:`minute` UTC. */
function at(daysBeforeRun, hour = 9, minute = 0) {
  return new Date(Date.UTC(y, m, runDay - daysBeforeRun, hour, minute, 0));
}
/** A @db.Date value `daysBeforeRun` days before the run day. */
function dayOnly(daysBeforeRun) {
  return new Date(Date.UTC(y, m, runDay - daysBeforeRun));
}
/** A @db.Date value `daysAfterRun` days in the future. */
function futureDayOnly(daysAfterRun) {
  return new Date(Date.UTC(y, m, runDay + daysAfterRun));
}
/** A Date exactly `hours` before now — used for the live countdown chips. */
function hoursAgo(hours) {
  return new Date(now.getTime() - hours * 60 * 60 * 1000);
}
/** UTC midnight of the day `date` falls on (a @db.Date value). */
function startOfDayUtc(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}
/** The `YYYY-MM-DD` form the server actions write into ActivityLog JSON. */
function activityDate(value) {
  return value == null ? null : value.toISOString().slice(0, 10);
}
/** Assert a step never precedes the step it follows (dev-time ordering guard). */
function ordered(anchor, moment, label) {
  if (moment != null && anchor != null && moment.getTime() < anchor.getTime()) {
    throw new Error(`[demo] ${label}: ${moment.toISOString()} precedes ${anchor.toISOString()}`);
  }
  return moment;
}
/** Assert a moment is in the past (nothing "already happened" in the future). */
function past(moment, label) {
  if (moment.getTime() > now.getTime()) {
    throw new Error(`[demo] ${label}: ${moment.toISOString()} is in the future`);
  }
  return moment;
}
/**
 * A monotonic clock for one entity's edit chain. Every step is asserted to be no
 * earlier than the previous one and never in the future, so a mistyped day offset
 * fails loudly instead of producing a timeline that reads backwards. (The DB's own
 * `updatedAt` is not usable as the anchor: Prisma manages that column.)
 */
function chain(startedAt, label) {
  let last = startedAt;
  return (moment) => {
    ordered(last, past(moment, label), label);
    last = moment;
    return moment;
  };
}

async function log(actorUserId, entityType, entityId, action, createdAt, afterJson, beforeJson = null, note = null) {
  past(createdAt, `activity log ${action}`);
  return prisma.activityLog.create({
    data: {
      actorUserId,
      entityType,
      entityId,
      action,
      beforeJson,
      afterJson: afterJson ?? null,
      note,
      createdAt
    }
  });
}

// ---------------------------------------------------------------------------
// Real attachment bytes (same templates scripts/simulate-kpi-data.mjs uses)
// ---------------------------------------------------------------------------
/** Valid 1x1 JPEG (SOI…EOI, 3-component) so thumbnails + the lightbox render. */
const DEMO_JPEG = Buffer.from(
  "/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wgARCAABAAEDAREAAhEBAxEB/8QAFAABAAAAAAAAAAAAAAAAAAAAAv/EABQBAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhADEAAAAT8P/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABBQJ//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAwEBPwF//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAgEBPwF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQAGPwJ//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPyF//9oADAMBAAIAAwAAABAf/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAwEBPxB//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAgEBPxB//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxB//9k=",
  "base64"
);
/** Minimal valid single-page PDF (correct xref) so report downloads open. */
const DEMO_PDF = Buffer.from(
  "JVBERi0xLjQKMSAwIG9iago8PC9UeXBlL0NhdGFsb2cvUGFnZXMgMiAwIFI+PgplbmRvYmoKMiAwIG9iago8PC9UeXBlL1BhZ2VzL0tpZHNbMyAwIFJdL0NvdW50IDE+PgplbmRvYmoKMyAwIG9iago8PC9UeXBlL1BhZ2UvUGFyZW50IDIgMCBSL01lZGlhQm94WzAgMCAyMDAgMjAwXS9SZXNvdXJjZXM8PC9Gb250PDwvRjEgNSAwIFI+Pj4+L0NvbnRlbnRzIDQgMCBSPj4KZW5kb2JqCjQgMCBvYmoKPDwvTGVuZ3RoIDUyPj4Kc3RyZWFtCkJUIC9GMSAxNCBUZiAyMCAxMDAgVGQgKE1QLVNJTSBRQyByZXBvcnQpIFRqIEVUCmVuZHN0cmVhbQplbmRvYmoKNSAwIG9iago8PC9UeXBlL0ZvbnQvU3VidHlwZS9UeXBlMS9CYXNlRm9udC9IZWx2ZXRpY2E+PgplbmRvYmoKeHJlZgowIDYKMDAwMDAwMDAwMCA2NTUzNSBmIAowMDAwMDAwMDA5IDAwMDAwIG4gCjAwMDAwMDAwNTQgMDAwMDAgbiAKMDAwMDAwMDEwNSAwMDAwMCBuIAowMDAwMDAwMjE3IDAwMDAwIG4gCjAwMDAwMDAzMTIgMDAwMDAgbiAKdHJhaWxlcgo8PC9TaXplIDYvUm9vdCAxIDAgUj4+CnN0YXJ0eHJlZgozNzUKJSVFT0YK",
  "base64"
);

const fileSpecByType = {
  TRIAL_PHOTO: { extension: "jpg", contentType: "image/jpeg", buffer: DEMO_JPEG, visibility: "INTERNAL" },
  QC_REPORT: { extension: "pdf", contentType: "application/pdf", buffer: DEMO_PDF, visibility: "CUSTOMER_SAFE" }
};

/** Mirror of attachmentStorageRoot() in src/server/attachment-storage.ts. */
function storageRoot() {
  const configured = process.env.MOLDPILOT_STORAGE_DIR;
  const root = configured != null && configured.trim().length > 0 ? configured : path.join("storage", "uploads");
  return path.isAbsolute(root) ? root : path.resolve(process.cwd(), root);
}

/**
 * Write REAL bytes for an attachment (server-generated id + sharded key, exactly
 * like writeAttachmentFile) and create the FileAttachment row plus the same
 * ActivityLog entry the upload path writes.
 */
async function createDemoAttachment({
  project,
  entityType,
  entityId,
  fileType,
  uploadedById,
  uploadedAt,
  fileName,
  visibility,
  logAction,
  logJson
}) {
  const spec = fileSpecByType[fileType];
  if (spec == null) {
    throw new Error(`[demo] no byte template for file type ${fileType}`);
  }
  const id = randomUUID();
  const storageKey = buildStorageKey(id, spec.extension);
  const absolutePath = resolveStoragePath(storageRoot(), storageKey);
  if (absolutePath == null) {
    throw new Error(`[demo] refusing to write outside the storage root: ${storageKey}`);
  }
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, spec.buffer);
  const attachment = await prisma.fileAttachment.create({
    data: {
      id,
      moldTrialProjectId: project.id,
      entityType,
      entityId,
      fileName,
      fileType,
      storageKey,
      contentType: spec.contentType,
      sizeBytes: spec.buffer.byteLength,
      visibility: visibility ?? spec.visibility,
      uploadedById,
      uploadedAt: past(uploadedAt, `attachment ${fileName}`)
    }
  });
  await log(uploadedById, "FileAttachment", attachment.id, logAction, uploadedAt, {
    projectCode: project.projectCode,
    fileName: attachment.fileName,
    fileType: attachment.fileType,
    visibility: attachment.visibility,
    sizeBytes: attachment.sizeBytes,
    ...logJson
  });
  return attachment;
}

// ---------------------------------------------------------------------------
// Reset — MP-DEMO- projects, their children, their logs, their files. Nothing else.
// ---------------------------------------------------------------------------
async function resetDemoData() {
  const projects = await prisma.moldTrialProject.findMany({
    where: { projectCode: { startsWith: PREFIX } },
    select: { id: true }
  });
  const ids = projects.map((project) => project.id);
  if (ids.length === 0) {
    console.log(`[reset] Removed 0 ${PREFIX} project(s).`);
    return;
  }

  const [trials, issues, attachments, designChanges, missedTrials] = await Promise.all([
    prisma.trialEvent.findMany({ where: { moldTrialProjectId: { in: ids } }, select: { id: true } }),
    prisma.trialIssue.findMany({ where: { moldTrialProjectId: { in: ids } }, select: { id: true } }),
    prisma.fileAttachment.findMany({
      where: { moldTrialProjectId: { in: ids } },
      select: { id: true, storageKey: true }
    }),
    prisma.designChangeEvent.findMany({ where: { moldTrialProjectId: { in: ids } }, select: { id: true } }),
    prisma.missedTrialEvent.findMany({ where: { moldTrialProjectId: { in: ids } }, select: { id: true } })
  ]);

  // Files first: the rows disappear with the project cascade.
  let removedFiles = 0;
  for (const attachment of attachments) {
    const absolutePath = resolveStoragePath(storageRoot(), attachment.storageKey);
    if (absolutePath != null) {
      await rm(absolutePath, { force: true });
      removedFiles += 1;
    }
  }

  // ActivityLog has no cascade — clear it by the entity ids we wrote.
  const entityIds = [
    ...ids,
    ...trials.map((trial) => trial.id),
    ...issues.map((issue) => issue.id),
    ...attachments.map((attachment) => attachment.id),
    ...designChanges.map((change) => change.id),
    ...missedTrials.map((event) => event.id)
  ];
  const removedLogs = await prisma.activityLog.deleteMany({ where: { entityId: { in: entityIds } } });
  await prisma.moldTrialProject.deleteMany({ where: { id: { in: ids } } });
  console.log(
    `[reset] Removed ${ids.length} ${PREFIX} project(s), ${trials.length} trial(s), ${issues.length} issue(s), ` +
      `${removedFiles} file(s) and ${removedLogs.count} activity log row(s).`
  );
}

// ---------------------------------------------------------------------------
// Runtime roster resolution — by ROLE, never by username
// ---------------------------------------------------------------------------
/** Roles that may act on operational rows. ADMIN / GM / VIEWER are excluded. */
const operationalRoleCodes = ["pm", "marketing", "injection", "assembly", "qc"];

/**
 * The first ACTIVE user holding `roleCode` (DB role code, lowercase), ordered by
 * username so the pick is deterministic across runs and machines. Whatever roster
 * `pnpm prisma:bootstrap` loaded is what the demo uses.
 */
async function actorForRole(roleCode) {
  if (!operationalRoleCodes.includes(roleCode)) {
    throw new Error(`[demo] refusing to use role "${roleCode}" as an actor (ADMIN/GM/VIEWER never act).`);
  }
  const role = await prisma.role.findUnique({ where: { code: roleCode }, select: { id: true } });
  if (role == null) {
    throw new Error(`[demo] role "${roleCode}" is missing. Run \`pnpm prisma:bootstrap\` (or \`pnpm prisma:seed\`) first.`);
  }
  const user = await prisma.user.findFirst({
    where: { roleId: role.id, status: "ACTIVE" },
    orderBy: { username: "asc" },
    select: { id: true, username: true, displayName: true, chineseName: true }
  });
  if (user == null) {
    throw new Error(
      `[demo] no ACTIVE user has role "${roleCode}". Load the reviewed roster with \`pnpm prisma:bootstrap\` first.`
    );
  }
  return user;
}

async function groupForCode(code) {
  const group = await prisma.departmentGroup.findUnique({ where: { code }, select: { id: true, code: true, name: true } });
  if (group == null) {
    throw new Error(`[demo] department group "${code}" is missing. Run \`pnpm prisma:bootstrap\` first.`);
  }
  return group;
}

/**
 * Two demo presses, deterministic: active machines sorted by machine number,
 * preferring the 150-600T band a small two-cavity ABS tool would really run on.
 */
async function demoMachines() {
  const machines = await prisma.injectionMachine.findMany({
    where: { active: true },
    select: { id: true, machineNo: true, displayName: true, model: true, brand: true, tonnage: true }
  });
  if (machines.length === 0) {
    throw new Error("[demo] no active injection machines. Run `pnpm prisma:bootstrap` first.");
  }
  const sorted = [...machines].sort(compareInjectionMachineNo);
  const preferred = sorted.filter((machine) => machine.tonnage != null && machine.tonnage >= 150 && machine.tonnage <= 600);
  const pool = preferred.length >= 2 ? preferred : sorted;
  return [pool[0], pool[1] ?? pool[0]];
}

async function demoProcessTemplate() {
  const template = await prisma.processSheetTemplate.findUnique({
    where: { code: DEFAULT_PROCESS_SHEET_TEMPLATE_CODE },
    select: { id: true, code: true }
  });
  if (template == null) {
    throw new Error(
      `[demo] process sheet template "${DEFAULT_PROCESS_SHEET_TEMPLATE_CODE}" is missing. Run \`pnpm prisma:bootstrap\` first.`
    );
  }
  const parameters = await prisma.processSheetParameter.findMany({
    where: { processSheetTemplateId: template.id, active: true },
    select: { id: true, parameterKey: true, labelEn: true, labelZh: true, unit: true, customerVisible: true }
  });
  return { template, parameters };
}

/** The demo client. Master data, so it is never deleted by --reset and has no admin author. */
async function ensureDemoCustomer(marketingId, templateId) {
  const existing = await prisma.customer.findUnique({ where: { code: DEMO_CUSTOMER_CODE }, select: { id: true, code: true } });
  if (existing != null) {
    return existing;
  }
  return prisma.customer.create({
    data: {
      code: DEMO_CUSTOMER_CODE,
      displayName: "培训演示客户（非真实客户）",
      shortName: "培训演示",
      ownerUserId: marketingId,
      defaultProcessSheetTemplateId: templateId,
      notes: "Training-session demo client. Only MP-DEMO- projects use it.",
      active: true
    },
    select: { id: true, code: true }
  });
}

// ---------------------------------------------------------------------------
// Row builders (app-shaped)
// ---------------------------------------------------------------------------
let processTemplate = null;
let processParameters = [];

/** STAGE 1 — Marketing files the intake; the project starts in INTAKE. */
async function createIntakeProject({
  code,
  customer,
  marketingId,
  moldCode,
  partCode,
  parts,
  intakeNote,
  initialCustomerNote,
  clientProjectRef,
  customerTargetDate,
  priority,
  createdAt
}) {
  const project = await prisma.moldTrialProject.create({
    data: {
      projectCode: code,
      clientProjectRef,
      customerId: customer.id,
      customerCode: customer.code,
      processSheetTemplateId: processTemplate.id,
      processSheetTemplateCode: processTemplate.code,
      partCode,
      moldCode,
      status: "INTAKE",
      priority,
      intakeNote,
      customerTargetDate,
      initialCustomerNote,
      baseTrialLimit: 3,
      currentTrialLimit: 3,
      createdById: marketingId,
      createdAt: past(createdAt, `${code} intake`),
      updatedAt: createdAt
    }
  });
  await prisma.moldTrialPart.createMany({
    data: parts.map((part, index) => ({
      moldTrialProjectId: project.id,
      partCode: part.partCode,
      partName: part.partName,
      cavityLabel: part.cavityLabel,
      cavityCount: part.cavityCount,
      notes: part.notes ?? null,
      sortOrder: index,
      active: true
    }))
  });
  await log(marketingId, "MoldTrialProject", project.id, "created_project_intake", createdAt, {
    projectCode: project.projectCode,
    clientProjectRef: project.clientProjectRef,
    status: project.status,
    customerId: project.customerId,
    customerCode: project.customerCode,
    processSheetTemplateCode: project.processSheetTemplateCode,
    partCount: parts.length
  });
  return project;
}

/** STAGE 1/2 — the PM reviews the intake and sets the first T0 date. */
async function planFirstT0({ project, pmId, plannedDate, createdAt }) {
  const trial = await prisma.trialEvent.create({
    data: {
      moldTrialProjectId: project.id,
      trialCode: "T0",
      sequenceNumber: 1,
      plannedDate,
      status: "PLANNED",
      dateConfirmationStatus: "PENDING_CONFIRMATION",
      countsAgainstLimit: false,
      createdById: pmId,
      createdAt: past(createdAt, `${project.projectCode} T0 planned`),
      updatedAt: createdAt
    }
  });
  const updated = await prisma.moldTrialProject.update({
    where: { id: project.id },
    data: {
      planningPmId: pmId,
      status: "WAITING_TRIAL",
      firstPlannedTrialDate: plannedDate,
      nextPlannedTrialDate: plannedDate,
      updatedAt: createdAt
    }
  });
  await log(
    pmId,
    "MoldTrialProject",
    project.id,
    "set_first_t0_planned_date",
    createdAt,
    { status: updated.status, firstPlannedTrialDate: activityDate(plannedDate) },
    { status: "INTAKE", firstPlannedTrialDate: null }
  );
  await log(pmId, "TrialEvent", trial.id, "created_initial_planned_trial", createdAt, {
    trialCode: trial.trialCode,
    plannedDate: activityDate(plannedDate)
  });
  return { trial, project: updated };
}

/** STAGE 2 — Injection confirms the date and names the machine (<=24h). */
async function confirmTrialDate({ project, trial, injectionId, machine, confirmedAt }) {
  const snapshot = snapshotInjectionMachine(machine);
  const updated = await prisma.trialEvent.update({
    where: { id: trial.id },
    data: {
      dateConfirmationStatus: "CONFIRMED",
      dateConfirmedById: injectionId,
      dateConfirmedAt: ordered(trial.createdAt, past(confirmedAt, "date confirm"), `${project.projectCode} date confirm`),
      injectionMachineId: machine.id,
      machineNoSnapshot: snapshot.machineNoSnapshot,
      machineTonnageSnapshot: snapshot.machineTonnageSnapshot,
      machine: snapshot.machineDisplayText,
      updatedAt: confirmedAt
    }
  });
  await log(
    injectionId,
    "TrialEvent",
    trial.id,
    "confirmed_trial_date",
    confirmedAt,
    {
      dateConfirmationStatus: updated.dateConfirmationStatus,
      plannedDate: activityDate(updated.plannedDate),
      machineNoSnapshot: updated.machineNoSnapshot
    },
    { dateConfirmationStatus: "PENDING_CONFIRMATION" }
  );
  return updated;
}

/** STAGE 3 — Injection enters the process values for a trial. */
async function saveProcessValues({ project, trial, injectionId, valuesByKey, savedAt }) {
  const wanted = new Set(Object.keys(valuesByKey));
  const editable = processParameters.filter(
    (parameter) => wanted.has(parameter.parameterKey) && !isProcessSheetSummaryParameter(parameter.parameterKey)
  );
  for (const parameter of editable) {
    const raw = valuesByKey[parameter.parameterKey];
    await prisma.trialProcessValue.create({
      data: {
        moldTrialProjectId: project.id,
        trialEventId: trial.id,
        processSheetParameterId: parameter.id,
        parameterKeySnapshot: parameter.parameterKey,
        labelEnSnapshot: parameter.labelEn,
        labelZhSnapshot: parameter.labelZh,
        unitSnapshot: parameter.unit,
        valueText: typeof raw === "number" ? null : raw,
        valueNumber: typeof raw === "number" ? String(raw) : null,
        valueDate: null,
        customerVisible: parameter.customerVisible,
        enteredById: injectionId,
        createdAt: past(savedAt, "process values"),
        updatedAt: savedAt
      }
    });
  }
  await log(injectionId, "TrialEvent", trial.id, "saved_trial_process_sheet", savedAt, {
    trialCode: trial.trialCode,
    savedFieldCount: editable.length
  });
  return editable.length;
}

/** STAGE 3 — the PM records the trial result (<=24h; same day here). */
async function recordCompletedTrial({
  project,
  trial,
  pmId,
  actualDate,
  result,
  outcomeDisposition,
  projectStatus,
  sampleQuantity,
  mainIssuesSummary,
  outcomeNote,
  recordedAt
}) {
  const updated = await prisma.trialEvent.update({
    where: { id: trial.id },
    data: {
      actualDate,
      status: "COMPLETED",
      result,
      outcomeDisposition,
      outcomeNote,
      sampleQuantity,
      mainIssuesSummary,
      countsAgainstLimit: true,
      updatedAt: recordedAt
    }
  });
  await prisma.moldTrialProject.update({
    where: { id: project.id },
    data: { status: projectStatus, updatedAt: recordedAt }
  });
  await log(
    pmId,
    "TrialEvent",
    trial.id,
    "recorded_completed_trial",
    ordered(trial.createdAt, past(recordedAt, "record result"), `${project.projectCode} record result`),
    {
      status: updated.status,
      actualDate: activityDate(updated.actualDate),
      result: updated.result,
      machineNoSnapshot: updated.machineNoSnapshot
    },
    { status: "PLANNED", actualDate: null }
  );
  return updated;
}

/**
 * STAGE 3 — "登记问题只要两样：一句话 + 一张照片". No owner is named: the type
 * decides the department inbox (issue-routing.ts), and the due date falls back to
 * the same default window the server action applies.
 */
async function fileIssueWithPhoto({
  project,
  trial,
  reporterId,
  title,
  description,
  issueType,
  source,
  severity,
  affectedPartId,
  affectedCavityNote,
  ownerGroupId,
  createdAt,
  photoFileName
}) {
  const issue = await prisma.trialIssue.create({
    data: {
      moldTrialProjectId: project.id,
      foundAtTrialEventId: trial?.id ?? null,
      affectedScope: affectedPartId == null ? "MOLD" : "PART",
      affectedPartId,
      affectedCavityNote,
      title,
      description,
      issueType,
      source,
      severity,
      status: "OPEN",
      ownerUserId: null,
      ownerGroupId,
      dueDate: computeDefaultIssueDueDate(createdAt),
      createdById: reporterId,
      reportedById: reporterId,
      createdAt: past(createdAt, `issue ${title}`),
      updatedAt: createdAt
    }
  });
  await log(reporterId, "TrialIssue", issue.id, "created_trial_issue", createdAt, {
    title: issue.title,
    severity: issue.severity,
    source: issue.source,
    affectedScope: issue.affectedScope,
    affectedPartId: issue.affectedPartId
  });
  await createDemoAttachment({
    project,
    entityType: "TRIAL_ISSUE",
    entityId: issue.id,
    fileType: "TRIAL_PHOTO",
    uploadedById: reporterId,
    uploadedAt: new Date(createdAt.getTime() + 6 * 60 * 1000),
    fileName: photoFileName,
    visibility: "INTERNAL",
    logAction: "uploaded_attachment",
    logJson: {
      targetEntityType: "TRIAL_ISSUE",
      targetEntityId: issue.id,
      securityPipeline: "quarantine_signature_scan"
    }
  });
  return issue;
}

/** STAGE 4 — 我来处理: the first person to take it becomes the 处理人. */
async function claimIssue({ issue, claimerId, claimedAt }) {
  ordered(issue.createdAt, past(claimedAt, "issue claim"), `claim ${issue.title}`);
  const updated = await prisma.trialIssue.update({
    where: { id: issue.id },
    data: {
      ownerUserId: claimerId,
      status: "IN_PROGRESS",
      updatedAt: claimedAt
    }
  });
  await log(
    claimerId,
    "TrialIssue",
    issue.id,
    "claimed_department_inbox_issue",
    claimedAt,
    { ownerUserId: claimerId, status: updated.status },
    { ownerUserId: null, status: issue.status }
  );
  return updated;
}

/** Any issue lifecycle edit, logged exactly like editTrialIssue does. */
async function updateIssue({ issue, actorId, data, updatedAt, action = "updated_trial_issue" }) {
  const updated = await prisma.trialIssue.update({
    where: { id: issue.id },
    data: { ...data, updatedAt: ordered(issue.createdAt, past(updatedAt, "issue update"), `update ${issue.title}`) }
  });
  await log(
    actorId,
    "TrialIssue",
    issue.id,
    action,
    updatedAt,
    {
      status: updated.status,
      ownerUserId: updated.ownerUserId,
      rootCause: updated.rootCause,
      correctiveAction: updated.correctiveAction,
      verificationMethod: updated.verificationMethod,
      verificationResult: updated.verificationResult,
      assemblyAcknowledgedAt: activityDate(updated.assemblyAcknowledgedAt),
      assemblyEstimatedFinishDate: activityDate(updated.assemblyEstimatedFinishDate),
      assemblySelfCheckedAt: activityDate(updated.assemblySelfCheckedAt),
      assemblySelfCheckNote: updated.assemblySelfCheckNote,
      pmReadyConfirmedAt: activityDate(updated.pmReadyConfirmedAt),
      closedAt: activityDate(updated.closedAt)
    },
    {
      status: issue.status,
      ownerUserId: issue.ownerUserId,
      rootCause: issue.rootCause,
      correctiveAction: issue.correctiveAction,
      verificationMethod: issue.verificationMethod,
      verificationResult: issue.verificationResult,
      assemblyAcknowledgedAt: activityDate(issue.assemblyAcknowledgedAt),
      assemblyEstimatedFinishDate: activityDate(issue.assemblyEstimatedFinishDate),
      assemblySelfCheckedAt: activityDate(issue.assemblySelfCheckedAt),
      assemblySelfCheckNote: issue.assemblySelfCheckNote,
      pmReadyConfirmedAt: activityDate(issue.pmReadyConfirmedAt),
      closedAt: activityDate(issue.closedAt)
    }
  );
  return updated;
}

/** STAGE 4 — the PM plans the verification trial after the correction. */
async function planNextTrial({ project, pmId, trialCode, sequenceNumber, plannedDate, planReasonDetail, createdAt }) {
  const trial = await prisma.trialEvent.create({
    data: {
      moldTrialProjectId: project.id,
      trialCode,
      sequenceNumber,
      plannedDate,
      status: "PLANNED",
      dateConfirmationStatus: "PENDING_CONFIRMATION",
      planReasonCategory: "MOLD_CORRECTION_VERIFICATION",
      planReasonDetail,
      sourceArea: "PLANNING",
      requestedById: pmId,
      countsAgainstLimit: false,
      createdById: pmId,
      createdAt: past(createdAt, `${project.projectCode} ${trialCode} planned`),
      updatedAt: createdAt
    }
  });
  await prisma.moldTrialProject.update({
    where: { id: project.id },
    data: { nextPlannedTrialDate: plannedDate, updatedAt: createdAt }
  });
  await log(pmId, "TrialEvent", trial.id, "added_new_planned_trial", createdAt, {
    trialCode: trial.trialCode,
    plannedDate: activityDate(plannedDate),
    planReasonCategory: trial.planReasonCategory,
    sourceArea: trial.sourceArea
  });
  return trial;
}

/** STAGE 5 — QC uploads the measurement report for a completed trial (<=48h). */
async function uploadMeasurementReport({ project, trial, qcId, uploadedAt }) {
  const trialCode = `T${Math.max(0, trial.sequenceNumber - 1)}`;
  return createDemoAttachment({
    project,
    entityType: "TRIAL_EVENT",
    entityId: trial.id,
    fileType: "QC_REPORT",
    uploadedById: qcId,
    uploadedAt,
    fileName: measurementReportFileName({ projectCode: project.projectCode, trialCode, extension: "pdf" }),
    visibility: "CUSTOMER_SAFE",
    logAction: "uploaded_measurement_report",
    logJson: {
      trialEventId: trial.id,
      trialCode,
      note: "全尺寸测量报告（培训演示）",
      securityPipeline: "quarantine_validate_scan_release"
    }
  });
}

// ---------------------------------------------------------------------------
// Realistic process values (ABS, two-cavity tool)
// ---------------------------------------------------------------------------
function processValuesForTrial(machine, { holdPressure1, holdPressure2, coolingTime, cycleTime }) {
  return {
    material_rep_company: "华美塑胶",
    material_grade: "ABS 757",
    material_drying_time: 3,
    material_drying_temperature: 80,
    machine_name: machine.brand ?? "注塑机",
    machine_number: machine.machineNo,
    press_tonnage: machine.tonnage ?? 0,
    clamp_tonnage_used: Math.round((machine.tonnage ?? 200) * 0.62),
    nozzle_orifice: 4,
    shot_capacity: 680,
    cycle_time: cycleTime,
    cooling_time: coolingTime,
    injection_time: 2.4,
    barrel_zone_1_temp: 205,
    barrel_zone_2_temp: 215,
    barrel_zone_3_temp: 220,
    barrel_nozzle_temp: 225,
    velocity_stage_1: 55,
    velocity_stage_2: 40,
    velocity_stage_3: 25,
    hold_pressure_stage_1: holdPressure1,
    hold_pressure_stage_2: holdPressure2,
    hold_time: 6,
    back_pressure: 50,
    screw_speed: 80,
    cushion: 4.8,
    number_of_cavities: 2,
    part_weight_average: 86.4,
    shot_weight_1: 86.5,
    shot_weight_2: 86.2,
    shot_weight_3: 86.6
  };
}

// ---------------------------------------------------------------------------
// SCENARIO 1 — MP-DEMO-001: the complete journey, intake to final approval
// ---------------------------------------------------------------------------
async function buildCompleteJourney({ customer, actors, machines }) {
  const { marketing, pm, injection, assembly, qc } = actors;
  const machine = machines[0];

  const project = await createIntakeProject({
    code: `${PREFIX}001`,
    customer,
    marketingId: marketing.id,
    moldCode: "DM-2601",
    partCode: "DM-2601-A",
    clientProjectRef: "KH-2026-041",
    priority: "NORMAL",
    intakeNote: "客户新项目：面壳 + 底壳，一模两穴，ABS 本色，首批样品 30 件。",
    initialCustomerNote: "客户要求：外观面无缩水、无夹水线，装配间隙 ≤0.15mm，交样附全尺寸测量报告。",
    customerTargetDate: dayOnly(2),
    parts: [
      { partCode: "DM-2601-A", partName: "面壳", cavityLabel: "A穴", cavityCount: 1, notes: "外观面，不允许批锋" },
      { partCode: "DM-2601-B", partName: "底壳", cavityLabel: "B穴", cavityCount: 1, notes: "装配面，卡扣位需顺畅" }
    ],
    createdAt: at(21, 9)
  });
  const parts = await prisma.moldTrialPart.findMany({
    where: { moldTrialProjectId: project.id },
    orderBy: { sortOrder: "asc" },
    select: { id: true, partCode: true }
  });

  // STAGE 2 — PM plans T0, Injection confirms the date and the press.
  const { trial: t0Planned } = await planFirstT0({
    project,
    pmId: pm.id,
    plannedDate: dayOnly(14),
    createdAt: at(20, 10)
  });
  const t0Confirmed = await confirmTrialDate({
    project,
    trial: t0Planned,
    injectionId: injection.id,
    machine,
    confirmedAt: at(20, 15)
  });

  // STAGE 3 — trial day: process values, then the result (same day = on time).
  await saveProcessValues({
    project,
    trial: t0Confirmed,
    injectionId: injection.id,
    valuesByKey: processValuesForTrial(machine, { holdPressure1: 720, holdPressure2: 560, coolingTime: 16, cycleTime: 38 }),
    savedAt: at(14, 11, 30)
  });
  const t0 = await recordCompletedTrial({
    project,
    trial: t0Confirmed,
    pmId: pm.id,
    actualDate: dayOnly(14),
    result: "NOT_APPROVED",
    outcomeDisposition: "REWORK_REQUIRED",
    projectStatus: "IN_CORRECTION",
    sampleQuantity: 30,
    mainIssuesSummary: "T0：A穴分型面批锋，产品边缘毛刺；保压窗口偏窄需再调。",
    outcomeNote: "首次试模，样品外观未通过，模具需整改后安排 T1 验证。",
    recordedAt: at(14, 16)
  });

  // STAGE 3 — the person who saw it files it: one line + one photo, no names.
  const issueType = "ASSEMBLY_FITTING_ISSUE";
  const inboxGroup = await groupForCode(defaultOwnerGroupCodeForIssueType(issueType));
  let issue = await fileIssueWithPhoto({
    project,
    trial: t0,
    reporterId: injection.id,
    title: "分型面批锋，A穴产品边缘毛刺",
    description: "试模第 5 模起 A穴分型面出现批锋，产品边缘有毛刺，需修模后重新试模验证。",
    issueType,
    source: "INTERNAL_TRIAL",
    severity: "MEDIUM",
    affectedPartId: parts[0].id,
    affectedCavityNote: "A穴",
    ownerGroupId: inboxGroup.id,
    createdAt: at(14, 17),
    photoFileName: "T0-A穴分型面批锋.jpg"
  });

  // One monotonic clock for the whole issue chain: a mistyped day offset throws.
  const issueClock = chain(issue.createdAt, `${project.projectCode} issue chain`);

  // STAGE 4 — 我来处理 (<=48h), acknowledge with an estimated finish (<=24h).
  issue = await claimIssue({ issue, claimerId: assembly.id, claimedAt: issueClock(at(13, 8, 30)) });
  const acknowledgedAt = issueClock(at(13, 9));
  issue = await updateIssue({
    issue,
    actorId: assembly.id,
    updatedAt: acknowledgedAt,
    data: {
      assemblyAcknowledgedAt: acknowledgedAt,
      assemblyAcknowledgedById: assembly.id,
      assemblyEstimatedFinishDate: dayOnly(10)
    }
  });
  issue = await updateIssue({
    issue,
    actorId: assembly.id,
    updatedAt: issueClock(at(10, 16)),
    data: {
      status: "WAITING_VERIFICATION",
      rootCause: "分型面局部塌陷约 0.03mm，合模后有间隙。",
      correctiveAction: "塌陷位烧焊补料后重新省模，分型面研配着色检查。",
      fixSummary: "分型面研配完成，着色率 95% 以上，手动合模无间隙。",
      fixTimeMinutes: 180
    }
  });
  // 下次试模前完成自检.
  const selfCheckedAt = issueClock(at(10, 17));
  issue = await updateIssue({
    issue,
    actorId: assembly.id,
    updatedAt: selfCheckedAt,
    data: {
      assemblySelfCheckedAt: selfCheckedAt,
      assemblySelfCheckedById: assembly.id,
      assemblySelfCheckNote: "自检：合模面着色均匀，手动合模无批锋，模腔已清理，可安排试模。"
    }
  });

  // STAGE 4 — the PM confirms readiness and plans the verification trial.
  const readyConfirmedAt = issueClock(at(9, 9));
  issue = await updateIssue({
    issue,
    actorId: pm.id,
    updatedAt: readyConfirmedAt,
    data: { pmReadyConfirmedAt: readyConfirmedAt, pmReadyConfirmedById: pm.id }
  });
  const t1Planned = await planNextTrial({
    project,
    pmId: pm.id,
    trialCode: "T1",
    sequenceNumber: 2,
    plannedDate: dayOnly(4),
    planReasonDetail: "验证 A穴分型面批锋整改效果，并确认保压工艺窗口。",
    createdAt: at(9, 9, 30)
  });
  const t1Confirmed = await confirmTrialDate({
    project,
    trial: t1Planned,
    injectionId: injection.id,
    machine,
    confirmedAt: at(9, 14)
  });

  // STAGE 5 — QC uploads the T0 report, then verifies the fix at T1.
  await uploadMeasurementReport({ project, trial: t0, qcId: qc.id, uploadedAt: at(13, 10) });
  await saveProcessValues({
    project,
    trial: t1Confirmed,
    injectionId: injection.id,
    valuesByKey: processValuesForTrial(machine, { holdPressure1: 760, holdPressure2: 600, coolingTime: 18, cycleTime: 40 }),
    savedAt: at(4, 10, 30)
  });
  // QC sets the severity at verification (the reporter never grades it).
  issue = await updateIssue({
    issue,
    actorId: qc.id,
    updatedAt: issueClock(at(4, 14)),
    data: {
      status: "VERIFIED",
      severity: "HIGH",
      verifiedAtTrialEventId: t1Confirmed.id,
      verificationMethod: "首件全尺寸检测 + 外观目视（对照客户封样）",
      verificationResult: "T1 首件 A/B 穴外观无批锋，全尺寸 12/12 项合格。"
    }
  });
  const t1 = await recordCompletedTrial({
    project,
    trial: t1Confirmed,
    pmId: pm.id,
    actualDate: dayOnly(4),
    result: "APPROVED",
    outcomeDisposition: "APPROVED_COMPLETE",
    projectStatus: "APPROVED",
    sampleQuantity: 50,
    mainIssuesSummary: "T1：批锋整改验证通过，外观与尺寸全部合格。",
    outcomeNote: "样品送客户确认，等待签样。",
    recordedAt: at(4, 16)
  });
  await uploadMeasurementReport({ project, trial: t1, qcId: qc.id, uploadedAt: at(3, 10) });

  // STAGE 6 — the fix is verified, so the PM closes the issue and the project.
  const closedAt = issueClock(at(2, 9));
  issue = await updateIssue({
    issue,
    actorId: pm.id,
    updatedAt: closedAt,
    action: "closed_trial_issue",
    data: { status: "CLOSED", closedAt, closedById: pm.id }
  });
  await prisma.moldTrialProject.update({
    where: { id: project.id },
    data: {
      finalTrialCount: 2,
      closeReason: "客户签样批准，2 次试模结案。",
      updatedAt: at(2, 10)
    }
  });

  return { project, trials: [t0, t1], issue };
}

// ---------------------------------------------------------------------------
// SCENARIO 2 — MP-DEMO-002: a T0 date waiting for Injection to confirm
// ---------------------------------------------------------------------------
async function buildAwaitingDateConfirmation({ customer, actors }) {
  const { marketing, pm } = actors;
  const project = await createIntakeProject({
    code: `${PREFIX}002`,
    customer,
    marketingId: marketing.id,
    moldCode: "DM-2602",
    partCode: "DM-2602-A",
    clientProjectRef: "KH-2026-052",
    priority: "HIGH",
    intakeNote: "客户加急项目：支架件，一模一穴，PA66+GF30，要求两周内出首样。",
    initialCustomerNote: "客户催样：本月底前必须收到首批样品与测量报告。",
    customerTargetDate: futureDayOnly(12),
    parts: [{ partCode: "DM-2602-A", partName: "支架", cavityLabel: "A穴", cavityCount: 1, notes: "加纤料，注意烧焦与困气" }],
    createdAt: at(6, 9)
  });

  // The PM set the date ~19h ago and Injection has NOT answered: on /me this is
  // one live card with an amber "~5h left" chip (inj.date_confirm = 24h).
  const plannedAt = hoursAgo(19);
  const { trial } = await planFirstT0({
    project,
    pmId: pm.id,
    plannedDate: futureDayOnly(5),
    createdAt: plannedAt
  });
  return { project, trial };
}

// ---------------------------------------------------------------------------
// SCENARIO 3 — MP-DEMO-003: the claim demo + the acknowledge/self-check demo
// ---------------------------------------------------------------------------
async function buildCorrectionLoop({ customer, actors, machines }) {
  const { marketing, pm, injection, assembly, qc } = actors;
  const machine = machines[1];

  const project = await createIntakeProject({
    code: `${PREFIX}003`,
    customer,
    marketingId: marketing.id,
    moldCode: "DM-2603",
    partCode: "DM-2603-A",
    clientProjectRef: "KH-2026-047",
    priority: "NORMAL",
    intakeNote: "客户返单改模：上盖 + 下盖各一穴，PC+ABS 黑色，验证顶出与外观。",
    initialCustomerNote: "客户要求：顶针位不可顶白，外观面无夹水线。",
    customerTargetDate: futureDayOnly(10),
    parts: [
      { partCode: "DM-2603-A", partName: "上盖", cavityLabel: "A穴", cavityCount: 1, notes: "外观面" },
      { partCode: "DM-2603-B", partName: "下盖", cavityLabel: "B穴", cavityCount: 1, notes: "顶针位偏薄" }
    ],
    createdAt: at(12, 9)
  });
  const parts = await prisma.moldTrialPart.findMany({
    where: { moldTrialProjectId: project.id },
    orderBy: { sortOrder: "asc" },
    select: { id: true, partCode: true }
  });

  // T0 ran yesterday; the result was recorded on the trial day itself.
  const recordedAt = hoursAgo(23);
  const trialDay = startOfDayUtc(recordedAt);
  const { trial: t0Planned } = await planFirstT0({
    project,
    pmId: pm.id,
    plannedDate: trialDay,
    createdAt: at(10, 10)
  });
  const t0Confirmed = await confirmTrialDate({
    project,
    trial: t0Planned,
    injectionId: injection.id,
    machine,
    confirmedAt: at(10, 15)
  });
  await saveProcessValues({
    project,
    trial: t0Confirmed,
    injectionId: injection.id,
    valuesByKey: processValuesForTrial(machine, { holdPressure1: 700, holdPressure2: 540, coolingTime: 20, cycleTime: 42 }),
    savedAt: hoursAgo(24)
  });
  const t0 = await recordCompletedTrial({
    project,
    trial: t0Confirmed,
    pmId: pm.id,
    actualDate: trialDay,
    result: "NOT_APPROVED",
    outcomeDisposition: "REWORK_REQUIRED",
    projectStatus: "IN_CORRECTION",
    sampleQuantity: 25,
    mainIssuesSummary: "T0：分型面批锋 + B穴顶针位顶白，需整改后验证。",
    outcomeNote: "样品未通过，模具整改后安排 T1 验证。",
    recordedAt
  });

  // (a) Already claimed, acknowledge still pending — the acknowledge/self-check
  //     demo. Created ~20h ago, so the 24h acknowledge chip reads ~4h (amber).
  const claimedIssueType = "ASSEMBLY_FITTING_ISSUE";
  const assemblyInbox = await groupForCode(defaultOwnerGroupCodeForIssueType(claimedIssueType));
  const claimedIssue = await fileIssueWithPhoto({
    project,
    trial: t0,
    reporterId: injection.id,
    title: "分型面批锋，产品边缘毛刺",
    description: "T0 试模中后段分型面出现批锋，A穴产品边缘毛刺明显，已停机取样拍照。",
    issueType: claimedIssueType,
    source: "INTERNAL_TRIAL",
    severity: "MEDIUM",
    affectedPartId: parts[0].id,
    affectedCavityNote: "A穴",
    ownerGroupId: assemblyInbox.id,
    createdAt: hoursAgo(20),
    photoFileName: "T0-分型面批锋.jpg"
  });
  await claimIssue({ issue: claimedIssue, claimerId: assembly.id, claimedAt: hoursAgo(18) });

  // (b) Fresh and UNCLAIMED — the 我来处理 demo. QC filed it 6h ago with a photo
  //     and named nobody; it sits in the assembly department inbox (~42h left).
  const openIssueType = "ASSEMBLY_FITTING_ISSUE";
  const openInbox = await groupForCode(defaultOwnerGroupCodeForIssueType(openIssueType));
  const unclaimedIssue = await fileIssueWithPhoto({
    project,
    trial: t0,
    reporterId: qc.id,
    title: "B穴顶针位顶白，顶出不顺",
    description: "全检样品发现 B穴顶针位顶白，脱模有阻力，需检查顶出机构与脱模斜度。",
    issueType: openIssueType,
    source: "QC_INSPECTION",
    severity: "MEDIUM",
    affectedPartId: parts[1].id,
    affectedCavityNote: "B穴",
    ownerGroupId: openInbox.id,
    createdAt: hoursAgo(6),
    photoFileName: "T0-B穴顶白.jpg"
  });

  // QC's T0 measurement report is already in (the 48h clock started yesterday).
  await uploadMeasurementReport({ project, trial: t0, qcId: qc.id, uploadedAt: hoursAgo(4) });

  // The verification trial is already planned AND confirmed, so the self-check
  // deadline ("before the next trial") is concrete on screen.
  const t1Planned = await planNextTrial({
    project,
    pmId: pm.id,
    trialCode: "T1",
    sequenceNumber: 2,
    plannedDate: futureDayOnly(4),
    planReasonDetail: "验证分型面批锋与 B穴顶出整改效果。",
    createdAt: hoursAgo(17)
  });
  await confirmTrialDate({
    project,
    trial: t1Planned,
    injectionId: injection.id,
    machine,
    confirmedAt: hoursAgo(16)
  });

  return { project, claimedIssue, unclaimedIssue, nextTrial: t1Planned };
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------
async function main() {
  if (RESET) {
    await resetDemoData();
  }
  if (RESET_ONLY) {
    return;
  }

  const existing = await prisma.moldTrialProject.count({ where: { projectCode: { startsWith: PREFIX } } });
  if (existing > 0) {
    throw new Error(
      `${existing} ${PREFIX} project(s) already exist. Re-run with \`--reset\` to rebuild them (only ${PREFIX} data is deleted).`
    );
  }

  // Roster resolved at runtime, by role, from whatever bootstrap loaded.
  const [marketing, pm, injection, assembly, qc] = await Promise.all([
    actorForRole("marketing"),
    actorForRole("pm"),
    actorForRole("injection"),
    actorForRole("assembly"),
    actorForRole("qc")
  ]);
  const actors = { marketing, pm, injection, assembly, qc };

  const templateBundle = await demoProcessTemplate();
  processTemplate = templateBundle.template;
  processParameters = templateBundle.parameters;
  const machines = await demoMachines();
  const customer = await ensureDemoCustomer(marketing.id, processTemplate.id);

  const journey = await buildCompleteJourney({ customer, actors, machines });
  const pending = await buildAwaitingDateConfirmation({ customer, actors });
  const correction = await buildCorrectionLoop({ customer, actors, machines });

  const who = (user) => `${user.username}${user.chineseName == null ? "" : ` / ${user.chineseName}`}`;
  console.log("");
  console.log("Training examples created (roster resolved at runtime, by role):");
  console.log(`  Marketing 市场   ${who(marketing)}`);
  console.log(`  PM 项目管理      ${who(pm)}`);
  console.log(`  Injection 注塑   ${who(injection)}`);
  console.log(`  Assembly 装配    ${who(assembly)}`);
  console.log(`  QC 质检          ${who(qc)}`);
  console.log(`  Presses          No. ${machines[0].machineNo} / No. ${machines[1].machineNo}`);
  console.log("");
  console.log(`${journey.project.projectCode} 完整流程 (APPROVED, 2/3 trials, issue CLOSED)`);
  console.log("  Walk the project page top to bottom: intake -> T0 confirmed with a machine ->");
  console.log("  process sheet -> defect + photo -> 我来处理 -> acknowledge/self-check -> T1 ->");
  console.log("  QC verdict -> two measurement reports (CUSTOMER_SAFE) -> Approved. The activity");
  console.log("  timeline at the bottom is the whole story in order.");
  console.log("");
  console.log(`${pending.project.projectCode} 待注塑确认日期 (WAITING_TRIAL)`);
  console.log(`  Log in as ${injection.username} -> /me: ONE live "Confirm trial dates" card,`);
  console.log("  amber chip ~5h left (24h rule). Confirm it live, or counter-propose to hand");
  console.log(`  Marketing (${marketing.username}) an approval task.`);
  console.log("");
  console.log(`${correction.project.projectCode} 整改中 (IN_CORRECTION)`);
  console.log(`  Log in as ${assembly.username} -> /me:`);
  console.log("    · Department inbox: 「B穴顶针位顶白」 unclaimed, with a photo -> press 我来处理.");
  console.log("    · Assembly acknowledge: 「分型面批锋」 already claimed, amber ~4h left ->");
  console.log("      acknowledge with an estimated finish, then the self-check card appears.");
  console.log(`  T1 is planned in 4 days and already confirmed, so "before the next trial" is real.`);
  console.log("");
  console.log("Note: if MP-SIM- simulator data is loaded too, its cards appear on the same /me");
  console.log("pages. For a clean training session run `node scripts/simulate-kpi-data.mjs --reset`");
  console.log("first, or point the trainer at the MP-DEMO- project codes on each card.");
  const resetCommand = deploymentAllowance.production
    ? `pnpm training:examples -- --reset --production-confirm "${PRODUCTION_TRAINING_CONFIRMATION}"`
    : "pnpm training:examples -- --reset";
  console.log(`Reset: \`${resetCommand}\` (MP-DEMO- only, files included).`);
}

try {
  await main();
} catch (error) {
  console.error(`\n[FAIL] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
