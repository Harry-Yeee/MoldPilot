ALTER TYPE "MoldTrialProjectStatus" ADD VALUE IF NOT EXISTS 'INTAKE';

ALTER TABLE "mold_trial_projects"
  ALTER COLUMN "planning_pm_id" DROP NOT NULL,
  ALTER COLUMN "first_planned_trial_date" DROP NOT NULL,
  ADD COLUMN "intake_note" TEXT,
  ADD COLUMN "customer_target_date" DATE,
  ADD COLUMN "initial_customer_note" TEXT;

ALTER TABLE "trial_issues"
  ADD COLUMN "assembly_acknowledged_at" TIMESTAMP(3),
  ADD COLUMN "assembly_estimated_finish_date" DATE,
  ADD COLUMN "assembly_acknowledged_by_id" UUID,
  ADD COLUMN "pm_ready_confirmed_at" TIMESTAMP(3),
  ADD COLUMN "pm_ready_confirmed_by_id" UUID;

ALTER TABLE "trial_issues"
  ADD CONSTRAINT "trial_issues_assembly_acknowledged_by_id_fkey"
    FOREIGN KEY ("assembly_acknowledged_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "trial_issues_pm_ready_confirmed_by_id_fkey"
    FOREIGN KEY ("pm_ready_confirmed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
