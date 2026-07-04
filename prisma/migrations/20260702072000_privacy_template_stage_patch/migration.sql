-- Client country is out of scope for Phase 1 privacy. Remove it from the
-- Customer Master table instead of leaving it selectable/searchable.
ALTER TABLE "customers" DROP COLUMN IF EXISTS "country";

-- Existing projects created before Digital Process Sheet template snapshotting
-- should receive the global default template when it already exists.
UPDATE "mold_trial_projects" AS project
SET
  "process_sheet_template_id" = template."id",
  "process_sheet_template_code" = template."code"
FROM "process_sheet_templates" AS template
WHERE
  template."code" = 'default_process_setup'
  AND project."process_sheet_template_id" IS NULL;

UPDATE "mold_trial_projects" AS project
SET "process_sheet_template_code" = template."code"
FROM "process_sheet_templates" AS template
WHERE
  project."process_sheet_template_id" = template."id"
  AND project."process_sheet_template_code" IS NULL;
