-- Trial date confirmation handshake: PM proposes a planned date, Injection
-- confirms it (with a machine) or counter-proposes, Marketing approves or
-- rejects a counter-proposal, and a rejection returns the trial to the PM.
-- The workflow never blocks reality (results stay recordable regardless), so
-- these columns are purely advisory and nullable apart from the status enum,
-- which every planned/at-risk trial carries.

-- Handshake state for a planned trial's date.
CREATE TYPE "TrialDateConfirmationStatus" AS ENUM (
    'PENDING_CONFIRMATION',
    'CONFIRMED',
    'RESCHEDULE_PROPOSED',
    'RETURNED_TO_PM'
);

-- Confirmation status defaults to PENDING_CONFIRMATION so every existing
-- planned/at-risk trial starts awaiting Injection. Proposal + decision columns
-- are nullable (no proposal in flight on backfill).
ALTER TABLE "trial_events"
    ADD COLUMN "date_confirmation_status" "TrialDateConfirmationStatus" NOT NULL DEFAULT 'PENDING_CONFIRMATION',
    ADD COLUMN "date_confirmed_by_id" UUID,
    ADD COLUMN "date_confirmed_at" TIMESTAMP(3),
    ADD COLUMN "proposed_date" DATE,
    ADD COLUMN "proposed_by_id" UUID,
    ADD COLUMN "proposed_reason" TEXT,
    ADD COLUMN "reschedule_decision_by_id" UUID,
    ADD COLUMN "reschedule_decision_at" TIMESTAMP(3),
    ADD COLUMN "reschedule_reject_reason" TEXT;

-- Backfill: history should not nag. Completed/terminal trials are recorded as
-- CONFIRMED; only trials still in play (PLANNED / AT_RISK / auto-missed) keep
-- the PENDING_CONFIRMATION default.
UPDATE "trial_events"
    SET "date_confirmation_status" = 'CONFIRMED'
    WHERE "status" IN ('COMPLETED', 'PENDING_FOLLOW_UP', 'ABORTED', 'CANCELLED', 'SKIPPED', 'DELAYED');

CREATE INDEX "trial_events_date_confirmation_status_idx" ON "trial_events"("date_confirmation_status");

ALTER TABLE "trial_events"
    ADD CONSTRAINT "trial_events_date_confirmed_by_id_fkey"
    FOREIGN KEY ("date_confirmed_by_id") REFERENCES "users"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "trial_events"
    ADD CONSTRAINT "trial_events_proposed_by_id_fkey"
    FOREIGN KEY ("proposed_by_id") REFERENCES "users"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "trial_events"
    ADD CONSTRAINT "trial_events_reschedule_decision_by_id_fkey"
    FOREIGN KEY ("reschedule_decision_by_id") REFERENCES "users"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
