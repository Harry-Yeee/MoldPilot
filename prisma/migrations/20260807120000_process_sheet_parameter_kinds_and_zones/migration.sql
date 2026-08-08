-- The Digital Process Sheet learns the shapes the factory's paper sheet uses.
--
-- Until now every template row was one label and one value per trial. The
-- owner's paper sheet has three more shapes, and none of them fit:
--
--   ZONED   炮筒温度 / 射胶压力 … carry one value PER MACHINE ZONE (一区…七区).
--           On paper this is a small table drawn INSIDE the big table.
--   CHOICE  操作 is exactly one of 手动 / 半自动 / 全自动.
--   FLAGS   入水 and 运水 are any number of a fixed list.
--
-- So `kind` carries the shape, `zone_count` how many zones a zoned row has
-- (7 on this factory's machines), `options` the fixed list for CHOICE/FLAGS,
-- and `trial_process_values.zone_index` which zone a stored value belongs to.
--
-- BACKFILL IS THE DEFAULT. `kind` is NOT NULL DEFAULT 'SCALAR', so every row
-- that already exists — the whole seeded default template and every customer
-- template — reads exactly as it does today with no UPDATE statement at all.
-- `options` is NOT NULL DEFAULT '{}' for the same reason (the same choice the
-- 2026-07-30 `insert_types` column made); `zone_count` is nullable because
-- "not zoned" is genuinely the absence of a zone count, and the domain reader
-- (`parseProcessSheetZoneCount`) is what turns a zoned row's missing count into
-- the house default of 7.
--
-- `kind` is TEXT, not a Postgres enum, deliberately: the same reasoning as
-- `insert_types`. The allowlist lives in
-- src/domain/mold-trial/process-sheet-catalog.ts (`parseProcessSheetParameterKind`,
-- which reads anything unknown as SCALAR), so a fifth shape is a code change,
-- not a migration plus a client regeneration.
--
-- THE UNIQUE CONSTRAINT — the decision this migration turns on.
--
-- `trial_process_values` was UNIQUE (trial_event_id, process_sheet_parameter_id):
-- one stored value per trial per template row. A zoned row needs N of them, so
-- zone_index has to join that key. Postgres treats NULLs as DISTINCT inside a
-- unique index, so a NULLABLE zone_index would let (trial, parameter, NULL) be
-- inserted twice with no error — the constraint would silently stop protecting
-- exactly the rows it protects today (every pre-existing scalar value).
--
-- The alternative, two PARTIAL unique indexes (… WHERE zone_index IS NULL and
-- … WHERE zone_index IS NOT NULL), closes the hole but Prisma cannot express a
-- partial unique index, so the model would lose its `@@unique` — and with it the
-- compound `where` key that the process-sheet save has always used
-- (`trialEventId_processSheetParameterId`). The save would have to become
-- find-then-create-or-update, which is a race under concurrent saves of the same
-- trial column. Losing an upsert to keep a NULL is a bad trade.
--
-- So: NOT NULL DEFAULT 0, a SENTINEL. Zones number from 1, so 0 can never
-- collide with a real zone; every existing row backfills by the default; the
-- constraint stays a plain UNIQUE index Prisma can express and upsert against.
--
-- The index keeps its name: Prisma clips a generated index name to 63 chars by
-- cutting the base and keeping the `_key` suffix (see the 20260702071024 rename
-- migration), and both the two-column and the three-column names clip to the
-- same string. Dropping and recreating under that name is exactly what
-- `prisma migrate dev` would emit, so the schema and the database do not drift.

-- AlterTable
ALTER TABLE "process_sheet_parameters" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'SCALAR';
ALTER TABLE "process_sheet_parameters" ADD COLUMN "zone_count" INTEGER;
ALTER TABLE "process_sheet_parameters" ADD COLUMN "options" TEXT[] NOT NULL DEFAULT '{}';

-- AlterTable
ALTER TABLE "trial_process_values" ADD COLUMN "zone_index" INTEGER NOT NULL DEFAULT 0;

-- DropIndex
DROP INDEX "trial_process_values_trial_event_id_process_sheet_parameter_key";

-- CreateIndex
CREATE UNIQUE INDEX "trial_process_values_trial_event_id_process_sheet_parameter_key"
    ON "trial_process_values"("trial_event_id", "process_sheet_parameter_id", "zone_index");
