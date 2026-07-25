#!/usr/bin/env node
/**
 * KPI simulation data generator. Writes ~6 weeks of realistic MoldPilot
 * activity under the projectCode prefix "MP-SIM-" so the whole KPI engine AND
 * every shipped /me task channel can be exercised end-to-end on the owner's Mac:
 *
 *   node scripts/simulate-kpi-data.mjs            # generate (idempotent-ish)
 *   node scripts/simulate-kpi-data.mjs --reset    # delete all MP-SIM- data first
 *
 * Two layers of data:
 *
 * 1. MONTHLY personas — mixed on-time/late timestamps so the poster personas
 *    emerge in the CURRENT month's Scores tab:
 *      zhong (assembly lead) ~92%  · wang (injection lead) 75% (misses)
 *      bill  (PM)           ~92%  · gong (QC referee)     100%
 *      yvonne(marketing)   100%   · lin  (design lead)     90%  (one late)
 *
 * 2. LIVE task channels — items left in a pending state AT RUN END so every
 *    role's /me demos its own inbox (wang confirms, yvonne approval, bill
 *    returned date, zhong inbox+ack, gong missing report, lin design revisions).
 *    These are engineered to be scoring-neutral (unattributed / pending-excluded
 *    / previous-month anchors) so they never move the monthly percentages.
 *
 * REAL FILES: every attachment writes actual bytes through the same
 * key/path conventions as src/server/attachment-storage.ts (a valid 1x1 JPEG for
 * TRIAL_PHOTOs, a minimal valid PDF for QC reports, a small STEP text for
 * DRAWINGs) under MOLDPILOT_STORAGE_DIR, so galleries, the lightbox, and
 * downloads all work in demos. --reset deletes the files it wrote.
 *
 * For every timestamp the extractor reads, a matching ActivityLog row is written
 * so the live Scores tab and the nightly snapshot agree with the summary below.
 * (Live channels assume a mid-month run so their hour-offset anchors stay in the
 * current month; that matches how the monthly generators spread across past days.)
 */
import "dotenv/config";

