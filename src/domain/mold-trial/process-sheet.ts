import {
  LEGACY_SHOT_PART_WEIGHT_PARAMETER_KEY_PATTERN,
  SHOT_PART_WEIGHT_PARAMETER_KEY,
  type ProcessSheetParameterKind
} from "./process-sheet-catalog.ts";

export const DEFAULT_PROCESS_SHEET_TEMPLATE_CODE = "default_process_setup";

export type ProcessValueType = "TEXT" | "NUMBER" | "DATE" | "BOOLEAN";

export type DefaultProcessSheetParameter = {
  section: string;
  parameterKey: string;
  labelEn: string;
  labelZh?: string;
  unit?: string;
  valueType: ProcessValueType;
  customerVisible: boolean;
  /** Absent means SCALAR — the shape every row of this list had until 2026-08-08. */
  kind?: ProcessSheetParameterKind;
  zoneCount?: number;
};

/**
 * 热流道温度 — the row that replaces the fixed `hot_runner_zone_1_temp` /
 * `hot_runner_zone_2_temp` pair (2026-08-08).
 *
 * The pair was a guess at how many hot-runner tips a mould has. Real moulds have
 * anywhere from one to a dozen, so two fixed rows were wrong for almost every
 * mould: too few to record a 8-tip manifold, two empty rows on a cold-runner
 * tool. ZONED with twelve zones is the same shape the paper sheet uses for
 * 炮筒温度 — sparse is normal, a tip the mould does not have simply stays blank.
 *
 * Exported so the seed, the 20260808120000 data migration and its test all name
 * the same row. It is NOT part of `factoryProcessSheetCatalog`: that list is the
 * owner's paper 工艺参数表 transcribed, and the hot runner is not on that paper —
 * it has always been one of this template's own rows.
 */
export const HOT_RUNNER_ZONED_PARAMETER = {
  section: "Hot Runner Settings",
  parameterKey: "hot_runner_temp",
  labelEn: "Hot Runner Temperature",
  labelZh: "热流道温度",
  unit: "deg C",
  valueType: "NUMBER",
  customerVisible: true,
  kind: "ZONED",
  zoneCount: 12
} as const satisfies DefaultProcessSheetParameter;

/** The fixed hot-runner rows the ZONED row replaces: `hot_runner_zone_<N>_temp`. */
export const LEGACY_HOT_RUNNER_PARAMETER_KEY_PATTERN = /^hot_runner_zone_(\d+)_temp$/;

/**
 * The zone a legacy hot-runner row becomes, or null when the key is not one.
 *
 * This is the whole value-migration rule in one function: `hot_runner_zone_2_temp`
 * holds the temperature of tip 2, so its stored values become `zone_index = 2`
 * of the ZONED row. Zone 0 is the non-zoned sentinel and a zone above the row's
 * twelve would not render, so both read as "not migratable" — the SQL carries
 * the same bounds, and a row whose values cannot move is left alone rather than
 * retired.
 */
export function legacyHotRunnerZoneIndex(parameterKey: string): number | null {
  const matched = LEGACY_HOT_RUNNER_PARAMETER_KEY_PATTERN.exec(parameterKey.trim());
  if (matched == null) {
    return null;
  }

  const zone = Number.parseInt(matched[1] ?? "", 10);
  if (!Number.isFinite(zone) || zone < 1 || zone > HOT_RUNNER_ZONED_PARAMETER.zoneCount) {
    return null;
  }

  return zone;
}

/**
 * 连续六啤产品重量 — one ZONED row of six shots, replacing `shot_weight_1` …
 * `shot_weight_6` (2026-08-09).
 *
 * Six rows for six consecutive shots was six copies of one measurement. On the
 * paper sheet it is one line with six boxes, and it is read ACROSS: the setter
 * is looking at whether the six weights drift, which six stacked rows hide.
 * ZONED is the shape the sheet already has for "one line, N boxes", so this
 * needs no new mechanism — only a caption that says 第1啤 instead of 一区
 * (`processSheetZoneCaptionKind`).
 *
 * Exported so the seed, the 20260808130000 data migration and its test all name
 * the same row, exactly as `HOT_RUNNER_ZONED_PARAMETER` is.
 */
