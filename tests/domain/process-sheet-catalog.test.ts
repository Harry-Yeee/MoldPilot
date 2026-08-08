import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

import {
  buildProcessSheetZoneMatrix,
  deserializeProcessSheetFlagValues,
  DEFAULT_PROCESS_SHEET_ZONE_COUNT,
  factoryProcessSheetCatalog,
  factoryProcessSheetSections,
  factoryProcessSheetSortOrder,
  FACTORY_PROCESS_SHEET_CATALOG_SORT_BASE,
  isTransposedProcessSheetSection,
  isUnchangedLegacyProcessSheetOptionValue,
  MAX_PROCESS_SHEET_ZONE_COUNT,
  NON_ZONED_ZONE_INDEX,
  parseProcessSheetCellKey,
  parseProcessSheetChoiceValue,
  parseProcessSheetFlagValues,
  parseProcessSheetOptions,
  parseProcessSheetParameterKind,
  parseProcessSheetZoneCount,
  processSheetCellKey,
  processSheetNavigationCellKeys,
  processSheetOptionValueView,
  processSheetParameterFacets,
  processSheetSectionAnchorId,
  processSheetSectionFill,
  processSheetSectionZoneCaptionKind,
  processSheetTrialCellKey,
  processSheetZoneCaption,
  processSheetZoneCaptionKind,
  processSheetZoneCaptionZh,
  processSheetZoneLabel,
  processValueZoneIndex,
  serializeProcessSheetFlagValues
} from "../../src/domain/mold-trial/process-sheet-catalog.ts";
import {
  copyPreviousTrialProcessSheetValues,
  defaultProcessSheetParameters,
  HOT_RUNNER_ZONED_PARAMETER,
  legacyHotRunnerZoneIndex,
  legacyShotPartWeightZoneIndex,
  SHOT_PART_WEIGHT_ZONED_PARAMETER
} from "../../src/domain/mold-trial/process-sheet.ts";
import { dictionaries } from "../../src/i18n/index.ts";
import { translateDefaultProcessSection } from "../../src/i18n/display.ts";

const migrationSql = readFileSync(
  new URL(
    "../../prisma/migrations/20260807130000_seed_factory_process_sheet_catalog/migration.sql",
    import.meta.url
  ),
  "utf8"
);
const schemaMigrationSql = readFileSync(
  new URL(
    "../../prisma/migrations/20260807120000_process_sheet_parameter_kinds_and_zones/migration.sql",
    import.meta.url
  ),
  "utf8"
);
const reconcileMigrationSql = readFileSync(
  new URL(
    "../../prisma/migrations/20260808120000_reconcile_legacy_process_sheet_parameters/migration.sql",
    import.meta.url
  ),
  "utf8"
);
const shotWeightMigrationSql = readFileSync(
  new URL("../../prisma/migrations/20260808130000_six_shot_part_weight_zoned/migration.sql", import.meta.url),
  "utf8"
);

/** The paper sheet, section by section — the shape the transcription must match. */
const paperSections = [
  { zh: "注塑", en: "Injection Profile", kind: "ZONED", rows: 4 },
  { zh: "保压", en: "Hold Profile", kind: "ZONED", rows: 3 },
  { zh: "熔胶", en: "Plasticizing", kind: "SCALAR", rows: 3 },
  { zh: "顶针", en: "Ejector", kind: "SCALAR", rows: 3 },
  { zh: "模温", en: "Mold Temperature", kind: "SCALAR", rows: 2 },
  { zh: "入水", en: "Gate Type", kind: "FLAGS", rows: 1 },
  { zh: "运水", en: "Cooling Circuit", kind: "FLAGS", rows: 1 },
  { zh: "操作", en: "Operation Mode", kind: "CHOICE", rows: 1 },
  { zh: "抽芯A", en: "Core Pull A", kind: "SCALAR", rows: 4 },
  { zh: "退芯A", en: "Core Return A", kind: "SCALAR", rows: 4 },
  { zh: "抽芯B", en: "Core Pull B", kind: "SCALAR", rows: 4 },
  { zh: "退芯B", en: "Core Return B", kind: "SCALAR", rows: 4 }
] as const;

describe("Process-sheet parameter kinds", () => {
  test("kind parsing defaults to SCALAR for everything it does not recognise", () => {
    assert.equal(parseProcessSheetParameterKind("ZONED"), "ZONED");
    assert.equal(parseProcessSheetParameterKind("CHOICE"), "CHOICE");
    assert.equal(parseProcessSheetParameterKind("FLAGS"), "FLAGS");
    assert.equal(parseProcessSheetParameterKind("SCALAR"), "SCALAR");
    assert.equal(parseProcessSheetParameterKind(" zoned "), "ZONED");
    // The pre-existing rows and a stale generated client both read as SCALAR.
    assert.equal(parseProcessSheetParameterKind(null), "SCALAR");
    assert.equal(parseProcessSheetParameterKind(undefined), "SCALAR");
    assert.equal(parseProcessSheetParameterKind(""), "SCALAR");
    assert.equal(parseProcessSheetParameterKind("MATRIX"), "SCALAR");
  });

  test("zone count is zoned-only, defaults to seven, and is clamped", () => {
    assert.equal(parseProcessSheetZoneCount(null, "ZONED"), DEFAULT_PROCESS_SHEET_ZONE_COUNT);
    assert.equal(parseProcessSheetZoneCount(undefined, "ZONED"), DEFAULT_PROCESS_SHEET_ZONE_COUNT);
    assert.equal(parseProcessSheetZoneCount(3, "ZONED"), 3);
    assert.equal(parseProcessSheetZoneCount(0, "ZONED"), DEFAULT_PROCESS_SHEET_ZONE_COUNT);
    assert.equal(parseProcessSheetZoneCount(-4, "ZONED"), DEFAULT_PROCESS_SHEET_ZONE_COUNT);
    assert.equal(parseProcessSheetZoneCount(999, "ZONED"), MAX_PROCESS_SHEET_ZONE_COUNT);
    assert.equal(parseProcessSheetZoneCount(7, "SCALAR"), null);
    assert.equal(parseProcessSheetZoneCount(7, "CHOICE"), null);
    assert.equal(parseProcessSheetZoneCount(7, "FLAGS"), null);
  });

  test("options are trimmed, de-duplicated, and only kept for CHOICE/FLAGS", () => {
    assert.deepEqual(parseProcessSheetOptions([" 大 ", "细", "大", "", "潜水"]), ["大", "细", "潜水"]);
    assert.deepEqual(parseProcessSheetOptions(null), []);

    assert.deepEqual(
      processSheetParameterFacets({ parameterKey: "operation_mode", kind: "CHOICE", options: ["手动", "全自动"] }),
      { kind: "CHOICE", zoneCount: null, options: ["手动", "全自动"] }
    );
    assert.deepEqual(
      processSheetParameterFacets({ parameterKey: "cycle_time", kind: "SCALAR", options: ["ignored"] }),
      { kind: "SCALAR", zoneCount: null, options: [] }
    );
  });

  test("the facets read seam survives a generated client that predates the migration", () => {
    // Exactly the shape a stale client returns: no kind, no zoneCount, no options.
    assert.deepEqual(processSheetParameterFacets({ parameterKey: "cycle_time" }), {
      kind: "SCALAR",
      zoneCount: null,
      options: []
    });
    assert.deepEqual(processSheetParameterFacets({ parameterKey: "injection_barrel_temp", kind: "ZONED" }), {
      kind: "ZONED",
      zoneCount: DEFAULT_PROCESS_SHEET_ZONE_COUNT,
      options: []
    });
    assert.equal(processValueZoneIndex({ processSheetParameterId: "p1" }), NON_ZONED_ZONE_INDEX);
    assert.equal(processValueZoneIndex({ processSheetParameterId: "p1", zoneIndex: null }), NON_ZONED_ZONE_INDEX);
    assert.equal(processValueZoneIndex({ processSheetParameterId: "p1", zoneIndex: 4 }), 4);
  });

  test("cell keys round-trip and leave non-zoned keys exactly as they were", () => {
    assert.equal(processSheetCellKey("param-1"), "param-1");
    assert.equal(processSheetCellKey("param-1", 0), "param-1");
    assert.equal(processSheetCellKey("param-1", null), "param-1");
    assert.equal(processSheetCellKey("param-1", 3), "param-1#3");
    assert.deepEqual(parseProcessSheetCellKey("param-1"), { parameterId: "param-1", zoneIndex: 0 });
    assert.deepEqual(parseProcessSheetCellKey("param-1#3"), { parameterId: "param-1", zoneIndex: 3 });
    // A uuid contains no '#', so a bare id can never be mistaken for a zone cell.
    assert.deepEqual(parseProcessSheetCellKey("2f1a-9c#0"), { parameterId: "2f1a-9c#0", zoneIndex: 0 });
  });

  test("zone captions are bilingual", () => {
    assert.equal(processSheetZoneLabel(1, "zh-CN"), "一区");
    assert.equal(processSheetZoneLabel(7, "zh-CN"), "七区");
    assert.equal(processSheetZoneLabel(12, "zh-CN"), "十二区");
    assert.equal(processSheetZoneLabel(1, "en"), "Zone 1");
  });
});

