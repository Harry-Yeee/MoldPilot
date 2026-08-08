/**
 * The factory's own paper process sheet, transcribed 工艺参数表.
 *
 * The owner's sheet is not a flat list of numbers. Four shapes appear on it:
 *
 *   SCALAR  one value per trial — what the sheet has always stored.
 *   ZONED   one value per machine ZONE per trial (一区…七区). On paper this is a
 *           small table drawn INSIDE the big table: rows are the parameters of a
 *           section, columns are the zones. Machines differ, so zones the
 *           machine does not have stay blank — sparse is normal, not an error.
 *   CHOICE  exactly one of a fixed list (操作: 手动 / 半自动 / 全自动).
 *   FLAGS   any number of a fixed list (入水: 大 / 细 / 潜水 / 热流道).
 *
 * `ProcessSheetParameter.kind` carries the shape, `zoneCount` how many zones a
 * zoned parameter has (7 on this factory's machines), and `options` the fixed
 * list for CHOICE / FLAGS. Everything already in the template keeps working
 * untouched: a row with no kind reads as SCALAR, which is what
 * `parseProcessSheetParameterKind` returns for null/undefined/garbage.
 *
 * This module is PURE. It is the single source of truth for the catalog, for
 * the cell-key encoding that lets zoned values ride the existing copy-previous
 * machinery unchanged, and for the CHOICE/FLAGS text encoding that keeps
 * `value_text` readable in the customer Excel export.
 */

import type { BilingualLabel } from "./labels.ts";

export const processSheetParameterKinds = ["SCALAR", "ZONED", "CHOICE", "FLAGS"] as const;

export type ProcessSheetParameterKind = (typeof processSheetParameterKinds)[number];

/** This factory's machines have seven barrel/hold zones. */
export const DEFAULT_PROCESS_SHEET_ZONE_COUNT = 7;

/** A sanity ceiling so a bad row can never render hundreds of inputs. */
export const MAX_PROCESS_SHEET_ZONE_COUNT = 12;

/**
 * `trial_process_values.zone_index` for everything that is NOT zoned.
 *
 * A SENTINEL, not NULL, and that is the whole unique-constraint decision:
 * Postgres treats NULLs as distinct inside a UNIQUE index, so a nullable
 * zone_index would let the same (trial, parameter) cell be inserted twice with
 * no error. Zones are numbered from 1, so 0 can never collide with a real one.
 */
export const NON_ZONED_ZONE_INDEX = 0;

const processSheetParameterKindSet: ReadonlySet<string> = new Set<string>(processSheetParameterKinds);

/**
 * The stored `kind`, defaulted to SCALAR.
 *
 * Absent (a generated client that predates the migration, or a row written
 * before it), unknown, or mis-cased all read as SCALAR — the shape every
 * pre-existing parameter has.
 */
export function parseProcessSheetParameterKind(raw: string | null | undefined): ProcessSheetParameterKind {
  const normalized = raw == null ? "" : raw.trim().toUpperCase();
  return processSheetParameterKindSet.has(normalized) ? (normalized as ProcessSheetParameterKind) : "SCALAR";
}

export function isZonedProcessSheetKind(kind: ProcessSheetParameterKind): boolean {
  return kind === "ZONED";
}

export function isOptionProcessSheetKind(kind: ProcessSheetParameterKind): boolean {
  return kind === "CHOICE" || kind === "FLAGS";
}

/**
 * Zone count for a parameter: null unless the parameter is ZONED, otherwise the
 * stored count clamped to 1…12, and 7 when nothing is stored.
 */
export function parseProcessSheetZoneCount(
  raw: number | null | undefined,
  kind: ProcessSheetParameterKind
): number | null {
  if (!isZonedProcessSheetKind(kind)) {
    return null;
  }

  if (raw == null || !Number.isFinite(raw)) {
    return DEFAULT_PROCESS_SHEET_ZONE_COUNT;
  }

  const rounded = Math.trunc(raw);
  if (rounded < 1) {
    return DEFAULT_PROCESS_SHEET_ZONE_COUNT;
  }

  return Math.min(rounded, MAX_PROCESS_SHEET_ZONE_COUNT);
}

/** The stored option list: trimmed, de-duplicated, blanks dropped, order kept. */
export function parseProcessSheetOptions(raw: readonly string[] | null | undefined): string[] {
  if (raw == null) {
    return [];
  }

  const seen = new Set<string>();
  const options: string[] = [];

  for (const value of raw) {
    const trimmed = value.trim();
    if (trimmed.length === 0 || seen.has(trimmed)) {
      continue;
    }

    seen.add(trimmed);
    options.push(trimmed);
  }

  return options;
}

export type ProcessSheetParameterFacets = {
  kind: ProcessSheetParameterKind;
  zoneCount: number | null;
  options: string[];
};