export const SHOT_PART_WEIGHT_ZONED_PARAMETER = {
  section: "Six Consecutive Shots Part Weight",
  parameterKey: SHOT_PART_WEIGHT_PARAMETER_KEY,
  labelEn: "Six-shot Part Weight",
  labelZh: "连续六啤产品重量",
  unit: "g",
  valueType: "NUMBER",
  customerVisible: true,
  kind: "ZONED",
  zoneCount: 6
} as const satisfies DefaultProcessSheetParameter;

/**
 * The shot a legacy `shot_weight_<N>` row becomes, or null when the key is not
 * one — the same rule, and the same bounds, `legacyHotRunnerZoneIndex` applies.
 * Zone 0 is the non-zoned sentinel and a shot above six would not render, so
 * both read as "not migratable" and the SQL leaves such a row alone.
 */
export function legacyShotPartWeightZoneIndex(parameterKey: string): number | null {
  const matched = LEGACY_SHOT_PART_WEIGHT_PARAMETER_KEY_PATTERN.exec(parameterKey.trim());
  if (matched == null) {
    return null;
  }

  const shot = Number.parseInt(matched[1] ?? "", 10);
  if (!Number.isFinite(shot) || shot < 1 || shot > SHOT_PART_WEIGHT_ZONED_PARAMETER.zoneCount) {
    return null;
  }

  return shot;
}

