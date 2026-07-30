-- Insert types 嵌件类型 captured at project intake.
--
-- A mold that shoots over inserts (threaded nuts, magnets, metal terminals, an
-- IML label) needs different preparation before T0, so the list belongs on the
-- project record from intake onward instead of living in someone's memory.
--
-- Stored as a Postgres text[] rather than an enum or a child table: the
-- vocabulary is shop-floor terminology that keeps growing, a project carries a
-- handful of values at most, and nothing joins or filters on them. The
-- allowlist that keeps the column honest is
-- src/domain/mold-trial/insert-types.ts (`parseInsertTypes`), which is also the
-- single place a new insert type gets added — no migration required for that.
--
-- NOT NULL DEFAULT '{}' so every existing project reads as "no inserts" with no
-- backfill and no nullable-vs-empty ambiguity in the UI.

-- AlterTable
ALTER TABLE "mold_trial_projects" ADD COLUMN "insert_types" TEXT[] NOT NULL DEFAULT '{}';
