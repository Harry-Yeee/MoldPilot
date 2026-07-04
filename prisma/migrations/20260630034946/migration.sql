-- DropForeignKey
ALTER TABLE "mold_trial_projects" DROP CONSTRAINT "mold_trial_projects_planning_pm_id_fkey";

-- AddForeignKey
ALTER TABLE "mold_trial_projects" ADD CONSTRAINT "mold_trial_projects_planning_pm_id_fkey" FOREIGN KEY ("planning_pm_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