export const defaultProcessSheetParameters = [
  {
    section: "Material Information",
    parameterKey: "material_rep_company",
    labelEn: "Material Rep Name and Company",
    labelZh: "胶料的技术人员和公司",
    valueType: "TEXT",
    customerVisible: true
  },
  {
    section: "Material Information",
    parameterKey: "material_grade",
    labelEn: "Material Grade",
    labelZh: "胶料牌号",
    valueType: "TEXT",
    customerVisible: true
  },
  {
    section: "Material Information",
    parameterKey: "material_drying_time",
    labelEn: "Drying Time",
    labelZh: "烘料时间",
    unit: "hr",
    valueType: "NUMBER",
    customerVisible: true
  },
  {
    section: "Material Information",
    parameterKey: "material_drying_temperature",
    labelEn: "Drying Temperature",
    labelZh: "烘料温度",
    unit: "deg C",
    valueType: "NUMBER",
    customerVisible: true
  },
  {
    section: "Machine Information",
    parameterKey: "machine_name",
    labelEn: "Machine Name",
    labelZh: "啤机名称",
    valueType: "TEXT",
    customerVisible: true
  },
  {
    section: "Machine Information",
    parameterKey: "machine_number",
    labelEn: "Machine Number",
    labelZh: "啤机号码",
    valueType: "TEXT",
    customerVisible: true
  },
  {
    section: "Machine Information",
    parameterKey: "press_tonnage",
    labelEn: "Press Tonnage",
    labelZh: "啤机吨位",
    unit: "T",
    valueType: "NUMBER",
    customerVisible: true
  },
  {
    section: "Machine Information",
    parameterKey: "clamp_tonnage_used",
    labelEn: "Clamp Tonnage Used",
    labelZh: "锁模压力",
    unit: "T",
    valueType: "NUMBER",
    customerVisible: true
  },
  {
    section: "Machine Information",
    parameterKey: "nozzle_orifice",
    labelEn: "Nozzle Orifice",
    labelZh: "啤机射咀大小",
    unit: "mm",
    valueType: "NUMBER",
    customerVisible: true
  },
  {
    section: "Machine Information",
    parameterKey: "shot_capacity",
    labelEn: "Shot Capacity",
    labelZh: "啤机射胶重量",
    unit: "g",
    valueType: "NUMBER",
    customerVisible: true
  },
  {
    section: "Process Information",
    parameterKey: "cycle_time",
    labelEn: "Cycle Time",
    labelZh: "周期时间",
    unit: "sec",
    valueType: "NUMBER",
    customerVisible: true
  },
  {
    section: "Process Information",
    parameterKey: "cooling_time",
    labelEn: "Cooling Time",
    labelZh: "冷却时间",
    unit: "sec",
    valueType: "NUMBER",
    customerVisible: true
  },
  {
    section: "Process Information",
    parameterKey: "injection_time",
    labelEn: "Injection Time",
    labelZh: "射胶时间",
    unit: "sec",
    valueType: "NUMBER",
    customerVisible: true
  },
  {
    section: "Barrel Settings",
    parameterKey: "barrel_zone_1_temp",
    labelEn: "Barrel Zone 1 Temperature",
    labelZh: "炮筒一区温度",
    unit: "deg C",
    valueType: "NUMBER",
    customerVisible: true
  },
  {
    section: "Barrel Settings",
    parameterKey: "barrel_zone_2_temp",
    labelEn: "Barrel Zone 2 Temperature",
    labelZh: "炮筒二区温度",
    unit: "deg C",
    valueType: "NUMBER",
    customerVisible: true
  },
  {
    section: "Barrel Settings",
    parameterKey: "barrel_zone_3_temp",
    labelEn: "Barrel Zone 3 Temperature",
    labelZh: "炮筒三区温度",
    unit: "deg C",
    valueType: "NUMBER",
    customerVisible: true
  },
  {
    section: "Barrel Settings",
    parameterKey: "barrel_nozzle_temp",
    labelEn: "Nozzle Temperature",
    labelZh: "射咀温度",
    unit: "deg C",
    valueType: "NUMBER",
    customerVisible: true
  },
  {
    section: "Velocity Profile",
    parameterKey: "velocity_stage_1",
    labelEn: "Velocity Stage 1",
    labelZh: "射速一段",
    unit: "mm/s",
    valueType: "NUMBER",
    customerVisible: true
  },
  {
    section: "Velocity Profile",
    parameterKey: "velocity_stage_2",
    labelEn: "Velocity Stage 2",
    labelZh: "射速二段",
    unit: "mm/s",
    valueType: "NUMBER",
    customerVisible: true
  },
  {
    section: "Velocity Profile",
    parameterKey: "velocity_stage_3",
    labelEn: "Velocity Stage 3",
    labelZh: "射速三段",
    unit: "mm/s",
    valueType: "NUMBER",
    customerVisible: true
  },
  {
    section: "Hold Pressure",
    parameterKey: "hold_pressure_stage_1",
    labelEn: "Hold Pressure Stage 1",
    labelZh: "保压一段",
    unit: "bar",
    valueType: "NUMBER",
    customerVisible: true
  },
  {
    section: "Hold Pressure",
    parameterKey: "hold_pressure_stage_2",
    labelEn: "Hold Pressure Stage 2",
    labelZh: "保压二段",
    unit: "bar",
    valueType: "NUMBER",
    customerVisible: true
  },
  {
    section: "Hold Pressure",
    parameterKey: "hold_time",
    labelEn: "Hold Time",
    labelZh: "保压时间",
    unit: "sec",
    valueType: "NUMBER",
    customerVisible: true
  },
  {
    section: "Other Settings",
    parameterKey: "back_pressure",
    labelEn: "Back Pressure",
    labelZh: "背压",
    unit: "bar",
    valueType: "NUMBER",
    customerVisible: true
  },
  {
    section: "Other Settings",
    parameterKey: "screw_speed",
    labelEn: "Screw Speed",
    labelZh: "螺杆转速",
    unit: "rpm",
    valueType: "NUMBER",
    customerVisible: true
  },
  {
    section: "Other Settings",
    parameterKey: "cushion",
    labelEn: "Cushion",
    labelZh: "残量",
    unit: "mm",
    valueType: "NUMBER",
    customerVisible: true
  },
  {
    section: "Tool Data",
    parameterKey: "tool_name_number",
    labelEn: "Tool Name / Number",
    labelZh: "模号",
    valueType: "TEXT",
    customerVisible: true
  },
  {
    section: "Tool Data",
    parameterKey: "number_of_cavities",
    labelEn: "Number of Cavities",
    labelZh: "穴数",
    valueType: "NUMBER",
    customerVisible: true
  },
  {
    section: "Tool Data",
    parameterKey: "part_weight_average",
    labelEn: "Part Weight Average",
    labelZh: "产品单重",
    unit: "g",
    valueType: "NUMBER",
    customerVisible: true
  },
  // One ZONED row, twelve zones — replaces the fixed zone-1 / zone-2 pair
  // (2026-08-08). Existing databases get the same end state from the
  // 20260808120000 data migration, which moves the pair's stored values into
  // zones 1 and 2 before retiring them.
  HOT_RUNNER_ZONED_PARAMETER,
  // One ZONED row of six shots — replaces the six `shot_weight_<N>` scalars
  // (2026-08-09). Existing databases reach the same end state from the
  // 20260808130000 data migration, which moves the six stored values into zones
  // 1…6 before retiring the rows.
  SHOT_PART_WEIGHT_ZONED_PARAMETER
] as const satisfies readonly DefaultProcessSheetParameter[];

