#!/usr/bin/env node
/**
 * Nightly KPI snapshot runner. Computes previous + current month scorecards for
 * every active user and writes one KpiSnapshot row per scope (USER +
 * DEPARTMENT_GROUP + COMPANY) dated today. Idempotent per day: existing rows
 * for (today, scope) are replaced.
 *
 * Self-contained (own Prisma client + the shared pure engine) so it runs as a
 * standalone node script on the owner's Mac:
 *   node scripts/run-kpi-snapshot.mjs                 # write rows + JSON archive
 *   node scripts/run-kpi-snapshot.mjs --out FILE.json # choose the archive path
 *   node scripts/run-kpi-snapshot.mjs --verify FILE   # recheck a JSON archive
 *
 * The extraction mirrors src/server/kpi-events.ts. The scoring is the SAME pure
 * engine the app uses (src/domain/mold-trial/kpi-scoring.ts), so nightly totals
 * match the live Scores tab. Rules are read live, so a mid-month rule change is
 * reflected on the next run.
 *
 * TAMPER EVIDENCE: every run also writes a JSON archive whose `data` section is
 * hashed with SHA-256 (see src/domain/security/snapshot-integrity.ts) and prints
 * the first 12 hex characters as a human "integrity code". The prize meeting
 * prints the snapshot, reads the code aloud, and the CEO plus both referees sign
 * the page. `--verify` recomputes the hash later. The chain is: signed paper <->
 * integrity code <-> archived JSON (nightly backup, off-machine). This EVIDENCES
 * tampering; it does not prevent anyone with database access from editing rows.
 * File the archive with the signed page — scripts/backup.sh only picks this file
 * up if MOLDPILOT_KPI_SNAPSHOT_DIR sits inside the backed-up uploads tree, though
 * the KpiSnapshot rows behind the code always travel in the nightly dump.
 */
import "dotenv/config";

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { computeDepartmentRollup, computeScorecard } from "../src/domain/mold-trial/kpi-scoring.ts";
import { defaultKpiRules, isKpiRuleCode } from "../src/domain/mold-trial/kpi-rules.ts";
import {
  buildSnapshotFile,
  verifySnapshotFile
} from "../src/domain/security/snapshot-integrity.ts";

const PROJECT_ROOT = fileURLToPath(new URL("..", import.meta.url));

function sha256Hex(input) {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

function parseArgs(argv) {
  const options = { out: null, verify: null };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === "--verify" || flag === "--out") {
      const value = argv[index + 1];
      if (value == null || value.startsWith("--")) {
        console.error(`[fail] ${flag} requires a file path.`);
        process.exit(2);
      }
      options[flag === "--verify" ? "verify" : "out"] = value;
      index += 1;
      continue;
    }
    console.error(`[fail] Unknown argument: ${flag}`);
    process.exit(2);
  }
  return options;
}

const options = parseArgs(process.argv.slice(2));

