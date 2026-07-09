#!/usr/bin/env node
/**
 * KPI simulation data generator. Writes ~6 weeks of realistic MoldPilot
 * activity under the projectCode prefix "MP-SIM-" so the whole KPI engine can
 * be exercised end-to-end on the owner's Mac:
 *
 *   node scripts/simulate-kpi-data.mjs            # generate (idempotent-ish)
 *   node scripts/simulate-kpi-data.mjs --reset    # delete all MP-SIM- data first
 *
 * Timestamps are deliberately mixed on-time/late so the poster personas emerge
 * in the current month:
 *   zhong  (assembly lead) ~92%  — hits the bar
 *   wang   (injection lead) ~75% — misses via late date confirmations
 *   bill   (PM)            ~88%  — hits the bar
 *   gong   (QC referee)   ~100%  — records + uploads everything on time
 *
 * For every timestamp the extractor reads, a matching ActivityLog row is
 * written (recorded_completed_trial, redated_returned_trial,
 * claimed_department_inbox_issue, proposed_trial_date_change) so the live
 * Scores tab and the nightly snapshot agree with the summary printed below.
 */
import "dotenv/config";

import { severityWeight } from "../src/domain/mold-trial/kpi-rules.ts";

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

// Newest moment any event may use: yesterday 20:00 (a comfortable margin before
// `now`, so nothing a few hours old reads as "future" or unfinished).
const latestDay = Math.max(1, runDay - 1);

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

async function resetSimData() {
  const projects = await prisma.moldTrialProject.findMany({
    where: { projectCode: { startsWith: PREFIX } },
    select: { id: true }
  });
  const ids = projects.map((p) => p.id);
  if (ids.length > 0) {
    // FileAttachment / TrialProcessValue / TrialIssue / TrialEvent cascade with
    // the project delete; ActivityLog does not, so clear sim logs by entity.
    const trials = await prisma.trialEvent.findMany({ where: { moldTrialProjectId: { in: ids } }, select: { id: true } });
    const issues = await prisma.trialIssue.findMany({ where: { moldTrialProjectId: { in: ids } }, select: { id: true } });
    const entityIds = [...ids, ...trials.map((t) => t.id), ...issues.map((i) => i.id)];
    await prisma.activityLog.deleteMany({ where: { entityId: { in: entityIds } } });
    await prisma.moldTrialProject.deleteMany({ where: { id: { in: ids } } });
  }
  console.log(`[reset] Removed ${ids.length} MP-SIM- project(s) and their records.`);
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

async function ensureMachine() {
  const existing = await prisma.injectionMachine.findFirst({ where: { active: true }, orderBy: { machineNo: "asc" } });
  if (existing != null) return existing;
  return prisma.injectionMachine.create({ data: { machineNo: "999", brand: "SIM", tonnage: 250, active: true } });
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
 * each no earlier than the previous and none later than `latestDay`.
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
  // The trial is created and completed on the same in-month past day (`anchorAgo`
  // days before the run day). Keeping createdAt and actualDate on one anchor day
  // lets the full on-time/late chain fit even when the sim runs early in the
  // month, while every downstream stamp still moves strictly forward in time.
  const createdAt = at(anchorAgo, 8);
  const actualDate = dayOnly(anchorAgo);
  // Confirmed after created: on-time = same day +4h (<24h); late = 2 days later.
  const dateConfirmedAt = confirmOnTime ? at(anchorAgo, 12) : at(anchorAgo - 2, 12);
  // Result recorded vs end-of-actual-day: on-time = that day 10:00 (<= EOD);
  // late = the next day (> EOD).
  const recordAgo = recordOnTime ? anchorAgo : anchorAgo - 1;
  const recordedAt = at(recordAgo, 10);
  // QC upload measured from the record log (+48h window): on-time = next day
  // (~28h); late = 2 days after the record (~52h > 48h).
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
      // Date confirmation: PENDING started at createdAt; confirmed on/after.
      dateConfirmationStatus: "CONFIRMED",
      dateConfirmedById: confirmerId,
      dateConfirmedAt: ordered(createdAt, dateConfirmedAt, "date confirm"),
      createdById: adminId,
      createdAt
    }
  });

  // inj.process_values boolean signal.
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

  // pm.result_recorded / qc.report_upload clock: the record-result log.
  await log(recorderId, "TrialEvent", trial.id, "recorded_completed_trial", recordedAt, { result: "APPROVED" });

  // qc.report_upload doneAt: a QC_REPORT attachment (storageKey placeholder).
  await prisma.fileAttachment.create({
    data: {
      moldTrialProjectId: project.id,
      entityType: "TRIAL_EVENT",
      entityId: trial.id,
      fileName: "sim-qc-report.pdf",
      fileType: "QC_REPORT",
      storageKey: `sim/qc/${trial.id}.pdf`,
      contentType: "application/pdf",
      sizeBytes: 1024,
      visibility: "INTERNAL",
      uploadedById: recorderId,
      uploadedAt: ordered(recordedAt, qcUploadAt, "qc upload")
    }
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
      // Planned date sits on the creation day (a PLANNED trial has no actualDate).
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
  // Resolved after the miss: on-time = same day 20:00 (<24h); late = 2 days on.
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
      // Trial was created before it auto-missed (2 days earlier here).
      createdAt: at(missedAgo + 2, 8)
    }
  });
}