export const PROCESS_SHEET_SUMMARY_PARAMETER_KEYS = new Set([
  "trial_result_summary",
  "major_issues",
  "correction_summary",
  "next_action",
  "internal_private_note"
]);

export const PROCESS_SHEET_COPY_EXCLUDED_PARAMETER_KEYS = PROCESS_SHEET_SUMMARY_PARAMETER_KEYS;

export function isProcessSheetSummaryParameter(parameterKey: string): boolean {
  return PROCESS_SHEET_SUMMARY_PARAMETER_KEYS.has(parameterKey);
}

export type InjectionMachineSearchRecord = {
  machineNo: string;
  displayName?: string | null;
  model?: string | null;
  brand?: string | null;
  tonnage?: number | null;
};

export function normalizeInjectionMachineNo(value: string): string {
  return value.trim();
}

export function isNumericInjectionMachineNo(value: string): boolean {
  return /^\d+$/.test(normalizeInjectionMachineNo(value));
}

export function compareInjectionMachineNo(
  left: Pick<InjectionMachineSearchRecord, "machineNo">,
  right: Pick<InjectionMachineSearchRecord, "machineNo">
): number {
  const leftIsNumeric = isNumericInjectionMachineNo(left.machineNo);
  const rightIsNumeric = isNumericInjectionMachineNo(right.machineNo);

  if (leftIsNumeric && rightIsNumeric) {
    const leftNumber = Number.parseInt(left.machineNo, 10);
    const rightNumber = Number.parseInt(right.machineNo, 10);

    if (leftNumber !== rightNumber) {
      return leftNumber - rightNumber;
    }
  } else if (leftIsNumeric) {
    return -1;
  } else if (rightIsNumeric) {
    return 1;
  }

  return left.machineNo.localeCompare(right.machineNo, undefined, { numeric: true, sensitivity: "base" });
}

export function injectionMachineMatchesQuery(machine: InjectionMachineSearchRecord, query: string): boolean {
  const normalized = query.trim().toLowerCase();

  if (normalized.length === 0) {
    return true;
  }

  const tonnage = machine.tonnage == null ? "" : String(machine.tonnage);
  const searchable = [
    machine.machineNo,
    machine.brand,
    tonnage,
    tonnage.length === 0 ? "" : `${tonnage}t`
  ]
    .filter((value): value is string => value != null)
    .join(" ")
    .toLowerCase();

  return searchable.includes(normalized);
}

export function formatInjectionMachineLabel(machine: InjectionMachineSearchRecord): string {
  const clampingForce = machine.tonnage == null ? "" : ` / ${machine.tonnage}T`;
  const brand = machine.brand == null || machine.brand.trim().length === 0 ? "" : ` / ${machine.brand}`;

  return `No. ${machine.machineNo}${clampingForce}${brand}`;
}

