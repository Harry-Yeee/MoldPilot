-- Data migration: put the owner's paper catalog into EVERY process-sheet
-- template that already exists.
--
-- Root cause this follows: production never runs `prisma db seed` (the
-- 20260807090000 permissions migration exists for exactly this reason — new
-- permission codes shipped in the code registry and no rows existed on the
-- mini). The 34 catalog parameters are template DATA, not code, so shipping the
-- seed change alone would give a fresh dev database the new sections and leave
-- every real project's sheet exactly as it was. So the rows are inserted here.
--
-- Idempotent twice over: NOT EXISTS on (template, parameter_key) and
-- ON CONFLICT DO NOTHING against that same unique index. Safe to re-run, safe
-- on a dev database where the seed already created the rows, and safe on a
-- template that has SOME of the catalog already (only the missing rows land).
--
-- EVERY template, active or not: a customer template that is switched back on
-- later must not come back missing the factory's own parameters. Nothing
-- existing is touched — no UPDATE, no DELETE, and `kind` on the pre-existing
-- rows keeps the 'SCALAR' default from the schema migration.
--
-- SORT ORDER starts at 1000 so the catalog always renders AFTER whatever a
-- template already had (the seeded default template ends in the thirties), and
-- the seed uses the same base (`FACTORY_PROCESS_SHEET_CATALOG_SORT_BASE`), so a
-- migrated database and a freshly seeded one order the sheet identically.
--
-- The catalog itself is src/domain/mold-trial/process-sheet-catalog.ts. The rows
-- below were generated from it and are asserted against it, key by key, in
-- tests/domain/process-sheet-catalog.test.ts — that test is what keeps this file
-- and the seed from drifting apart.

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
  c."section",
  c."parameter_key",
  c."label_en",
  c."label_zh",
  c."unit",
  c."value_type"::"ProcessValueType",
  c."kind",
  c."zone_count",
  c."options",
  c."sort_order",
  true,
  true,
  NOW(),
  NOW()
