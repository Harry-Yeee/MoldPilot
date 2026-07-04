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
};

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
  {
    section: "Hot Runner Settings",
    parameterKey: "hot_runner_zone_1_temp",
    labelEn: "Hot Runner Zone 1 Temperature",
    labelZh: "热流道一区温度",
    unit: "deg C",
    valueType: "NUMBER",
    customerVisible: true
  },
  {
    section: "Hot Runner Settings",
    parameterKey: "hot_runner_zone_2_temp",
    labelEn: "Hot Runner Zone 2 Temperature",
    labelZh: "热流道二区温度",
    unit: "deg C",
    valueType: "NUMBER",
    customerVisible: true
  },
  {
    section: "Six Consecutive Shots Part Weight",
    parameterKey: "shot_weight_1",
    labelEn: "Shot 1 Part Weight",
    labelZh: "第一啤产品重量",
    unit: "g",
    valueType: "NUMBER",
    customerVisible: true
  },
  {
    section: "Six Consecutive Shots Part Weight",
    parameterKey: "shot_weight_2",
    labelEn: "Shot 2 Part Weight",
    labelZh: "第二啤产品重量",
    unit: "g",
    valueType: "NUMBER",
    customerVisible: true
  },
  {
    section: "Six Consecutive Shots Part Weight",
    parameterKey: "shot_weight_3",
    labelEn: "Shot 3 Part Weight",
    labelZh: "第三啤产品重量",
    unit: "g",
    valueType: "NUMBER",
    customerVisible: true
  },
  {
    section: "Six Consecutive Shots Part Weight",
    parameterKey: "shot_weight_4",
    labelEn: "Shot 4 Part Weight",
    labelZh: "第四啤产品重量",
    unit: "g",
    valueType: "NUMBER",
    customerVisible: true
  },
  {
    section: "Six Consecutive Shots Part Weight",
    parameterKey: "shot_weight_5",
    labelEn: "Shot 5 Part Weight",
    labelZh: "第五啤产品重量",
    unit: "g",
    valueType: "NUMBER",
    customerVisible: true
  },
  {
    section: "Six Consecutive Shots Part Weight",
    parameterKey: "shot_weight_6",
    labelEn: "Shot 6 Part Weight",
    labelZh: "第六啤产品重量",
    unit: "g",
    valueType: "NUMBER",
    customerVisible: true
  }
] as const satisfies readonly DefaultProcessSheetParameter[];

export const PROCESS_SHEET_SUMMARY_PARAMETER_KEYS = new Set([
  "trial_result_summary",
  "major_issues",
  "correction_summary",
  "next_action",
  "internal_private_note"
]);

const processSheetSummaryLabels = new Set([
  "trial result",
  "major issues",
  "correction summary",
  "next action",
  "internal private note"
]);

export const PROCESS_SHEET_COPY_EXCLUDED_PARAMETER_KEYS = PROCESS_SHEET_SUMMARY_PARAMETER_KEYS;

export function isProcessSheetSummaryParameter(parameterKey: string): boolean {
  return PROCESS_SHEET_SUMMARY_PARAMETER_KEYS.has(parameterKey);
}

function isProcessSheetSummaryLabel(label: string): boolean {
  const normalized = label
    .replace(/\([^)]*\)/g, "")
    .trim()
    .toLowerCase();

  return processSheetSummaryLabels.has(normalized);
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

export type CustomerSafeProcessSheetIssue = {
  title: string;
  status: string;
  correctionSummary?: string | null;
  rootCause?: string | null;
  rootCauseApproved?: boolean;
  internalOwner?: string | null;
  assemblySelfCheckNote?: string | null;
  privateNote?: string | null;
};

export function buildCustomerSafeProcessSheetExport(input: {
  projectIdentifier: string;
  trialSummaries: readonly string[];
  processRows: readonly { label: string; values: readonly string[]; customerVisible: boolean }[];
  issues: readonly CustomerSafeProcessSheetIssue[];
  nextStep?: string | null;
}): string {
  const lines = [
    "MoldPilot Process Sheet Export",
    `Project: ${input.projectIdentifier}`,
    "",
    "Trial Result",
    ...input.trialSummaries.filter((summary) => summary.trim().length > 0),
    "",
    "Process Sheet Comparison"
  ];

  for (const row of input.processRows) {
    if (!row.customerVisible || isProcessSheetSummaryLabel(row.label)) {
      continue;
    }

    lines.push(`${row.label}: ${row.values.join(" | ")}`);
  }

  lines.push("", "Issue Summary");
  for (const issue of input.issues) {
    const parts = [`${issue.title} (${issue.status})`];

    if (issue.correctionSummary != null && issue.correctionSummary.trim().length > 0) {
      parts.push(`Correction: ${issue.correctionSummary}`);
    }

    if (issue.rootCauseApproved === true && issue.rootCause != null && issue.rootCause.trim().length > 0) {
      parts.push(`Verified cause: ${issue.rootCause}`);
    }

    lines.push(parts.join(" - "));
  }

  if (input.nextStep != null && input.nextStep.trim().length > 0) {
    lines.push("", "Next Step", input.nextStep);
  }

  return lines.join("\n");
}
