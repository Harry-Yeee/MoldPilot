-- Data migration: reconcile the template rows that EXISTED BEFORE parameter
-- kinds with the catalog that arrived with them.
--
-- ROOT CAUSE, and the lesson this migration exists to record: 20260807130000
-- only INSERTED. It was written as if every template were empty, so it guarded
-- with NOT EXISTS on (template, parameter_key) and touched nothing else. But the
-- templates were not empty — they had carried the factory's rows since
-- 20260702000100 — and two things went wrong on the owner's screen:
--
--   * 入水 / 运水 / 操作 already existed as free-text rows. The NOT EXISTS guard
--     therefore SKIPPED the catalog's FLAGS/FLAGS/CHOICE versions and left the
--     old text boxes in place: the checklists shipped, and nobody could see them.
--   * 热流道 was two fixed rows, `hot_runner_zone_1_temp` and
--     `hot_runner_zone_2_temp`. A mould has as many hot-runner tips as it has —
--     one, four, eight — so two rows are wrong for nearly every mould. The
--     catalog had no hot-runner row at all (it is not on the paper 工艺参数表),
--     so nothing replaced them.
--
-- A data migration must consider the rows a template ALREADY HAS, not only the
-- rows it lacks. This one therefore UPDATEs and DELETEs as well as INSERTs, and
-- every one of those is guarded.
--
-- PRODUCTION-SAFE, per the 20260807090000 precedent (production never runs
-- `prisma db seed`, so template data ships as SQL): every statement is
-- idempotent, and no statement can destroy a stored value.
--
--   * The UPDATEs re-state a row's shape and are no-ops on a second run.
--   * Every DELETE carries a "zero TrialProcessValue rows" guard, so a row that
--     still holds data is LEFT IN PLACE rather than removed. (The FK is ON
--     DELETE RESTRICT, so an unguarded delete would abort the migration; the
--     guard makes the intent explicit and keeps the run green.)
--   * IDs and parameter_keys of the upgraded rows are NOT changed, so every
--     existing trial_process_values row stays attached to its row and keeps
--     rendering. A free-text value that is not on the new option list stays
--     readable — the editor shows it and the next save normalises it
--     (`processSheetOptionValueView` / `isUnchangedLegacyProcessSheetOptionValue`).
--
-- No ALTER TABLE: `kind`, `zone_count`, `options` and `zone_index` all arrived
-- with 20260807120000. This file is data only.

-- ---------------------------------------------------------------------------
-- 1. 入水 / 运水 / 操作 — upgrade the pre-existing rows IN PLACE.
--
-- Matched three ways because the row may predate the catalog's key: the catalog
-- parameter_key, the 中文 label, or the English label. `section` and the labels
-- are deliberately NOT rewritten — the row is already where the operator expects
-- to find it, and moving a row to a different section band would re-cut the
-- sheet under them. `unit` is cleared because a checklist has no unit.
-- ---------------------------------------------------------------------------

UPDATE "process_sheet_parameters" p
SET
  "kind" = c."kind",
  "options" = c."options",
  "value_type" = 'TEXT'::"ProcessValueType",
  "unit" = NULL,
  "updated_at" = NOW()
FROM (VALUES
    ('gate_type', 'Gate Type', '入水', 'gate type', 'FLAGS', ARRAY['大', '细', '潜水', '热流道']::TEXT[]),
    ('cooling_circuit', 'Cooling Circuit', '运水', 'cooling circuit', 'FLAGS', ARRAY['热油', '热水', '冷水', '机水']::TEXT[]),
    ('operation_mode', 'Operation Mode', '操作', 'operation mode', 'CHOICE', ARRAY['手动', '半自动', '全自动']::TEXT[])
) AS c("parameter_key", "section", "label_zh", "label_en", "kind", "options")
WHERE (
    p."parameter_key" = c."parameter_key"
    OR btrim(p."label_zh") = c."label_zh"
    OR lower(btrim(p."label_en")) = c."label_en"
    -- The section too, because these three sections hold exactly ONE row each
    -- and no template that predates the catalog ever used those names for
    -- anything else — it is what catches a row that was keyed and labelled by
    -- hand ("入水方式", "gate") but filed under the right heading.
    OR btrim(p."section") = c."section"
  )
  -- Idempotence: a row already in the target shape is not written again.
  AND (
    p."kind" IS DISTINCT FROM c."kind"
    OR p."options" IS DISTINCT FROM c."options"
    OR p."value_type" IS DISTINCT FROM 'TEXT'::"ProcessValueType"
    OR p."unit" IS NOT NULL
  );

