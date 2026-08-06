/**
 * Project archive 已归档 — the admin escape hatch for a mis-entered project.
 *
 * Intake is fast and sometimes wrong: the wrong client, the wrong mold code, a
 * duplicate of a project someone else already opened. Deleting is not an option
 * (attachments, activity log and KPI history hang off the row), so an ADMIN
 * archives instead: the project is stamped `archivedAt` / `archivedById` /
 * `archiveReason`, drops out of every live surface, and stays fully readable.
 *
 * THE CODE RENAME. `mold_trial_projects.project_code` is the ONLY
 * unique-constrained code on the table — `mold_code` and `client_project_ref`
 * are indexed but not unique, and there is no separate internal-tracking column
 * (projectCode *is* the internal tracking id, `MP-TRK-<date>-<suffix>`, see
 * identifiers.ts). A mis-entered project therefore squats on exactly one scarce
 * name, and the corrected re-entry needs it back. Archiving renames it to
 * `<original>-ARCHIVED-<n>`, with the original recorded in the ActivityLog
 * before/after payload so nothing is lost.
 *
 * NO UN-ARCHIVE, deliberately. The rename frees the original code the moment the
 * archive commits, so by the time anyone wants the project back the code may
 * already belong to its replacement — restoring it would either collide or
 * silently hand back a renamed shell. The supported answer is to re-create the
 * project (the codes are free) and read the archived one for history.
 *
 * Pure module: no Prisma imports, no I/O. The Prisma-typed query filters live in
 * `src/server/project-archive-filters.ts`.
 */

import type { BilingualLabel } from "./labels.ts";

/** Separator between the original code and the archive counter. */
export const archivedCodeMarker = "-ARCHIVED-";

/** Longest archive reason accepted; anything longer is truncated. */
export const archiveReasonMaxLength = 500;

/** `-ARCHIVED-<n>` at the very end of a code. */
const archivedSuffixPattern = /-ARCHIVED-(\d+)$/;

/** Section, banner and admin-list labels. */
export const projectArchiveLabels = {
  archived: { en: "Archived", zh: "已归档" },
  bannerTitle: { en: "Archived — read only", zh: "已归档 — 只读" },
  bannerBody: {
    en: "This project was archived by an administrator. It is kept for history and cannot be edited.",
    zh: "本项目已由管理员归档，仅作历史记录保留，不可编辑。"
  },
  archiveProject: { en: "Archive project", zh: "归档项目" },
  reason: { en: "Reason (required)", zh: "归档原因（必填）" },
  reasonHint: {
    en: "Why this project is being archived — wrong client, duplicate, test entry.",
    zh: "为什么归档：客户填错、重复建档、测试数据。"
  },
  confirm: {
    en: "I understand: the project leaves the dashboard, calendar, tasks, reports and KPI, and its code is released for re-entry. This cannot be undone.",
    zh: "我已知悉：项目将从看板、日历、任务、报表与 KPI 中移除，其编号会释放供重新建档，且无法撤销。"
  },
  listTitle: { en: "Archived projects", zh: "已归档项目" },
  listSubtitle: {
    en: "Kept for history. Re-create the project instead of restoring — the original codes are free again.",
    zh: "仅作历史记录保留。需要恢复请重新建档 — 原编号已释放。"
  },
  listEmpty: { en: "No archived projects.", zh: "暂无已归档项目。" },
  archivedCode: { en: "Archived code", zh: "归档编号" },
  originalCode: { en: "Original code", zh: "原编号" },
  archivedBy: { en: "Archived by", zh: "归档人" },
  archivedAt: { en: "Archived on", zh: "归档时间" },
  openReadOnly: { en: "Open (read only)", zh: "查看（只读）" }
} as const satisfies Record<string, BilingualLabel>;

/**
 * The archive reason, normalized. Blank reads as "not given" so the caller can
 * refuse it with one check; the form marks the field `required` as well.
 */
export function parseArchiveReason(value: string | null | undefined): string | null {
  if (value == null) {
    return null;
  }

  const trimmed = value.trim();

  if (trimmed.length === 0) {
    return null;
  }

  return trimmed.slice(0, archiveReasonMaxLength);
}