import { mkdir, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

import { severityWeight } from "../src/domain/mold-trial/kpi-rules.ts";
import { buildStorageKey, resolveStoragePath } from "../src/domain/mold-trial/attachments.ts";

const RESET = process.argv.includes("--reset");
const PREFIX = "MP-SIM-";

const { PrismaClient } = await import("@prisma/client");
const { PrismaPg } = await import("@prisma/adapter-pg");
const connectionString =
  process.env.DATABASE_URL ?? "postgresql://moldpilot:moldpilot@localhost:5432/moldpilot?schema=public";
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

// The live Scores tab scores the CURRENT month, so every rule's "applicable"
// anchor (trial.createdAt, autoMissedAt, issue.createdAt, the record-result
// log, actualDate's end-of-day) must land inside this month AND strictly in the
// PAST relative to `now` — otherwise a "done" timestamp can precede its anchor,
// or a trial's actualDate falls in the future ("Due Jul 30, done Jul 2").
//
// We build timestamps as DAY OFFSETS counted back from the run day, clamped to
// day 1 of the month, and spread events across the available in-month past days
// so the six-week generator does not cram everything onto two days. Every
// generator threads its anchor -> intermediate -> done chain monotonically:
//   anchor <= done <= latest (a safe margin before now).
const now = new Date();
const y = now.getUTCFullYear();
const m = now.getUTCMonth();
const runDay = now.getUTCDate();

/** A Date `daysBeforeRun` days before the run day (clamped to day 1), at `hour`. */
function at(daysBeforeRun, hour = 9) {
  const day = Math.max(1, runDay - daysBeforeRun);
  return new Date(Date.UTC(y, m, day, hour, 0, 0));
}
/** @db.Date value `daysBeforeRun` days before the run day (clamped to day 1). */
function dayOnly(daysBeforeRun) {
  const day = Math.max(1, runDay - daysBeforeRun);
  return new Date(Date.UTC(y, m, day));
}
function iso(daysBeforeRun) {
  return dayOnly(daysBeforeRun).toISOString().slice(0, 10);
}

// --- Live-channel time helpers (precise, for countdown chips at run end) -------
/** A Date exactly `h` hours before `now` (hour-precise, for live countdowns). */
function hoursAgo(h) {
  return new Date(now.getTime() - h * 60 * 60 * 1000);
}
/** UTC midnight of the day `date` falls on (a @db.Date value). */
function startOfDayUtc(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}
/** A date in the PREVIOUS month (day 15) — an anchor that never lands in-window. */
function lastMonthAt(hour = 9) {
  const prevYear = m === 0 ? y - 1 : y;
  const prevMonth = m === 0 ? 11 : m - 1;
  return new Date(Date.UTC(prevYear, prevMonth, 15, hour, 0, 0));
}
/** @db.Date value `daysAfterRun` days in the future (rolls into next month if needed). */
function futureDayOnly(daysAfterRun) {
  return new Date(Date.UTC(y, m, runDay + daysAfterRun));
}
function futureIso(daysAfterRun) {
  return futureDayOnly(daysAfterRun).toISOString().slice(0, 10);
}

/** Assert (dev-time) that a done/log moment never precedes its anchor. */
function ordered(anchor, done, label) {
  if (done != null && done.getTime() < anchor.getTime()) {
    throw new Error(`[sim] ${label}: done ${done.toISOString()} precedes anchor ${anchor.toISOString()}`);
  }
  return done;
}

async function log(actorUserId, entityType, entityId, action, createdAt, afterJson) {
  await prisma.activityLog.create({
    data: { actorUserId, entityType, entityId, action, createdAt, afterJson: afterJson ?? { sim: true } }
  });
}

async function requireUser(username) {
  const user = await prisma.user.findUnique({ where: { username } });
  if (user == null) throw new Error(`Missing user "${username}". Run the seed first (pnpm prisma:seed).`);
  return user;
}

// --- Real attachment bytes ----------------------------------------------------
// Valid 1x1 JPEG (SOI…EOI, 3-component) so <img> thumbnails + the lightbox render.
const SIM_JPEG = Buffer.from(
  "/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wgARCAABAAEDAREAAhEBAxEB/8QAFAABAAAAAAAAAAAAAAAAAAAAAv/EABQBAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhADEAAAAT8P/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABBQJ//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAwEBPwF//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAgEBPwF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQAGPwJ//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPyF//9oADAMBAAIAAwAAABAf/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAwEBPxB//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAgEBPxB//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxB//9k=",
  "base64"
);
// Minimal valid single-page PDF (correct xref) so QC-report downloads open.
const SIM_PDF = Buffer.from(
  "JVBERi0xLjQKMSAwIG9iago8PC9UeXBlL0NhdGFsb2cvUGFnZXMgMiAwIFI+PgplbmRvYmoKMiAwIG9iago8PC9UeXBlL1BhZ2VzL0tpZHNbMyAwIFJdL0NvdW50IDE+PgplbmRvYmoKMyAwIG9iago8PC9UeXBlL1BhZ2UvUGFyZW50IDIgMCBSL01lZGlhQm94WzAgMCAyMDAgMjAwXS9SZXNvdXJjZXM8PC9Gb250PDwvRjEgNSAwIFI+Pj4+L0NvbnRlbnRzIDQgMCBSPj4KZW5kb2JqCjQgMCBvYmoKPDwvTGVuZ3RoIDUyPj4Kc3RyZWFtCkJUIC9GMSAxNCBUZiAyMCAxMDAgVGQgKE1QLVNJTSBRQyByZXBvcnQpIFRqIEVUCmVuZHN0cmVhbQplbmRvYmoKNSAwIG9iago8PC9UeXBlL0ZvbnQvU3VidHlwZS9UeXBlMS9CYXNlRm9udC9IZWx2ZXRpY2E+PgplbmRvYmoKeHJlZgowIDYKMDAwMDAwMDAwMCA2NTUzNSBmIAowMDAwMDAwMDA5IDAwMDAwIG4gCjAwMDAwMDAwNTQgMDAwMDAgbiAKMDAwMDAwMDEwNSAwMDAwMCBuIAowMDAwMDAwMjE3IDAwMDAwIG4gCjAwMDAwMDAzMTIgMDAwMDAgbiAKdHJhaWxlcgo8PC9TaXplIDYvUm9vdCAxIDAgUj4+CnN0YXJ0eHJlZgozNzUKJSVFT0YK",
  "base64"
);
// Small but structurally valid STEP (ISO-10303-21) text for a native CAD DRAWING.
const SIM_STP = Buffer.from(
  [
    "ISO-10303-21;",
    "HEADER;",
    "FILE_DESCRIPTION((''),'2;1');",
    "FILE_NAME('MP-SIM.stp','2026-07-08T00:00:00',(''),(''),'','','');",
    "FILE_SCHEMA(('AUTOMOTIVE_DESIGN'));",
    "ENDSEC;",
    "DATA;",
    "#1=CARTESIAN_POINT('',(0.,0.,0.));",
    "#2=DIRECTION('',(0.,0.,1.));",
    "ENDSEC;",
    "END-ISO-10303-21;",
    ""
  ].join("\n"),
  "utf8"
);

const fileSpecByType = {
  TRIAL_PHOTO: { extension: "jpg", contentType: "image/jpeg", buffer: SIM_JPEG, visibility: "INTERNAL", fileName: "sim-photo.jpg" },
  QC_REPORT: { extension: "pdf", contentType: "application/pdf", buffer: SIM_PDF, visibility: "INTERNAL", fileName: "sim-qc-report.pdf" },
  DRAWING: { extension: "stp", contentType: "model/step", buffer: SIM_STP, visibility: "TECHNICAL", fileName: "sim-drawing.stp" }
};

/** Mirror of attachmentStorageRoot() in src/server/attachment-storage.ts. */
function storageRoot() {
  const configured = process.env.MOLDPILOT_STORAGE_DIR;
  const root = configured != null && configured.trim().length > 0 ? configured : path.join("storage", "uploads");
  return path.isAbsolute(root) ? root : path.resolve(process.cwd(), root);
}

/**
 * Write REAL bytes for an attachment (server-generated id + sharded key, exactly
 * like writeAttachmentFile) and create the FileAttachment row with the true
 * contentType/sizeBytes so downloads and galleries work.
 */
async function createSimAttachment({ project, entityType, entityId, fileType, uploadedById, uploadedAt, fileName, visibility }) {
  const spec = fileSpecByType[fileType];
  if (spec == null) throw new Error(`[sim] no byte template for file type ${fileType}`);
  const id = randomUUID();
  const storageKey = buildStorageKey(id, spec.extension);
  const absolutePath = resolveStoragePath(storageRoot(), storageKey);
  if (absolutePath == null) throw new Error(`[sim] refusing to write outside storage root: ${storageKey}`);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, spec.buffer);
  return prisma.fileAttachment.create({
    data: {
      id,
      moldTrialProjectId: project.id,
      entityType,
      entityId,
      fileName: fileName ?? spec.fileName,
      fileType,
      storageKey,
      contentType: spec.contentType,
      sizeBytes: spec.buffer.byteLength,
      visibility: visibility ?? spec.visibility,
      uploadedById,
      uploadedAt
    }
  });
}

async function resetSimData() {
  const projects = await prisma.moldTrialProject.findMany({
    where: { projectCode: { startsWith: PREFIX } },
    select: { id: true }
  });
  const ids = projects.map((p) => p.id);
  if (ids.length === 0) {
    console.log("[reset] Removed 0 MP-SIM- project(s) and their records.");
    return;
  }
  // FileAttachment / TrialProcessValue / TrialIssue / TrialEvent / DesignChangeEvent
  // cascade with the project delete; ActivityLog does not, so clear sim logs by
  // entity. Real files on disk are removed here (before the rows cascade away).
  const [trials, issues, attachments] = await Promise.all([
    prisma.trialEvent.findMany({ where: { moldTrialProjectId: { in: ids } }, select: { id: true } }),
    prisma.trialIssue.findMany({ where: { moldTrialProjectId: { in: ids } }, select: { id: true } }),
    prisma.fileAttachment.findMany({ where: { moldTrialProjectId: { in: ids } }, select: { storageKey: true } })
  ]);
  const designChanges = await prisma.designChangeEvent.findMany({
    where: { moldTrialProjectId: { in: ids } },
    select: { id: true }
  });
  let removedFiles = 0;
  for (const attachment of attachments) {
    const absolutePath = resolveStoragePath(storageRoot(), attachment.storageKey);
    if (absolutePath != null) {
      await rm(absolutePath, { force: true });
      removedFiles += 1;
    }
  }
  const entityIds = [
    ...ids,
    ...trials.map((t) => t.id),
    ...issues.map((i) => i.id),
    ...designChanges.map((d) => d.id)
  ];
  await prisma.activityLog.deleteMany({ where: { entityId: { in: entityIds } } });
  await prisma.moldTrialProject.deleteMany({ where: { id: { in: ids } } });
  console.log(`[reset] Removed ${ids.length} MP-SIM- project(s), ${removedFiles} file(s), and their records.`);
}