-- ---------------------------------------------------------------------------
-- 2. DEDUPE — only where a template ended up with BOTH twins.
--
-- That happens when the pre-existing row used a different parameter_key from the
-- catalog's, so 20260807130000's NOT EXISTS did not see it and inserted a second
-- row for the same concept. The row that keeps the data wins: the catalog insert
-- is removed ONLY when it holds no values at all. If both rows hold values,
-- NOTHING is deleted here — the sheet shows two rows and that is reported for a
-- human decision, because merging two columns of real trial data is not
-- something a migration may guess at.
-- ---------------------------------------------------------------------------

DELETE FROM "process_sheet_parameters" duplicate
USING (VALUES
    ('gate_type', 'Gate Type', '入水', 'gate type'),
    ('cooling_circuit', 'Cooling Circuit', '运水', 'cooling circuit'),
    ('operation_mode', 'Operation Mode', '操作', 'operation mode')
) AS c("parameter_key", "section", "label_zh", "label_en")
WHERE duplicate."parameter_key" = c."parameter_key"
  AND EXISTS (
    SELECT 1
    FROM "process_sheet_parameters" twin
    WHERE twin."process_sheet_template_id" = duplicate."process_sheet_template_id"
      AND twin."id" <> duplicate."id"
      AND twin."parameter_key" <> c."parameter_key"
      -- ACTIVE only: a retired twin is not a reason to remove the row that is
      -- actually on the sheet, or the concept would vanish from the template.
      AND twin."active"
      AND (
        btrim(twin."label_zh") = c."label_zh"
        OR lower(btrim(twin."label_en")) = c."label_en"
        OR btrim(twin."section") = c."section"
      )
  )
  AND NOT EXISTS (
    SELECT 1
    FROM "trial_process_values" v
    WHERE v."process_sheet_parameter_id" = duplicate."id"
  );

-- ---------------------------------------------------------------------------
-- 3a. 热流道温度 — one ZONED row per template, twelve zones.
--
-- Twelve, not the house seven: seven is how many zones this factory's MACHINES
-- have, while hot-runner tips belong to the MOULD. Twelve is the domain ceiling
-- (MAX_PROCESS_SHEET_ZONE_COUNT), and a mould with four tips simply leaves the
-- rest blank — sparse zones are data, exactly as on the paper matrix.
--
-- sort_order is taken from the legacy pair so the new row lands in the SAME
-- place on the sheet — the sheet renders in sort_order and bands consecutive
-- rows that share a section, so the row appears inside the existing 热流道设置
-- band and is the only row left in it once 3c retires the pair. A template that
-- never had hot-runner rows gets 999 — immediately before the catalog block,
-- which starts at 1000.
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
  'Hot Runner Settings',
  'hot_runner_temp',
  'Hot Runner Temperature',
  '热流道温度',
  'deg C',
  'NUMBER'::"ProcessValueType",
  'ZONED',
  12,
  '{}'::TEXT[],
  COALESCE(
    (
      SELECT MIN(legacy."sort_order")
      FROM "process_sheet_parameters" legacy
      WHERE legacy."process_sheet_template_id" = t."id"
        AND legacy."parameter_key" ~ '^hot_runner_zone_[0-9]+_temp$'
    ),
    999
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
    AND existing."parameter_key" = 'hot_runner_temp'
)
ON CONFLICT ("process_sheet_template_id", "parameter_key") DO NOTHING;

