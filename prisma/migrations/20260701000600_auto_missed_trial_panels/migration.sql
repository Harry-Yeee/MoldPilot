ALTER TYPE "TrialStatus" ADD VALUE IF NOT EXISTS 'AUTO_MISSED_REASON_REQUIRED';

CREATE TYPE "AutoMissedResolution" AS ENUM (
    'MISSED_CONFIRMED',
    'LATE_COMPLETED_TRIAL_ENTERED',
    'BLOCKED',
    'PAUSED',
    'ADMIN_CORRECTION'
);

ALTER TABLE "trial_events"
    ADD COLUMN "auto_missed_at" TIMESTAMP(3),
    ADD COLUMN "auto_missed_resolved_at" TIMESTAMP(3),
    ADD COLUMN "auto_missed_resolved_by_id" UUID,
    ADD COLUMN "auto_missed_resolution" "AutoMissedResolution";

CREATE INDEX "trial_events_auto_missed_resolved_by_id_idx" ON "trial_events"("auto_missed_resolved_by_id");

ALTER TABLE "trial_events"
    ADD CONSTRAINT "trial_events_auto_missed_resolved_by_id_fkey"
    FOREIGN KEY ("auto_missed_resolved_by_id") REFERENCES "users"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
