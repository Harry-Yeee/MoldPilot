ALTER TABLE "trial_issues"
  ADD COLUMN "fix_summary" TEXT,
  ADD COLUMN "fix_time_minutes" INTEGER,
  ADD COLUMN "closed_by_id" UUID,
  ADD COLUMN "non_owner_close_reason" TEXT;

CREATE INDEX "trial_issues_closed_by_id_idx" ON "trial_issues"("closed_by_id");

ALTER TABLE "trial_issues"
  ADD CONSTRAINT "trial_issues_closed_by_id_fkey"
  FOREIGN KEY ("closed_by_id") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
