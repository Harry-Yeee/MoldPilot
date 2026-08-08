-- Data migration: 连续六啤产品重量 becomes ONE zoned row of six shots.
--
-- WHY, in the owner's terms: 连续六啤 is one measurement taken six times in a
-- row, and what it is FOR is the drift between the six. The template stored it
-- as six separate rows — `shot_weight_1` … `shot_weight_6`, each with its own
-- 第一啤/第二啤 label — so the sheet showed six stacked lines and the setter had
-- to read down a column to see a trend that the paper sheet shows across one
-- line. ZONED is the shape the sheet already has for "one line, N boxes"
-- (炮筒温度, 热流道温度), so this is a re-SHAPING, not a new mechanism.
--
-- The captions are the one thing that differs from every other zoned row: these
-- columns are shots, not machine zones, so they read 第1啤…第6啤 instead of
-- 一区…六区. That is derived in code from the parameter key
-- (`processSheetZoneCaptionKind`) and needs NO column here — this file changes
-- data only, exactly like 20260808120000.
--
-- MECHANICS: identical to the hot-runner block of 20260808120000, deliberately.
-- That migration is the precedent this one follows statement for statement:
--
--   * PRODUCTION-SAFE: production never runs `prisma db seed`, so template data
--     ships as SQL. Every statement is idempotent and no statement can destroy
--     a stored value.
--   * Values MOVE (an UPDATE that re-points `process_sheet_parameter_id` and
--     sets `zone_index`), never insert+delete — that is what preserves the trial
--     linkage, the operator who entered the value and its created_at. The row is
--     the same fact, now addressed as a shot.
--   * The DELETE carries a "zero TrialProcessValue rows" guard, so a legacy row
--     that still holds a value is LEFT IN PLACE and shows up on the sheet, which
--     is the visible signal that it needs a human. (The FK is ON DELETE
--     RESTRICT, so an unguarded delete would abort the run.)
--
-- No ALTER TABLE: `kind`, `zone_count`, `options` and `zone_index` all arrived
-- with 20260807120000.

-- ---------------------------------------------------------------------------
-- 1. 连续六啤产品重量 — one ZONED row per template, six zones.
--
-- Six, not the house seven and not the twelve the hot runner took: the paper
-- line has exactly six boxes because "连续六啤" IS the measurement. A seventh
-- box would invite a seventh shot that the sheet has no meaning for.
--
-- sort_order is taken from the legacy six so the new row lands in the SAME place
-- on the sheet — the sheet renders in sort_order and bands consecutive rows that
-- share a section, so the row appears inside the existing 连续六啤产品重量 band
-- and is the only row left in it once step 3 retires the six. A template that
-- never had the rows gets 998, immediately before the hot-runner fallback (999)
-- and the catalog block (1000+).
-- ---------------------------------------------------------------------------

INSERT INTO "process_sheet_parameters" (
  "id",
  "process_sheet_template_id",
  "section",
  "parameter_key",
  "label_en",
  "label_zh",
  "unit",
  "value_type",
  "kind",
  "zone_count",
  "options",
  "sort_order",
  "customer_visible",
  "active",
  "created_at",
  "updated_at"
)
SELECT
  gen_random_uuid(),
  t."id",
  'Six Consecutive Shots Part Weight',
  'shot_part_weight',
  'Six-shot Part Weight',
  '连续六啤产品重量',
  'g',
  'NUMBER'::"ProcessValueType",
  'ZONED',
  6,
  '{}'::TEXT[],
  COALESCE(
    (
      SELECT MIN(legacy."sort_order")
      FROM "process_sheet_parameters" legacy
      WHERE legacy."process_sheet_template_id" = t."id"
        AND legacy."parameter_key" ~ '^shot_weight_[0-9]+$'
    ),
    998
  ),
  true,
  true,
  NOW(),
  NOW()
FROM "process_sheet_templates" t
WHERE NOT EXISTS (
  SELECT 1
  FROM "process_sheet_parameters" existing
  WHERE existing."process_sheet_template_id" = t."id"
    AND existing."parameter_key" = 'shot_part_weight'
)
ON CONFLICT ("process_sheet_template_id", "parameter_key") DO NOTHING;