async function ensureSimCustomer(adminId) {
  const existing = await prisma.customer.findUnique({ where: { code: "MP-SIM" } });
  if (existing != null) return existing;
  return prisma.customer.create({
    data: {
      code: "MP-SIM",
      displayName: "Simulation Customer",
      shortName: "SIM",
      active: true,
      createdById: adminId,
      updatedById: adminId
    }
  });
}

/** Return at least `count` active injection machines, creating SIM ones as needed. */
async function ensureMachines(count) {
  const existing = await prisma.injectionMachine.findMany({ where: { active: true }, orderBy: { machineNo: "asc" } });
  const machines = [...existing];
  let next = 901;
  while (machines.length < count) {
    machines.push(
      await prisma.injectionMachine.create({ data: { machineNo: String(next), brand: "SIM", tonnage: 200 + next % 100, active: true } })
    );
    next += 1;
  }
  return machines;
}

async function createProject(index, { customer, pmId, adminId }) {
  const code = `${PREFIX}${String(index).padStart(3, "0")}`;
  return prisma.moldTrialProject.create({
    data: {
      projectCode: code,
      customerId: customer.id,
      customerCode: customer.code,
      partCode: `SIM-PART-${index}`,
      moldCode: `SIM-MOLD-${index}`,
      status: "ACTIVE",
      planningPmId: pmId,
      baseTrialLimit: 3,
      currentTrialLimit: 3,
      createdById: adminId
    }
  });
}

/**
 * Create a completed trial whose result was recorded by `recorderId`. Writes
 * the trial + the `recorded_completed_trial` ActivityLog whose createdAt is the
 * on-time/late signal for pm.result_recorded and the clock-start for
 * qc.report_upload. `confirmerId` owns inj.date_confirm + inj.process_values.
 *
 * All day parameters are DAYS-BEFORE-RUN (bigger = older). The timeline is
 * strictly monotonic and entirely in the past:
 *   created (anchor) -> confirmed -> actualDate -> result recorded -> qc upload,
 * each no earlier than the previous and none later than the run day.
 */
async function completedTrial({
  project,
  seq,
  machine,
  adminId,
  confirmerId,
  recorderId,
  anchorAgo,
  confirmOnTime,
  recordOnTime,
  withProcessValues,
  qcOnTime,
  processSheetParameterId,
  enteredById
}) {
  const createdAt = at(anchorAgo, 8);
  const actualDate = dayOnly(anchorAgo);
  const dateConfirmedAt = confirmOnTime ? at(anchorAgo, 12) : at(anchorAgo - 2, 12);
  const recordAgo = recordOnTime ? anchorAgo : anchorAgo - 1;
  const recordedAt = at(recordAgo, 10);
  const qcUploadAt = qcOnTime ? at(recordAgo - 1, 14) : at(recordAgo - 2, 14);

  const trial = await prisma.trialEvent.create({
    data: {
      moldTrialProjectId: project.id,
      trialCode: seq === 1 ? "T0" : seq === 2 ? "T1" : "T2",
      sequenceNumber: seq,
      plannedDate: actualDate,
      actualDate,
      status: "COMPLETED",
      injectionMachineId: machine.id,
      result: "APPROVED",
      countsAgainstLimit: true,
      dateConfirmationStatus: "CONFIRMED",
      dateConfirmedById: confirmerId,
      dateConfirmedAt: ordered(createdAt, dateConfirmedAt, "date confirm"),
      createdById: adminId,
      createdAt
    }
  });

  if (withProcessValues && processSheetParameterId != null) {
    await prisma.trialProcessValue.create({
      data: {
        moldTrialProjectId: project.id,
        trialEventId: trial.id,
        processSheetParameterId,
        parameterKeySnapshot: "sim_param",
        labelEnSnapshot: "Sim param",
        valueText: "ok",
        enteredById
      }
    });
  }

  await log(recorderId, "TrialEvent", trial.id, "recorded_completed_trial", recordedAt, { result: "APPROVED" });

  // qc.report_upload doneAt: a REAL QC_REPORT PDF on disk.
  await createSimAttachment({
    project,
    entityType: "TRIAL_EVENT",
    entityId: trial.id,
    fileType: "QC_REPORT",
    uploadedById: recorderId,
    uploadedAt: ordered(recordedAt, qcUploadAt, "qc upload"),
    fileName: "sim-qc-report.pdf"
  });

  return trial;
}

/**
 * Create a PLANNED (not completed) trial whose date `confirmerId` confirmed.
 * Only inj.date_confirm fires (no completion => no process_values / result /
 * qc), so this contributes date-confirm events without adding process-value
 * events. `confirmOnTime` decides the on-time signal.
 */
async function confirmOnlyTrial({ project, seq, machine, adminId, confirmerId, createdAgo, confirmOnTime }) {
  const createdAt = at(createdAgo, 8);
  const dateConfirmedAt = confirmOnTime ? at(createdAgo, 12) : at(createdAgo - 2, 12);
  return prisma.trialEvent.create({
    data: {
      moldTrialProjectId: project.id,
      trialCode: seq === 1 ? "T0" : "T1",
      sequenceNumber: seq,
      plannedDate: dayOnly(createdAgo),
      status: "PLANNED",
      injectionMachineId: machine.id,
      dateConfirmationStatus: "CONFIRMED",
      dateConfirmedById: confirmerId,
      dateConfirmedAt: ordered(createdAt, dateConfirmedAt, "confirm-only date confirm"),
      createdById: adminId,
      createdAt
    }
  });
}

