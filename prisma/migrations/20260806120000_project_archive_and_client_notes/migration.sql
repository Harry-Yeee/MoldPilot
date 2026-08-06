-- Two owner-approved pilot features that share one migration.
--
-- 1) ADMIN ARCHIVE for a mis-entered project (`archived_at` / `archived_by_id` /
--    `archive_reason` on mold_trial_projects).
--
-- Intake happens fast and sometimes wrong: the wrong client, the wrong mold
-- code, a duplicate of a project someone else already opened. Until now the only
-- answers were "leave the junk on the dashboard forever" or "delete", and delete
-- is not an option — attachments, activity log and KPI history hang off the row.
-- So archiving is a SOFT stamp: three nullable columns, no cascade, no data loss.
--
-- Nullable with no default and no backfill: every existing project reads as
-- live, which is exactly today's behaviour. `archived_at` alone decides — the
-- reason and the actor are the audit trail, not the switch.
--
-- ON DELETE SET NULL on archived_by_id, matching custom_trial_limit_set_by_id
-- and every other "who did this" column here: an archived project must survive
-- the admin account that archived it being removed. It keeps the reason and the
-- timestamp; only the name goes.
--
-- WHY AN INDEX ON archived_at: every live surface (dashboard, calendar, /me,
-- management reports, KPI extraction) now filters `archived_at IS NULL`, and the
-- admin list filters `archived_at IS NOT NULL`. Both are the same one-column
-- predicate on the table's hottest read path.
--
-- NOTE ON THE CODE RENAME: project_code is the only UNIQUE-constrained code on
-- this table (mold_code and client_project_ref are indexed but NOT unique), and
-- it doubles as the internal tracking id (MP-TRK-<date>-<suffix>). Archiving
-- renames it to `<original>-ARCHIVED-<n>` in the same transaction so the real
-- code is free for the corrected re-entry; the original is recorded in the
-- ActivityLog before/after payload. That is application logic
-- (src/domain/mold-trial/project-archive.ts), not a constraint change — the
-- UNIQUE index is exactly what makes the scheme safe, so it stays as it is.
--
-- 2) CLIENT NOTES LEDGER (project_notes).
--
-- The strikethrough sketch: a project page section where Marketing/PM write what
-- the client said, and superseding a line STRIKES IT THROUGH instead of
-- rewriting it. Append-only by construction — there is no UPDATE path to `body`
-- anywhere in the application; "retire" only stamps retired_at/retired_by_id.
-- The visible history is the feature.
--
-- retired_at is nullable (live line) and never cleared: un-retiring is not a
-- workflow, a mistake is retired and re-added, and both lines stay visible.
-- ON DELETE CASCADE from the project (like mold_trial_parts) because a note has
-- no meaning without its project; ON DELETE SET NULL for the retirer, and a
-- plain restrict for the author because created_by_id is NOT NULL.
--
-- Index on project_id only: the section always reads "every note of ONE project,
-- oldest first", and ordering is done in memory over a handful of rows.

-- AlterTable
ALTER TABLE "mold_trial_projects" ADD COLUMN "archived_at" TIMESTAMP(3);
ALTER TABLE "mold_trial_projects" ADD COLUMN "archived_by_id" UUID;
ALTER TABLE "mold_trial_projects" ADD COLUMN "archive_reason" TEXT;

-- CreateIndex
CREATE INDEX "mold_trial_projects_archived_at_idx" ON "mold_trial_projects"("archived_at");

-- AddForeignKey
ALTER TABLE "mold_trial_projects" ADD CONSTRAINT "mold_trial_projects_archived_by_id_fkey" FOREIGN KEY ("archived_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "project_notes" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "body" TEXT NOT NULL,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "retired_at" TIMESTAMP(3),
    "retired_by_id" UUID,

    CONSTRAINT "project_notes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "project_notes_project_id_idx" ON "project_notes"("project_id");

-- AddForeignKey
ALTER TABLE "project_notes" ADD CONSTRAINT "project_notes_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "mold_trial_projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_notes" ADD CONSTRAINT "project_notes_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_notes" ADD CONSTRAINT "project_notes_retired_by_id_fkey" FOREIGN KEY ("retired_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