describe("Process-sheet zone matrix", () => {
  const barrel = { id: "barrel", parameterKey: "injection_barrel_temp", labelEn: "Barrel Temperature", kind: "ZONED" as const, zoneCount: 7 };
  const shortPull = { id: "short", parameterKey: "injection_pressure", labelEn: "Injection Pressure", kind: "ZONED" as const, zoneCount: 3 };
  const scalarRow = { id: "cycle", parameterKey: "cycle_time", labelEn: "Cycle Time", kind: "SCALAR" as const, zoneCount: null };

  test("a section is as wide as its widest zoned parameter and sparse cells stay blank", () => {
    const matrix = buildProcessSheetZoneMatrix({
      parameters: [barrel, shortPull, scalarRow],
      valueByCellKey: {
        "barrel#1": "210",
        "barrel#3": "220",
        "short#2": "85"
      }
    });

    assert.equal(matrix.zoneCount, 7);
    assert.deepEqual(matrix.zoneIndexes, [1, 2, 3, 4, 5, 6, 7]);
    // The SCALAR row is not part of the matrix.
    assert.deepEqual(matrix.rows.map((row) => row.parameter.id), ["barrel", "short"]);

    const barrelRow = matrix.rows[0];
    assert.deepEqual(
      barrelRow?.cells.map((cell) => cell.value),
      ["210", "", "220", "", "", "", ""]
    );
    assert.equal(barrelRow?.cells.every((cell) => cell.available), true);
    assert.deepEqual(barrelRow?.cells.map((cell) => cell.cellKey).slice(0, 3), ["barrel#1", "barrel#2", "barrel#3"]);

    const shortRow = matrix.rows[1];
    assert.deepEqual(
      shortRow?.cells.map((cell) => cell.available),
      [true, true, true, false, false, false, false]
    );
    assert.deepEqual(shortRow?.cells.map((cell) => cell.value), ["", "85", "", "", "", "", ""]);
  });

  test("a zoned parameter with no stored zone count falls back to seven, and a section with none is zero-wide", () => {
    const defaulted = buildProcessSheetZoneMatrix({
      parameters: [{ ...barrel, zoneCount: null }]
    });
    assert.equal(defaulted.zoneCount, DEFAULT_PROCESS_SHEET_ZONE_COUNT);
    assert.equal(defaulted.rows[0]?.cells.length, DEFAULT_PROCESS_SHEET_ZONE_COUNT);
    assert.equal(defaulted.rows[0]?.cells.every((cell) => cell.value === ""), true);

    const noZones = buildProcessSheetZoneMatrix({ parameters: [scalarRow] });
    assert.equal(noZones.zoneCount, 0);
    assert.deepEqual(noZones.rows, []);
  });

  test("a Map of values reads the same as a record", () => {
    const matrix = buildProcessSheetZoneMatrix({
      parameters: [shortPull],
      valueByCellKey: new Map([["short#1", "12"]])
    });

    assert.deepEqual(matrix.rows[0]?.cells.map((cell) => cell.value), ["12", "", ""]);
  });
});

describe("Process-sheet choices and flags", () => {
  const gateOptions = ["大", "细", "潜水", "热流道"];

  test("FLAGS keep the option list's order and drop anything not on it", () => {
    assert.deepEqual(parseProcessSheetFlagValues(["潜水", "大", "unknown"], gateOptions), ["大", "潜水"]);
    assert.equal(serializeProcessSheetFlagValues(["大", "潜水"]), "大, 潜水");
    assert.deepEqual(deserializeProcessSheetFlagValues("大, 潜水", gateOptions), ["大", "潜水"]);
    assert.deepEqual(deserializeProcessSheetFlagValues("潜水,大", gateOptions), ["大", "潜水"]);
    assert.deepEqual(deserializeProcessSheetFlagValues(null, gateOptions), []);
    assert.deepEqual(deserializeProcessSheetFlagValues("", gateOptions), []);
    // Round trip through the readable storage the PDF prints verbatim.
    assert.equal(
      serializeProcessSheetFlagValues(deserializeProcessSheetFlagValues("热流道, 细", gateOptions)),
      "细, 热流道"
    );
  });

  test("CHOICE accepts exactly one listed option and nothing else", () => {
    const modes = ["手动", "半自动", "全自动"];

    assert.equal(parseProcessSheetChoiceValue("半自动", modes), "半自动");
    assert.equal(parseProcessSheetChoiceValue(" 全自动 ", modes), "全自动");
    assert.equal(parseProcessSheetChoiceValue("", modes), null);
    assert.equal(parseProcessSheetChoiceValue(null, modes), null);
    assert.equal(parseProcessSheetChoiceValue("自动", modes), null);
  });

});

describe("Copy Previous Trial carries zones, choices and flags", () => {
  test("zoned cells, a choice and a flag list all copy forward under one call", () => {
    const zone = (parameterId: string, index: number) => processSheetCellKey(parameterId, index);
    const copyableKeys = [
      zone("barrel", 1),
      zone("barrel", 2),
      zone("barrel", 3),
      "operation_mode",
      "gate_type",
      "cycle_time"
    ];
    const previousValues = {
      [zone("barrel", 1)]: "210",
      [zone("barrel", 2)]: "215",
      [zone("barrel", 3)]: "",
      operation_mode: "半自动",
      gate_type: "大, 潜水",
      cycle_time: "42"
    };
    const blankOnly = copyPreviousTrialProcessSheetValues({
      currentMachineId: "machine-10",
      previousMachineId: "machine-10",
      currentValues: {
        [zone("barrel", 1)]: "",
        [zone("barrel", 2)]: "205",
        [zone("barrel", 3)]: "",
        operation_mode: "",
        gate_type: "",
        cycle_time: ""
      },
      previousValues,
      copyableKeys
    });

    assert.equal(blankOnly.values[zone("barrel", 1)], "210");
    // A zone that already holds a value is never silently overwritten…
    assert.equal(blankOnly.values[zone("barrel", 2)], "205");
    // …and a zone the previous trial left blank stays blank (sparse is data).
    assert.equal(blankOnly.values[zone("barrel", 3)], "");
    assert.equal(blankOnly.values.operation_mode, "半自动");
    assert.equal(blankOnly.values.gate_type, "大, 潜水");
    assert.equal(blankOnly.values.cycle_time, "42");
    assert.deepEqual(blankOnly.skippedExistingKeys, [zone("barrel", 2)]);
    assert.equal(blankOnly.changedCount, 4);

    const overwrite = copyPreviousTrialProcessSheetValues({
      currentMachineId: "machine-10",
      previousMachineId: "machine-10",
      currentValues: blankOnly.values,
      previousValues,
      copyableKeys,
      overwrite: true
    });

    assert.equal(overwrite.values[zone("barrel", 2)], "215");
    assert.deepEqual(overwrite.overwrittenKeys, [zone("barrel", 2)]);
  });

  test("the summary rows stay excluded from the copy even with zone keys present", () => {
    const result = copyPreviousTrialProcessSheetValues({
      currentValues: { "barrel#1": "", next_action: "" },
      previousValues: { "barrel#1": "210", next_action: "Run correction check" },
      copyableKeys: ["barrel#1"]
    });

    assert.equal(result.values["barrel#1"], "210");
    assert.equal(result.values.next_action, "");
  });
});