/**
 * Read the three new columns off a `ProcessSheetParameter` row.
 *
 * `parameterKey` is REQUIRED on purpose. All three new fields are optional here
 * so a generated client that predates the 2026-08-07 migration still typechecks
 * (they simply read as absent) — and TypeScript's weak-type rule rejects an
 * all-optional parameter type, exactly the lesson the archive read seams
 * recorded. The required key is what keeps this callable.
 */
export function processSheetParameterFacets(parameter: {
  parameterKey: string;
  kind?: string | null;
  zoneCount?: number | null;
  options?: string[] | null;
}): ProcessSheetParameterFacets {
  const kind = parseProcessSheetParameterKind(parameter.kind);

  return {
    kind,
    zoneCount: parseProcessSheetZoneCount(parameter.zoneCount, kind),
    options: isOptionProcessSheetKind(kind) ? parseProcessSheetOptions(parameter.options) : []
  };
}

/** Read `zone_index` off a stored value row, sentinel-safe and stale-client-safe. */
export function processValueZoneIndex(value: {
  processSheetParameterId: string;
  zoneIndex?: number | null;
}): number {
  const raw = value.zoneIndex;
  if (raw == null || !Number.isFinite(raw) || raw < 0) {
    return NON_ZONED_ZONE_INDEX;
  }

  return Math.trunc(raw);
}

/**
 * The editor/copy-forward cell key.
 *
 * Copy Previous Trial works over a flat `Record<key, value>` and does not care
 * what the keys mean, so encoding the zone INTO the key is what makes zones
 * copy forward with no change to `copyPreviousTrialProcessSheetValues` at all.
 * Non-zoned cells keep the bare parameter id, so every key that existed before
 * this feature still reads exactly the same.
 */
export function processSheetCellKey(parameterId: string, zoneIndex?: number | null): string {
  const zone = zoneIndex == null ? NON_ZONED_ZONE_INDEX : Math.trunc(zoneIndex);
  return zone === NON_ZONED_ZONE_INDEX ? parameterId : `${parameterId}#${zone}`;
}

export function parseProcessSheetCellKey(key: string): { parameterId: string; zoneIndex: number } {
  const separator = key.lastIndexOf("#");
  if (separator <= 0) {
    return { parameterId: key, zoneIndex: NON_ZONED_ZONE_INDEX };
  }

  const zone = Number.parseInt(key.slice(separator + 1), 10);
  if (!Number.isFinite(zone) || zone <= 0) {
    return { parameterId: key, zoneIndex: NON_ZONED_ZONE_INDEX };
  }

  return { parameterId: key.slice(0, separator), zoneIndex: zone };
}

const chineseZoneNumerals = ["一", "二", "三", "四", "五", "六", "七", "八", "九", "十", "十一", "十二"];

/** 一区 / 二区 … — the column captions on the owner's paper matrix. */
export function processSheetZoneLabelZh(zoneIndex: number): string {
  const numeral = chineseZoneNumerals[zoneIndex - 1];
  return numeral == null ? `${zoneIndex}区` : `${numeral}区`;
}

export function processSheetZoneLabelEn(zoneIndex: number): string {
  return `Zone ${zoneIndex}`;
}

export function processSheetZoneLabel(zoneIndex: number, language: string): string {
  return language === "zh-CN" ? processSheetZoneLabelZh(zoneIndex) : processSheetZoneLabelEn(zoneIndex);
}

/**
 * WHAT A ZONED ROW'S COLUMNS ARE CALLED (2026-08-09).
 *
 * Every zoned row until now was a MACHINE axis — 炮筒温度, 射胶压力, 热流道温度 —
 * so `一区…七区` was the only caption the matrix ever needed. 连续六啤产品重量 is
 * the same SHAPE with a different axis: its six columns are six consecutive
 * SHOTS, and calling shot 3 "三区" would be wrong on the owner's own paper, which
 * says 第三啤.
 *
 * The caption is therefore derived from the PARAMETER KEY, not stored. That is
 * deliberate and it is why this needs no schema change at all: a caption is a
 * property of what the row means, the row's key already says what it means, and
 * a `zone_caption_kind` column would be a second place for the same fact to be
 * wrong. Anything this function does not recognise reads as ZONE — the axis
 * every pre-existing zoned row has.
 */
export const processSheetZoneCaptionKinds = ["ZONE", "SHOT"] as const;

export type ProcessSheetZoneCaptionKind = (typeof processSheetZoneCaptionKinds)[number];

/**
 * The ZONED 连续六啤产品重量 row that replaces the six `shot_weight_<N>` scalars.
 *
 * The key lives HERE, next to the caption function that reads it, rather than
 * beside the row definition in `process-sheet.ts`: that module imports this one,
 * so the reverse would be a cycle.
 */
export const SHOT_PART_WEIGHT_PARAMETER_KEY = "shot_part_weight";

/** The six fixed rows the ZONED row replaces: `shot_weight_<N>`. */
export const LEGACY_SHOT_PART_WEIGHT_PARAMETER_KEY_PATTERN = /^shot_weight_(\d+)$/;

