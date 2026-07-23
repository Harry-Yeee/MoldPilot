#!/usr/bin/env node
/**
 * Nightly KPI snapshot runner. Computes previous + current month scorecards for
 * every active user and writes one KpiSnapshot row per scope (USER +
 * DEPARTMENT_GROUP + COMPANY) dated today. Idempotent per day: existing rows
 * for (today, scope) are replaced.
 *
 * Self-contained (own Prisma client + the shared pure engine) so it runs as a
 * standalone node script on the owner's Mac:
 *   node scripts/run-kpi-snapshot.mjs
 *
 * The extraction mirrors src/server/kpi-events.ts. The scoring is the SAME pure
 * engine the app uses (src/domain/mold-trial/kpi-scoring.ts), so nightly totals
 * match the live Scores tab. Rules are read live, so a mid-month rule change is
 * reflected on the next run.
 */
import "dotenv/config";

import { computeDepartmentRollup, computeScorecard } from "../src/domain/mold-trial/kpi-scoring.ts";
import { defaultKpiRules, isKpiRuleCode } from "../src/domain/mold-trial/kpi-rules.ts";

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

  let written = 0;
  await prisma.$transaction(async (tx) => {
    for (const s of scored) {
      await tx.kpiSnapshot.deleteMany({ where: { snapshotDate: dateOnly, scopeType: "USER", scopeId: s.user.id } });
      await tx.kpiSnapshot.create({ data: { snapshotDate: dateOnly, scopeType: "USER", scopeId: s.user.id, metricsJson: { month, username: s.user.username, roleCode: s.user.role.code, roleScope: s.roleScope, scorecard: serialize(s.card) } } });
      written += 1;
    }
    for (const g of groups) {
      if (g.kpiLeaderId == null) continue;
      const cards = memberCardsByGroupId.get(g.id) ?? [];
      const rollup = computeDepartmentRollup(cards);
      await tx.kpiSnapshot.deleteMany({ where: { snapshotDate: dateOnly, scopeType: "DEPARTMENT_GROUP", scopeId: g.id } });
      await tx.kpiSnapshot.create({ data: { snapshotDate: dateOnly, scopeType: "DEPARTMENT_GROUP", scopeId: g.id, metricsJson: { month, groupCode: g.code, leaderUserId: g.kpiLeaderId, memberCount: cards.length, ...rollup } } });
      written += 1;
    }
    const cApplicable = scored.reduce((s, x) => s + x.card.applicable, 0);
    const cOnTime = scored.reduce((s, x) => s + x.card.onTime, 0);
    await tx.kpiSnapshot.deleteMany({ where: { snapshotDate: dateOnly, scopeType: "COMPANY", scopeId: null } });
    await tx.kpiSnapshot.create({ data: { snapshotDate: dateOnly, scopeType: "COMPANY", scopeId: null, metricsJson: { month, applicable: cApplicable, onTime: cOnTime, percent: cApplicable === 0 ? 100 : Math.round((cOnTime / cApplicable) * 100), userCount: scored.length } } });
    written += 1;
  });
  return written;
}

try {
  const now = new Date();
  const dateOnly = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const thisMonth = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  const prev = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const prevMonth = `${prev.getUTCFullYear()}-${String(prev.getUTCMonth() + 1).padStart(2, "0")}`;

  const a = await snapshotMonth(prevMonth, dateOnly, now);
  const b = await snapshotMonth(thisMonth, dateOnly, now);
  console.log(`[ok] Wrote ${a + b} KpiSnapshot rows for ${prevMonth} and ${thisMonth} dated ${dateOnly.toISOString().slice(0, 10)}.`);
} finally {
  await prisma.$disconnect();
}
