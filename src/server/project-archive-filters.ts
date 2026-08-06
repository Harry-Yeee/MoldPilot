/**
 * The `archived_at` query seams — the ONE place the archive column enters a
 * Prisma `where` clause.
 *
 * `mold_trial_projects.archived_at` arrives with the 2026-08-06 migration, so a
 * checkout that has not run `prisma generate` since then has a generated client
 * whose `MoldTrialProjectWhereInput` does not know the field — and unlike a
 * write payload, a `where` value cannot be smuggled past that with a bare spread
 * (`insertTypesWrite`-style). TypeScript's weak-type rule rejects
 * `{ archivedAt: null }` against an all-optional input type it has no property
 * in common with, both as the whole `where` and as a nested relation value.
 *
 * So the two filters below are typed AS `Prisma.MoldTrialProjectWhereInput` —
 * the single pair of documented casts this feature needs, in one file. They stay
 * correct, unchanged, after `prisma generate`: what they produce is exactly what
 * Prisma will then accept with no cast at all. Both work in either position:
 *
 *     where: liveProjectFilter()                              // project query
 *     where: { …, moldTrialProject: liveProjectFilter() }     // child query
 *     where: { moldTrialProject: { OR: […], …liveProjectFilter() } }
 *
 * The archive WRITE below needs no cast: spreading a typed object into a `data`
 * literal is the same seam `insertTypesWrite` / `intakeDetailsWrite` use.
 *
 * Everything else about archiving is pure and lives in
 * `src/domain/mold-trial/project-archive.ts`.
 */

import type { Prisma } from "@prisma/client";

/** `archived_at IS NULL` — every live surface filters on this. */
export function liveProjectFilter(): Prisma.MoldTrialProjectWhereInput {
  return { archivedAt: null } as unknown as Prisma.MoldTrialProjectWhereInput;
}

/** `archived_at IS NOT NULL` — the admin "Archived projects" list. */
export function archivedProjectFilter(): Prisma.MoldTrialProjectWhereInput {
  return { archivedAt: { not: null } } as unknown as Prisma.MoldTrialProjectWhereInput;
}

/** The three archive columns as a Prisma write payload (stamp an archive). */
export function archiveStampWrite(input: {
  archivedAt: Date;
  archivedById: string;
  archiveReason: string;
}): { archivedAt: Date; archivedById: string; archiveReason: string } {
  return {
    archivedAt: input.archivedAt,
    archivedById: input.archivedById,
    archiveReason: input.archiveReason
  };
}
