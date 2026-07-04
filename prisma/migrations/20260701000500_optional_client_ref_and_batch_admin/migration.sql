ALTER TABLE "mold_trial_projects"
  ADD COLUMN "client_project_ref" TEXT;

UPDATE "mold_trial_projects"
SET "client_project_ref" = "project_code"
WHERE "client_project_ref" IS NULL;

CREATE INDEX "mold_trial_projects_client_project_ref_idx"
  ON "mold_trial_projects"("client_project_ref");