/** Which caption a zoned row's columns take. Unknown keys are 区, the old default. */
export function processSheetZoneCaptionKind(
  parameterKey: string | null | undefined
): ProcessSheetZoneCaptionKind {
  const key = parameterKey == null ? "" : parameterKey.trim().toLowerCase();

  if (key.length === 0) {
    return "ZONE";
  }

  return key === SHOT_PART_WEIGHT_PARAMETER_KEY || LEGACY_SHOT_PART_WEIGHT_PARAMETER_KEY_PATTERN.test(key)
    ? "SHOT"
    : "ZONE";
}

/** 一区 / 二区 … for a machine axis, 第1啤 / 第2啤 … for a shot axis. */
export function processSheetZoneCaptionZh(
  zoneIndex: number,
  captionKind: ProcessSheetZoneCaptionKind
): string {
  // Arabic numerals for shots on purpose: 第11啤 stays one glance wide, and the
  // count is a sequence number, not the ordinal name of a machine section.
  return captionKind === "SHOT" ? `第${zoneIndex}啤` : processSheetZoneLabelZh(zoneIndex);
}

export function processSheetZoneCaptionEn(
  zoneIndex: number,
  captionKind: ProcessSheetZoneCaptionKind
): string {
  return captionKind === "SHOT" ? `Shot ${zoneIndex}` : processSheetZoneLabelEn(zoneIndex);
}

export function processSheetZoneCaption(
  zoneIndex: number,
  captionKind: ProcessSheetZoneCaptionKind,
  language: string
): string {
  return language === "zh-CN"
    ? processSheetZoneCaptionZh(zoneIndex, captionKind)
    : processSheetZoneCaptionEn(zoneIndex, captionKind);
}

/**
 * A section's caption kind is its FIRST zoned row's.
 *
 * The captions are one row above the whole section's matrix, so a section can
 * only have one axis. Nothing on the paper sheet mixes them — 连续六啤产品重量 is
 * alone in its band — and if a hand-built template ever did, the first row wins
 * and the mismatch is visible rather than silently averaged.
 */
export function processSheetSectionZoneCaptionKind(
  parameters: readonly { parameterKey: string; kind: ProcessSheetParameterKind }[]
): ProcessSheetZoneCaptionKind {
  const firstZoned = parameters.find((parameter) => isZonedProcessSheetKind(parameter.kind));
  return processSheetZoneCaptionKind(firstZoned?.parameterKey);
}

export type ProcessSheetMatrixParameter = {
  id: string;
  parameterKey: string;
  labelEn: string;
  labelZh?: string | null;
  unit?: string | null;
  kind: ProcessSheetParameterKind;
  zoneCount?: number | null;
};

export type ProcessSheetMatrixCell = {
  zoneIndex: number;
  cellKey: string;
  /** False when this parameter has fewer zones than the section — render nothing. */
  available: boolean;
  value: string;
};

export type ProcessSheetMatrixRow = {
  parameter: ProcessSheetMatrixParameter;
  cells: ProcessSheetMatrixCell[];
};

export type ProcessSheetZoneMatrix = {
  zoneCount: number;
  zoneIndexes: number[];
  rows: ProcessSheetMatrixRow[];
};

/**
 * Build the "table inside a table": rows are the ZONED parameters of one
 * section, columns are 一区…N区.
 *
 * The section's width is the MAX zoneCount among its parameters, so a section
 * mixing a 7-zone and a 3-zone parameter still lines up; the short parameter's
 * extra columns come back `available: false`. Missing values are blank strings —
 * a worker fills only the zones the machine actually has, and a blank cell is
 * data, not an error.
 */
export function buildProcessSheetZoneMatrix(input: {
  parameters: readonly ProcessSheetMatrixParameter[];
  valueByCellKey?: ReadonlyMap<string, string> | Record<string, string | null | undefined>;
}): ProcessSheetZoneMatrix {
  const zonedParameters = input.parameters.filter((parameter) => isZonedProcessSheetKind(parameter.kind));
  const source = input.valueByCellKey;
  const readValue = (cellKey: string): string => {
    if (source == null) {
      return "";
    }

    const raw = source instanceof Map ? source.get(cellKey) : (source as Record<string, string | null | undefined>)[cellKey];

    return raw == null ? "" : raw;
  };
  const zoneCount = zonedParameters.reduce((widest, parameter) => {
    const count = parseProcessSheetZoneCount(parameter.zoneCount, parameter.kind) ?? 0;
    return Math.max(widest, count);
  }, 0);
  const zoneIndexes = Array.from({ length: zoneCount }, (_unused, index) => index + 1);

  return {
    zoneCount,
    zoneIndexes,
    rows: zonedParameters.map((parameter) => {
      const ownZoneCount = parseProcessSheetZoneCount(parameter.zoneCount, parameter.kind) ?? 0;

      return {
        parameter,
        cells: zoneIndexes.map((zoneIndex) => {
          const cellKey = processSheetCellKey(parameter.id, zoneIndex);

          return {
            zoneIndex,
            cellKey,
            available: zoneIndex <= ownZoneCount,
            value: zoneIndex <= ownZoneCount ? readValue(cellKey) : ""
          };
        })
      };
    })
  };
}

