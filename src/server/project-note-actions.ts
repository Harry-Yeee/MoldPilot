"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { assertProjectNotArchived } from "@/domain/mold-trial/project-archive";
import {
  decideProjectNoteRetire,
  parseProjectNoteBody,
  projectNoteRetireMessages
} from "@/domain/mold-trial/project-notes";
import { prisma } from "@/lib/prisma";
import { friendlyActionErrorMessage } from "@/server/action-errors";
import { getCurrentUser } from "@/server/current-user";
import { requirePermission } from "@/server/permissions";
import {
  createProjectNoteRow,
  findProjectNoteRow,
  retireProjectNoteRow
} from "@/server/project-note-store";

/**
 * Client notes 客户备注 — the two writes the ledger allows.
 *
 * ADD appends a line. RETIRE strikes one through and, when the same sheet also
 * carries a replacement, appends the new line IN THE SAME TRANSACTION so the
 * "old struck, new below it" pair either both happen or neither does. There is
 * no third action: nothing here updates a note body, ever (see
 * `src/domain/mold-trial/project-notes.ts` for why that is the feature).
 *
 * Both actions require `project.client_note.write` (PM / Marketing / Admin) and
 * both refuse an archived project through the shared archive guard.
 */

function value(formData: FormData, key: string): string {
  const raw = formData.get(key);
  return typeof raw === "string" ? raw.trim() : "";
}

function optionalValue(formData: FormData, key: string): string | null {
  const next = value(formData, key);
  return next.length === 0 ? null : next;
}

function redirectPath(formData: FormData, fallback: string): string {
  const path = optionalValue(formData, "redirectTo");
  return path?.startsWith("/") === true ? path : fallback;
}

function redirectWithMessage(path: string, type: "error" | "success", message: string): never {
  const separator = path.includes("?") ? "&" : "?";
  redirect(`${path}${separator}${type}=${encodeURIComponent(message)}#section-client-notes`);
}

function isRedirectSignal(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "digest" in error &&
    String((error as { digest: unknown }).digest).startsWith("NEXT_REDIRECT")
  );
}

/**
 * Load the target project, check the permission, refuse when archived.
 * Every write in this file starts here, so the three checks cannot drift apart.
 */
async function loadWritableProject(projectCode: string) {
  const actor = await getCurrentUser();
  await requirePermission(actor.id, "project.client_note.write");

  const project = await prisma.moldTrialProject.findUnique({ where: { projectCode } });

  if (project == null) {
    throw new Error("Project not found.");
  }

  assertProjectNotArchived(project);

  return { actor, project };
}

export async function addProjectNote(formData: FormData) {
  const projectCode = value(formData, "projectCode");
  const fallback = redirectPath(formData, `/projects/${projectCode}`);

  try {
    const { actor, project } = await loadWritableProject(projectCode);
    const body = parseProjectNoteBody(value(formData, "body"));

    if (body == null) {
      redirectWithMessage(fallback, "error", "Client note text is required.");
    }

    const note = await prisma.$transaction(async (tx) => {
      const created = await createProjectNoteRow(
        { projectId: project.id, body, createdById: actor.id },
        tx
      );

      await tx.activityLog.create({
        data: {
          actorUserId: actor.id,
          entityType: "ProjectNote",
          entityId: created.id,
          action: "added_client_note",
          afterJson: { projectCode: project.projectCode, body: created.body }
        }
      });

      return created;
    });

    revalidatePath(`/projects/${project.projectCode}`);
    redirectWithMessage(fallback, "success", `Client note added (${note.body.slice(0, 40)}).`);
  } catch (error) {
    if (isRedirectSignal(error)) {
      throw error;
    }

    redirectWithMessage(fallback, "error", friendlyActionErrorMessage(error, "Unable to add the client note."));
  }
}

/**
 * Strike one line through, optionally appending its replacement in the same
 * transaction. The replacement is written AFTER the retire so its `createdAt`
 * sorts below the line it supersedes — the owner's sketch, exactly.
 */
export async function retireProjectNote(formData: FormData) {
  const projectCode = value(formData, "projectCode");
  const fallback = redirectPath(formData, `/projects/${projectCode}`);

  try {
    const { actor, project } = await loadWritableProject(projectCode);
    const noteId = value(formData, "noteId");
    const replacementBody = parseProjectNoteBody(value(formData, "replacementBody"));
    const existing = noteId.length === 0 ? null : await findProjectNoteRow(noteId);
    const decision = decideProjectNoteRetire({ projectId: project.id, note: existing });

    if (!decision.ok) {
      redirectWithMessage(fallback, "error", projectNoteRetireMessages[decision.reason]);
    }

    const retiredAt = new Date();

    await prisma.$transaction(async (tx) => {
      const retired = await retireProjectNoteRow({ id: noteId, retiredById: actor.id, retiredAt }, tx);

      await tx.activityLog.create({
        data: {
          actorUserId: actor.id,
          entityType: "ProjectNote",
          entityId: retired.id,
          action: "retired_client_note",
          beforeJson: { projectCode: project.projectCode, body: retired.body, retiredAt: null },
          afterJson: {
            projectCode: project.projectCode,
            body: retired.body,
            retiredAt: retiredAt.toISOString()
          }
        }
      });

      if (replacementBody == null) {
        return;
      }

      const replacement = await createProjectNoteRow(
        { projectId: project.id, body: replacementBody, createdById: actor.id },
        tx
      );

      await tx.activityLog.create({
        data: {
          actorUserId: actor.id,
          entityType: "ProjectNote",
          entityId: replacement.id,
          action: "added_client_note",
          afterJson: {
            projectCode: project.projectCode,
            body: replacement.body,
            replacesNoteId: retired.id
          }
        }
      });
    });

    revalidatePath(`/projects/${project.projectCode}`);
    redirectWithMessage(
      fallback,
      "success",
      replacementBody == null ? "Client note struck through." : "Client note struck through and replaced."
    );
  } catch (error) {
    if (isRedirectSignal(error)) {
      throw error;
    }

    redirectWithMessage(fallback, "error", friendlyActionErrorMessage(error, "Unable to update the client note."));
  }
}