describe("The owner's paper catalog", () => {
  test("every paper row is present exactly once, in paper order", () => {
    const expectedRowCount = paperSections.reduce((total, section) => total + section.rows, 0);

    assert.equal(expectedRowCount, 34);
    assert.equal(factoryProcessSheetCatalog.length, expectedRowCount);

    const keys = factoryProcessSheetCatalog.map((parameter) => parameter.parameterKey);
    assert.equal(new Set(keys).size, keys.length, "duplicate parameter key in the catalog");

    assert.deepEqual(
      factoryProcessSheetSections.map((section) => section.zh),
      paperSections.map((section) => section.zh)
    );

    for (const section of paperSections) {
      const rows = factoryProcessSheetCatalog.filter((parameter) => parameter.section === section.en);

      assert.equal(rows.length, section.rows, `${section.zh} row count`);
      assert.equal(
        rows.every((row) => row.sectionZh === section.zh),
        true
      );
      assert.equal(
        rows.every((row) => parseProcessSheetParameterKind(row.kind) === section.kind),
        true,
        `${section.zh} kind`
      );
    }
  });

  test("the zoned sections carry seven zones and the option sections carry the paper's lists", () => {
    for (const parameter of factoryProcessSheetCatalog) {
      const facets = processSheetParameterFacets({
        parameterKey: parameter.parameterKey,
        kind: parameter.kind,
        zoneCount: "zoneCount" in parameter ? parameter.zoneCount : null,
        options: "options" in parameter ? [...parameter.options] : []
      });

      if (facets.kind === "ZONED") {
        assert.equal(facets.zoneCount, 7, `${parameter.parameterKey} zone count`);
      } else {
        assert.equal(facets.zoneCount, null, `${parameter.parameterKey} zone count`);
      }

      assert.equal(
        parameter.valueType,
        facets.kind === "CHOICE" || facets.kind === "FLAGS" ? "TEXT" : "NUMBER"
      );
      assert.equal(parameter.labelEn.trim().length > 0, true);
      assert.equal(parameter.labelZh.trim().length > 0, true);
      assert.equal(parameter.customerVisible, true);
    }

    const optionsByKey = Object.fromEntries(
      factoryProcessSheetCatalog
        .filter((parameter) => "options" in parameter)
        .map((parameter) => [parameter.parameterKey, [...(parameter as { options: readonly string[] }).options]])
    );

    assert.deepEqual(optionsByKey.gate_type, ["大", "细", "潜水", "热流道"]);
    assert.deepEqual(optionsByKey.cooling_circuit, ["热油", "热水", "冷水", "机水"]);
    assert.deepEqual(optionsByKey.operation_mode, ["手动", "半自动", "全自动"]);
  });

  test("the units follow the paper, including the 保压压力 typo correction", () => {
    const unitByKey = Object.fromEntries(
      factoryProcessSheetCatalog.map((parameter) => [
        parameter.parameterKey,
        "unit" in parameter ? parameter.unit : null
      ])
    );

    assert.equal(unitByKey.injection_barrel_temp, "C");
    assert.equal(unitByKey.injection_pressure, "bar");
    assert.equal(unitByKey.injection_speed, "mm/s");
    assert.equal(unitByKey.injection_position, "mm");
    // The paper writes "mm" against 保压压力; a hold PRESSURE in millimetres is
    // a slip of the pen, so it is stored in bar.
    assert.equal(unitByKey.hold_profile_pressure, "bar");
    // 保压速度 keeps the paper's own unit rather than an invented mm/s.
    assert.equal(unitByKey.hold_profile_speed, "bar");
    assert.equal(unitByKey.hold_profile_time, "s");
    assert.equal(unitByKey.mold_temp_front, "C");
    assert.equal(unitByKey.mold_temp_rear, "C");
    assert.equal(unitByKey.gate_type, null);
    assert.equal(unitByKey.cooling_circuit, null);
    assert.equal(unitByKey.operation_mode, null);

    for (const suffix of ["pressure", "speed", "time", "position"] as const) {
      const expected = { pressure: "bar", speed: "mm/s", time: "s", position: "mm" }[suffix];

      for (const group of ["core_pull_a", "core_return_a", "core_pull_b", "core_return_b"]) {
        assert.equal(unitByKey[`${group}_${suffix}`], expected, `${group}_${suffix}`);
      }
    }
  });

  test("catalog sort orders start after the existing template rows and never collide", () => {
    const sortOrders = factoryProcessSheetCatalog.map((_parameter, index) => factoryProcessSheetSortOrder(index));

    assert.equal(sortOrders[0], FACTORY_PROCESS_SHEET_CATALOG_SORT_BASE);
    assert.equal(new Set(sortOrders).size, sortOrders.length);
    assert.deepEqual(sortOrders, [...sortOrders].sort((left, right) => left - right));
  });

  test("both dictionaries name every catalog section", () => {
    for (const section of factoryProcessSheetSections) {
      for (const language of ["en", "zh-CN"] as const) {
        const translated = translateDefaultProcessSection(dictionaries[language], section.en, false);

        assert.notEqual(translated, section.en, `${section.en} is untranslated in ${language}`);
        assert.equal(translated.includes(section.zh), true, `${section.en} misses 中文 in ${language}`);
      }
    }
  });
});