/** Create an auto-missed-then-resolved trial for pm.missed_reason. */
async function missedTrial({ project, seq, adminId, pmId, missedAgo, resolveOnTime }) {
  const autoMissedAt = at(missedAgo, 8); // anchor (clock start)
  const autoMissedResolvedAt = resolveOnTime ? at(missedAgo, 20) : at(missedAgo - 2, 20);
  return prisma.trialEvent.create({
    data: {
      moldTrialProjectId: project.id,
      trialCode: seq === 1 ? "T0" : "T1",
      sequenceNumber: seq,
      plannedDate: dayOnly(missedAgo),
      status: "DELAYED",
      autoMissedAt,
      autoMissedResolvedAt: ordered(autoMissedAt, autoMissedResolvedAt, "missed resolve"),
      autoMissedResolvedById: pmId,
      autoMissedResolution: "MISSED_CONFIRMED",
      createdById: adminId,
      createdAt: at(missedAgo + 2, 8)
    }
  });
}

/** Create a RETURNED_TO_PM trial + the re-date log for pm.returned_redate. */
async function returnedTrial({ project, seq, adminId, pmId, decisionAgo, redateOnTime }) {
  const rescheduleDecisionAt = at(decisionAgo, 9); // anchor (rejection clock start)
  const redatedAt = redateOnTime ? at(decisionAgo, 20) : at(decisionAgo - 2, 20);
  const trial = await prisma.trialEvent.create({
    data: {
      moldTrialProjectId: project.id,
      trialCode: "T1",
      sequenceNumber: seq,
      plannedDate: dayOnly(decisionAgo),
      status: "PLANNED",
      dateConfirmationStatus: "RETURNED_TO_PM",
      rescheduleDecisionById: pmId,
      rescheduleDecisionAt,
      rescheduleRejectReason: "Machine conflict",
      createdById: adminId,
      createdAt: at(decisionAgo + 3, 8)
    }
  });
  await log(pmId, "TrialEvent", trial.id, "redated_returned_trial", ordered(rescheduleDecisionAt, redatedAt, "redate"), {
    newPlannedDate: iso(decisionAgo)
  });
  return trial;
}

/**
 * Create an assembly issue acknowledged (+ self-checked) by zhong. `ackOnTime`
 * decides asm.acknowledge; self-check always passes here. A REAL defect photo is
 * attached so the reporter's all.photo_on_defect passes.
 */
async function assemblyIssue({ project, reporterId, zhongId, createdAgo, ackOnTime, severity, verified, verifyTrialId }) {
  const createdAt = at(createdAgo, 8); // anchor (assembly clock start)
  const acknowledgedAt = ackOnTime ? at(createdAgo, 20) : at(createdAgo - 2, 20);
  const selfCheckedAt = at(createdAgo - 1, 10);
  const closedAt = verified ? at(createdAgo - 2, 10) : null;
  const issue = await prisma.trialIssue.create({
    data: {
      moldTrialProjectId: project.id,
      title: `Assembly fit ${createdAgo}`,
      issueType: "ASSEMBLY_FITTING_ISSUE",
      source: "TECHNICAL_REVIEW",
      severity,
      status: verified ? "VERIFIED" : "IN_PROGRESS",
      ownerUserId: zhongId,
      ownerGroupId: null,
      assemblyAcknowledgedById: zhongId,
      assemblyAcknowledgedAt: ordered(createdAt, acknowledgedAt, "assembly ack"),
      assemblyEstimatedFinishDate: dayOnly(createdAgo - 2),
      assemblySelfCheckedById: zhongId,
      assemblySelfCheckedAt: ordered(createdAt, selfCheckedAt, "assembly self-check"),
      verifiedAtTrialEventId: verified ? verifyTrialId : null,
      closedAt,
      createdById: reporterId,
      reportedById: reporterId,
      createdAt
    }
  });
  await createSimAttachment({
    project,
    entityType: "TRIAL_ISSUE",
    entityId: issue.id,
    fileType: "TRIAL_PHOTO",
    uploadedById: reporterId,
    uploadedAt: at(createdAgo, 9),
    fileName: "sim-assembly-defect.jpg"
  });
  return issue;
}

/**
 * Create a department-inbox issue claimed by `claimerId` (all.inbox_claim, plus
 * design.inbox_claim when `groupId` is the design group). The `creatorId` (a
 * scored-role user, never admin) owns the all.photo_on_defect boolean.
 */
async function inboxIssue({ project, creatorId, claimerId, groupId, createdAgo, claimOnTime, hasPhoto, issueType }) {
  const createdAt = at(createdAgo, 8); // anchor (inbox clock start)
  const claimedAt = claimOnTime ? at(createdAgo, 20) : at(createdAgo - 3, 20);
  const issue = await prisma.trialIssue.create({
    data: {
      moldTrialProjectId: project.id,
      title: `Inbox item ${createdAgo}`,
      issueType: issueType ?? "APPEARANCE_ISSUE",
      source: "QC_INSPECTION",
      severity: "LOW",
      status: "IN_PROGRESS",
      ownerUserId: claimerId,
      ownerGroupId: groupId,
      createdById: creatorId,
      reportedById: creatorId,
      createdAt,
      updatedAt: ordered(createdAt, claimedAt, "inbox claim updatedAt")
    }
  });
  await log(claimerId, "TrialIssue", issue.id, "claimed_department_inbox_issue", ordered(createdAt, claimedAt, "inbox claim log"), {
    ownerUserId: claimerId
  });
  if (hasPhoto) {
    await createSimAttachment({
      project,
      entityType: "TRIAL_ISSUE",
      entityId: issue.id,
      fileType: "TRIAL_PHOTO",
      uploadedById: creatorId,
      uploadedAt: at(createdAgo, 9),
      fileName: "sim-defect.jpg"
    });
  }
  return issue;
}

/**
 * Create a design-change event whose first DRAWING (a REAL .stp) was uploaded by
 * `drawerId` (lin). `onTime` decides design.change_revision (48h from the event's
 * createdAt). The drawing upload is the "done" moment.
 */
async function designChangeWithDrawing({ project, creatorId, drawerId, createdAgo, onTime, index }) {
  const createdAt = at(createdAgo, 8); // anchor (revision clock start)
  // On-time: next day 14:00 (~30h < 48h). Late: three days on (~78h > 48h).
  const uploadedAt = onTime ? at(createdAgo - 1, 14) : at(createdAgo - 3, 14);
  const event = await prisma.designChangeEvent.create({
    data: {
      moldTrialProjectId: project.id,
      changeDate: dayOnly(createdAgo),
      requestedBy: "CUSTOMER",
      title: `Design change ${index}`,
      description: "Simulated design-change revision awaiting an updated drawing.",
      firstCompletedTrialAlreadyDone: false,
      createdById: creatorId,
      createdAt
    }
  });
  await createSimAttachment({
    project,
    entityType: "DESIGN_CHANGE_EVENT",
    entityId: event.id,
    fileType: "DRAWING",
    uploadedById: drawerId,
    uploadedAt: ordered(createdAt, uploadedAt, "design drawing"),
    fileName: `sim-drawing-${index}.stp`,
    visibility: "TECHNICAL"
  });
  return event;
}