/**
 * THE SECTION MAP (2026-08-09, cut back 2026-08-10) — the answer to "wall of
 * fields", chosen over tabs because the owner compares trials LINE BY LINE and
 * tabs would put the line he is reading and the line he is comparing it to on
 * different screens.
 *
 * ONE pure fact drives it now:
 *
 *   fill    how much of a section is actually filled, across every visible
 *           trial column — the chip's "12/21". Computed from the STORED values,
 *           because the chip is a statement about what is SAVED.
 *
 * Two others were here for a day and are GONE, both reverted by the owner:
 * `isProcessSheetSectionOpen` (sections do not fold any more — every band is
 * always open) and `isShortProcessSheetSection` (the ≤5-row test that let one
 * section be half the width of its neighbour; every non-matrix section now takes
 * exactly one lane, and "is it a matrix" is `zoneCount > 0`, which the editor
 * already has from `buildProcessSheetZoneMatrix`).
 */

/** How the editor keys one stored cell: (trial column, parameter cell). */
export function processSheetTrialCellKey(trialEventId: string, cellKey: string): string {
  return `${trialEventId}:${cellKey}`;
}

export type ProcessSheetSectionFill = {
  /** Cells that hold a value, across every visible trial column. */
  filled: number;
  /** Cells the section has, across every visible trial column. */
  total: number;
};

/**
 * A section's fill across the visible trial columns.
 *
 * Counting over ALL the columns, not just the editable one, is what makes the
 * chip honest on a project with three trials: a section T0 filled and T2 left
 * blank is half done, and saying "21/21" because one column is complete would
 * hide exactly the gap the owner is looking for.
 *
 * "-" counts as EMPTY. It is the sheet's own placeholder for a missing value
 * (`displayValue`), not something anyone typed.
 */
export function processSheetSectionFill(input: {
  /** Every cell of the section: one per parameter, or one per zone when zoned. */
  cellKeys: readonly string[];
  trialEventIds: readonly string[];
  valueByTrialCellKey: ReadonlyMap<string, string> | Record<string, string | null | undefined>;
}): ProcessSheetSectionFill {
  const source = input.valueByTrialCellKey;
  const read = (key: string): string => {
    const raw =
      source instanceof Map ? source.get(key) : (source as Record<string, string | null | undefined>)[key];

    return raw == null ? "" : raw.trim();
  };
  let filled = 0;

  for (const trialEventId of input.trialEventIds) {
    for (const cellKey of input.cellKeys) {
      const value = read(processSheetTrialCellKey(trialEventId, cellKey));

      if (value.length > 0 && value !== "-") {
        filled += 1;
      }
    }
  }

  return { filled, total: input.cellKeys.length * input.trialEventIds.length };
}

/**
 * The scroll target for one section band.
 *
 * By POSITION, not by name: section names are 中文, are user-visible text, and
 * two templates may legitimately reuse one. The position is what the chip strip
 * and the band agree on, and both are rendered from the same list in the same
 * order.
 */
export function processSheetSectionAnchorId(sectionIndex: number): string {
  return `process-section-${sectionIndex + 1}`;
}

/**
 * TRANSPOSED SECTIONS (2026-08-10, the owner's refinement).
 *
 * A zoned section with exactly ONE parameter has nothing to compare down its
 * rows — the parameter IS the section (热流道温度 alone in 热流道, 连续六啤产品重量
 * alone in its band). Printed the ordinary way, that single row repeats its N
 * zone boxes once per TRIAL COLUMN, side by side: twelve hot-runner tips × three
 * trials is thirty-six boxes on one line and the owner is scrolling SIDEWAYS to
 * compare T0 against T1 — the one movement this whole screen exists to avoid.
 *
 * Transposed, the zone captions become the header row across the FULL sheet
 * width and every trial gets a ROW of its own, so the comparison runs DOWN the
 * page, which is the direction the page already scrolls. Same cells, same keys,
 * same fill count — only the arrangement moves.
 *
 * The rule is exactly "zoned, and one parameter", derived and never stored: a
 * multi-parameter matrix (注塑, 保压) already compares something down its rows and
 * is left alone, and a template that later adds a second row to 热流道 gets the
 * ordinary matrix on the next render with no code change at all.
 */
export function isTransposedProcessSheetSection(section: {
  /** The section's matrix width — `0` for a flat (SCALAR/CHOICE/FLAGS) section. */
  zoneCount: number;
  parameterCount: number;
}): boolean {
  return section.zoneCount > 0 && section.parameterCount === 1;
}