// --- --verify: pure, no database, no Prisma client needed ---------------------
if (options.verify != null) {
  const file = path.resolve(process.cwd(), options.verify);
  let verification;
  try {
    verification = verifySnapshotFile(JSON.parse(readFileSync(file, "utf8")), sha256Hex);
  } catch (error) {
    console.error(`[FAIL] ${file}`);
    console.error(`       ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
  console.log(`File          : ${file}`);
  console.log(`Recorded hash : ${verification.expectedHash ?? "(none)"}`);
  console.log(`Recomputed    : ${verification.actualHash}`);
  console.log(`Integrity code / 校验码: ${verification.code}`);
  if (verification.ok) {
    console.log("[PASS] Snapshot matches its integrity code. 快照与校验码一致。");
    process.exit(0);
  }
  for (const problem of verification.problems) {
    console.error(`  - ${problem}`);
  }
  console.error("[FAIL] Snapshot does not match its integrity code. 快照与校验码不一致。");
  process.exit(1);
}

const { PrismaClient } = await import("@prisma/client");
const { PrismaPg } = await import("@prisma/adapter-pg");
const connectionString =
  process.env.DATABASE_URL ?? "postgresql://moldpilot:moldpilot@localhost:5432/moldpilot?schema=public";
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

function monthWindow(month) {
  const [y, m] = month.split("-").map((value) => Number.parseInt(value, 10));
  return { start: new Date(Date.UTC(y, m - 1, 1)), end: new Date(Date.UTC(y, m, 1)) };
}
function addHours(base, hours) {
  return new Date(base.getTime() + hours * 3600000);
}
function endOfDay(date) {
  const eod = new Date(date.getTime());
  eod.setUTCHours(23, 59, 59, 999);
  return eod;
}
function within(window, at) {
  return at != null && at.getTime() >= window.start.getTime() && at.getTime() < window.end.getTime();
}
function roleScopeForRole(code) {
  return ["pm", "injection", "assembly", "marketing", "qc"].includes(code) ? code : null;
}

async function loadRuleConfig() {
  const rows = await prisma.kpiRule.findMany();
  const source =
    rows.length > 0
      ? rows.map((r) => ({ code: r.code, hours: r.hours, active: r.active }))
      : defaultKpiRules.map((r) => ({ code: r.code, hours: r.hours, active: r.active }));
  const rules = [];
  const ruleHours = {};
  for (const r of source) {
    if (!isKpiRuleCode(r.code)) continue;
    rules.push({ code: r.code, hours: r.hours, active: r.active });
    ruleHours[r.code] = r.hours;
  }
  return { rules, ruleHours };
}
function hoursFor(ruleHours, code, fallback) {
  return typeof ruleHours[code] === "number" ? ruleHours[code] : fallback;
}

async function extract(window, ruleHours) {
  const habitEvents = [];
  const pointsEvents = [];
  const [trials, issues, activityLogs, proposalLogs, qcReports, photos] = await Promise.all([
    prisma.trialEvent.findMany({
      include: {
        moldTrialProject: { select: { projectCode: true, planningPmId: true, technicalPmId: true } },
        processValues: { select: { id: true }, take: 1 }
      }
    }),
    prisma.trialIssue.findMany({ include: { moldTrialProject: { select: { projectCode: true } } } }),
    prisma.activityLog.findMany({
      where: { action: { in: ["recorded_completed_trial", "redated_returned_trial", "claimed_department_inbox_issue"] } },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }]
    }),
    prisma.activityLog.findMany({ where: { action: "proposed_trial_date_change" }, orderBy: [{ createdAt: "asc" }] }),
    prisma.fileAttachment.findMany({
      where: { entityType: "TRIAL_EVENT", fileType: "QC_REPORT", deletedAt: null },
      orderBy: [{ uploadedAt: "asc" }],
      select: { entityId: true, uploadedAt: true }
    }),
    prisma.fileAttachment.findMany({
      where: { entityType: "TRIAL_ISSUE", fileType: "TRIAL_PHOTO", deletedAt: null },
      select: { entityId: true }
    })
  ]);

  const recordLogByTrial = new Map();
  const redateLogByTrial = new Map();
  const claimLogByIssue = new Map();
  for (const log of activityLogs) {
    if (log.action === "recorded_completed_trial" && !recordLogByTrial.has(log.entityId))
      recordLogByTrial.set(log.entityId, { createdAt: log.createdAt, actorUserId: log.actorUserId });
    else if (log.action === "redated_returned_trial" && !redateLogByTrial.has(log.entityId))
      redateLogByTrial.set(log.entityId, { createdAt: log.createdAt, actorUserId: log.actorUserId });
    else if (log.action === "claimed_department_inbox_issue" && !claimLogByIssue.has(log.entityId))
      claimLogByIssue.set(log.entityId, { createdAt: log.createdAt, actorUserId: log.actorUserId });
  }
  const proposalAtByTrial = new Map();
  for (const log of proposalLogs) if (!proposalAtByTrial.has(log.entityId)) proposalAtByTrial.set(log.entityId, log.createdAt);
  const qcByTrial = new Map();
  for (const r of qcReports) if (!qcByTrial.has(r.entityId)) qcByTrial.set(r.entityId, r.uploadedAt);
  const issueHasPhoto = new Set(photos.map((p) => p.entityId));

  for (const trial of trials) {
    const projectCode = trial.moldTrialProject.projectCode;
    const pmId = trial.moldTrialProject.planningPmId ?? trial.moldTrialProject.technicalPmId ?? null;
    const ref = `${projectCode} · ${trial.trialCode}`;
    if (within(window, trial.autoMissedAt)) {
      const resolverId = trial.autoMissedResolvedById ?? pmId;
      if (resolverId != null)
        habitEvents.push({ ruleCode: "pm.missed_reason", userId: resolverId, ref, dueAt: addHours(trial.autoMissedAt, hoursFor(ruleHours, "pm.missed_reason", 24)), doneAt: trial.autoMissedResolvedAt ?? null });
    }
    const recordLog = recordLogByTrial.get(trial.id);
    if (recordLog != null && trial.actualDate != null && within(window, recordLog.createdAt))
      habitEvents.push({ ruleCode: "pm.result_recorded", userId: recordLog.actorUserId, ref, dueAt: endOfDay(trial.actualDate), doneAt: recordLog.createdAt });
    if (trial.dateConfirmationStatus === "RETURNED_TO_PM" && within(window, trial.rescheduleDecisionAt)) {
      const redate = redateLogByTrial.get(trial.id);
      const userId = redate?.actorUserId ?? pmId;
      if (userId != null)
        habitEvents.push({ ruleCode: "pm.returned_redate", userId, ref, dueAt: addHours(trial.rescheduleDecisionAt, hoursFor(ruleHours, "pm.returned_redate", 24)), doneAt: redate?.createdAt ?? null });
    }
    if (within(window, trial.createdAt)) {
      const answeredAt = trial.dateConfirmedAt ?? ((trial.dateConfirmationStatus === "RESCHEDULE_PROPOSED" || trial.dateConfirmationStatus === "RETURNED_TO_PM") ? trial.rescheduleDecisionAt ?? null : null);
      const userId = trial.dateConfirmedById ?? trial.proposedById ?? null;
      if (userId != null)
        habitEvents.push({ ruleCode: "inj.date_confirm", userId, ref, dueAt: addHours(trial.createdAt, hoursFor(ruleHours, "inj.date_confirm", 24)), doneAt: answeredAt });
    }
    if ((trial.status === "COMPLETED" || trial.status === "PENDING_FOLLOW_UP") && trial.actualDate != null && within(window, endOfDay(trial.actualDate))) {
      const injId = trial.dateConfirmedById ?? trial.proposedById ?? null;
      if (injId != null)
        habitEvents.push({ ruleCode: "inj.process_values", userId: injId, ref, dueAt: null, doneAt: null, passed: trial.processValues.length > 0 });
      if (recordLog != null && within(window, recordLog.createdAt))
        habitEvents.push({ ruleCode: "qc.report_upload", userId: recordLog.actorUserId, ref, dueAt: addHours(recordLog.createdAt, hoursFor(ruleHours, "qc.report_upload", 48)), doneAt: qcByTrial.get(trial.id) ?? null });
    }
    const proposalAt = proposalAtByTrial.get(trial.id);
    if (proposalAt != null && within(window, proposalAt) && trial.rescheduleDecisionById != null)
      habitEvents.push({ ruleCode: "mkt.date_decision", userId: trial.rescheduleDecisionById, ref, dueAt: addHours(proposalAt, hoursFor(ruleHours, "mkt.date_decision", 24)), doneAt: trial.rescheduleDecisionAt ?? null });
  }

  for (const issue of issues) {
    const ref = `${issue.moldTrialProject.projectCode} · ${issue.title}`;
    if (within(window, issue.createdAt) && (issue.assemblyAcknowledgedAt != null || issue.assemblyAcknowledgedById != null || issue.assemblySelfCheckedAt != null)) {
      const userId = issue.assemblyAcknowledgedById ?? issue.ownerUserId ?? null;
      if (userId != null)
        habitEvents.push({ ruleCode: "asm.acknowledge", userId, ref, dueAt: addHours(issue.createdAt, hoursFor(ruleHours, "asm.acknowledge", 24)), doneAt: issue.assemblyAcknowledgedAt ?? null });
    }
    if (issue.assemblyAcknowledgedById != null && within(window, issue.assemblyAcknowledgedAt))
      habitEvents.push({ ruleCode: "asm.self_check", userId: issue.assemblySelfCheckedById ?? issue.assemblyAcknowledgedById, ref, dueAt: null, doneAt: null, passed: issue.assemblySelfCheckedAt != null });
    if (issue.ownerGroupId != null && within(window, issue.createdAt)) {
      const claim = claimLogByIssue.get(issue.id);
      const claimerId = claim?.actorUserId ?? issue.ownerUserId ?? null;
      if (claimerId != null)
        habitEvents.push({ ruleCode: "all.inbox_claim", userId: claimerId, ref, dueAt: addHours(issue.createdAt, hoursFor(ruleHours, "all.inbox_claim", 48)), doneAt: claim?.createdAt ?? (issue.ownerUserId != null ? issue.updatedAt : null) });
    }
    if (within(window, issue.createdAt))
      habitEvents.push({ ruleCode: "all.photo_on_defect", userId: issue.createdById, ref, dueAt: null, doneAt: null, passed: issueHasPhoto.has(issue.id) });
    const fixerId = issue.ownerUserId ?? issue.createdById;
    const verified = issue.verifiedAtTrialEventId != null;
    const at = verified ? issue.closedAt ?? issue.updatedAt : issue.createdAt;
    if (within(window, at)) pointsEvents.push({ userId: fixerId, issueRef: ref, severity: issue.severity, verified });
  }

  return { habitEvents, pointsEvents };
}

function serialize(card) {
  return {
    applicable: card.applicable, onTime: card.onTime, percent: card.percent, barHit: card.barHit,
    barHitByFloor: card.barHitByFloor, totalPoints: card.totalPoints,
    lines: card.lines.map((l) => ({ ruleCode: l.ruleCode, applicable: l.applicable, onTime: l.onTime,
      items: l.items.map((i) => ({ ref: i.ref, dueAt: i.dueAt?.toISOString() ?? null, doneAt: i.doneAt?.toISOString() ?? null, onTime: i.onTime })) })),
    points: card.points.map((p) => ({ issueRef: p.issueRef, severity: p.severity, weight: p.weight, verified: p.verified, counted: p.counted }))
  };
}

async function snapshotMonth(month, dateOnly, now) {
  const window = monthWindow(month);
  const { rules, ruleHours } = await loadRuleConfig();
  const [users, extraction, groups] = await Promise.all([
    prisma.user.findMany({ where: { status: "ACTIVE" }, include: { role: { select: { code: true } } }, orderBy: [{ username: "asc" }] }),
    extract(window, ruleHours),
    prisma.departmentGroup.findMany({ select: { id: true, code: true, kpiLeaderId: true } })
  ]);
  const habitByUser = new Map();
  for (const e of extraction.habitEvents) { const l = habitByUser.get(e.userId) ?? []; l.push(e); habitByUser.set(e.userId, l); }
  const pointsByUser = new Map();
  for (const e of extraction.pointsEvents) { const l = pointsByUser.get(e.userId) ?? []; l.push(e); pointsByUser.set(e.userId, l); }

  const scored = users.map((u) => ({
    user: u,
    roleScope: roleScopeForRole(u.role.code),
    card: computeScorecard({ userId: u.id, habitEvents: habitByUser.get(u.id) ?? [], pointsEvents: pointsByUser.get(u.id) ?? [], rules, now })
  }));

  // Leader-designation layer: aggregate each scored user's card into their real
  // KPI group (departmentGroupId). DEPARTMENT_GROUP snapshots key on real group
  // ids — one row per group with a designated leader (kpiLeaderId). The pm group
  // has no leader (PMs are USER-scope individuals), so it is skipped here.
  const memberCardsByGroupId = new Map();
  for (const s of scored) {
    if (s.user.departmentGroupId == null) continue;
    const l = memberCardsByGroupId.get(s.user.departmentGroupId) ?? [];
    l.push(s.card);
    memberCardsByGroupId.set(s.user.departmentGroupId, l);
  }

  // `rows` mirrors exactly what is written to KpiSnapshot and becomes the hashed
  // `data.rows` of the JSON archive, so paper, archive, and database agree.
  const rows = [];
  await prisma.$transaction(async (tx) => {
    for (const s of scored) {
      const metricsJson = { month, username: s.user.username, roleCode: s.user.role.code, roleScope: s.roleScope, scorecard: serialize(s.card) };
      await tx.kpiSnapshot.deleteMany({ where: { snapshotDate: dateOnly, scopeType: "USER", scopeId: s.user.id } });
      await tx.kpiSnapshot.create({ data: { snapshotDate: dateOnly, scopeType: "USER", scopeId: s.user.id, metricsJson } });
      rows.push({ month, scopeType: "USER", scopeId: s.user.id, metrics: metricsJson });
    }
    for (const g of groups) {
      if (g.kpiLeaderId == null) continue;
      const cards = memberCardsByGroupId.get(g.id) ?? [];
      const rollup = computeDepartmentRollup(cards);
      const metricsJson = { month, groupCode: g.code, leaderUserId: g.kpiLeaderId, memberCount: cards.length, ...rollup };
      await tx.kpiSnapshot.deleteMany({ where: { snapshotDate: dateOnly, scopeType: "DEPARTMENT_GROUP", scopeId: g.id } });
      await tx.kpiSnapshot.create({ data: { snapshotDate: dateOnly, scopeType: "DEPARTMENT_GROUP", scopeId: g.id, metricsJson } });
      rows.push({ month, scopeType: "DEPARTMENT_GROUP", scopeId: g.id, metrics: metricsJson });
    }
    const cApplicable = scored.reduce((s, x) => s + x.card.applicable, 0);
    const cOnTime = scored.reduce((s, x) => s + x.card.onTime, 0);
    const metricsJson = { month, applicable: cApplicable, onTime: cOnTime, percent: cApplicable === 0 ? 100 : Math.round((cOnTime / cApplicable) * 100), userCount: scored.length };
    await tx.kpiSnapshot.deleteMany({ where: { snapshotDate: dateOnly, scopeType: "COMPANY", scopeId: null } });
    await tx.kpiSnapshot.create({ data: { snapshotDate: dateOnly, scopeType: "COMPANY", scopeId: null, metricsJson } });
    rows.push({ month, scopeType: "COMPANY", scopeId: null, metrics: metricsJson });
  });
  return rows;
}

/** Stable row order so two runs over unchanged data hash identically. */
function sortRows(rows) {
  return [...rows].sort((left, right) => {
    const keyLeft = `${left.month}|${left.scopeType}|${left.scopeId ?? ""}`;
    const keyRight = `${right.month}|${right.scopeType}|${right.scopeId ?? ""}`;
    return keyLeft < keyRight ? -1 : keyLeft > keyRight ? 1 : 0;
  });
}

function defaultArchivePath(snapshotDate) {
  const directory =
    process.env.MOLDPILOT_KPI_SNAPSHOT_DIR?.trim() ||
    path.join(PROJECT_ROOT, "storage", "kpi-snapshots");
  return path.resolve(directory, `kpi-snapshot-${snapshotDate}.json`);
}

try {
  const now = new Date();
  const dateOnly = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const snapshotDate = dateOnly.toISOString().slice(0, 10);
  const thisMonth = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  const prev = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const prevMonth = `${prev.getUTCFullYear()}-${String(prev.getUTCMonth() + 1).padStart(2, "0")}`;

  const previousRows = await snapshotMonth(prevMonth, dateOnly, now);
  const currentRows = await snapshotMonth(thisMonth, dateOnly, now);
  const rows = sortRows([...previousRows, ...currentRows]);

  // Hashed: snapshotDate + months + every snapshot row (scope + metrics).
  // Deliberately excluded: generatedAt and the integrity block itself.
  const file = buildSnapshotFile(
    { snapshotDate, months: [prevMonth, thisMonth], rowCount: rows.length, rows },
    now.toISOString(),
    sha256Hex
  );
  const archivePath = options.out == null ? defaultArchivePath(snapshotDate) : path.resolve(process.cwd(), options.out);
  mkdirSync(path.dirname(archivePath), { recursive: true });
  writeFileSync(archivePath, `${JSON.stringify(file, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });

  const byScope = (scopeType) => rows.filter((row) => row.scopeType === scopeType).length;
  console.log(`[ok] Wrote ${rows.length} KpiSnapshot rows for ${prevMonth} and ${thisMonth} dated ${snapshotDate}.`);
  console.log("");
  console.log("  MoldPilot monthly KPI snapshot 月度KPI快照");
  console.log(`  Months 月份        : ${prevMonth}, ${thisMonth}`);
  console.log(`  Snapshot date 日期 : ${snapshotDate}`);
  console.log(`  Generated at 生成于: ${file.generatedAt}`);
  console.log(
    `  Rows 行数          : ${rows.length} (user ${byScope("USER")} · group ${byScope("DEPARTMENT_GROUP")} · company ${byScope("COMPANY")})`
  );
  console.log(`  Archive 存档       : ${archivePath}`);
  console.log("");
  console.log(`  Integrity code / 校验码: ${file.integrity.code}`);
  console.log("");
  console.log("  Read this code aloud at the prize meeting and write it on the signed page.");
  console.log("  在评奖会上朗读该校验码并写在签字页上。");
  console.log(`  Recheck later: node scripts/run-kpi-snapshot.mjs --verify "${archivePath}"`);
} finally {
  await prisma.$disconnect();
}
