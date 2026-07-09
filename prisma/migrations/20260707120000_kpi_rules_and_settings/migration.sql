-- KPI phase-1 data layer: an admin-editable rule registry and a small
-- key/value system-settings table. Rules feed the monthly habit scorecard;
-- deadlines are stored as literal HOURS (weekends count). Boolean rules
-- (self-check-before-trial, photo-on-defect, process-values) carry a NULL
-- `hours`. Every rule and setting change is logged via activity_logs by the
-- server actions; these tables only hold current state.

-- One row per measurable habit behavior. `code` is a stable identifier the
-- scoring engine keys on (e.g. "pm.missed_reason"); labels are bilingual.
-- `role_scope` names which leader's bar the rule feeds (e.g. "pm",
-- "injection", "assembly", "all"). Dormant rules (Design, active=false) are
-- registered now and shown grayed until the Design role ships.
CREATE TABLE "kpi_rules" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code" TEXT NOT NULL,
    "label_en" TEXT NOT NULL,
    "label_zh" TEXT NOT NULL,
    "hours" INTEGER,
    "role_scope" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "updated_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "kpi_rules_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "kpi_rules_code_key" ON "kpi_rules"("code");
CREATE INDEX "kpi_rules_role_scope_idx" ON "kpi_rules"("role_scope");

ALTER TABLE "kpi_rules"
    ADD CONSTRAINT "kpi_rules_updated_by_id_fkey"
    FOREIGN KEY ("updated_by_id") REFERENCES "users"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- Generic single-value settings. First key: "scoreboard_enabled" (default
-- "false") gates the staff-facing personal scoreboard during the quiet
-- data-gathering months. Values are plain strings; interpretation lives in
-- the app layer.
CREATE TABLE "system_settings" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updated_by_id" UUID,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "system_settings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "system_settings_key_key" ON "system_settings"("key");

ALTER TABLE "system_settings"
    ADD CONSTRAINT "system_settings_updated_by_id_fkey"
    FOREIGN KEY ("updated_by_id") REFERENCES "users"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