export function snapshotInjectionMachine(machine: InjectionMachineSearchRecord): {
  machineNoSnapshot: string;
  machineTonnageSnapshot: string | null;
  machineDisplayText: string;
} {
  return {
    machineNoSnapshot: machine.machineNo,
    machineTonnageSnapshot: machine.tonnage == null ? null : `${machine.tonnage}T`,
    machineDisplayText: formatInjectionMachineLabel(machine)
  };
}

export function isProcessSheetColumnEditable(input: {
  trialEventId: string;
  currentEditableTrialEventId?: string | null;
}): boolean {
  return input.currentEditableTrialEventId != null && input.trialEventId === input.currentEditableTrialEventId;
}

export function nextProcessSheetInputIndex(input: {
  currentIndex: number;
  fieldCount: number;
  shiftKey?: boolean;
}): number {
  if (input.fieldCount <= 0) {
    return -1;
  }

  const direction = input.shiftKey === true ? -1 : 1;
  return Math.min(Math.max(input.currentIndex + direction, 0), input.fieldCount - 1);
}

export type ProcessSheetCopyPlan = {
  currentMachineId?: string | null;
  previousMachineId?: string | null;
  currentValues: Record<string, string | null | undefined>;
  previousValues: Record<string, string | null | undefined>;
  copyableKeys?: readonly string[];
  overwrite?: boolean;
};

export type ProcessSheetCopyResult = {
  machineId: string;
  values: Record<string, string>;
  copiedKeys: string[];
  skippedExistingKeys: string[];
  overwrittenKeys: string[];
  changedCount: number;
};

function blankProcessSheetValue(value: string | null | undefined): boolean {
  return value == null || value.trim().length === 0;
}

export function isCopyableProcessSheetParameter(parameterKey: string): boolean {
  return !PROCESS_SHEET_COPY_EXCLUDED_PARAMETER_KEYS.has(parameterKey);
}

export function copyPreviousTrialProcessSheetValues(input: ProcessSheetCopyPlan): ProcessSheetCopyResult {
  const overwrite = input.overwrite === true;
  const copyableKeys = input.copyableKeys == null ? null : new Set(input.copyableKeys);
  const currentMachineId = input.currentMachineId ?? "";
  const previousMachineId = input.previousMachineId ?? "";
  const nextValues = Object.fromEntries(
    Object.entries(input.currentValues).map(([key, value]) => [key, value ?? ""])
  );
  const copiedKeys: string[] = [];
  const skippedExistingKeys: string[] = [];
  const overwrittenKeys: string[] = [];
  let machineId = currentMachineId;
  let changedCount = 0;

  if (!blankProcessSheetValue(previousMachineId)) {
    if (blankProcessSheetValue(currentMachineId)) {
      machineId = previousMachineId;
      changedCount += 1;
      copiedKeys.push("injectionMachineId");
    } else if (overwrite && currentMachineId !== previousMachineId) {
      machineId = previousMachineId;
      changedCount += 1;
      overwrittenKeys.push("injectionMachineId");
    } else if (currentMachineId !== previousMachineId) {
      skippedExistingKeys.push("injectionMachineId");
    }
  }

  for (const [parameterId, previousValue] of Object.entries(input.previousValues)) {
    if (copyableKeys != null && !copyableKeys.has(parameterId)) {
      continue;
    }

    if (blankProcessSheetValue(previousValue)) {
      continue;
    }

    const currentValue = nextValues[parameterId] ?? "";
    if (blankProcessSheetValue(currentValue)) {
      nextValues[parameterId] = previousValue ?? "";
      changedCount += 1;
      copiedKeys.push(parameterId);
    } else if (overwrite && currentValue !== previousValue) {
      nextValues[parameterId] = previousValue ?? "";
      changedCount += 1;
      overwrittenKeys.push(parameterId);
    } else if (currentValue !== previousValue) {
      skippedExistingKeys.push(parameterId);
    }
  }

  return {
    machineId,
    values: nextValues,
    copiedKeys,
    skippedExistingKeys,
    overwrittenKeys,
    changedCount
  };
}