export type ProcessSheetNavigationParameter = {
  id: string;
  kind: ProcessSheetParameterKind;
  zoneCount?: number | null;
};

export type ProcessSheetNavigationSection = {
  /** The section's matrix width, i.e. `buildProcessSheetZoneMatrix().zoneCount`. */
  zoneCount: number;
  parameters: readonly ProcessSheetNavigationParameter[];
};

/** One parameter's cells: one per zone when zoned, otherwise exactly one. */
function navigationCellKeys(parameter: ProcessSheetNavigationParameter): string[] {
  if (!isZonedProcessSheetKind(parameter.kind)) {
    return [processSheetCellKey(parameter.id)];
  }

  const zoneCount = parseProcessSheetZoneCount(parameter.zoneCount, parameter.kind) ?? 0;
  return Array.from({ length: zoneCount }, (_unused, index) => processSheetCellKey(parameter.id, index + 1));
}

/**
 * Every editable cell of the sheet IN RENDER ORDER — what Enter / Shift+Enter
 * walk, and the only reason this is not simply the catalog order.
 *
 * `sections` arrives ALREADY PARTITIONED (flat sections, then matrices), so the
 * walk follows the two regions the eye sees rather than the order the template
 * stores. Inside an ordinary section a row is a parameter, so its zones run
 * left→right and the parameters follow.
 *
 * A TRANSPOSED section is walked ROW-MAJOR: one trial row at a time, its zones
 * left→right, then the next trial row. Only the editable trial's row holds
 * inputs — the others are read-only text — so in practice one run of zones comes
 * out of the whole section, and it comes out in the position the editable row
 * occupies. Written the other way round (zone 1 of every trial, then zone 2…)
 * Enter would jump between trial rows on every keystroke the day a second column
 * becomes editable; the order is fixed here so that cannot happen by accident.
 */
export function processSheetNavigationCellKeys(input: {
  sections: readonly ProcessSheetNavigationSection[];
  /** Trial columns in render order — a transposed section prints one row each. */
  trialEventIds: readonly string[];
  /** The single trial whose row holds inputs; every other row is read-only. */
  editableTrialEventId: string | null;
}): string[] {
  return input.sections.flatMap((section) => {
    const sectionCellKeys = section.parameters.flatMap(navigationCellKeys);

    if (
      !isTransposedProcessSheetSection({
        zoneCount: section.zoneCount,
        parameterCount: section.parameters.length
      })
    ) {
      return sectionCellKeys;
    }

    return input.trialEventIds.flatMap((trialEventId) =>
      trialEventId === input.editableTrialEventId ? sectionCellKeys : []
    );
  });
}

/**
 * FLAGS are stored in `value_text` as the chosen options joined by ", ".
 *
 * Readable storage is deliberate: the customer Excel export and every snapshot column
 * print `value_text` verbatim, so an encoded blob would leak into the export.
 * None of the option words contain a comma, so the round trip is exact.
 */
export const PROCESS_SHEET_FLAGS_SEPARATOR = ", ";

/** The chosen flags, allowlisted and always in the option list's own order. */
export function parseProcessSheetFlagValues(
  raw: readonly string[] | null | undefined,
  options: readonly string[]
): string[] {
  const submitted = new Set((raw ?? []).map((value) => value.trim()));
  return parseProcessSheetOptions(options).filter((option) => submitted.has(option));
}

export function serializeProcessSheetFlagValues(values: readonly string[]): string {
  return values.join(PROCESS_SHEET_FLAGS_SEPARATOR);
}

/** Stored text back to the checked boxes (allowlisted, canonical order). */
export function deserializeProcessSheetFlagValues(
  raw: string | null | undefined,
  options: readonly string[]
): string[] {
  if (raw == null) {
    return [];
  }

  return parseProcessSheetFlagValues(raw.split(","), options);
}

/** The chosen option for a CHOICE parameter, or null when nothing is chosen. */
export function parseProcessSheetChoiceValue(
  raw: string | null | undefined,
  options: readonly string[]
): string | null {
  const trimmed = raw == null ? "" : raw.trim();
  if (trimmed.length === 0) {
    return null;
  }

  return parseProcessSheetOptions(options).find((option) => option === trimmed) ?? null;
}

export type ProcessSheetOptionValueView = {
  /** Stored words that ARE on the option list, in the option list's own order. */
  selected: string[];
  /** Stored words that are NOT on the option list, verbatim — null when there are none. */
  legacy: string | null;
};

/**
 * LEGACY TOLERANCE (2026-08-08).
 *
 * A row that becomes CHOICE or FLAGS by data migration keeps the values it
 * already had, and those were free text typed before any option list existed
 * ("大水口", "auto", a sentence). `parseProcessSheetFlagValues` and
 * `parseProcessSheetChoiceValue` allowlist, so on their own they render such a
 * value as NOTHING — the operator sees an empty cell where the paper sheet says
 * something, and cannot tell whether the field was never filled or is simply
 * unrecognised.
 *
 * This splits a stored value into the part the option list recognises and the
 * part it does not, so both renderers can SHOW the unrecognised remainder and
 * let the next save normalise it. Blank in, blank out.
 */
