import { formatBilingualUserName } from "@/domain/mold-trial/users";
import { originalProjectCode, projectArchiveState } from "@/domain/mold-trial/project-archive";
import { prisma } from "@/lib/prisma";
import { archivedProjectFilter } from "@/server/project-archive-filters";

/**
 * The admin "Archived projects 已归档" list.
 *
 * One row per archived project: the renamed code it lives under now, the
 * ORIGINAL code it was archived from (derived from the rename, so no extra
 * column is needed), the reason, who archived it and when, plus the mold/client
 * identifiers that make it recognisable — those were never renamed, because
 * nothing forced them to be unique.
 */
export type ArchivedProjectRow = {
  id: string;
  /** Current (renamed) code — also the URL of the read-only project page. */
  projectCode: string;
  /** The code as it read before archiving. */
  originalCode: string;
  moldCode: string;
  clientProjectRef: string | null;
  customerCode: string;
  archivedAt: Date | null;
  archiveReason: string | null;
  archivedByName: string | null;
};

export async function listArchivedProjects(): Promise<ArchivedProjectRow[]> {
  // No `select` and no `orderBy` on archivedAt: both would name a column a
  // generated client that predates the 2026-08-06 migration does not know. The
  // whole row is read and the archive fields come off it through the pure seam
  // (project-archive.ts); ordering is done here, over a list that is short by
  // construction — archiving is rare and each row is a correction.
  const rows = await prisma.moldTrialProject.findMany({ where: archivedProjectFilter() });

  const archivedByIds = [
    ...new Set(
      rows
        .map((row) => projectArchiveState(row).archivedById)
        .filter((id): id is string => id != null)
    )
  ];
  // A separate lookup rather than an `include: { archivedBy: … }`, for the same
  // reason: the relation does not exist on a stale client either.
  const actors =
    archivedByIds.length === 0
      ? []
      : await prisma.user.findMany({
          where: { id: { in: archivedByIds } },
          select: { id: true, displayName: true, chineseName: true }
        });
  const actorNameById = new Map(actors.map((actor) => [actor.id, formatBilingualUserName(actor)]));

  return rows
    .map((row) => {
      const archive = projectArchiveState(row);

      return {
        id: row.id,
        projectCode: row.projectCode,
        originalCode: originalProjectCode(row.projectCode),
        moldCode: row.moldCode,
        clientProjectRef: row.clientProjectRef,
        customerCode: row.customerCode,
        archivedAt: archive.archivedAt,
        archiveReason: archive.archiveReason,
        archivedByName: archive.archivedById == null ? null : actorNameById.get(archive.archivedById) ?? null
      };
    })
    .sort((left, right) => {
      // Newest archive first; a row with no timestamp (impossible today, but the
      // column is nullable) sorts last rather than crashing the comparator.
      const leftAt = left.archivedAt?.getTime() ?? 0;
      const rightAt = right.archivedAt?.getTime() ?? 0;
      return rightAt - leftAt || left.projectCode.localeCompare(right.projectCode);
    });
}