/** Create a RETURNED_TO_PM trial + the re-date log for pm.returned_redate. */
async function returnedTrial({ project, seq, adminId, pmId, decisionAgo, redateOnTime }) {
  const rescheduleDecisionAt = at(decisionAgo, 9); // anchor (rejection clock start)
  // Re-date after the rejection: on-time = same day 20:00 (<24h); late = 2 days.
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
      // Created a few days before the reschedule decision.
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
 * decides asm.acknowledge; self-check always passes here. A defect photo is
 * attached so the reporter's all.photo_on_defect passes.
 */
async function assemblyIssue({ project, reporterId, zhongId, createdAgo, ackOnTime, severity, verified, verifyTrialId }) {
  // ownerGroupId is intentionally NULL: this is a direct-owned correction, not a
  // department-inbox item, so it does not emit an all.inbox_claim event. The
  // creator/reporter is a scored-role user (PM), NOT admin, so admin accrues no
  // photo-on-defect event; the fix credit still goes to zhong via ownerUserId.
  const createdAt = at(createdAgo, 8); // anchor (assembly clock start)
  // Acknowledged after created: on-time = same day 20:00 (<24h); late = 2 days.
  const acknowledgedAt = ackOnTime ? at(createdAgo, 20) : at(createdAgo - 2, 20);
  // Self-check + close land shortly after, all in the past.
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
  // Defect photo -> all.photo_on_defect passes for the reporter (PM).
  await prisma.fileAttachment.create({
    data: {
      moldTrialProjectId: project.id,
      entityType: "TRIAL_ISSUE",
      entityId: issue.id,
      fileName: "sim-assembly-defect.jpg",
      fileType: "TRIAL_PHOTO",
      storageKey: `sim/photo/${issue.id}.jpg`,
      contentType: "image/jpeg",
      sizeBytes: 2048,
      visibility: "INTERNAL",
      uploadedById: reporterId,
      uploadedAt: at(createdAgo, 9)
    }
  });
  return issue;
}

/**
 * Create a department-inbox issue claimed by `claimerId` (all.inbox_claim). The
 * `creatorId` (a scored-role user, never admin) owns the all.photo_on_defect
 * boolean for this issue.
 */
async function inboxIssue({ project, creatorId, claimerId, groupId, createdAgo, claimOnTime, hasPhoto }) {
  const createdAt = at(createdAgo, 8); // anchor (inbox clock start)
  // Claimed after created: on-time = same day 20:00 (<48h); late = 3 days later.
  const claimedAt = claimOnTime ? at(createdAgo, 20) : at(createdAgo - 3, 20);
  const issue = await prisma.trialIssue.create({
    data: {
      moldTrialProjectId: project.id,
      title: `Inbox item ${createdAgo}`,
      issueType: "APPEARANCE_ISSUE",
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
    await prisma.fileAttachment.create({
      data: {
        moldTrialProjectId: project.id,
        entityType: "TRIAL_ISSUE",
        entityId: issue.id,
        fileName: "sim-defect.jpg",
        fileType: "TRIAL_PHOTO",
        storageKey: `sim/photo/${issue.id}.jpg`,
        contentType: "image/jpeg",
        sizeBytes: 2048,
        visibility: "INTERNAL",
        uploadedById: creatorId,
        uploadedAt: at(createdAgo, 9) // shortly after the issue was created
      }
    });
  }
  return issue;
}

async function main() {
  if (RESET) {
    await resetSimData();
  }

  const [admin, bill, wang, zhong, gong, yvonne] = await Promise.all([
    requireUser("admin"),
    requireUser("bill"),
    requireUser("wang"),
    requireUser("zhong"),
    requireUser("gong"),
    requireUser("yvonne")
  ]);
  // Injection group owns the shared-inbox demo issues (claimed by yvonne).
  const injectionGroup = await prisma.departmentGroup.findUnique({ where: { code: "injection" } });
  const customer = await ensureSimCustomer(admin.id);
  const machine = await ensureMachine();
  // A process-sheet parameter to satisfy TrialProcessValue FK (any active one).
  const param = await prisma.processSheetParameter.findFirst({ where: { active: true } });

  // 8 simulated projects.
  const projects = [];
  for (let index = 1; index <= 8; index += 1) {
    projects.push(await createProject(index, { customer, pmId: bill.id, adminId: admin.id }));
  }
  const P = (n) => projects[n - 1];

  // All events use DAYS-BEFORE-RUN anchors (bigger = older). Anchors are spread
  // across the in-month past days so nothing clamps to day 1 on an early run and
  // the six-week window does not collapse onto a single day.

  // ---- INJECTION (wang): inj.date_confirm 5/8, inj.process_values 4/4 = 9/12 (75%)
  // 4 COMPLETED trials (confirmer=wang, WITH process values -> 4/4 pass; results
  // recorded by gong so result/qc land on the QC referee, not wang) + 4
  // confirm-only PLANNED trials (date-confirm without a completion, so no
  // process-value events). Across the 8 date-confirms, 5 are on-time.
  const injConfirmOnTime = [true, true, true, false, true, true, false, false];
  const injCompletedAgo = [6, 6, 5, 5]; // anchors for the 4 completed injection trials
  for (let i = 0; i < 4; i += 1) {
    await completedTrial({
      project: P((i % 8) + 1),
      seq: 1,
      machine,
      adminId: admin.id,
      confirmerId: wang.id,
      recorderId: gong.id, // QC records -> pm.result_recorded + qc.report_upload attribute to gong
      anchorAgo: injCompletedAgo[i],
      confirmOnTime: injConfirmOnTime[i],
      recordOnTime: true, // gong records on-time
      withProcessValues: true, // all 4 completed trials get values -> 4/4 pass
      qcOnTime: true, // gong uploads QC on-time
      processSheetParameterId: param?.id ?? null,
      enteredById: wang.id
    });
  }
  const injConfirmOnlyAgo = [6, 5, 4, 3]; // anchors for the 4 confirm-only trials
  for (let i = 4; i < 8; i += 1) {
    await confirmOnlyTrial({
      project: P((i % 8) + 1),
      seq: 1,
      machine,
      adminId: admin.id,
      confirmerId: wang.id,
      anchorAgo: injConfirmOnlyAgo[i - 4],
      confirmOnTime: injConfirmOnTime[i]
    });
  }

  // ---- PM (bill): missed_reason 5/5, returned_redate 3/4, result_recorded 7/8,
  //      qc.report_upload 7/8, photo_on_defect 12/12 (assembly issues bill files
  //      as PM, all with a defect photo) => 34/37 = 92% (still hits the bar).
  // bill's own completed trials (bill records): result 7/8 on-time, qc 7/8.
  const billResultOnTime = [true, true, true, true, true, true, true, false];
  const billQcOnTime = [true, true, true, true, true, true, true, false];
  const pmCompletedAgo = [6, 6, 6, 5, 5, 5, 4, 4]; // anchors for the 8 PM trials
  for (let i = 0; i < 8; i += 1) {
    const project = P((i % 8) + 1);
    await completedTrial({
      project,
      seq: 2,
      machine,
      adminId: admin.id,
      confirmerId: gong.id, // confirmation owned by gong here (kept off wang/bill lines: gong stays 100%)
      recorderId: bill.id,
      anchorAgo: pmCompletedAgo[i],
      confirmOnTime: true, // gong confirms on-time
      recordOnTime: billResultOnTime[i], // late record for the last
      // gong confirmed these completed trials -> gong's inj.process_values must
      // pass, so give each one a process value. (result/qc still land on bill.)
      withProcessValues: true,
      qcOnTime: billQcOnTime[i], // late upload for the last
      processSheetParameterId: param?.id ?? null,
      enteredById: gong.id
    });
  }
  // bill missed_reason 5/5 (spread anchors across the past window)
  const missedAgo = [6, 5, 4, 3, 2];
  for (let i = 0; i < 5; i += 1) {
    await missedTrial({ project: P((i % 8) + 1), seq: 3, adminId: admin.id, pmId: bill.id, missedAgo: missedAgo[i], resolveOnTime: true });
  }
  // bill returned_redate 3/4 (one late)
  const redateOnTime = [true, true, true, false];
  const redateAgo = [5, 4, 3, 3];
  for (let i = 0; i < 4; i += 1) {
    await returnedTrial({ project: P((i % 8) + 1), seq: 4, adminId: admin.id, pmId: bill.id, decisionAgo: redateAgo[i], redateOnTime: redateOnTime[i] });
  }

  // ---- ASSEMBLY (zhong): acknowledge 10/12, self_check 12/12 => 22/24 = 92%.
  //      Issues are filed by bill (PM) with a defect photo, so admin gets no
  //      events and the photo_on_defect credit lands on bill (12/12).
  const ackOnTime = [true, true, true, true, true, true, true, true, true, true, false, false];
  const severities = ["HIGH", "MEDIUM", "MEDIUM", "LOW", "HIGH", "MEDIUM", "LOW", "HIGH", "MEDIUM", "LOW", "MEDIUM", "LOW"];
  const asmAgo = [6, 6, 6, 5, 5, 5, 4, 4, 4, 3, 3, 3]; // anchors for the 12 issues
  // Verify a few fixes at a later trial (points). Use a completed sim trial as
  // the verification trial reference.
  const verifyTrial = await prisma.trialEvent.findFirst({
    where: { moldTrialProject: { projectCode: { startsWith: PREFIX } }, status: "COMPLETED" },
    select: { id: true }
  });
  for (let i = 0; i < 12; i += 1) {
    await assemblyIssue({
      project: P((i % 8) + 1),
      reporterId: bill.id, // PM files the trial issue (with a photo) -> not admin
      zhongId: zhong.id,
      createdAgo: asmAgo[i],
      ackOnTime: ackOnTime[i],
      severity: severities[i],
      verified: i < 4, // first 4 verified -> counted points for zhong
      verifyTrialId: verifyTrial?.id ?? null
    });
  }

  // ---- Shared line examples (kept small so they don't distort personas):
  //   yvonne (marketing) reports + claims 2 client-feedback inbox issues on-time
  //   with photos. Creator is marketing (not admin), so photo_on_defect lands on
  //   yvonne (2/2) and the inbox claim also on yvonne (2/2).
  const inboxAgo = [4, 3];
  for (let i = 0; i < 2; i += 1) {
    await inboxIssue({
      project: P(i + 1),
      creatorId: yvonne.id, // marketing reports client feedback -> not admin
      claimerId: yvonne.id,
      groupId: injectionGroup?.id ?? null,
      createdAgo: inboxAgo[i],
      claimOnTime: true,
      hasPhoto: true
    });
  }

  // ---- Expected-percentage summary (recomputed after the admin-exclusion +
  // move-creators-to-scored-roles changes). Percentages are whole-number rounds
  // of on/applicable, matching the engine.
  const zhongPoints = severities.slice(0, 4).reduce((sum, s) => sum + severityWeight(s), 0);
  const rows = [
    ["zhong", "Assembly", "22/24", "92%", "hits bar", `${zhongPoints} (4 verified fixes)`],
    ["wang", "Injection", "9/12", "75%", "MISS (late confirms)", "0"],
    ["bill", "PM", "34/37", "92%", "hits bar", "0"],
    ["gong", "QC referee", "24/24", "100%", "hits bar", "0"],
    ["yvonne", "Marketing", "4/4", "100%", "hits (floor <5)", "0"]
  ];
  console.log("");
  console.log("Expected current-month personas (compare against Admin -> Scores):");
  console.log("user    role         on/appl  pct    verdict               points");
  console.log("---------------------------------------------------------------------");
  for (const [u, role, ratio, pct, verdict, points] of rows) {
    console.log(`${u.padEnd(7)} ${role.padEnd(12)} ${ratio.padEnd(8)} ${pct.padEnd(6)} ${verdict.padEnd(21)} ${points}`);
  }
  console.log("");
  console.log("Admin has ZERO KPI events (excluded from scoring; no issues created by admin).");
  console.log("bill 34/37 = missed 5/5 + redate 3/4 + result 7/8 + qc 7/8 + photo 12/12 (assembly issues he files, all with photos).");
  console.log("gong 24/24 = result 4 + qc 4 (injection trials) + date-confirm 8 + process-values 8 (PM trials).");
  console.log("yvonne 4/4 = inbox-claim 2 + photo 2 (client-feedback issues she reports + claims).");
  console.log("Run `node scripts/run-kpi-snapshot.mjs` to persist snapshots, then open Admin -> Scores.");
}

try {
  await main();
} finally {
  await prisma.$disconnect();
}