/**
 * Create a design-group issue reported by lin and claimed by lin on-time
 * (mirrors the marketing inbox pattern): emits all.inbox_claim +
 * design.inbox_claim + all.photo_on_defect, all on-time, attributed to lin.
 */
async function designInboxClaimed({ project, linId, groupId, createdAgo }) {
  const createdAt = at(createdAgo, 8);
  const claimedAt = at(createdAgo, 20); // same day (<48h) = on-time
  const issue = await prisma.trialIssue.create({
    data: {
      moldTrialProjectId: project.id,
      title: `Design issue ${createdAgo}`,
      issueType: "MOLD_DESIGN_ISSUE",
      source: "TECHNICAL_REVIEW",
      severity: "MEDIUM",
      status: "IN_PROGRESS",
      ownerUserId: linId,
      ownerGroupId: groupId,
      createdById: linId,
      reportedById: linId,
      createdAt,
      updatedAt: ordered(createdAt, claimedAt, "design inbox claim updatedAt")
    }
  });
  await log(linId, "TrialIssue", issue.id, "claimed_department_inbox_issue", ordered(createdAt, claimedAt, "design inbox claim log"), {
    ownerUserId: linId
  });
  await createSimAttachment({
    project,
    entityType: "TRIAL_ISSUE",
    entityId: issue.id,
    fileType: "TRIAL_PHOTO",
    uploadedById: linId,
    uploadedAt: at(createdAgo, 9),
    fileName: `sim-design-photo-${createdAgo}.jpg`
  });
  return issue;
}

