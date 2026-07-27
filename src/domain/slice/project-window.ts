/**
 * Dev-slice project membership — is this project IN the window?
 *
 * THE RULE (the whole windowing design in one sentence): a project is IN when
 * ANY activity anywhere in its lineage — the project row itself, a part, a trial
 * event, a missed trial, an issue, a process value, a design change, a limit
 * adjustment, an attachment, or an activity-log row pointing at any of those —
 * carries a timestamp inside the window; and an IN project then exports its
 * COMPLETE history, every child row, regardless of that row's own date. An OUT
 * project exports nothing at all.
 *
 * Why complete history rather than only in-window rows: a trial recorded last
 * Tuesday makes no sense on a dev machine without the T0 it followed, the issue
 * it verified, or the limit adjustment that allowed it. Half a project is worse
 * than no project — it looks like a data bug rather than an absence.
 *
 * The caller reduces each table to at most one timestamp per project (its latest
 * relevant `createdAt`/`updatedAt`/`uploadedAt`) and hands the signals here.
 * That keeps this decision pure and directly testable, and keeps the SQL in the
 * CLI where it belongs.
 *
 * Pure module: no Prisma, no filesystem, no environment.
 */

import { isWithinSliceWindow, type SliceWindow } from "./window.ts";

/** One table's latest activity for one project. `at: null` means "no rows". */
export type ProjectActivitySignal = {
  /** Table/field the timestamp came from, e.g. "TrialEvent.updatedAt". */
  source: string;
  at: Date | null;
};

export type ProjectActivitySummary = {
  projectId: string;
  signals: readonly ProjectActivitySignal[];
};

export type ProjectWindowVerdict = {
  projectId: string;
  included: boolean;
  /** The signal that put the project in the window, or null when excluded. */
  matchedSource: string | null;
  matchedAt: Date | null;
};

/**
 * Verdict for one project.
 *
 * When several signals land inside the window the MOST RECENT one is reported,
 * because that is what an operator asking "why is this project here?" means.
 * Ties break on source name so two runs over unchanged data explain themselves
 * identically. Null timestamps and invalid dates never match.
 */
export function decideProjectWindowMembership(
  summary: ProjectActivitySummary,
  window: SliceWindow
): ProjectWindowVerdict {
  let matchedSource: string | null = null;
  let matchedAt: Date | null = null;

  for (const signal of summary.signals) {
    if (!isWithinSliceWindow(window, signal.at) || signal.at == null) {
      continue;
    }

    if (matchedAt == null) {
      matchedSource = signal.source;
      matchedAt = signal.at;
      continue;
    }

    const newer = signal.at.getTime() > matchedAt.getTime();
    const tieBrokenByName =
      signal.at.getTime() === matchedAt.getTime() && signal.source < (matchedSource ?? "");

    if (newer || tieBrokenByName) {
      matchedSource = signal.source;
      matchedAt = signal.at;
    }
  }

  return {
    projectId: summary.projectId,
    included: matchedAt != null,
    matchedSource,
    matchedAt
  };
}

/** Verdicts for many projects, in stable projectId order. */
export function decideProjectWindowMemberships(
  summaries: readonly ProjectActivitySummary[],
  window: SliceWindow
): ProjectWindowVerdict[] {
  return [...summaries]
    .sort((left, right) => (left.projectId < right.projectId ? -1 : left.projectId > right.projectId ? 1 : 0))
    .map((summary) => decideProjectWindowMembership(summary, window));
}

/** Ids of the IN projects, stable order. */
export function includedProjectIds(verdicts: readonly ProjectWindowVerdict[]): string[] {
  return verdicts.filter((verdict) => verdict.included).map((verdict) => verdict.projectId);
}
