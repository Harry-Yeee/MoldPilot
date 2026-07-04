-- CreateEnum
CREATE TYPE "IssueAffectedScope" AS ENUM ('MOLD', 'PART', 'MULTIPLE_PARTS');

-- CreateTable
CREATE TABLE "mold_trial_parts" (
    "id" UUID NOT NULL,
    "mold_trial_project_id" UUID NOT NULL,
    "part_code" TEXT NOT NULL,
    "part_name" TEXT,
    "cavity_label" TEXT,
    "cavity_count" INTEGER,
    "notes" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mold_trial_parts_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "trial_issues" ADD COLUMN "affected_scope" "IssueAffectedScope" NOT NULL DEFAULT 'MOLD',
ADD COLUMN "affected_part_id" UUID,
ADD COLUMN "affected_cavity_note" TEXT;

-- Backfill one primary part row for existing mold-level projects.
INSERT INTO "mold_trial_parts" (
    "id",
    "mold_trial_project_id",
    "part_code",
    "sort_order",
    "active",
    "created_at",
    "updated_at"
)
SELECT
    gen_random_uuid(),
    "id",
    "part_code",
    0,
    true,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM "mold_trial_projects"
WHERE "part_code" IS NOT NULL
  AND btrim("part_code") <> '';

-- CreateIndex
CREATE INDEX "mold_trial_parts_mold_trial_project_id_active_sort_order_idx" ON "mold_trial_parts"("mold_trial_project_id", "active", "sort_order");

-- Prevent duplicate active part/cavity rows while allowing archived historical rows.
CREATE UNIQUE INDEX "mold_trial_parts_active_part_cavity_unique" ON "mold_trial_parts"("mold_trial_project_id", "part_code", COALESCE("cavity_label", '')) WHERE "active" = true;

-- CreateIndex
CREATE INDEX "trial_issues_affected_part_id_idx" ON "trial_issues"("affected_part_id");

-- AddForeignKey
ALTER TABLE "mold_trial_parts" ADD CONSTRAINT "mold_trial_parts_mold_trial_project_id_fkey" FOREIGN KEY ("mold_trial_project_id") REFERENCES "mold_trial_projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trial_issues" ADD CONSTRAINT "trial_issues_affected_part_id_fkey" FOREIGN KEY ("affected_part_id") REFERENCES "mold_trial_parts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