export function processSheetOptionValueView(input: {
  raw: string | null | undefined;
  kind: ProcessSheetParameterKind;
  options: readonly string[];
}): ProcessSheetOptionValueView {
  const options = parseProcessSheetOptions(input.options);
  const raw = input.raw == null ? "" : input.raw.trim();

  if (raw.length === 0 || !isOptionProcessSheetKind(input.kind)) {
    return { selected: [], legacy: null };
  }

  if (input.kind === "CHOICE") {
    const chosen = parseProcessSheetChoiceValue(raw, options);
    return chosen == null ? { selected: [], legacy: raw } : { selected: [chosen], legacy: null };
  }

  const words = raw
    .split(",")
    .map((word) => word.trim())
    .filter((word) => word.length > 0);
  const known = new Set(options);
  const unknown = words.filter((word) => !known.has(word));

  return {
    selected: parseProcessSheetFlagValues(words, options),
    legacy: unknown.length === 0 ? null : unknown.join(PROCESS_SHEET_FLAGS_SEPARATOR)
  };
}

/**
 * True when a posted CHOICE/FLAGS value is a pre-option-list value coming back
 * UNCHANGED — the editor shows it, so an untouched save posts it verbatim.
 *
 * The save path uses this to keep such a value instead of rejecting it (CHOICE,
 * which would block the whole sheet's save) or silently dropping it (FLAGS).
 * The moment the operator actually touches the control the posted text differs
 * from the stored one, this returns false, and the normal allowlist runs — which
 * is what "the next save normalises it" means.
 */
export function isUnchangedLegacyProcessSheetOptionValue(input: {
  raw: string | null | undefined;
  storedText: string | null | undefined;
  kind: ProcessSheetParameterKind;
  options: readonly string[];
}): boolean {
  const raw = input.raw == null ? "" : input.raw.trim();
  const stored = input.storedText == null ? "" : input.storedText.trim();

  if (raw.length === 0 || raw !== stored) {
    return false;
  }

  return processSheetOptionValueView({ raw, kind: input.kind, options: input.options }).legacy != null;
}

/**
 * A catalog row, i.e. one line of the owner's paper sheet.
 *
 * `section` is the stored English section name (the house pattern — the sheet
 * translates section names through the i18n dictionary, see
 * `translateProcessSection`); `sectionZh` is the paper's own heading and exists
 * so the catalog can be checked against the paper and so the dictionary can be
 * proved complete by test.
 */
export type FactoryProcessSheetParameter = {
  section: string;
  sectionZh: string;
  parameterKey: string;
  labelEn: string;
  labelZh: string;
  unit?: string;
  kind: ProcessSheetParameterKind;
  zoneCount?: number;
  options?: readonly string[];
  valueType: "TEXT" | "NUMBER";
  customerVisible: boolean;
};

/**
 * Sort orders start at 1000 so the catalog always lands AFTER whatever a
 * template already had (the seeded default template ends in the thirties) —
 * the data migration and the seed use the same base, so every template in
 * every database orders the new sections identically.
 */
export const FACTORY_PROCESS_SHEET_CATALOG_SORT_BASE = 1000;

export function factoryProcessSheetSortOrder(index: number): number {
  return FACTORY_PROCESS_SHEET_CATALOG_SORT_BASE + index;
}

const zoned = { kind: "ZONED", zoneCount: DEFAULT_PROCESS_SHEET_ZONE_COUNT, valueType: "NUMBER" } as const;
const scalar = { kind: "SCALAR", valueType: "NUMBER" } as const;

/**
 * The owner's paper catalog, in paper order. Adding a row here is the ONLY
 * place a new factory parameter is declared: the seed, the data migration test
 * and the completeness test all read this list.
 */