async function main() {
  if (RESET) {
    await resetSimData();
  }

  const [admin, bill, wang, zhong, pei, gong, yvonne, lin, mei] = await Promise.all([
    requireUser("admin"),
    requireUser("bill"),
    requireUser("wang"),
    requireUser("zhong"),
    requireUser("pei"),
    requireUser("gong"),
    requireUser("yvonne"),
    requireUser("lin"),
    requireUser("mei")
  ]);

  const [injectionGroup, assemblyGroup, designGroup] = await Promise.all([
    prisma.departmentGroup.findUnique({ where: { code: "injection" } }),
    prisma.departmentGroup.findUnique({ where: { code: "assembly" } }),
    prisma.departmentGroup.findUnique({ where: { code: "design" } })
  ]);
  if (designGroup == null) throw new Error('Missing "design" department group. Run the seed first (pnpm prisma:seed).');

  const customer = await ensureSimCustomer(admin.id);
  const machines = await ensureMachines(3);
  const machine = machines[0];
  const param = await prisma.processSheetParameter.findFirst({ where: { active: true } });

  // 8 simulated projects.
  const projects = [];
  for (let index = 1; index <= 8; index += 1) {
    projects.push(await createProject(index, { customer, pmId: bill.id, adminId: admin.id }));
  }
  const P = (n) => projects[n - 1];

  // ---- INJECTION (wang): inj.date_confirm 5/8, inj.process_values 4/4 = 9/12 (75%)
  const injConfirmOnTime = [true, true, true, false, true, true, false, false];
  const injCompletedAgo = [6, 6, 5, 5];
  for (let i = 0; i < 4; i += 1) {
    await completedTrial({
      project: P((i % 8) + 1),
      seq: 1,
      machine,
      adminId: admin.id,
      confirmerId: wang.id,
      recorderId: gong.id,
      anchorAgo: injCompletedAgo[i],
      confirmOnTime: injConfirmOnTime[i],
      recordOnTime: true,
      withProcessValues: true,
      qcOnTime: true,
      processSheetParameterId: param?.id ?? null,
      enteredById: wang.id
    });
  }
  const injConfirmOnlyAgo = [6, 5, 4, 3];
  for (let i = 4; i < 8; i += 1) {
    await confirmOnlyTrial({
      project: P((i % 8) + 1),
      seq: 1,
      machine,
      adminId: admin.id,
      confirmerId: wang.id,
      createdAgo: injConfirmOnlyAgo[i - 4],
      confirmOnTime: injConfirmOnTime[i]
    });
  }

  // ---- PM (bill): missed_reason 5/5, returned_redate 3/4, result_recorded 7/8,
  //      qc.report_upload 7/8, photo_on_defect 12/12 => 34/37 = 92% (hits the bar).
  const billResultOnTime = [true, true, true, true, true, true, true, false];
  const billQcOnTime = [true, true, true, true, true, true, true, false];
  const pmCompletedAgo = [6, 6, 6, 5, 5, 5, 4, 4];
  for (let i = 0; i < 8; i += 1) {
    await completedTrial({
      project: P((i % 8) + 1),
      seq: 2,
      machine,
      adminId: admin.id,
      confirmerId: gong.id,
      recorderId: bill.id,
      anchorAgo: pmCompletedAgo[i],
      confirmOnTime: true,
      recordOnTime: billResultOnTime[i],
      withProcessValues: true,
      qcOnTime: billQcOnTime[i],
      processSheetParameterId: param?.id ?? null,
      enteredById: gong.id
    });
  }
  const missedAgo = [6, 5, 4, 3, 2];
  for (let i = 0; i < 5; i += 1) {
    await missedTrial({ project: P((i % 8) + 1), seq: 3, adminId: admin.id, pmId: bill.id, missedAgo: missedAgo[i], resolveOnTime: true });
  }
  const redateOnTime = [true, true, true, false];
  const redateAgo = [5, 4, 3, 3];
  for (let i = 0; i < 4; i += 1) {
    await returnedTrial({ project: P((i % 8) + 1), seq: 4, adminId: admin.id, pmId: bill.id, decisionAgo: redateAgo[i], redateOnTime: redateOnTime[i] });
  }

  // ---- ASSEMBLY (zhong): acknowledge 10/12, self_check 12/12 => 22/24 = 92%.
  const ackOnTime = [true, true, true, true, true, true, true, true, true, true, false, false];
  const severities = ["HIGH", "MEDIUM", "MEDIUM", "LOW", "HIGH", "MEDIUM", "LOW", "HIGH", "MEDIUM", "LOW", "MEDIUM", "LOW"];
  const asmAgo = [6, 6, 6, 5, 5, 5, 4, 4, 4, 3, 3, 3];
  const verifyTrial = await prisma.trialEvent.findFirst({
    where: { moldTrialProject: { projectCode: { startsWith: PREFIX } }, status: "COMPLETED" },
    select: { id: true }
  });
  for (let i = 0; i < 12; i += 1) {
    await assemblyIssue({
      project: P((i % 8) + 1),
      reporterId: bill.id,
      zhongId: zhong.id,
      createdAgo: asmAgo[i],
      ackOnTime: ackOnTime[i],
      severity: severities[i],
      verified: i < 4,
      verifyTrialId: verifyTrial?.id ?? null
    });
  }

  // ---- ASSEMBLY-B (pei): a small OWN-group set so assembly-b shows a real bar,
  //      separate from zhong's assembly-a. pei reports + acknowledges + self-checks
  //      3 fitting issues, all on-time (self-contained — pei is both reporter and
  //      owner, so this never touches bill's/mei's counts): acknowledge 3/3 +
  //      self_check 3/3 + photo 3/3 = 9/9 = 100% (hits the bar). zhong's 22/24
  //      (assembly-a) is left intact.
  const peiAgo = [5, 4, 3];
  for (let i = 0; i < peiAgo.length; i += 1) {
    await assemblyIssue({
      project: P((i % 8) + 1),
      reporterId: pei.id,
      zhongId: pei.id,
      createdAgo: peiAgo[i],
      ackOnTime: true,
      severity: "MEDIUM",
      verified: false,
      verifyTrialId: null
    });
  }

  // ---- Shared line (yvonne): 2 client-feedback inbox issues, reported + claimed
  //      on-time with photos => photo_on_defect 2/2 + inbox_claim 2/2 = 4/4 (100%).
  const inboxAgo = [4, 3];
  for (let i = 0; i < 2; i += 1) {
    await inboxIssue({
      project: P(i + 1),
      creatorId: yvonne.id,
      claimerId: yvonne.id,
      groupId: injectionGroup?.id ?? null,
      createdAgo: inboxAgo[i],
      claimOnTime: true,
      hasPhoto: true
    });
  }

  // ---- DESIGN (lin): design.change_revision 3/4 (one late), plus design-inbox
  //      claims (2, with photos) which each emit all.inbox_claim + design.inbox_claim
  //      + photo_on_defect on-time => 9/10 = 90% (hits the bar).
  const linRevisionOnTime = [true, true, true, false];
  const linRevisionAgo = [6, 5, 4, 6];
  for (let i = 0; i < 4; i += 1) {
    await designChangeWithDrawing({
      project: P((i % 8) + 1),
      creatorId: bill.id, // a PM/marketing reports the change; credit lands on the drawing uploader (lin)
      drawerId: lin.id,
      createdAgo: linRevisionAgo[i],
      onTime: linRevisionOnTime[i],
      index: i + 1
    });
  }
  const linInboxAgo = [4, 3];
  for (let i = 0; i < 2; i += 1) {
    await designInboxClaimed({ project: P(i + 5), linId: lin.id, groupId: designGroup.id, createdAgo: linInboxAgo[i] });
  }

  // ==========================================================================
  // LIVE task channels at run end — one per role, all scoring-neutral.
  // ==========================================================================

  // wang (Injection): 2 PENDING_CONFIRMATION trials (unconfirmed -> no confirmer/
  // proposer -> the scorer attributes nothing). createdAt drives the inj.date_confirm
  // (24h) chip: ~4h left and OVERDUE. Future plannedDate => never auto-missed.
  await prisma.trialEvent.create({
    data: {
      moldTrialProjectId: P(1).id,
      trialCode: "T0",
      sequenceNumber: 20,
      plannedDate: futureDayOnly(5),
      status: "PLANNED",
      dateConfirmationStatus: "PENDING_CONFIRMATION",
      createdById: admin.id,
      createdAt: hoursAgo(20) // due in ~4h (24h rule) -> amber "4h left"
    }
  });
  await prisma.trialEvent.create({
    data: {
      moldTrialProjectId: P(2).id,
      trialCode: "T0",
      sequenceNumber: 20,
      plannedDate: futureDayOnly(6),
      status: "PLANNED",
      dateConfirmationStatus: "PENDING_CONFIRMATION",
      createdById: admin.id,
      createdAt: hoursAgo(30) // ~6h overdue -> red chip
    }
  });

  // yvonne (Marketing): an Injection counter-proposal awaiting a decision. The
  // proposal ActivityLog drives mkt.date_decision (24h, ~14h left). Undecided =>
  // mkt attributes nothing; the proposer's inj.date_confirm is pending (future due).
  {
    const proposalTrialCreatedAt = hoursAgo(14); // inj.date_confirm due ~10h in the FUTURE => pending/excluded
    const proposalTrial = await prisma.trialEvent.create({
      data: {
        moldTrialProjectId: P(3).id,
        trialCode: "T1",
        sequenceNumber: 21,
        plannedDate: futureDayOnly(5),
        status: "PLANNED",
        dateConfirmationStatus: "RESCHEDULE_PROPOSED",
        proposedById: wang.id,
        proposedDate: futureDayOnly(14),
        proposedReason: "Machine availability — proposing a later slot",
        createdById: admin.id,
        createdAt: proposalTrialCreatedAt
      }
    });
    await log(
      wang.id,
      "TrialEvent",
      proposalTrial.id,
      "proposed_trial_date_change",
      ordered(proposalTrialCreatedAt, hoursAgo(10), "live proposal log"),
      { proposedDate: futureIso(14) }
    );
    // Customer target earlier than the proposal -> red "after target" gap in the card.
    await prisma.moldTrialProject.update({ where: { id: P(3).id }, data: { customerTargetDate: futureDayOnly(9) } });
  }

  // bill (PM): a trial Marketing returned to the PM. rescheduleDecisionAt drives
  // pm.returned_redate (24h, ~14h left). Not re-dated yet => pending (future due).
  {
    const returnCreatedAt = hoursAgo(72);
    await prisma.trialEvent.create({
      data: {
        moldTrialProjectId: P(4).id,
        trialCode: "T1",
        sequenceNumber: 22,
        plannedDate: futureDayOnly(6),
        status: "PLANNED",
        dateConfirmationStatus: "RETURNED_TO_PM",
        rescheduleDecisionById: bill.id,
        rescheduleDecisionAt: ordered(returnCreatedAt, hoursAgo(10), "live returned decision"),
        rescheduleRejectReason: "Customer target at risk — please re-date with Injection",
        createdById: admin.id,
        createdAt: returnCreatedAt
      }
    });
  }

  // zhong (Assembly): 1 unclaimed assembly-inbox issue + 1 acknowledge-pending
  // issue. Both anchored in the PREVIOUS month => no scored event (no photo, no
  // inbox-claim, no acknowledge); they surface as aged, overdue-chip items.
  await prisma.trialIssue.create({
    data: {
      moldTrialProjectId: P(5).id,
      title: "Short shot at gate — needs an owner",
      issueType: "ASSEMBLY_FITTING_ISSUE",
      source: "QC_INSPECTION",
      severity: "MEDIUM",
      status: "IN_PROGRESS",
      ownerUserId: null,
      ownerGroupId: assemblyGroup?.id ?? null,
      createdById: bill.id,
      reportedById: bill.id,
      createdAt: lastMonthAt(9)
    }
  });
  await prisma.trialIssue.create({
    data: {
      moldTrialProjectId: P(6).id,
      title: "Fit correction — awaiting acknowledgement",
      issueType: "ASSEMBLY_FITTING_ISSUE",
      source: "TECHNICAL_REVIEW",
      severity: "HIGH",
      status: "IN_PROGRESS",
      ownerUserId: zhong.id,
      ownerGroupId: null,
      createdById: bill.id,
      reportedById: bill.id,
      createdAt: lastMonthAt(10)
    }
  });

  // gong (QC): a completed trial whose report is still missing. The record log is
  // ~38h old so qc.report_upload (48h) shows ~10h left. actualDate is the record
  // day so pm.result_recorded (to gong) is on-time. No confirmer => no other lines.
  {
    const recordedAt = hoursAgo(38);
    const actualDate = startOfDayUtc(recordedAt);
    const missingReportTrial = await prisma.trialEvent.create({
      data: {
        moldTrialProjectId: P(7).id,
        trialCode: "T2",
        sequenceNumber: 23,
        plannedDate: actualDate,
        actualDate,
        status: "COMPLETED",
        injectionMachineId: machine.id,
        result: "APPROVED",
        countsAgainstLimit: true,
        dateConfirmationStatus: "CONFIRMED",
        createdById: admin.id,
        createdAt: hoursAgo(60)
      }
    });
    await log(gong.id, "TrialEvent", missingReportTrial.id, "recorded_completed_trial", recordedAt, { result: "APPROVED" });
    // Intentionally NO QC_REPORT attachment -> the trial shows in "QC: reports to upload".
  }

  // lin (Design): 2 DesignChangeEvents awaiting a drawing (live design.change_revision
  // chips) + 2 unclaimed design-group issues (reported by mei with a real photo, so
  // the /me "Design inbox" claim chips are live; mei owns their photo_on_defect).
  {
    const awaitingAgoHours = [20, 36]; // 48h rule -> ~28h and ~12h left
    for (let i = 0; i < awaitingAgoHours.length; i += 1) {
      await prisma.designChangeEvent.create({
        data: {
          moldTrialProjectId: P(i + 1).id,
          changeDate: startOfDayUtc(hoursAgo(awaitingAgoHours[i])),
          requestedBy: i === 0 ? "CUSTOMER" : "INTERNAL",
          title: `Rib relocation revision ${i + 1}`,
          description: "Awaiting an updated drawing from the design team.",
          firstCompletedTrialAlreadyDone: false,
          createdById: bill.id,
          createdAt: hoursAgo(awaitingAgoHours[i])
        }
      });
    }
    const unclaimedDesign = [
      { project: P(2), hoursAgoCreated: 24, issueType: "DFM_PART_DESIGN_ISSUE", title: "DFM: draft angle too shallow" },
      { project: P(3), hoursAgoCreated: 40, issueType: "MOLD_DESIGN_ISSUE", title: "Mold design: cooling line clash" }
    ];
    for (const item of unclaimedDesign) {
      const createdAt = hoursAgo(item.hoursAgoCreated);
      const issue = await prisma.trialIssue.create({
        data: {
          moldTrialProjectId: item.project.id,
          title: item.title,
          issueType: item.issueType,
          source: "TECHNICAL_REVIEW",
          severity: "MEDIUM",
          status: "IN_PROGRESS",
          ownerUserId: null,
          ownerGroupId: designGroup.id,
          createdById: mei.id,
          reportedById: mei.id,
          createdAt
        }
      });
      // A real defect photo -> mei's photo_on_defect passes; unclaimed => no claim event.
      await createSimAttachment({
        project: item.project,
        entityType: "TRIAL_ISSUE",
        entityId: issue.id,
        fileType: "TRIAL_PHOTO",
        uploadedById: mei.id,
        uploadedAt: ordered(createdAt, hoursAgo(item.hoursAgoCreated - 1), "design inbox photo"),
        fileName: "sim-design-inbox.jpg"
      });
    }
  }

  // ==========================================================================
  // Calendar / machine-load: an AMBER future day (3 on one machine), a RED future
  // day (4 on one machine), and other confirmed trials spread across machines and
  // days so the month grid looks alive. createdAt is last month => no scored event.
  // ==========================================================================
  let loadSeq = 30;
  async function machineLoadTrial(project, machineId, plannedInDays) {
    const trial = await prisma.trialEvent.create({
      data: {
        moldTrialProjectId: project.id,
        trialCode: "EXTRA",
        sequenceNumber: loadSeq,
        plannedDate: futureDayOnly(plannedInDays),
        status: "PLANNED",
        injectionMachineId: machineId,
        dateConfirmationStatus: "CONFIRMED",
        dateConfirmedById: wang.id,
        dateConfirmedAt: lastMonthAt(12),
        createdById: admin.id,
        createdAt: lastMonthAt(8)
      }
    });
    loadSeq += 1;
    return trial;
  }
  // Amber: 3 trials, same machine, same day (+8).
  for (let i = 0; i < 3; i += 1) {
    await machineLoadTrial(P((i % 8) + 1), machines[0].id, 8);
  }
  // Red: 4 trials, same machine, same day (+12).
  for (let i = 0; i < 4; i += 1) {
    await machineLoadTrial(P((i % 8) + 1), machines[1].id, 12);
  }
  // Spread: 1–2 trials per machine on assorted days, none stacking to 3 on a machine.
  const spread = [
    [machines[2].id, 9],
    [machines[0].id, 10],
    [machines[1].id, 10],
    [machines[2].id, 13],
    [machines[0].id, 15],
    [machines[1].id, 16]
  ];
  for (let i = 0; i < spread.length; i += 1) {
    await machineLoadTrial(P((i % 8) + 1), spread[i][0], spread[i][1]);
  }

  // ---- Expected-percentage summary (monthly personas; percentages are whole-
  // number rounds of on/applicable, matching the engine). Live channels above are
  // engineered scoring-neutral, so these ratios are unchanged except gong (+1
  // on-time result from the missing-report trial) and the new lin row.
  const zhongPoints = severities.slice(0, 4).reduce((sum, s) => sum + severityWeight(s), 0);
  const rows = [
    ["zhong", "Assembly-A", "22/24", "92%", "hits bar", `${zhongPoints} (4 verified fixes)`],
    ["pei", "Assembly-B", "9/9", "100%", "hits bar", "0"],
    ["wang", "Injection", "9/12", "75%", "MISS (late confirms)", "0"],
    ["bill", "PM", "34/37", "92%", "hits bar", "0"],
    ["gong", "QC referee", "25/25", "100%", "hits bar", "0"],
    ["yvonne", "Marketing", "4/4", "100%", "hits (floor <5)", "0"],
    ["lin", "Design", "9/10", "90%", "hits bar", "0"]
  ];
  console.log("");
  console.log("Expected current-month personas (compare against Admin -> Scores):");
  console.log("user    role         on/appl  pct    verdict               points");
  console.log("---------------------------------------------------------------------");
  for (const [u, role, ratio, pct, verdict, points] of rows) {
    console.log(`${u.padEnd(7)} ${role.padEnd(12)} ${ratio.padEnd(8)} ${pct.padEnd(6)} ${verdict.padEnd(21)} ${points}`);
  }
  console.log("");

  // Leader bars: the GROUP aggregates the Scores tab's "Leaders 组长达标" section
  // shows (7 award rows + 2 referee rows). A leader's bar covers their whole
  // group, so Design combines lin+mei and the referees combine their crews; the
  // single-member groups equal that member's card. zhong (assembly-a) and pei
  // (assembly-b) are SEPARATE bars. jun/cheng have no simulated events, so their
  // individual bars float on the <5 floor.
  const leaderRows = [
    ["lin", "Design", "2", "11/12", "92%", "hits bar", "¥400"],
    ["bill", "PM (individual)", "1", "34/37", "92%", "hits bar", "¥400"],
    ["cheng", "PM (individual)", "1", "0/0", "-", "hits (floor <5)", "¥400"],
    ["jun", "PM (individual)", "1", "0/0", "-", "hits (floor <5)", "¥400"],
    ["zhong", "Assembly (Zhong)", "1", "22/24", "92%", "hits bar", "¥400"],
    ["pei", "Assembly (Pei)", "1", "9/9", "100%", "hits bar", "¥400"],
    ["wang", "Injection", "1", "9/12", "75%", "MISS", "-"],
    ["gong", "QC (referee)", "2", "25/25", "100%", "hits bar", "¥250"],
    ["yvonne", "Marketing (referee)", "6", "4/4", "100%", "hits (floor <5)", "¥250"]
  ];
  console.log("Leader bars (Admin -> Scores -> Leaders 组长达标):");
  console.log("leader  group                members on/appl  pct    verdict          prize");
  console.log("--------------------------------------------------------------------------------");
  for (const [u, group, members, ratio, pct, verdict, prize] of leaderRows) {
    console.log(`${u.padEnd(7)} ${group.padEnd(20)} ${members.padEnd(7)} ${ratio.padEnd(8)} ${pct.padEnd(6)} ${verdict.padEnd(16)} ${prize}`);
  }
  console.log("");
  console.log("Assembly is split: zhong=assembly-a (钟组), pei=assembly-b (裴组) — separate bars.");
  console.log("PMs (bill/jun/cheng) are award-tier individuals: the pm group has no leader.");
  console.log("");
  console.log("Admin has ZERO KPI events (excluded from scoring; no issues created by admin).");
  console.log("bill 34/37 = missed 5/5 + redate 3/4 + result 7/8 + qc 7/8 + photo 12/12 (assembly issues he files, all with photos).");
  console.log("gong 25/25 = result 4 + qc 4 (injection trials) + date-confirm 8 + process-values 8 (PM trials) + 1 result (the missing-report trial).");
  console.log("yvonne 4/4 = inbox-claim 2 + photo 2 (client-feedback issues she reports + claims).");
  console.log("lin 9/10 = revision 3/4 (one late, all with drawings) + inbox-claim 2/2 + design-inbox-claim 2/2 + photo 2/2.");
  console.log("mei (Design) also appears: 2/2 photo (floor <5) from the unclaimed design issues she reports for lin's inbox.");
  console.log("");
  console.log("Live task channels at run end (log in as each user, open /me):");
  console.log("  wang   (Injection) Confirm trial dates ×2 — one ~4h left (amber), one OVERDUE (red).");
  console.log("  yvonne (Marketing) Approve date changes ×1 — live countdown (~14h left), proposed after target (red gap).");
  console.log("  bill   (PM)        Returned dates ×1 — live countdown (~14h left).");
  console.log("  zhong  (Assembly)  Department inbox ×1 (unclaimed) + Assembly acknowledge ×1 (also shows the unclaimed one).");
  console.log("  gong   (QC)        QC: reports to upload ×1 — completed trial, ~10h left.");
  console.log("  lin    (Design)    Design: revisions ×2 (awaiting drawing, live chips) + Design inbox ×2 (unclaimed design issues).");
  console.log("  Calendar: AMBER day (3 on one machine, +8d) + RED day (4 on one machine, +12d); other trials spread across machines/days.");
  console.log("");
  console.log("Run `node scripts/run-kpi-snapshot.mjs` to persist snapshots, then open Admin -> Scores.");
}

try {
  await main();
} finally {
  await prisma.$disconnect();
}