FROM "process_sheet_templates" t
CROSS JOIN (VALUES
    ('Injection Profile', 'injection_barrel_temp', 'Barrel Temperature', '炮筒温度', 'C'::TEXT, 'NUMBER', 'ZONED', 7::INTEGER, '{}'::TEXT[], 1000),
    ('Injection Profile', 'injection_pressure', 'Injection Pressure', '射胶压力', 'bar'::TEXT, 'NUMBER', 'ZONED', 7::INTEGER, '{}'::TEXT[], 1001),
    ('Injection Profile', 'injection_speed', 'Injection Speed', '射胶速度', 'mm/s'::TEXT, 'NUMBER', 'ZONED', 7::INTEGER, '{}'::TEXT[], 1002),
    ('Injection Profile', 'injection_position', 'Injection Position', '射胶位置', 'mm'::TEXT, 'NUMBER', 'ZONED', 7::INTEGER, '{}'::TEXT[], 1003),
    ('Hold Profile', 'hold_profile_pressure', 'Hold Pressure', '保压压力', 'bar'::TEXT, 'NUMBER', 'ZONED', 7::INTEGER, '{}'::TEXT[], 1004),
    ('Hold Profile', 'hold_profile_speed', 'Hold Speed', '保压速度', 'bar'::TEXT, 'NUMBER', 'ZONED', 7::INTEGER, '{}'::TEXT[], 1005),
    ('Hold Profile', 'hold_profile_time', 'Hold Time', '保压时间', 's'::TEXT, 'NUMBER', 'ZONED', 7::INTEGER, '{}'::TEXT[], 1006),
    ('Plasticizing', 'plasticizing_pressure', 'Plasticizing Pressure', '熔胶压力', 'bar'::TEXT, 'NUMBER', 'SCALAR', NULL::INTEGER, '{}'::TEXT[], 1007),
    ('Plasticizing', 'plasticizing_speed', 'Plasticizing Speed', '熔胶速度', 'mm/s'::TEXT, 'NUMBER', 'SCALAR', NULL::INTEGER, '{}'::TEXT[], 1008),
    ('Plasticizing', 'plasticizing_position', 'Plasticizing Position', '熔胶位置', 'mm'::TEXT, 'NUMBER', 'SCALAR', NULL::INTEGER, '{}'::TEXT[], 1009),
    ('Ejector', 'ejector_pressure', 'Ejector Pressure', '顶针压力', 'bar'::TEXT, 'NUMBER', 'SCALAR', NULL::INTEGER, '{}'::TEXT[], 1010),
    ('Ejector', 'ejector_speed', 'Ejector Speed', '顶针速度', 'mm/s'::TEXT, 'NUMBER', 'SCALAR', NULL::INTEGER, '{}'::TEXT[], 1011),
    ('Ejector', 'ejector_position', 'Ejector Position', '顶针位置', 'mm'::TEXT, 'NUMBER', 'SCALAR', NULL::INTEGER, '{}'::TEXT[], 1012),
    ('Mold Temperature', 'mold_temp_front', 'Front Mold Temperature', '前模温度', 'C'::TEXT, 'NUMBER', 'SCALAR', NULL::INTEGER, '{}'::TEXT[], 1013),
    ('Mold Temperature', 'mold_temp_rear', 'Rear Mold Temperature', '后模温度', 'C'::TEXT, 'NUMBER', 'SCALAR', NULL::INTEGER, '{}'::TEXT[], 1014),
    ('Gate Type', 'gate_type', 'Gate Type', '入水', NULL::TEXT, 'TEXT', 'FLAGS', NULL::INTEGER, ARRAY['大', '细', '潜水', '热流道']::TEXT[], 1015),
    ('Cooling Circuit', 'cooling_circuit', 'Cooling Circuit', '运水', NULL::TEXT, 'TEXT', 'FLAGS', NULL::INTEGER, ARRAY['热油', '热水', '冷水', '机水']::TEXT[], 1016),
    ('Operation Mode', 'operation_mode', 'Operation Mode', '操作', NULL::TEXT, 'TEXT', 'CHOICE', NULL::INTEGER, ARRAY['手动', '半自动', '全自动']::TEXT[], 1017),
    ('Core Pull A', 'core_pull_a_pressure', 'Core Pull A Pressure', 'A组抽芯压力', 'bar'::TEXT, 'NUMBER', 'SCALAR', NULL::INTEGER, '{}'::TEXT[], 1018),
    ('Core Pull A', 'core_pull_a_speed', 'Core Pull A Speed', '进芯速度', 'mm/s'::TEXT, 'NUMBER', 'SCALAR', NULL::INTEGER, '{}'::TEXT[], 1019),
    ('Core Pull A', 'core_pull_a_time', 'Core Pull A Time', '进芯时间', 's'::TEXT, 'NUMBER', 'SCALAR', NULL::INTEGER, '{}'::TEXT[], 1020),
    ('Core Pull A', 'core_pull_a_position', 'Core Pull A Position', '进芯位置', 'mm'::TEXT, 'NUMBER', 'SCALAR', NULL::INTEGER, '{}'::TEXT[], 1021),
    ('Core Return A', 'core_return_a_pressure', 'Core Return A Pressure', 'A组退芯压力', 'bar'::TEXT, 'NUMBER', 'SCALAR', NULL::INTEGER, '{}'::TEXT[], 1022),
    ('Core Return A', 'core_return_a_speed', 'Core Return A Speed', '退芯速度', 'mm/s'::TEXT, 'NUMBER', 'SCALAR', NULL::INTEGER, '{}'::TEXT[], 1023),
    ('Core Return A', 'core_return_a_time', 'Core Return A Time', '退芯时间', 's'::TEXT, 'NUMBER', 'SCALAR', NULL::INTEGER, '{}'::TEXT[], 1024),
    ('Core Return A', 'core_return_a_position', 'Core Return A Position', '退芯位置', 'mm'::TEXT, 'NUMBER', 'SCALAR', NULL::INTEGER, '{}'::TEXT[], 1025),
    ('Core Pull B', 'core_pull_b_pressure', 'Core Pull B Pressure', 'B组抽芯压力', 'bar'::TEXT, 'NUMBER', 'SCALAR', NULL::INTEGER, '{}'::TEXT[], 1026),
    ('Core Pull B', 'core_pull_b_speed', 'Core Pull B Speed', '进芯速度', 'mm/s'::TEXT, 'NUMBER', 'SCALAR', NULL::INTEGER, '{}'::TEXT[], 1027),
    ('Core Pull B', 'core_pull_b_time', 'Core Pull B Time', '进芯时间', 's'::TEXT, 'NUMBER', 'SCALAR', NULL::INTEGER, '{}'::TEXT[], 1028),
    ('Core Pull B', 'core_pull_b_position', 'Core Pull B Position', '进芯位置', 'mm'::TEXT, 'NUMBER', 'SCALAR', NULL::INTEGER, '{}'::TEXT[], 1029),
    ('Core Return B', 'core_return_b_pressure', 'Core Return B Pressure', 'B组退芯压力', 'bar'::TEXT, 'NUMBER', 'SCALAR', NULL::INTEGER, '{}'::TEXT[], 1030),
    ('Core Return B', 'core_return_b_speed', 'Core Return B Speed', '退芯速度', 'mm/s'::TEXT, 'NUMBER', 'SCALAR', NULL::INTEGER, '{}'::TEXT[], 1031),
    ('Core Return B', 'core_return_b_time', 'Core Return B Time', '退芯时间', 's'::TEXT, 'NUMBER', 'SCALAR', NULL::INTEGER, '{}'::TEXT[], 1032),
    ('Core Return B', 'core_return_b_position', 'Core Return B Position', '退芯位置', 'mm'::TEXT, 'NUMBER', 'SCALAR', NULL::INTEGER, '{}'::TEXT[], 1033)
) AS c(
  "section",
  "parameter_key",
  "label_en",
  "label_zh",
  "unit",
  "value_type",
  "kind",
  "zone_count",
  "options",
  "sort_order"
)
WHERE NOT EXISTS (
  SELECT 1
  FROM "process_sheet_parameters" existing
  WHERE existing."process_sheet_template_id" = t."id"
    AND existing."parameter_key" = c."parameter_key"
)
ON CONFLICT ("process_sheet_template_id", "parameter_key") DO NOTHING;