export const factoryProcessSheetCatalog = [
  // 注塑 — the injection profile, one column per zone.
  {
    section: "Injection Profile",
    sectionZh: "注塑",
    parameterKey: "injection_barrel_temp",
    labelEn: "Barrel Temperature",
    labelZh: "炮筒温度",
    unit: "C",
    customerVisible: true,
    ...zoned
  },
  {
    section: "Injection Profile",
    sectionZh: "注塑",
    parameterKey: "injection_pressure",
    labelEn: "Injection Pressure",
    labelZh: "射胶压力",
    unit: "bar",
    customerVisible: true,
    ...zoned
  },
  {
    section: "Injection Profile",
    sectionZh: "注塑",
    parameterKey: "injection_speed",
    labelEn: "Injection Speed",
    labelZh: "射胶速度",
    unit: "mm/s",
    customerVisible: true,
    ...zoned
  },
  {
    section: "Injection Profile",
    sectionZh: "注塑",
    parameterKey: "injection_position",
    labelEn: "Injection Position",
    labelZh: "射胶位置",
    unit: "mm",
    customerVisible: true,
    ...zoned
  },
  // 保压 — the hold profile. The paper writes "mm" against 保压压力; a hold
  // PRESSURE in millimetres is a slip of the pen, so it is stored as bar. The
  // 保压速度 line keeps the paper's own "bar" rather than inventing mm/s.
  {
    section: "Hold Profile",
    sectionZh: "保压",
    parameterKey: "hold_profile_pressure",
    labelEn: "Hold Pressure",
    labelZh: "保压压力",
    unit: "bar",
    customerVisible: true,
    ...zoned
  },
  {
    section: "Hold Profile",
    sectionZh: "保压",
    parameterKey: "hold_profile_speed",
    labelEn: "Hold Speed",
    labelZh: "保压速度",
    unit: "bar",
    customerVisible: true,
    ...zoned
  },
  {
    section: "Hold Profile",
    sectionZh: "保压",
    parameterKey: "hold_profile_time",
    labelEn: "Hold Time",
    labelZh: "保压时间",
    unit: "s",
    customerVisible: true,
    ...zoned
  },
  // 熔胶
  {
    section: "Plasticizing",
    sectionZh: "熔胶",
    parameterKey: "plasticizing_pressure",
    labelEn: "Plasticizing Pressure",
    labelZh: "熔胶压力",
    unit: "bar",
    customerVisible: true,
    ...scalar
  },
  {
    section: "Plasticizing",
    sectionZh: "熔胶",
    parameterKey: "plasticizing_speed",
    labelEn: "Plasticizing Speed",
    labelZh: "熔胶速度",
    unit: "mm/s",
    customerVisible: true,
    ...scalar
  },
  {
    section: "Plasticizing",
    sectionZh: "熔胶",
    parameterKey: "plasticizing_position",
    labelEn: "Plasticizing Position",
    labelZh: "熔胶位置",
    unit: "mm",
    customerVisible: true,
    ...scalar
  },
  // 顶针
  {
    section: "Ejector",
    sectionZh: "顶针",
    parameterKey: "ejector_pressure",
    labelEn: "Ejector Pressure",
    labelZh: "顶针压力",
    unit: "bar",
    customerVisible: true,
    ...scalar
  },
  {
    section: "Ejector",
    sectionZh: "顶针",
    parameterKey: "ejector_speed",
    labelEn: "Ejector Speed",
    labelZh: "顶针速度",
    unit: "mm/s",
    customerVisible: true,
    ...scalar
  },
  {
    section: "Ejector",
    sectionZh: "顶针",
    parameterKey: "ejector_position",
    labelEn: "Ejector Position",
    labelZh: "顶针位置",
    unit: "mm",
    customerVisible: true,
    ...scalar
  },
  // 模温
  {
    section: "Mold Temperature",
    sectionZh: "模温",
    parameterKey: "mold_temp_front",
    labelEn: "Front Mold Temperature",
    labelZh: "前模温度",
    unit: "C",
    customerVisible: true,
    ...scalar
  },
  {
    section: "Mold Temperature",
    sectionZh: "模温",
    parameterKey: "mold_temp_rear",
    labelEn: "Rear Mold Temperature",
    labelZh: "后模温度",
    unit: "C",
    customerVisible: true,
    ...scalar
  },
  // 入水 — multi-select: a mold can be gated more than one way.
  {
    section: "Gate Type",
    sectionZh: "入水",
    parameterKey: "gate_type",
    labelEn: "Gate Type",
    labelZh: "入水",
    kind: "FLAGS",
    options: ["大", "细", "潜水", "热流道"],
    valueType: "TEXT",
    customerVisible: true
  },
  // 运水 — multi-select: circuits can run different media at once.
  {
    section: "Cooling Circuit",
    sectionZh: "运水",
    parameterKey: "cooling_circuit",
    labelEn: "Cooling Circuit",
    labelZh: "运水",
    kind: "FLAGS",
    options: ["热油", "热水", "冷水", "机水"],
    valueType: "TEXT",
    customerVisible: true
  },
  // 操作 — exactly one mode.
  {
    section: "Operation Mode",
    sectionZh: "操作",
    parameterKey: "operation_mode",
    labelEn: "Operation Mode",
    labelZh: "操作",
    kind: "CHOICE",
    options: ["手动", "半自动", "全自动"],
    valueType: "TEXT",
    customerVisible: true
  },
  // 抽芯A
  {
    section: "Core Pull A",
    sectionZh: "抽芯A",
    parameterKey: "core_pull_a_pressure",
    labelEn: "Core Pull A Pressure",
    labelZh: "A组抽芯压力",
    unit: "bar",
    customerVisible: true,
    ...scalar
  },
  {
    section: "Core Pull A",
    sectionZh: "抽芯A",
    parameterKey: "core_pull_a_speed",
    labelEn: "Core Pull A Speed",
    labelZh: "进芯速度",
    unit: "mm/s",
    customerVisible: true,
    ...scalar
  },
  {
    section: "Core Pull A",
    sectionZh: "抽芯A",
    parameterKey: "core_pull_a_time",
    labelEn: "Core Pull A Time",
    labelZh: "进芯时间",
    unit: "s",
    customerVisible: true,
    ...scalar
  },
  {
    section: "Core Pull A",
    sectionZh: "抽芯A",
    parameterKey: "core_pull_a_position",
    labelEn: "Core Pull A Position",
    labelZh: "进芯位置",
    unit: "mm",
    customerVisible: true,
    ...scalar
  },
  // 退芯A
  {
    section: "Core Return A",
    sectionZh: "退芯A",
    parameterKey: "core_return_a_pressure",
    labelEn: "Core Return A Pressure",
    labelZh: "A组退芯压力",
    unit: "bar",
    customerVisible: true,
    ...scalar
  },
  {
    section: "Core Return A",
    sectionZh: "退芯A",
    parameterKey: "core_return_a_speed",
    labelEn: "Core Return A Speed",
    labelZh: "退芯速度",
    unit: "mm/s",
    customerVisible: true,
    ...scalar
  },
  {
    section: "Core Return A",
    sectionZh: "退芯A",
    parameterKey: "core_return_a_time",
    labelEn: "Core Return A Time",
    labelZh: "退芯时间",
    unit: "s",
    customerVisible: true,
    ...scalar
  },
  {
    section: "Core Return A",
    sectionZh: "退芯A",
    parameterKey: "core_return_a_position",
    labelEn: "Core Return A Position",
    labelZh: "退芯位置",
    unit: "mm",
    customerVisible: true,
    ...scalar
  },
  // 抽芯B
  {
    section: "Core Pull B",
    sectionZh: "抽芯B",
    parameterKey: "core_pull_b_pressure",
    labelEn: "Core Pull B Pressure",
    labelZh: "B组抽芯压力",
    unit: "bar",
    customerVisible: true,
    ...scalar
  },
  {
    section: "Core Pull B",
    sectionZh: "抽芯B",
    parameterKey: "core_pull_b_speed",
    labelEn: "Core Pull B Speed",
    labelZh: "进芯速度",
    unit: "mm/s",
    customerVisible: true,
    ...scalar
  },
  {
    section: "Core Pull B",
    sectionZh: "抽芯B",
    parameterKey: "core_pull_b_time",
    labelEn: "Core Pull B Time",
    labelZh: "进芯时间",
    unit: "s",
    customerVisible: true,
    ...scalar
  },
  {
    section: "Core Pull B",
    sectionZh: "抽芯B",
    parameterKey: "core_pull_b_position",
    labelEn: "Core Pull B Position",
    labelZh: "进芯位置",
    unit: "mm",
    customerVisible: true,
    ...scalar
  },
  // 退芯B
  {
    section: "Core Return B",
    sectionZh: "退芯B",
    parameterKey: "core_return_b_pressure",
    labelEn: "Core Return B Pressure",
    labelZh: "B组退芯压力",
    unit: "bar",
    customerVisible: true,
    ...scalar
  },
  {
    section: "Core Return B",
    sectionZh: "退芯B",
    parameterKey: "core_return_b_speed",
    labelEn: "Core Return B Speed",
    labelZh: "退芯速度",
    unit: "mm/s",
    customerVisible: true,
    ...scalar
  },
  {
    section: "Core Return B",
    sectionZh: "退芯B",
    parameterKey: "core_return_b_time",
    labelEn: "Core Return B Time",
    labelZh: "退芯时间",
    unit: "s",
    customerVisible: true,
    ...scalar
  },
  {
    section: "Core Return B",
    sectionZh: "退芯B",
    parameterKey: "core_return_b_position",
    labelEn: "Core Return B Position",
    labelZh: "退芯位置",
    unit: "mm",
    customerVisible: true,
    ...scalar
  }
] as const satisfies readonly FactoryProcessSheetParameter[];

/** The catalog's section names in paper order, de-duplicated. */
export const factoryProcessSheetSections: readonly { en: string; zh: string }[] =
  factoryProcessSheetCatalog.reduce<{ en: string; zh: string }[]>((sections, parameter) => {
    if (!sections.some((section) => section.en === parameter.section)) {
      sections.push({ en: parameter.section, zh: parameter.sectionZh });
    }

    return sections;
  }, []);

/** Bilingual labels for a catalog row, for surfaces that print both. */
export function factoryProcessSheetLabel(parameter: {
  labelEn: string;
  labelZh: string;
}): BilingualLabel {
  return { en: parameter.labelEn, zh: parameter.labelZh };
}