describe("The catalog migrations", () => {
  test("the schema migration backfills kind and closes the NULL hole in the unique index", () => {
    assert.match(schemaMigrationSql, /ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'SCALAR'/);
    assert.match(schemaMigrationSql, /ADD COLUMN "zone_count" INTEGER;/);
    assert.match(schemaMigrationSql, /ADD COLUMN "options" TEXT\[\] NOT NULL DEFAULT '\{\}'/);
    assert.match(schemaMigrationSql, /ADD COLUMN "zone_index" INTEGER NOT NULL DEFAULT 0/);
    assert.match(schemaMigrationSql, /DROP INDEX "trial_process_values_trial_event_id_process_sheet_parameter_key"/);
    assert.match(
      schemaMigrationSql,
      /CREATE UNIQUE INDEX "trial_process_values_trial_event_id_process_sheet_parameter_key"\s*\n\s*ON "trial_process_values"\("trial_event_id", "process_sheet_parameter_id", "zone_index"\)/
    );
    // No nullable zone_index anywhere: NULLs are distinct in a Postgres unique.
    assert.doesNotMatch(schemaMigrationSql, /"zone_index" INTEGER;/);
  });

  test("the data migration inserts every catalog row exactly once, into every template, idempotently", () => {
    for (const parameter of factoryProcessSheetCatalog) {
      const occurrences = migrationSql.split(`'${parameter.parameterKey}'`).length - 1;

      assert.equal(occurrences, 1, `${parameter.parameterKey} appears ${occurrences} times in the data migration`);
      assert.equal(migrationSql.includes(`'${parameter.labelZh}'`), true, `${parameter.parameterKey} 中文 label`);
    }

    assert.match(migrationSql, /INSERT INTO "process_sheet_parameters"/);
    assert.match(migrationSql, /FROM "process_sheet_templates" t/);
    assert.match(migrationSql, /WHERE NOT EXISTS \(/);
    assert.match(migrationSql, /ON CONFLICT \("process_sheet_template_id", "parameter_key"\) DO NOTHING;/);
    // Nothing existing is touched.
    assert.doesNotMatch(migrationSql, /UPDATE "process_sheet_parameters"/);
    assert.doesNotMatch(migrationSql, /DELETE FROM/);

    for (const index of factoryProcessSheetCatalog.keys()) {
      assert.equal(
        migrationSql.includes(`, ${factoryProcessSheetSortOrder(index)})`),
        true,
        `sort order ${factoryProcessSheetSortOrder(index)} missing`
      );
    }
  });

  test("the seed writes the same catalog through the same seam", () => {
    const seedSource = readFileSync(new URL("../../prisma/seed.ts", import.meta.url), "utf8");

    assert.match(seedSource, /factoryProcessSheetCatalog\.map\(\(parameter, index\) =>/);
    assert.match(seedSource, /factoryProcessSheetSortOrder\(index\)/);
    assert.match(seedSource, /processSheetParameterShapeWrite\(/);
    assert.match(seedSource, /trialProcessValueCellWhere\(/);
    assert.doesNotMatch(seedSource, /trialEventId_processSheetParameterId:/);
  });
});

describe("Legacy values on a row that became an option list", () => {
  const gateOptions = ["大", "细", "潜水", "热流道"];
  const modes = ["手动", "半自动", "全自动"];
  const processOptionView = (
    raw: string | null,
    kind: "FLAGS" | "CHOICE" | "SCALAR",
    options: readonly string[]
  ) => processSheetOptionValueView({ raw, kind, options });

  test("FLAGS split into what the list knows and the free text it does not", () => {
    assert.deepEqual(processSheetOptionValueView({ raw: "大, 潜水", kind: "FLAGS", options: gateOptions }), {
      selected: ["大", "潜水"],
      legacy: null
    });
    // Typed before the checklist existed: nothing matches, so nothing rendered
    // before this helper — the operator saw an empty cell.
    assert.deepEqual(processOptionView("大水口", "FLAGS", gateOptions), { selected: [], legacy: "大水口" });
    // Half recognised: the boxes tick, the remainder is still shown.
    assert.deepEqual(processOptionView("潜水, 大水口", "FLAGS", gateOptions), {
      selected: ["潜水"],
      legacy: "大水口"
    });
    assert.deepEqual(processOptionView("", "FLAGS", gateOptions), { selected: [], legacy: null });
    assert.deepEqual(processOptionView(null, "FLAGS", gateOptions), { selected: [], legacy: null });
  });

  test("CHOICE shows an unlisted stored value instead of silently blanking it", () => {
    assert.deepEqual(processOptionView("半自动", "CHOICE", modes), { selected: ["半自动"], legacy: null });
    assert.deepEqual(processOptionView(" 自动 ", "CHOICE", modes), { selected: [], legacy: "自动" });
    assert.deepEqual(processOptionView("", "CHOICE", modes), { selected: [], legacy: null });
    // SCALAR rows have no option list and no residue.
    assert.deepEqual(processOptionView("42", "SCALAR", []), { selected: [], legacy: null });
  });

  test("an UNCHANGED legacy value is kept; touching the control normalises it", () => {
    const unchanged = (raw: string | null, stored: string | null) =>
      isUnchangedLegacyProcessSheetOptionValue({ raw, storedText: stored, kind: "CHOICE", options: modes });

    // Posted back exactly as stored → kept, so the save is neither rejected
    // (CHOICE used to throw) nor silently emptied.
    assert.equal(unchanged("自动", "自动"), true);
    assert.equal(unchanged(" 自动 ", "自动"), true);
    // The operator picked a real option → normal validation normalises it.
    assert.equal(unchanged("全自动", "自动"), false);
    // Cleared, or never legacy in the first place.
    assert.equal(unchanged("", "自动"), false);
    assert.equal(unchanged("半自动", "半自动"), false);
    assert.equal(unchanged("自动", null), false);

    assert.equal(
      isUnchangedLegacyProcessSheetOptionValue({
        raw: "大水口",
        storedText: "大水口",
        kind: "FLAGS",
        options: gateOptions
      }),
      true
    );
    assert.equal(
      isUnchangedLegacyProcessSheetOptionValue({
        raw: "大",
        storedText: "大水口",
        kind: "FLAGS",
        options: gateOptions
      }),
      false
    );
  });
});

describe("The legacy hot-runner rows become one zoned row", () => {
  test("the zone a legacy key becomes is the number in the key, bounded by the row's width", () => {
    assert.equal(legacyHotRunnerZoneIndex("hot_runner_zone_1_temp"), 1);
    assert.equal(legacyHotRunnerZoneIndex("hot_runner_zone_2_temp"), 2);
    assert.equal(legacyHotRunnerZoneIndex("hot_runner_zone_12_temp"), 12);
    // Zone 0 is the non-zoned sentinel and 13 would not render: neither can move.
    assert.equal(legacyHotRunnerZoneIndex("hot_runner_zone_0_temp"), null);
    assert.equal(legacyHotRunnerZoneIndex("hot_runner_zone_13_temp"), null);
    assert.equal(legacyHotRunnerZoneIndex("hot_runner_temp"), null);
    assert.equal(legacyHotRunnerZoneIndex("barrel_zone_1_temp"), null);
  });

  test("the seeded default template is born reconciled", () => {
    const keys: string[] = defaultProcessSheetParameters.map((parameter) => parameter.parameterKey);

    assert.equal(keys.includes("hot_runner_zone_1_temp"), false);
    assert.equal(keys.includes("hot_runner_zone_2_temp"), false);
    assert.equal(keys.filter((key) => key === HOT_RUNNER_ZONED_PARAMETER.parameterKey).length, 1);

    const facets = processSheetParameterFacets({
      parameterKey: HOT_RUNNER_ZONED_PARAMETER.parameterKey,
      kind: HOT_RUNNER_ZONED_PARAMETER.kind,
      zoneCount: HOT_RUNNER_ZONED_PARAMETER.zoneCount
    });

    assert.equal(facets.kind, "ZONED");
    assert.equal(facets.zoneCount, MAX_PROCESS_SHEET_ZONE_COUNT);
    assert.equal(HOT_RUNNER_ZONED_PARAMETER.section, "Hot Runner Settings");
    // It is NOT on the owner's paper 工艺参数表, so it must not join the catalog.
    const catalogKeys: string[] = factoryProcessSheetCatalog.map((parameter) => parameter.parameterKey);

    assert.equal(catalogKeys.includes(HOT_RUNNER_ZONED_PARAMETER.parameterKey), false);

    // The band has to read in 中文 on EVERY template, not only the seeded
    // default one: the migration puts this row into all of them, and until
    // 2026-08-08 the section name was translated for the default template only.
    const zh = translateDefaultProcessSection(dictionaries["zh-CN"], HOT_RUNNER_ZONED_PARAMETER.section, false);

    assert.equal(zh.includes("热流道"), true);
    assert.notEqual(zh, HOT_RUNNER_ZONED_PARAMETER.section);
    assert.equal(
      translateDefaultProcessSection(dictionaries.en, HOT_RUNNER_ZONED_PARAMETER.section, false),
      dictionaries.en["process.section.hotRunnerSettings"]
    );
  });

  test("the upgraded row renders as a twelve-wide matrix in its own section band", () => {
    // What the editor does: group consecutive rows by section, then size the
    // band by its widest zoned parameter.
    const upgraded = {
      id: "hot-runner",
      parameterKey: HOT_RUNNER_ZONED_PARAMETER.parameterKey,
      labelEn: HOT_RUNNER_ZONED_PARAMETER.labelEn,
      kind: parseProcessSheetParameterKind(HOT_RUNNER_ZONED_PARAMETER.kind),
      zoneCount: HOT_RUNNER_ZONED_PARAMETER.zoneCount
    };
    const matrix = buildProcessSheetZoneMatrix({
      parameters: [upgraded],
      // The two migrated values: zone 1 and zone 2, exactly where the retired
      // `hot_runner_zone_1_temp` / `_2_temp` rows put them.
      valueByCellKey: {
        [processSheetCellKey(upgraded.id, 1)]: "245",
        [processSheetCellKey(upgraded.id, 2)]: "250"
      }
    });

    assert.equal(matrix.zoneCount, 12);
    assert.equal(matrix.rows.length, 1);
    assert.deepEqual(
      matrix.rows[0]?.cells.map((cell) => cell.value),
      ["245", "250", "", "", "", "", "", "", "", "", "", ""]
    );
    // A mould with two tips leaves the other ten blank — available, not an error.
    assert.equal(matrix.rows[0]?.cells.every((cell) => cell.available), true);
  });
});

describe("The reconciliation migration", () => {
  /** The SQL with its (long) reasoning comments stripped — statements only. */
  const reconcileStatements = reconcileMigrationSql
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");

  test("it upgrades the pre-existing 入水 / 运水 / 操作 rows in place", () => {
    assert.match(reconcileMigrationSql, /UPDATE "process_sheet_parameters" p/);

    for (const key of ["gate_type", "cooling_circuit", "operation_mode"] as const) {
      const catalogRow = factoryProcessSheetCatalog.find((parameter) => parameter.parameterKey === key);

      assert.notEqual(catalogRow, undefined);
      assert.equal(reconcileMigrationSql.includes(`'${key}'`), true, `${key} missing`);
      assert.equal(reconcileMigrationSql.includes(`'${catalogRow?.labelZh}'`), true, `${key} 中文 label`);
      assert.equal(reconcileMigrationSql.includes(`'${catalogRow?.kind}'`), true, `${key} kind`);

      const options =
        catalogRow != null && "options" in catalogRow ? (catalogRow as { options: readonly string[] }).options : [];

      assert.equal(options.length > 0, true, `${key} has no options`);
      for (const option of options) {
        assert.equal(reconcileMigrationSql.includes(`'${option}'`), true, `${key} option ${option}`);
      }
    }

    // The keys and the ids are what every stored value hangs off, so no
    // statement may assign either — that is what keeps TrialProcessValue rows
    // attached through the upgrade.
    const assignedColumns = reconcileMigrationSql
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => /^"[a-z_]+" = /.test(line))
      .map((line) => line.slice(1, line.indexOf('"', 1)));

    assert.equal(assignedColumns.length > 0, true);
    assert.equal(assignedColumns.includes("parameter_key"), false);
    assert.equal(assignedColumns.includes("id"), false);
    // Data only — the columns arrived with 20260807120000.
    assert.doesNotMatch(reconcileStatements, /ALTER TABLE/);
  });

  test("every delete is guarded by zero stored values", () => {
    const deletes = reconcileStatements.split(/DELETE FROM/).slice(1);

    assert.equal(deletes.length, 2);

    for (const statement of deletes) {
      const body = statement.split(";")[0] ?? "";

      assert.match(body, /NOT EXISTS/);
      assert.match(body, /"trial_process_values"/);
    }
  });

  test("the hot-runner row is created once per template and its values are re-pointed, not re-created", () => {
    assert.match(reconcileMigrationSql, /'hot_runner_temp'/);
    assert.match(reconcileMigrationSql, /'热流道温度'/);
    assert.match(reconcileMigrationSql, /'ZONED'/);
    assert.match(reconcileMigrationSql, /FROM "process_sheet_templates" t/);
    assert.match(reconcileMigrationSql, /WHERE NOT EXISTS \(/);
    assert.match(reconcileMigrationSql, /ON CONFLICT \("process_sheet_template_id", "parameter_key"\) DO NOTHING;/);

    // The row is as wide as the domain ceiling, and the zone bound in the SQL is
    // the same one `legacyHotRunnerZoneIndex` applies.
    assert.equal(reconcileMigrationSql.includes(`  ${MAX_PROCESS_SHEET_ZONE_COUNT},`), true);
    assert.match(reconcileMigrationSql, /\^hot_runner_zone_\(1\[0-2\]\|\[1-9\]\)_temp\$/);
    assert.match(reconcileMigrationSql, /BETWEEN 1 AND 12/);

    // Values MOVE (UPDATE of the existing rows), which is what preserves the
    // trial linkage and the operator who entered them.
    assert.match(reconcileMigrationSql, /UPDATE "trial_process_values" v/);
    assert.match(reconcileMigrationSql, /"process_sheet_parameter_id" = target\."id"/);
    assert.match(reconcileMigrationSql, /"zone_index" = legacy\."zone_index"/);
    assert.doesNotMatch(reconcileMigrationSql, /INSERT INTO "trial_process_values"/);
    // The catalog's sort base is what the fallback sits just below.
    assert.equal(reconcileMigrationSql.includes(`${FACTORY_PROCESS_SHEET_CATALOG_SORT_BASE - 1}`), true);
  });

  test("the seed reaches the same end state without the migration", () => {
    const seedSource = readFileSync(new URL("../../prisma/seed.ts", import.meta.url), "utf8");

    assert.match(seedSource, /processValues: \{ none: \{\} \}/);
    assert.match(seedSource, /hot_runner_zone_1_temp/);
    assert.match(seedSource, /defaultProcessSheetParameters\.map\(\(parameter, index\) =>/);
  });
});

describe("The six consecutive shots become one zoned row", () => {
  test("the shot a legacy key becomes is the number in the key, bounded by the row's width", () => {
    assert.equal(legacyShotPartWeightZoneIndex("shot_weight_1"), 1);
    assert.equal(legacyShotPartWeightZoneIndex("shot_weight_6"), 6);
    // Zone 0 is the non-zoned sentinel and a seventh shot would not render.
    assert.equal(legacyShotPartWeightZoneIndex("shot_weight_0"), null);
    assert.equal(legacyShotPartWeightZoneIndex("shot_weight_7"), null);
    assert.equal(legacyShotPartWeightZoneIndex("shot_part_weight"), null);
    // 啤机射胶重量 is the MACHINE's shot capacity — a different row entirely.
    assert.equal(legacyShotPartWeightZoneIndex("shot_capacity"), null);
    assert.equal(legacyShotPartWeightZoneIndex("hot_runner_zone_1_temp"), null);
  });

  test("the seeded default template is born as one six-zone row", () => {
    const keys: string[] = defaultProcessSheetParameters.map((parameter) => parameter.parameterKey);

    for (let shot = 1; shot <= 6; shot += 1) {
      assert.equal(keys.includes(`shot_weight_${shot}`), false, `shot_weight_${shot} still seeded`);
    }

    assert.equal(keys.filter((key) => key === SHOT_PART_WEIGHT_ZONED_PARAMETER.parameterKey).length, 1);

    const facets = processSheetParameterFacets({
      parameterKey: SHOT_PART_WEIGHT_ZONED_PARAMETER.parameterKey,
      kind: SHOT_PART_WEIGHT_ZONED_PARAMETER.kind,
      zoneCount: SHOT_PART_WEIGHT_ZONED_PARAMETER.zoneCount
    });

    assert.equal(facets.kind, "ZONED");
    // Six, because "连续六啤" IS the measurement — not the house seven.
    assert.equal(facets.zoneCount, 6);
    assert.equal(SHOT_PART_WEIGHT_ZONED_PARAMETER.section, "Six Consecutive Shots Part Weight");

    // Not on the owner's paper 工艺参数表, so it must not join the catalog.
    const catalogKeys: string[] = factoryProcessSheetCatalog.map((parameter) => parameter.parameterKey);

    assert.equal(catalogKeys.includes(SHOT_PART_WEIGHT_ZONED_PARAMETER.parameterKey), false);

    // The band reads in 中文 on EVERY template, not only the seeded default one:
    // the migration puts this row into all of them.
    const zh = translateDefaultProcessSection(dictionaries["zh-CN"], SHOT_PART_WEIGHT_ZONED_PARAMETER.section, false);

    assert.equal(zh, "连续六啤产品重量");
    assert.equal(
      translateDefaultProcessSection(dictionaries.en, SHOT_PART_WEIGHT_ZONED_PARAMETER.section, false),
      dictionaries.en["process.section.sixShotWeight"]
    );
  });

  test("the row renders as a six-wide matrix carrying the six migrated values", () => {
    const upgraded = {
      id: "shot-weight",
      parameterKey: SHOT_PART_WEIGHT_ZONED_PARAMETER.parameterKey,
      labelEn: SHOT_PART_WEIGHT_ZONED_PARAMETER.labelEn,
      kind: parseProcessSheetParameterKind(SHOT_PART_WEIGHT_ZONED_PARAMETER.kind),
      zoneCount: SHOT_PART_WEIGHT_ZONED_PARAMETER.zoneCount
    };
    const matrix = buildProcessSheetZoneMatrix({
      parameters: [upgraded],
      valueByCellKey: Object.fromEntries(
        ["553.2", "552.8", "553.4", "553", "552.9", "553.3"].map((value, index) => [
          processSheetCellKey(upgraded.id, index + 1),
          value
        ])
      )
    });

    assert.equal(matrix.zoneCount, 6);
    assert.deepEqual(
      matrix.rows[0]?.cells.map((cell) => cell.value),
      ["553.2", "552.8", "553.4", "553", "552.9", "553.3"]
    );
  });
});

describe("Zone captions say what the axis actually is", () => {
  test("the caption kind is derived from the parameter key alone", () => {
    assert.equal(processSheetZoneCaptionKind("shot_part_weight"), "SHOT");
    assert.equal(processSheetZoneCaptionKind(" Shot_Part_Weight "), "SHOT");
    assert.equal(processSheetZoneCaptionKind("shot_weight_3"), "SHOT");
    // Everything that was zoned before this feature keeps 区.
    assert.equal(processSheetZoneCaptionKind("hot_runner_temp"), "ZONE");
    assert.equal(processSheetZoneCaptionKind("injection_barrel_temp"), "ZONE");
    assert.equal(processSheetZoneCaptionKind("shot_capacity"), "ZONE");
    assert.equal(processSheetZoneCaptionKind(null), "ZONE");
    assert.equal(processSheetZoneCaptionKind(undefined), "ZONE");
    assert.equal(processSheetZoneCaptionKind(""), "ZONE");
  });

  test("a shot axis reads 第N啤 and a machine axis reads N区, in both languages", () => {
    assert.equal(processSheetZoneCaptionZh(1, "SHOT"), "第1啤");
    assert.equal(processSheetZoneCaptionZh(6, "SHOT"), "第6啤");
    assert.equal(processSheetZoneCaption(3, "SHOT", "zh-CN"), "第3啤");
    assert.equal(processSheetZoneCaption(3, "SHOT", "en"), "Shot 3");

    // The machine axis is byte-for-byte what it always was.
    for (let zone = 1; zone <= MAX_PROCESS_SHEET_ZONE_COUNT; zone += 1) {
      assert.equal(processSheetZoneCaption(zone, "ZONE", "zh-CN"), processSheetZoneLabel(zone, "zh-CN"));
      assert.equal(processSheetZoneCaption(zone, "ZONE", "en"), processSheetZoneLabel(zone, "en"));
    }
  });

  test("a section takes its first zoned row's caption kind, ignoring scalars around it", () => {
    assert.equal(
      processSheetSectionZoneCaptionKind([
        { parameterKey: "part_weight_average", kind: "SCALAR" },
        { parameterKey: "shot_part_weight", kind: "ZONED" }
      ]),
      "SHOT"
    );
    assert.equal(
      processSheetSectionZoneCaptionKind([{ parameterKey: "hot_runner_temp", kind: "ZONED" }]),
      "ZONE"
    );
    // A section with no matrix at all has no captions to get wrong.
    assert.equal(
      processSheetSectionZoneCaptionKind([{ parameterKey: "shot_part_weight", kind: "SCALAR" }]),
      "ZONE"
    );
    assert.equal(processSheetSectionZoneCaptionKind([]), "ZONE");
  });
});

describe("The section map", () => {
  const trials = ["T0", "T1"];
  const cellKeys = ["p1", "p2", "p3"];
  const stored: Record<string, string> = {
    [processSheetTrialCellKey("T0", "p1")]: "215",
    [processSheetTrialCellKey("T0", "p2")]: "  ",
    // The sheet's own placeholder for "nothing stored" — not something anyone typed.
    [processSheetTrialCellKey("T0", "p3")]: "-",
    [processSheetTrialCellKey("T1", "p1")]: "220"
  };

  test("fill counts every cell of the section across every visible trial column", () => {
    assert.deepEqual(processSheetSectionFill({ cellKeys, trialEventIds: trials, valueByTrialCellKey: stored }), {
      filled: 2,
      total: 6
    });
    // A Map reads the same as a plain record — the editor holds one of each.
    assert.deepEqual(
      processSheetSectionFill({
        cellKeys,
        trialEventIds: trials,
        valueByTrialCellKey: new Map(Object.entries(stored))
      }),
      { filled: 2, total: 6 }
    );
  });

  test("anchors are keyed by position, so a repeated section name cannot collide", () => {
    assert.equal(processSheetSectionAnchorId(0), "process-section-1");
    assert.notEqual(processSheetSectionAnchorId(0), processSheetSectionAnchorId(1));
  });

  /**
   * REVERTED 2026-08-10. The folding bands, then the two-up packing, were each
   * asserted here for a day and each rejected by the owner on sight. What this
   * test now guards is that they STAY gone — a `<details>` creeping back is the
   * exact regression he would notice first — and that the sheet is the two
   * full-width regions he settled on.
   */
  test("the editor renders the strip and always-open bands, and never folds again", () => {
    const editorSource = readFileSync(
      new URL("../../src/app/projects/[projectCode]/process-sheet-editor.tsx", import.meta.url),
      "utf8"
    );

    // The map survived both reverts: chips are plain anchors, so the jump works
    // with no JavaScript at all.
    assert.match(editorSource, /className="processSectionStrip"/);
    assert.match(editorSource, /href={`#\$\{section\.anchorId\}`}/);
    assert.match(editorSource, /className="processSectionChip"/);
    // The band is a plain header. No <details>, no <summary>, no expand/collapse.
    assert.match(editorSource, /<h3 className="processSectionBand">/);
    assert.doesNotMatch(editorSource, /<details/);
    assert.doesNotMatch(editorSource, /<summary/);
    assert.doesNotMatch(editorSource, /section\.open/);
    assert.doesNotMatch(editorSource, /expandAllSections|collapseAllSections/);
    assert.doesNotMatch(editorSource, /processSectionShort/);
    assert.doesNotMatch(editorSource, /role="tab"/);
    // The one layout fact the markup carries: a matrix section is marked, so the
    // shared trial-column width applies to everything else.
    assert.match(editorSource, /processSectionZoned/);
    assert.match(editorSource, /section\.zoneCount > 0/);
  });

  test("the sheet is two full-width regions: every flat section, then every matrix", () => {
    const editorSource = readFileSync(
      new URL("../../src/app/projects/[projectCode]/process-sheet-editor.tsx", import.meta.url),
      "utf8"
    );

    // A PARTITION, not a sort: catalog order survives inside each group.
    assert.match(editorSource, /const scalarSections = useMemo\(\(\) => sections\.filter\(\(section\) => section\.zoneCount === 0\)/);
    assert.match(editorSource, /const zonedSections = useMemo\(\(\) => sections\.filter\(\(section\) => section\.zoneCount > 0\)/);
    assert.match(editorSource, /\[\.\.\.scalarSections, \.\.\.zonedSections\]/);
    // The flat region renders first, the divider next, the matrices last.
    const scalarAt = editorSource.indexOf("{scalarSections.map((section) => renderSectionBlock(section))}");
    const dividerAt = editorSource.indexOf('className="processZonedDivider"');
    const zonedAt = editorSource.indexOf("{zonedSections.map((section) => renderSectionBlock(section))}");
    assert.ok(scalarAt > 0 && dividerAt > scalarAt && zonedAt > dividerAt, "flat region, divider, then matrices");
    // The chips follow the eye, not the catalog.
    assert.match(editorSource, /orderedSections\.map\(\(section\) => \(/);
    // The divider is bilingual through the dictionary, like every other label.
    assert.match(editorSource, /t\("process\.zonedGroup"\)/);
    // Enter walks the page AS RENDERED, so it can never disagree with Tab — the
    // order itself now comes from the pure, tested `processSheetNavigationCellKeys`
    // (2026-08-10), because a transposed section is a grid, not a run.
    assert.match(editorSource, /new Map\(\s*processSheetNavigationCellKeys\(\{/);
    assert.match(editorSource, /sections: orderedSections\.map/);
  });

  test("one shared template: every section declares the same column widths, and there are no lanes", () => {
    const cssSource = readFileSync(new URL("../../src/app/globals.css", import.meta.url), "utf8");

    // The widths are DECLARED, once, on the class every section's table carries
    // — which is what makes the trial-column headers align across sections
    // without anything measuring anything.
    assert.match(cssSource, /--processLabelCol: 17rem;/);
    assert.match(
      cssSource,
      /--processTrialCol: calc\(var\(--processScalarCellWidth\) \+ 2 \* var\(--processCellPadX\)\);/
    );
    assert.match(cssSource, /--processScalarCellWidth: 10rem;/);
    assert.match(cssSource, /--processZoneCellWidth: 5\.5rem;/);
    // The label column is a fixed track, not a 260–320px range two sections may
    // resolve differently.
    assert.match(cssSource, /width: var\(--processLabelCol\);/);
    assert.doesNotMatch(cssSource, /min-width: 260px;\n {2}max-width: 320px;/);
    // PACKING IS GONE (2026-08-10). The sections container declares NO tracks,
    // which is one implicit column at every width; the xl breakpoint that made
    // two lanes is deleted, and nothing spans them any more. (The rest of the
    // file has its own unrelated two-column grids — these checks are scoped.)
    assert.doesNotMatch(cssSource, /@media \(min-width: 1440px\)/);
    assert.doesNotMatch(cssSource, /\.processSheetSections \{[^}]*grid-template-columns/s);
    assert.doesNotMatch(cssSource, /\.processSectionZoned \{/);
    assert.doesNotMatch(cssSource, /\.processSectionShort/);
    assert.doesNotMatch(cssSource, /\.processSheetSections \{[^}]*grid-auto-flow/s);
    assert.match(cssSource, /\.processSheetSections \{\n {2}display: grid;/);
    // The seam between the two regions is its own slim rule, not a third band.
    assert.match(cssSource, /\.processZonedDivider \{/);
  });
});

/**
 * THE TRANSPOSED MATRIX (2026-08-10). A zoned section with ONE row printed the
 * ordinary way repeats that row's zone boxes once per trial column — twelve
 * hot-runner tips across three trials is thirty-six boxes on one line, and the
 * comparison the owner is actually making runs sideways off the screen. Zones
 * across, trials down, and it runs down the page instead.
 */
describe("A one-parameter matrix is transposed", () => {
  test("the rule is exactly 'zoned, and one parameter' — nothing about which section it is", () => {
    // 热流道 (12 tips) and 连续六啤 (6 shots): one row each.
    assert.equal(isTransposedProcessSheetSection({ zoneCount: 12, parameterCount: 1 }), true);
    assert.equal(isTransposedProcessSheetSection({ zoneCount: 6, parameterCount: 1 }), true);
    // 注塑 and 保压 already compare something DOWN their rows — left alone.
    assert.equal(isTransposedProcessSheetSection({ zoneCount: 7, parameterCount: 4 }), false);
    assert.equal(isTransposedProcessSheetSection({ zoneCount: 7, parameterCount: 3 }), false);
    // A flat section is never transposed, however few rows it has.
    assert.equal(isTransposedProcessSheetSection({ zoneCount: 0, parameterCount: 1 }), false);
    assert.equal(isTransposedProcessSheetSection({ zoneCount: 0, parameterCount: 0 }), false);
  });

  test("on the real template exactly 热流道 and 连续六啤 transpose, and 注塑 / 保压 do not", () => {
    // The seeded template is this list followed by the owner's paper catalog —
    // the same order the editor groups into bands.
    const seededRows: ReadonlyArray<{ section: string; kind?: string; zoneCount?: number }> = [
      ...defaultProcessSheetParameters,
      ...factoryProcessSheetCatalog
    ];
    const templateRows = seededRows.map((parameter) => {
      const kind = parseProcessSheetParameterKind(parameter.kind);

      return {
        section: parameter.section,
        kind,
        zoneCount: parseProcessSheetZoneCount(parameter.zoneCount ?? null, kind) ?? 0
      };
    });
    const bands = templateRows.reduce<Array<{ section: string; rows: typeof templateRows }>>((groups, row) => {
      const last = groups.at(-1);

      if (last != null && last.section === row.section) {
        last.rows.push(row);
      } else {
        groups.push({ section: row.section, rows: [row] });
      }

      return groups;
    }, []);
    const transposed: string[] = bands
      .filter((band) =>
        isTransposedProcessSheetSection({
          // The band's matrix is as wide as its WIDEST zoned row, exactly as
          // `buildProcessSheetZoneMatrix` computes it for the screen.
          zoneCount: band.rows.reduce((widest, row) => Math.max(widest, row.zoneCount), 0),
          parameterCount: band.rows.length
        })
      )
      .map((band) => band.section);

    // The multi-row matrices stay matrices. (Checked BEFORE the deepEqual below:
    // `assert/strict` narrows its first argument to the expected tuple type.)
    assert.equal(transposed.includes("Injection Profile"), false);
    assert.equal(transposed.includes("Hold Profile"), false);
    assert.deepEqual(transposed, [
      HOT_RUNNER_ZONED_PARAMETER.section,
      SHOT_PART_WEIGHT_ZONED_PARAMETER.section
    ]);
  });

  test("Enter walks a transposed section ROW-MAJOR: the editable trial's zones, left to right", () => {
    const sections = [
      // Region 1: the flat sections.
      { zoneCount: 0, parameters: [{ id: "flat", kind: "SCALAR" as const, zoneCount: null }] },
      // Region 2: an ordinary matrix (rows are parameters), then a transposed one.
      {
        zoneCount: 3,
        parameters: [
          { id: "zA", kind: "ZONED" as const, zoneCount: 3 },
          { id: "zB", kind: "ZONED" as const, zoneCount: 2 }
        ]
      },
      { zoneCount: 4, parameters: [{ id: "hot", kind: "ZONED" as const, zoneCount: 4 }] }
    ];
    const walk = (editableTrialEventId: string | null) =>
      processSheetNavigationCellKeys({ sections, trialEventIds: ["T0", "T1", "T2"], editableTrialEventId });

    assert.deepEqual(walk("T1"), [
      "flat",
      "zA#1",
      "zA#2",
      "zA#3",
      "zB#1",
      "zB#2",
      // ONE unbroken run of zones — never zone 1 of every trial, then zone 2.
      "hot#1",
      "hot#2",
      "hot#3",
      "hot#4"
    ]);
    // The editable row moves up and down the section; the run does not split.
    assert.deepEqual(walk("T0"), walk("T1"));
    assert.deepEqual(walk("T2"), walk("T1"));
  });

  test("the transposed section contributes the same cells as the flat list, exactly once", () => {
    const sections = [{ zoneCount: 6, parameters: [{ id: "shot", kind: "ZONED" as const, zoneCount: 6 }] }];
    const keys = processSheetNavigationCellKeys({
      sections,
      trialEventIds: ["T0", "T1", "T2"],
      editableTrialEventId: "T2"
    });

    // Three trial ROWS print, but only the editable one holds inputs — six cells,
    // not eighteen, so the walk index and the change count still count the same
    // thing and the save sees the same `value:<cell>` names it always did.
    assert.equal(keys.length, 6);
    assert.deepEqual(new Set(keys).size, 6);
    assert.deepEqual(keys, [1, 2, 3, 4, 5, 6].map((zone) => processSheetCellKey("shot", zone)));
    // A sheet with nothing editable walks nothing at all: there are no inputs.
    assert.deepEqual(
      processSheetNavigationCellKeys({ sections, trialEventIds: ["T0"], editableTrialEventId: null }),
      []
    );
  });

  test("the editor renders trials as rows, zone captions as the header, and every trial row prints", () => {
    const editorSource = readFileSync(
      new URL("../../src/app/projects/[projectCode]/process-sheet-editor.tsx", import.meta.url),
      "utf8"
    );
    const cssSource = readFileSync(new URL("../../src/app/globals.css", import.meta.url), "utf8");

    // The shape is DERIVED from the section, not hard-coded per section name.
    assert.match(editorSource, /isTransposedProcessSheetSection\(\{\s*zoneCount,\s*parameterCount: section\.parameters\.length/);
    assert.match(editorSource, /if \(section\.transposed && onlyParameter != null\)/);
    // Trials are rows, labelled by code and status; the empty ones render too,
    // because an empty row is where the next trial's numbers get typed.
    assert.match(editorSource, /processTrialRowLabel/);
    assert.match(editorSource, /trials\.map\(\(trial\) => \{/);
    // Save semantics are untouched: the same hidden parameter id, the same
    // `value:<cellKey>` inputs the ordinary matrix posts.
    assert.match(editorSource, /<input type="hidden" name="processParameterId" value=\{parameter\.id\} \/>/);
    // The zones share the row in equal fractions instead of fixed tracks.
    assert.match(cssSource, /\.processZoneCellsFluid \{\n {2}grid-template-columns: repeat\(var\(--processZoneCount, 7\), minmax\(0, 1fr\)\);/);
    assert.match(cssSource, /\.processSheetTable\.processTransposedTable \{\n {2}width: 100%;/);
    // …down to a floor, so a narrow window scrolls the row instead of crushing it.
    assert.match(
      cssSource,
      /min-width: calc\(var\(--processLabelCol\) \+ var\(--processZoneCount, 7\) \* 3rem\);/
    );
    // The ordinary matrix keeps its fixed 5.5rem zone track.
    assert.match(
      cssSource,
      /\.processZoneCells \{[^}]*grid-template-columns: repeat\(var\(--processZoneCount, 7\), var\(--processZoneCellWidth, 5\.5rem\)\);/s
    );
  });
});

describe("The six-shot migration", () => {
  const statements = shotWeightMigrationSql
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");

  test("it creates one six-zone row per template and never a second one", () => {
    assert.match(shotWeightMigrationSql, /'shot_part_weight'/);
    assert.match(shotWeightMigrationSql, /'连续六啤产品重量'/);
    assert.match(shotWeightMigrationSql, /'ZONED'/);
    assert.match(shotWeightMigrationSql, /FROM "process_sheet_templates" t/);
    assert.match(shotWeightMigrationSql, /WHERE NOT EXISTS \(/);
    assert.match(shotWeightMigrationSql, /ON CONFLICT \("process_sheet_template_id", "parameter_key"\) DO NOTHING;/);
    // The width in the SQL is the width the domain row declares.
    assert.equal(shotWeightMigrationSql.includes(`  ${SHOT_PART_WEIGHT_ZONED_PARAMETER.zoneCount},`), true);
    // Data only — every column it touches arrived with 20260807120000.
    assert.doesNotMatch(statements, /ALTER TABLE/);
  });

  test("the stored values MOVE, which is what keeps them attached to their trial", () => {
    assert.match(shotWeightMigrationSql, /UPDATE "trial_process_values" v/);
    assert.match(shotWeightMigrationSql, /"process_sheet_parameter_id" = target\."id"/);
    assert.match(shotWeightMigrationSql, /"zone_index" = legacy\."zone_index"/);
    assert.doesNotMatch(shotWeightMigrationSql, /INSERT INTO "trial_process_values"/);
    // The same bound `legacyShotPartWeightZoneIndex` applies, in the pattern and
    // again in the WHERE clause.
    assert.match(shotWeightMigrationSql, /\^shot_weight_\[1-6\]\$/);
    assert.match(
      shotWeightMigrationSql,
      new RegExp(`BETWEEN 1 AND ${SHOT_PART_WEIGHT_ZONED_PARAMETER.zoneCount}`)
    );
    // Re-runnable: a target cell that already holds a value is left alone.
    assert.match(shotWeightMigrationSql, /AND NOT EXISTS \(/);
  });

  test("every delete is guarded by zero stored values", () => {
    const deletes = statements.split(/DELETE FROM/).slice(1);

    assert.equal(deletes.length, 1);

    for (const statement of deletes) {
      const body = statement.split(";")[0] ?? "";

      assert.match(body, /NOT EXISTS/);
      assert.match(body, /"trial_process_values"/);
    }
  });

  test("the seed reaches the same end state without the migration", () => {
    const seedSource = readFileSync(new URL("../../prisma/seed.ts", import.meta.url), "utf8");

    // Same safety net as the hot-runner pair: retire the legacy rows only when
    // they hold nothing.
    assert.match(seedSource, /"shot_weight_1", "shot_weight_2"/);
    assert.match(seedSource, /processValues: \{ none: \{\} \}/);
    // And seed the demo values as six ZONES of one row, not six rows.
    assert.match(seedSource, /shot_part_weight: \[/);
    assert.match(seedSource, /trialProcessValueZoneWrite\(zoneIndex\)/);
  });
});

describe("The sheet renders and saves every kind", () => {
  const editorSource = readFileSync(
    new URL("../../src/app/projects/[projectCode]/process-sheet-editor.tsx", import.meta.url),
    "utf8"
  );
  const actionSource = readFileSync(new URL("../../src/server/mold-trial-actions.ts", import.meta.url), "utf8");

  test("the editor renders the zone matrix, the choice select and the flag boxes", () => {
    assert.match(editorSource, /buildProcessSheetZoneMatrix/);
    assert.match(editorSource, /processZoneCells/);
    assert.match(editorSource, /processZoneCaption/);
    assert.match(editorSource, /processChoiceSelect/);
    assert.match(editorSource, /processFlagOptions/);
    assert.match(editorSource, /type="checkbox"/);
    assert.match(editorSource, /processSheetCellKey/);
    // A value stored before the row became an option list is SHOWN, in both
    // renderers, instead of rendering as an empty cell (2026-08-08).
    assert.match(editorSource, /processSheetOptionValueView\(\{/);
    assert.match(editorSource, /optionView\.legacy == null \? null : \(/);
    assert.match(editorSource, /processLegacyValue/);
    // Copy Previous Trial works over the cell keys, zones included.
    assert.match(editorSource, /copyableKeys: copyableCellKeys/);
    // Nested components would remount the inputs and steal focus mid-typing.
    assert.doesNotMatch(editorSource, /function ZoneCells\(/);
    assert.doesNotMatch(editorSource, /function ScalarCellInput\(/);
  });

  test("the save action writes one row per zone and validates choices against the stored options", () => {
    assert.match(actionSource, /processSheetCellsForParameter/);
    assert.match(actionSource, /trialProcessValueCellWhere\(\{/);
    assert.match(actionSource, /\.\.\.trialProcessValueZoneWrite\(zoneIndex\)/);
    assert.match(actionSource, /parseProcessSheetChoiceValue/);
    assert.match(actionSource, /deserializeProcessSheetFlagValues/);
    // The Excel export replaced the text projection: a zoned row is a matrix
    // of zone columns, built from the same cell keys the save path writes.
    assert.match(actionSource, /buildProcessSheetWorkbook\(\{/);
    assert.match(actionSource, /zoneValues: Array\.from\(\{ length: zoneCount \}/);
    // An unchanged pre-option-list value must not fail the save (CHOICE used to
    // throw, which would have blocked the whole sheet) nor be silently dropped.
    assert.match(actionSource, /isUnchangedLegacyProcessSheetOptionValue\(\{/);
    assert.match(actionSource, /const keepLegacyValue =/);
    // The old two-column compound key is gone from every write path.
    assert.doesNotMatch(actionSource, /trialEventId_processSheetParameterId:/);
  });

  test("the e2e sentinel heading is untouched", () => {
    const pageSource = readFileSync(
      new URL("../../src/app/projects/[projectCode]/page.tsx", import.meta.url),
      "utf8"
    );

    assert.match(pageSource, /project\.digitalProcessSheet/);
    assert.equal(dictionaries.en["project.digitalProcessSheet"], "Digital Process Sheet");
  });
});
