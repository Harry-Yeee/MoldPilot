/**
 * The ONE place `ProjectNote` is read from or written to Prisma.
 *
 * `project_notes` is a NEW MODEL, added by the 2026-08-06 migration. Unlike a new
 * column — which a spread seam can smuggle past a stale generated client — a new
 * model simply does not exist on `PrismaClient`, so `prisma.projectNote` is a
 * hard type error until `prisma generate` runs. This module is the seam: ONE
 * documented cast, plus hand-authored row and delegate types describing exactly
 * the four calls the feature makes.
 *
 * The hand-authored types are deliberately narrow (no `select`, no `include`
 * generics, no filters we do not use). They are a contract with the migration,
 * not a re-implementation of Prisma — and once the client is regenerated the
 * shapes match what Prisma itself produces, so this file keeps working unchanged
 * and could then be inlined if anyone wants to.
 *
 * There is NO update-body call here, and there must never be one: the ledger is
 * append-only, and the reasoning lives in
 * `src/domain/mold-trial/project-notes.ts`.
 */

import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

/** A stored note row, exactly as the table declares it. */
export type ProjectNoteRow = {
  id: string;
  projectId: string;
  body: string;
  createdById: string;
  createdAt: Date;
  retiredAt: Date | null;
  retiredById: string | null;
};

type NoteUser = { displayName: string; chineseName: string | null };

/** A note row with the two people joined, as the section renders it. */
export type ProjectNoteRowWithPeople = ProjectNoteRow & {
  createdBy: NoteUser;
  retiredBy: NoteUser | null;
};

const noteUserSelect = { select: { displayName: true, chineseName: true } } as const;

/** Exactly the four calls this feature makes, and nothing else. */
type ProjectNoteDelegate = {
  findMany(args: {
    where: { projectId: string };
    include: { createdBy: typeof noteUserSelect; retiredBy: typeof noteUserSelect };
    orderBy: readonly { createdAt: "asc" }[] | { createdAt: "asc" };
  }): Promise<ProjectNoteRowWithPeople[]>;
  findUnique(args: { where: { id: string } }): Promise<ProjectNoteRow | null>;
  create(args: {
    data: { projectId: string; body: string; createdById: string };
  }): Promise<ProjectNoteRow>;
  update(args: {
    where: { id: string };
    data: { retiredAt: Date; retiredById: string };
  }): Promise<ProjectNoteRow>;
};

/** `prisma` itself, or the transaction client inside `$transaction`. */
export type ProjectNoteClient = typeof prisma | Prisma.TransactionClient;

/**
 * THE CAST. `project_notes` exists in the database and in
 * `prisma/schema.prisma`; it exists on the generated client only after
 * `prisma generate`. Everything above this line is typed; below it, nothing is.
 */
function projectNoteDelegate(client: ProjectNoteClient): ProjectNoteDelegate {
  return (client as unknown as { projectNote: ProjectNoteDelegate }).projectNote;
}

/** Every note of one project, oldest first, with both people joined. */
export async function listProjectNoteRows(
  projectId: string,
  client: ProjectNoteClient = prisma
): Promise<ProjectNoteRowWithPeople[]> {
  return projectNoteDelegate(client).findMany({
    where: { projectId },
    include: { createdBy: noteUserSelect, retiredBy: noteUserSelect },
    orderBy: [{ createdAt: "asc" }]
  });
}

/** One note by id (no join) — the retire guard's input. */
export async function findProjectNoteRow(
  id: string,
  client: ProjectNoteClient = prisma
): Promise<ProjectNoteRow | null> {
  return projectNoteDelegate(client).findUnique({ where: { id } });
}

/** Append one line. The only INSERT path. */
export async function createProjectNoteRow(
  input: { projectId: string; body: string; createdById: string },
  client: ProjectNoteClient = prisma
): Promise<ProjectNoteRow> {
  return projectNoteDelegate(client).create({ data: input });
}

/**
 * Strike one line through. The only UPDATE path — and it touches nothing but the
 * two retire columns, which is what makes the ledger append-only in practice and
 * not merely by convention.
 */
export async function retireProjectNoteRow(
  input: { id: string; retiredById: string; retiredAt: Date },
  client: ProjectNoteClient = prisma
): Promise<ProjectNoteRow> {
  return projectNoteDelegate(client).update({
    where: { id: input.id },
    data: { retiredAt: input.retiredAt, retiredById: input.retiredById }
  });
}