/**
 * The code as it read before archiving — `MP-TRK-…-ARCHIVED-2` → `MP-TRK-…`.
 *
 * Used by the admin list so the original code needs no extra column, and by
 * {@link nextArchivedProjectCode} so a code that somehow already carries the
 * marker never stacks a second one.
 */
export function originalProjectCode(code: string): string {
  return code.replace(archivedSuffixPattern, "");
}

/** True when this code was produced by an archive rename. */
export function isArchivedProjectCode(code: string): boolean {
  return archivedSuffixPattern.test(code);
}

/**
 * The renamed code for an archive: `<original>-ARCHIVED-<n>`, where `n` is the
 * lowest positive integer that is not already taken.
 *
 * `takenCodes` is every project code currently in the database (the caller
 * queries the ones that start with the original code — the only ones that can
 * collide). Counting up rather than using a timestamp keeps the result readable
 * and stable: the second time the same mold code is mis-entered and archived it
 * reads `-ARCHIVED-2`, which is exactly what an admin scanning the list expects.
 *
 * The comparison is case-sensitive because `project_code` is, and the original
 * suffix is stripped first so archiving an already-archived-looking code yields
 * `X-ARCHIVED-2`, never `X-ARCHIVED-1-ARCHIVED-1`.
 */
export function nextArchivedProjectCode(code: string, takenCodes: Iterable<string>): string {
  const base = originalProjectCode(code);
  const taken = new Set<string>(takenCodes);

  for (let counter = 1; ; counter += 1) {
    const candidate = `${base}${archivedCodeMarker}${counter}`;

    if (!taken.has(candidate)) {
      return candidate;
    }
  }
}

/**
 * Whether a project row is archived.
 *
 * `archivedAt` is optional in the parameter type and `id` is required, the same
 * seam `projectInsertTypes` / `projectIntakeDetails` use: the column arrives
 * with the 2026-08-06 migration, so a checkout whose generated Prisma client
 * predates it still typechecks here (the field simply reads as absent until
 * `prisma generate` runs), and the required `id` keeps TypeScript's weak-type
 * check from silently accepting an unrelated object.
 */
export function isProjectArchived(project: { id: string; archivedAt?: Date | null }): boolean {
  return project.archivedAt != null;
}

export type ProjectArchiveState = {
  archived: boolean;
  archivedAt: Date | null;
  archivedById: string | null;
  archiveReason: string | null;
};

/** The three archive columns off a project row, through the same stale-client seam. */
export function projectArchiveState(project: {
  id: string;
  archivedAt?: Date | null;
  archivedById?: string | null;
  archiveReason?: string | null;
}): ProjectArchiveState {
  return {
    archived: project.archivedAt != null,
    archivedAt: project.archivedAt ?? null,
    archivedById: project.archivedById ?? null,
    archiveReason: parseArchiveReason(project.archiveReason)
  };
}

/**
 * Whether events belonging to this project are applicable for KPI scoring.
 *
 * An archived project is a data-entry mistake, and a mistake must not cost
 * anybody a habit event: nobody confirmed a date, uploaded a report or claimed
 * an issue on a project that should never have existed. The scorer's own rule is
 * "when a source is unreliable, EXCLUDE rather than guess" (kpi-events.ts), and
 * excluding here is safe in the same way — the <5-applicable-events floor
 * protects a bar that loses rows.
 */
export function isKpiScorableProject(project: { id: string; archivedAt?: Date | null }): boolean {
  return !isProjectArchived(project);
}

/** Message every refused write shares, so the banner and the error agree. */
export const archivedProjectWriteMessage = "This project is archived (read only).";

/**
 * The shared write guard — belt and braces behind the hidden forms.
 *
 * The project page hides every mutating form on an archived project, but a stale
 * tab, a bookmarked POST or a hand-built request must be refused too, so every
 * project-scoped server action calls this after it loads its project.
 */
export function assertProjectNotArchived(project: { id: string; archivedAt?: Date | null }): void {
  if (isProjectArchived(project)) {
    throw new Error(archivedProjectWriteMessage);
  }
}
