-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "Locale" AS ENUM ('EN_US', 'ZH_CN');

-- CreateEnum
CREATE TYPE "DepartmentGroupType" AS ENUM ('DEPARTMENT', 'GROUP', 'SHIFT');

-- CreateEnum
CREATE TYPE "MoldTrialProjectStatus" AS ENUM ('ACTIVE', 'WAITING_TRIAL', 'TRIAL_DELAYED', 'IN_CORRECTION', 'WAITING_VERIFICATION', 'APPROVED', 'OVER_LIMIT', 'BLOCKED', 'PAUSED', 'CANCELLED', 'CLOSED');

-- CreateEnum
CREATE TYPE "Priority" AS ENUM ('NORMAL', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "TrialCode" AS ENUM ('T0', 'T1', 'T2', 'EXTRA', 'OTHER');

-- CreateEnum
CREATE TYPE "TrialStatus" AS ENUM ('PLANNED', 'AT_RISK', 'DELAYED', 'COMPLETED', 'PENDING_FOLLOW_UP', 'ABORTED', 'CANCELLED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "TrialResult" AS ENUM ('APPROVED', 'NOT_APPROVED', 'CONDITIONAL', 'PENDING_QC');

-- CreateEnum
CREATE TYPE "TrialOutcomeDisposition" AS ENUM ('APPROVED_COMPLETE', 'APPROVED_WITH_MINOR_ITEMS', 'REWORK_REQUIRED', 'PENDING_QC', 'PENDING_CUSTOMER_FEEDBACK', 'ABORTED_INVALID_TRIAL');

-- CreateEnum
CREATE TYPE "NewTrialReasonCategory" AS ENUM ('PLANNED_NEXT_TRIAL_AFTER_CORRECTION', 'CUSTOMER_DESIGN_CHANGE', 'BAD_CUSTOMER_FEEDBACK', 'CUSTOMER_SAMPLE_REJECTION', 'CUSTOMER_REQUIREMENT_CLARIFICATION', 'INTERNAL_REWORK', 'TRIAL_ISSUE_VERIFICATION', 'QC_FAILURE', 'MOLD_CORRECTION_VERIFICATION', 'INJECTION_PROCESS_RETEST', 'ABORTED_OR_INVALID_PREVIOUS_TRIAL', 'OTHER');

-- CreateEnum
CREATE TYPE "SourceArea" AS ENUM ('PLANNING', 'TECHNICAL', 'MARKETING', 'INJECTION', 'QC', 'CUSTOMER', 'SUPPLIER', 'OTHER');

-- CreateEnum
CREATE TYPE "ResponsibleArea" AS ENUM ('TECHNICAL', 'MACHINING', 'ASSEMBLY', 'INJECTION', 'QC', 'PURCHASING', 'CUSTOMER', 'SUPPLIER', 'PLANNING', 'OTHER');

-- CreateEnum
CREATE TYPE "MissedTrialReasonCategory" AS ENUM ('DESIGN_NOT_READY', 'DESIGN_CHANGE_PENDING', 'STEEL_OR_COMPONENT_NOT_READY', 'CNC_NOT_COMPLETE', 'EDM_NOT_COMPLETE', 'FITTING_NOT_COMPLETE', 'MOLD_CORRECTION_NOT_COMPLETE', 'INJECTION_MACHINE_NOT_AVAILABLE', 'MATERIAL_NOT_AVAILABLE', 'QC_PLAN_NOT_READY', 'CUSTOMER_REQUIREMENT_CHANGE', 'SUPPLIER_OR_OUTSOURCING_DELAY', 'INTERNAL_DECISION_PENDING', 'OTHER');

-- CreateEnum
CREATE TYPE "TrialIssueType" AS ENUM ('DESIGN_CHANGE', 'BAD_CUSTOMER_FEEDBACK', 'CUSTOMER_SAMPLE_REJECTION', 'DFM_PART_DESIGN_ISSUE', 'MOLD_DESIGN_ISSUE', 'MACHINING_ISSUE', 'ASSEMBLY_FITTING_ISSUE', 'INJECTION_PROCESS_ISSUE', 'MATERIAL_ISSUE', 'QC_DIMENSION_ISSUE', 'APPEARANCE_ISSUE', 'SUPPLIER_OUTSOURCING_ISSUE', 'CUSTOMER_REQUIREMENT_CHANGE', 'ABORTED_INVALID_TRIAL', 'OTHER');

-- CreateEnum
CREATE TYPE "TrialIssueSource" AS ENUM ('INTERNAL_TRIAL', 'PM_REVIEW', 'TECHNICAL_REVIEW', 'QC_INSPECTION', 'INJECTION_PROCESS', 'MARKETING_CLIENT_FEEDBACK', 'CUSTOMER_DESIGN_CHANGE', 'OTHER');

-- CreateEnum
CREATE TYPE "Severity" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "TrialIssueStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'WAITING_INTERNAL', 'WAITING_CUSTOMER', 'WAITING_SUPPLIER', 'WAITING_VERIFICATION', 'VERIFIED', 'CLOSED');

-- CreateEnum
CREATE TYPE "ChangeRequester" AS ENUM ('CUSTOMER', 'INTERNAL', 'MARKETING', 'SUPPLIER', 'OTHER');

-- CreateEnum
CREATE TYPE "LimitAdjustmentType" AS ENUM ('DESIGN_CHANGE_EXTRA_TRIAL', 'PM_CUSTOM_LIMIT', 'ADMIN_CORRECTION');

-- CreateEnum
CREATE TYPE "AttachmentEntityType" AS ENUM ('MOLD_TRIAL_PROJECT', 'TRIAL_EVENT', 'TRIAL_ISSUE', 'DESIGN_CHANGE_EVENT', 'MISSED_TRIAL_EVENT');

-- CreateEnum
CREATE TYPE "FileType" AS ENUM ('TRIAL_PHOTO', 'QC_REPORT', 'DESIGN_CHANGE', 'DRAWING', 'VIDEO', 'OTHER');

-- CreateEnum
CREATE TYPE "FileVisibility" AS ENUM ('INTERNAL', 'TECHNICAL', 'RESTRICTED');

-- CreateEnum
CREATE TYPE "KpiScopeType" AS ENUM ('COMPANY', 'DEPARTMENT_GROUP', 'MOLD_TRIAL_PROJECT', 'USER');

-- CreateTable
CREATE TABLE "roles" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "department_groups" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "group_type" "DepartmentGroupType" NOT NULL DEFAULT 'DEPARTMENT',
    "parent_group_id" UUID,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "department_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "username" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "email" TEXT,
    "role_id" UUID NOT NULL,
    "department_group_id" UUID,
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "locale" "Locale" NOT NULL DEFAULT 'EN_US',
    "is_default_admin" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mold_trial_projects" (
    "id" UUID NOT NULL,
    "project_code" TEXT NOT NULL,
    "customer_code" TEXT NOT NULL,
    "part_code" TEXT NOT NULL,
    "mold_code" TEXT NOT NULL,
    "planning_pm_id" UUID NOT NULL,
    "technical_pm_id" UUID,
    "status" "MoldTrialProjectStatus" NOT NULL DEFAULT 'ACTIVE',
    "priority" "Priority" NOT NULL DEFAULT 'NORMAL',
    "first_planned_trial_date" DATE NOT NULL,
    "next_planned_trial_date" DATE,
    "base_trial_limit" INTEGER NOT NULL DEFAULT 3,
    "current_trial_limit" INTEGER NOT NULL DEFAULT 3,
    "custom_trial_limit" INTEGER,
    "custom_trial_limit_reason" TEXT,
    "custom_trial_limit_set_by_id" UUID,
    "custom_trial_limit_set_at" TIMESTAMP(3),
    "final_trial_count" INTEGER,
    "close_reason" TEXT,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mold_trial_projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trial_events" (
    "id" UUID NOT NULL,
    "mold_trial_project_id" UUID NOT NULL,
    "trial_code" "TrialCode" NOT NULL,
    "sequence_number" INTEGER NOT NULL,
    "planned_date" DATE NOT NULL,
    "actual_date" DATE,
    "status" "TrialStatus" NOT NULL DEFAULT 'PLANNED',
    "machine" TEXT,
    "material" TEXT,
    "mold_status" TEXT,
    "sample_quantity" INTEGER,
    "result" "TrialResult",
    "outcome_disposition" "TrialOutcomeDisposition",
    "outcome_note" TEXT,
    "follow_up_owner_id" UUID,
    "follow_up_due_date" DATE,
    "main_issues_summary" TEXT,
    "next_action" TEXT,
    "next_planned_trial_date" DATE,
    "plan_reason_category" "NewTrialReasonCategory",
    "plan_reason_detail" TEXT,
    "source_area" "SourceArea",
    "requested_by_id" UUID,
    "related_trial_event_id" UUID,
    "related_trial_issue_id" UUID,
    "related_design_change_event_id" UUID,
    "counts_against_limit" BOOLEAN NOT NULL DEFAULT false,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "trial_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "missed_trial_events" (
    "id" UUID NOT NULL,
    "mold_trial_project_id" UUID NOT NULL,
    "trial_event_id" UUID,
    "planned_date" DATE NOT NULL,
    "new_planned_date" DATE,
    "reason_category" "MissedTrialReasonCategory" NOT NULL,
    "responsible_area" "ResponsibleArea" NOT NULL,
    "explanation" TEXT NOT NULL,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "missed_trial_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trial_issues" (
    "id" UUID NOT NULL,
    "mold_trial_project_id" UUID NOT NULL,
    "found_at_trial_event_id" UUID,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "issue_type" "TrialIssueType" NOT NULL,
    "source" "TrialIssueSource" NOT NULL,
    "source_detail" TEXT,
    "severity" "Severity" NOT NULL,
    "status" "TrialIssueStatus" NOT NULL DEFAULT 'OPEN',
    "owner_user_id" UUID,
    "owner_group_id" UUID,
    "due_date" DATE,
    "root_cause" TEXT,
    "corrective_action" TEXT,
    "verification_method" TEXT,
    "verified_at_trial_event_id" UUID,
    "verification_result" TEXT,
    "closed_at" TIMESTAMP(3),
    "created_by_id" UUID NOT NULL,
    "reported_by_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "trial_issues_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "design_change_events" (
    "id" UUID NOT NULL,
    "mold_trial_project_id" UUID NOT NULL,
    "change_date" DATE NOT NULL,
    "requested_by" "ChangeRequester" NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "first_completed_trial_already_done" BOOLEAN NOT NULL,
    "grants_extra_trial" BOOLEAN NOT NULL DEFAULT false,
    "extra_trial_count" INTEGER,
    "approved_by_id" UUID,
    "approval_reason" TEXT,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "design_change_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trial_limit_adjustments" (
    "id" UUID NOT NULL,
    "mold_trial_project_id" UUID NOT NULL,
    "adjustment_type" "LimitAdjustmentType" NOT NULL,
    "delta_trials" INTEGER,
    "new_limit" INTEGER,
    "reason" TEXT NOT NULL,
    "related_design_change_event_id" UUID,
    "set_by_id" UUID NOT NULL,
    "approved_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "trial_limit_adjustments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "file_attachments" (
    "id" UUID NOT NULL,
    "mold_trial_project_id" UUID NOT NULL,
    "entity_type" "AttachmentEntityType" NOT NULL,
    "entity_id" UUID NOT NULL,
    "file_name" TEXT NOT NULL,
    "file_type" "FileType" NOT NULL,
    "storage_key" TEXT NOT NULL,
    "visibility" "FileVisibility" NOT NULL DEFAULT 'INTERNAL',
    "uploaded_by_id" UUID NOT NULL,
    "uploaded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "file_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "activity_logs" (
    "id" UUID NOT NULL,
    "actor_user_id" UUID NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" UUID NOT NULL,
    "action" TEXT NOT NULL,
    "before_json" JSONB,
    "after_json" JSONB,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "activity_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kpi_snapshots" (
    "id" UUID NOT NULL,
    "snapshot_date" DATE NOT NULL,
    "scope_type" "KpiScopeType" NOT NULL,
    "scope_id" UUID,
    "metrics_json" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "kpi_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "roles_code_key" ON "roles"("code");

-- CreateIndex
CREATE UNIQUE INDEX "department_groups_code_key" ON "department_groups"("code");

-- CreateIndex
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");

-- CreateIndex
CREATE UNIQUE INDEX "mold_trial_projects_project_code_key" ON "mold_trial_projects"("project_code");

-- CreateIndex
CREATE INDEX "mold_trial_projects_customer_code_idx" ON "mold_trial_projects"("customer_code");

-- CreateIndex
CREATE INDEX "mold_trial_projects_mold_code_idx" ON "mold_trial_projects"("mold_code");

-- CreateIndex
CREATE INDEX "mold_trial_projects_status_idx" ON "mold_trial_projects"("status");

-- CreateIndex
CREATE INDEX "trial_events_mold_trial_project_id_idx" ON "trial_events"("mold_trial_project_id");

-- CreateIndex
CREATE INDEX "trial_events_planned_date_idx" ON "trial_events"("planned_date");

-- CreateIndex
CREATE INDEX "trial_events_status_idx" ON "trial_events"("status");

-- CreateIndex
CREATE INDEX "missed_trial_events_planned_date_idx" ON "missed_trial_events"("planned_date");

-- CreateIndex
CREATE INDEX "trial_issues_status_idx" ON "trial_issues"("status");

-- CreateIndex
CREATE INDEX "trial_issues_severity_idx" ON "trial_issues"("severity");

-- CreateIndex
CREATE INDEX "activity_logs_entity_type_entity_id_idx" ON "activity_logs"("entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "kpi_snapshots_snapshot_date_idx" ON "kpi_snapshots"("snapshot_date");

-- AddForeignKey
ALTER TABLE "department_groups" ADD CONSTRAINT "department_groups_parent_group_id_fkey" FOREIGN KEY ("parent_group_id") REFERENCES "department_groups"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_department_group_id_fkey" FOREIGN KEY ("department_group_id") REFERENCES "department_groups"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mold_trial_projects" ADD CONSTRAINT "mold_trial_projects_planning_pm_id_fkey" FOREIGN KEY ("planning_pm_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mold_trial_projects" ADD CONSTRAINT "mold_trial_projects_technical_pm_id_fkey" FOREIGN KEY ("technical_pm_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mold_trial_projects" ADD CONSTRAINT "mold_trial_projects_custom_trial_limit_set_by_id_fkey" FOREIGN KEY ("custom_trial_limit_set_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mold_trial_projects" ADD CONSTRAINT "mold_trial_projects_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trial_events" ADD CONSTRAINT "trial_events_mold_trial_project_id_fkey" FOREIGN KEY ("mold_trial_project_id") REFERENCES "mold_trial_projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trial_events" ADD CONSTRAINT "trial_events_follow_up_owner_id_fkey" FOREIGN KEY ("follow_up_owner_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trial_events" ADD CONSTRAINT "trial_events_requested_by_id_fkey" FOREIGN KEY ("requested_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trial_events" ADD CONSTRAINT "trial_events_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "missed_trial_events" ADD CONSTRAINT "missed_trial_events_mold_trial_project_id_fkey" FOREIGN KEY ("mold_trial_project_id") REFERENCES "mold_trial_projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "missed_trial_events" ADD CONSTRAINT "missed_trial_events_trial_event_id_fkey" FOREIGN KEY ("trial_event_id") REFERENCES "trial_events"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "missed_trial_events" ADD CONSTRAINT "missed_trial_events_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trial_issues" ADD CONSTRAINT "trial_issues_mold_trial_project_id_fkey" FOREIGN KEY ("mold_trial_project_id") REFERENCES "mold_trial_projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trial_issues" ADD CONSTRAINT "trial_issues_found_at_trial_event_id_fkey" FOREIGN KEY ("found_at_trial_event_id") REFERENCES "trial_events"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trial_issues" ADD CONSTRAINT "trial_issues_verified_at_trial_event_id_fkey" FOREIGN KEY ("verified_at_trial_event_id") REFERENCES "trial_events"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trial_issues" ADD CONSTRAINT "trial_issues_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trial_issues" ADD CONSTRAINT "trial_issues_owner_group_id_fkey" FOREIGN KEY ("owner_group_id") REFERENCES "department_groups"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trial_issues" ADD CONSTRAINT "trial_issues_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trial_issues" ADD CONSTRAINT "trial_issues_reported_by_id_fkey" FOREIGN KEY ("reported_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "design_change_events" ADD CONSTRAINT "design_change_events_mold_trial_project_id_fkey" FOREIGN KEY ("mold_trial_project_id") REFERENCES "mold_trial_projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "design_change_events" ADD CONSTRAINT "design_change_events_approved_by_id_fkey" FOREIGN KEY ("approved_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "design_change_events" ADD CONSTRAINT "design_change_events_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trial_limit_adjustments" ADD CONSTRAINT "trial_limit_adjustments_mold_trial_project_id_fkey" FOREIGN KEY ("mold_trial_project_id") REFERENCES "mold_trial_projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trial_limit_adjustments" ADD CONSTRAINT "trial_limit_adjustments_related_design_change_event_id_fkey" FOREIGN KEY ("related_design_change_event_id") REFERENCES "design_change_events"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trial_limit_adjustments" ADD CONSTRAINT "trial_limit_adjustments_set_by_id_fkey" FOREIGN KEY ("set_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trial_limit_adjustments" ADD CONSTRAINT "trial_limit_adjustments_approved_by_id_fkey" FOREIGN KEY ("approved_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "file_attachments" ADD CONSTRAINT "file_attachments_mold_trial_project_id_fkey" FOREIGN KEY ("mold_trial_project_id") REFERENCES "mold_trial_projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "file_attachments" ADD CONSTRAINT "file_attachments_uploaded_by_id_fkey" FOREIGN KEY ("uploaded_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity_logs" ADD CONSTRAINT "activity_logs_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