-- And upgrade one that already exists in the wrong shape (a re-run against a
-- half-applied database, or a row added by hand before this migration).
UPDATE "process_sheet_parameters"
SET
  "kind" = 'ZONED',
  "zone_count" = 12,
  "options" = '{}'::TEXT[],
  "value_type" = 'NUMBER'::"ProcessValueType",
  "unit" = 'deg C',
  "label_en" = 'Hot Runner Temperature',
  "label_zh" = '热流道温度',
  "section" = 'Hot Runner Settings',
  "active" = true,
  "updated_at" = NOW()
WHERE "parameter_key" = 'hot_runner_temp'
  AND (
    "kind" IS DISTINCT FROM 'ZONED'
    OR "zone_count" IS DISTINCT FROM 12
    OR "value_type" IS DISTINCT FROM 'NUMBER'::"ProcessValueType"
    OR "section" IS DISTINCT FROM 'Hot Runner Settings'
    OR "active" IS DISTINCT FROM true
  );

-- ---------------------------------------------------------------------------
-- 3b. MOVE the stored values: `hot_runner_zone_<N>_temp` becomes zone N.
--
-- Re-pointing the existing rows (rather than insert + delete) is what preserves
-- the trial linkage, the operator who entered the value and its created_at — the
-- row is the same fact, now addressed as a zone. The snapshots are rewritten
-- because they describe the row the value belongs to, and it is a different row
-- now; `value_number` / `value_text` are never touched.
--
-- The NOT EXISTS guard is what makes the move re-runnable: if the target cell
-- (trial, ZONED row, zone N) already holds a value — a second run, or the
-- operator having already filled the new row — the legacy value stays where it
-- is, which also keeps its parameter out of 3c's retirement.
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
    substring(p."parameter_key" from '^hot_runner_zone_([0-9]+)_temp$')::INTEGER AS "zone_index"
  FROM "process_sheet_parameters" p
  -- Bounded to zones 1…12 in the PATTERN, so the cast below can never see a
  -- number that does not fit — the same bound `legacyHotRunnerZoneIndex` applies.
  WHERE p."parameter_key" ~ '^hot_runner_zone_(1[0-2]|[1-9])_temp$'
) legacy
JOIN "process_sheet_parameters" target
  ON target."process_sheet_template_id" = legacy."process_sheet_template_id"
 AND target."parameter_key" = 'hot_runner_temp'
WHERE v."process_sheet_parameter_id" = legacy."id"
  -- Zone 0 is the non-zoned sentinel and 12 is the row's width: a value outside
  -- that range has nowhere to land, so it is left on its legacy row.
  AND legacy."zone_index" BETWEEN 1 AND 12
  AND NOT EXISTS (
    SELECT 1
    FROM "trial_process_values" existing
    WHERE existing."trial_event_id" = v."trial_event_id"
      AND existing."process_sheet_parameter_id" = target."id"
      AND existing."zone_index" = legacy."zone_index"
  );

-- ---------------------------------------------------------------------------
-- 3c. RETIRE the legacy hot-runner rows — only the ones fully migrated.
--
-- "Fully migrated" is exactly "holds no values any more". A row that still holds
-- one (zone above twelve, or a cell the ZONED row had already filled) survives
-- with its data intact and shows up on the sheet, which is the visible signal
-- that it needs a human.
-- ---------------------------------------------------------------------------

DELETE FROM "process_sheet_parameters" p
WHERE p."parameter_key" ~ '^hot_runner_zone_[0-9]+_temp$'
  AND NOT EXISTS (
    SELECT 1
    FROM "trial_process_values" v
    WHERE v."process_sheet_parameter_id" = p."id"
  );
