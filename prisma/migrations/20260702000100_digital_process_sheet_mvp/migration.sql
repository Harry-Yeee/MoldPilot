CREATE TYPE "ProcessValueType" AS ENUM ('TEXT', 'NUMBER', 'DATE', 'BOOLEAN');

ALTER TYPE "AttachmentEntityType" ADD VALUE IF NOT EXISTS 'PROCESS_SHEET_EXPORT';

ALTER TYPE "FileType" ADD VALUE IF NOT EXISTS 'PROCESS_SHEET_PDF';
ALTER TYPE "FileType" ADD VALUE IF NOT EXISTS 'CUSTOMER_REPORT_PDF';

CREATE TABLE "injection_machines" (
    "id" UUID NOT NULL,
    "machine_no" TEXT NOT NULL,
    "display_name" TEXT,
    "model" TEXT,
    "brand" TEXT,
    "tonnage" INTEGER,
    "shot_capacity_g" DECIMAL(10,2),
    "nozzle_orifice_mm" DECIMAL(10,2),
    "notes" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "injection_machines_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "process_sheet_templates" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "customer_id" UUID,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "process_sheet_templates_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "process_sheet_parameters" (
    "id" UUID NOT NULL,
    "process_sheet_template_id" UUID NOT NULL,
    "section" TEXT NOT NULL,
    "parameter_key" TEXT NOT NULL,
    "label_en" TEXT NOT NULL,
    "label_zh" TEXT,
    "unit" TEXT,
    "value_type" "ProcessValueType" NOT NULL DEFAULT 'TEXT',
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "customer_visible" BOOLEAN NOT NULL DEFAULT true,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "process_sheet_parameters_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "trial_process_values" (
    "id" UUID NOT NULL,
    "mold_trial_project_id" UUID NOT NULL,
    "trial_event_id" UUID NOT NULL,
    "process_sheet_parameter_id" UUID NOT NULL,
    "parameter_key_snapshot" TEXT NOT NULL,
    "label_en_snapshot" TEXT NOT NULL,
    "label_zh_snapshot" TEXT,
    "unit_snapshot" TEXT,
    "value_text" TEXT,
    "value_number" DECIMAL(14,4),
    "value_date" DATE,
    "customer_visible" BOOLEAN NOT NULL DEFAULT true,
    "entered_by_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "trial_process_values_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "customers"
    ADD COLUMN "default_process_sheet_template_id" UUID;

ALTER TABLE "mold_trial_projects"
    ADD COLUMN "process_sheet_template_id" UUID,
    ADD COLUMN "process_sheet_template_code" TEXT;

ALTER TABLE "trial_events"
    ADD COLUMN "injection_machine_id" UUID,
    ADD COLUMN "machine_no_snapshot" TEXT,
    ADD COLUMN "machine_tonnage_snapshot" TEXT;

ALTER TABLE "trial_issues"
    ADD COLUMN "assembly_self_checked_at" TIMESTAMP(3),
    ADD COLUMN "assembly_self_checked_by_id" UUID,
    ADD COLUMN "assembly_self_check_note" TEXT;

CREATE UNIQUE INDEX "injection_machines_machine_no_key" ON "injection_machines"("machine_no");
CREATE INDEX "injection_machines_active_idx" ON "injection_machines"("active");
CREATE INDEX "injection_machines_tonnage_idx" ON "injection_machines"("tonnage");

CREATE UNIQUE INDEX "process_sheet_templates_code_key" ON "process_sheet_templates"("code");
CREATE INDEX "process_sheet_templates_active_idx" ON "process_sheet_templates"("active");
CREATE INDEX "process_sheet_templates_customer_id_idx" ON "process_sheet_templates"("customer_id");

CREATE UNIQUE INDEX "process_sheet_parameters_process_sheet_template_id_parameter_key_key"
    ON "process_sheet_parameters"("process_sheet_template_id", "parameter_key");
CREATE INDEX "process_sheet_parameters_process_sheet_template_id_active_sort_order_idx"
    ON "process_sheet_parameters"("process_sheet_template_id", "active", "sort_order");

CREATE UNIQUE INDEX "trial_process_values_trial_event_id_process_sheet_parameter_id_key"
    ON "trial_process_values"("trial_event_id", "process_sheet_parameter_id");
CREATE INDEX "trial_process_values_mold_trial_project_id_idx" ON "trial_process_values"("mold_trial_project_id");
CREATE INDEX "trial_process_values_process_sheet_parameter_id_idx" ON "trial_process_values"("process_sheet_parameter_id");

CREATE INDEX "customers_default_process_sheet_template_id_idx" ON "customers"("default_process_sheet_template_id");
CREATE INDEX "mold_trial_projects_process_sheet_template_id_idx" ON "mold_trial_projects"("process_sheet_template_id");
CREATE INDEX "trial_events_injection_machine_id_idx" ON "trial_events"("injection_machine_id");
CREATE INDEX "trial_issues_assembly_self_checked_by_id_idx" ON "trial_issues"("assembly_self_checked_by_id");

ALTER TABLE "process_sheet_templates"
    ADD CONSTRAINT "process_sheet_templates_customer_id_fkey"
    FOREIGN KEY ("customer_id") REFERENCES "customers"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "process_sheet_parameters"
    ADD CONSTRAINT "process_sheet_parameters_process_sheet_template_id_fkey"
    FOREIGN KEY ("process_sheet_template_id") REFERENCES "process_sheet_templates"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "customers"
    ADD CONSTRAINT "customers_default_process_sheet_template_id_fkey"
    FOREIGN KEY ("default_process_sheet_template_id") REFERENCES "process_sheet_templates"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "mold_trial_projects"
    ADD CONSTRAINT "mold_trial_projects_process_sheet_template_id_fkey"
    FOREIGN KEY ("process_sheet_template_id") REFERENCES "process_sheet_templates"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "trial_events"
    ADD CONSTRAINT "trial_events_injection_machine_id_fkey"
    FOREIGN KEY ("injection_machine_id") REFERENCES "injection_machines"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "trial_issues"
    ADD CONSTRAINT "trial_issues_assembly_self_checked_by_id_fkey"
    FOREIGN KEY ("assembly_self_checked_by_id") REFERENCES "users"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "trial_process_values"
    ADD CONSTRAINT "trial_process_values_mold_trial_project_id_fkey"
    FOREIGN KEY ("mold_trial_project_id") REFERENCES "mold_trial_projects"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "trial_process_values"
    ADD CONSTRAINT "trial_process_values_trial_event_id_fkey"
    FOREIGN KEY ("trial_event_id") REFERENCES "trial_events"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "trial_process_values"
    ADD CONSTRAINT "trial_process_values_process_sheet_parameter_id_fkey"
    FOREIGN KEY ("process_sheet_parameter_id") REFERENCES "process_sheet_parameters"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "trial_process_values"
    ADD CONSTRAINT "trial_process_values_entered_by_id_fkey"
    FOREIGN KEY ("entered_by_id") REFERENCES "users"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