-- And upgrade one that already exists in the wrong shape (a re-run against a
-- half-applied database, or a row added by hand before this migration).
UPDATE "process_sheet_parameters"
SET
  "kind" = 'ZONED',
  "zone_count" = 6,
  "options" = '{}'::TEXT[],
  "value_type" = 'NUMBER'::"ProcessValueType",
  "unit" = 'g',
  "label_en" = 'Six-shot Part Weight',
  "label_zh" = '连续六啤产品重量',
  "section" = 'Six Consecutive Shots Part Weight',
  "active" = true,
  "updated_at" = NOW()
WHERE "parameter_key" = 'shot_part_weight'
  AND (
    "kind" IS DISTINCT FROM 'ZONED'
    OR "zone_count" IS DISTINCT FROM 6
    OR "value_type" IS DISTINCT FROM 'NUMBER'::"ProcessValueType"
    OR "section" IS DISTINCT FROM 'Six Consecutive Shots Part Weight'
    OR "active" IS DISTINCT FROM true
  );

-- ---------------------------------------------------------------------------
-- 2. MOVE the stored values: `shot_weight_<N>` becomes zone N.
--
-- The snapshots are rewritten because they describe the row the value belongs
-- to, and it is a different row now; `value_number` / `value_text` are never
-- touched, so the number the setter weighed is the number that survives.
--
-- The NOT EXISTS guard is what makes the move re-runnable: if the target cell
-- (trial, ZONED row, shot N) already holds a value — a second run, or the
-- operator having already filled the new row — the legacy value stays where it
-- is, which also keeps its parameter out of step 3's retirement.
-- ---------------------------------------------------------------------------

UPDATE "trial_process_values" v
SET
  "process_sheet_parameter_id" = target."id",
  "zone_index" = legacy."zone_index",
  "parameter_key_snapshot" = target."parameter_key",
  "label_en_snapshot" = target."label_en",
  "label_zh_snapshot" = target."label_zh",
  "unit_snapshot" = target."unit",
  "updated_at" = NOW()
FROM (
  SELECT
    p."id",
    p."process_sheet_template_id",
    substring(p."parameter_key" from '^shot_weight_([0-9]+)$')::INTEGER AS "zone_index"
  FROM "process_sheet_parameters" p
  -- Bounded to 1…6 in the PATTERN, so the cast below can never see a number
  -- that does not fit — the same bound `legacyShotPartWeightZoneIndex` applies.
  WHERE p."parameter_key" ~ '^shot_weight_[1-6]$'
) legacy
JOIN "process_sheet_parameters" target
  ON target."process_sheet_template_id" = legacy."process_sheet_template_id"
 AND target."parameter_key" = 'shot_part_weight'
WHERE v."process_sheet_parameter_id" = legacy."id"
  -- Zone 0 is the non-zoned sentinel and 6 is the row's width: a value outside
  -- that range has nowhere to land, so it is left on its legacy row.
  AND legacy."zone_index" BETWEEN 1 AND 6
  AND NOT EXISTS (
    SELECT 1
    FROM "trial_process_values" existing
    WHERE existing."trial_event_id" = v."trial_event_id"
      AND existing."process_sheet_parameter_id" = target."id"
      AND existing."zone_index" = legacy."zone_index"
  );

-- ---------------------------------------------------------------------------
-- 3. RETIRE the legacy shot rows — only the ones fully migrated.
--
-- "Fully migrated" is exactly "holds no values any more". A row that still holds
-- one (a `shot_weight_7` somebody added, or a cell the ZONED row had already
-- filled) survives with its data intact and shows up on the sheet.
-- ---------------------------------------------------------------------------

DELETE FROM "process_sheet_parameters" p
WHERE p."parameter_key" ~ '^shot_weight_[0-9]+$'
  AND NOT EXISTS (
    SELECT 1
    FROM "trial_process_values" v
    WHERE v."process_sheet_parameter_id" = p."id"
  );
