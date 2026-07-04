import type { IssueAffectedScope, ValidationIssue, ValidationResult } from "./types.ts";

export type MoldTrialPartInput = {
  id?: string | null;
  partCode?: string | null;
  partName?: string | null;
  cavityLabel?: string | null;
  cavityCount?: number | string | null;
  notes?: string | null;
  active?: boolean | null;
};

export type NormalizedMoldTrialPart = {
  id?: string;
  partCode: string;
  partName: string | null;
  cavityLabel: string | null;
  cavityCount: number | null;
  notes: string | null;
  sortOrder: number;
  active: boolean;
};

export type IssueAffectedPartInput = {
  affectedScope?: IssueAffectedScope | null;
  affectedPartId?: string | null;
  affectedCavityNote?: string | null;
};

type NormalizeResult = ValidationResult & {
  parts: NormalizedMoldTrialPart[];
};

function validationResult(issues: ValidationIssue[], parts: NormalizedMoldTrialPart[] = []): NormalizeResult {
  return {
    ok: issues.length === 0,
    issues,
    parts
  };
}

function optionalText(value: string | null | undefined): string | null {
  const next = value?.trim() ?? "";
  return next.length === 0 ? null : next;
}

function rowHasAnyValue(input: MoldTrialPartInput): boolean {
  return (
    optionalText(input.id) != null ||
    optionalText(input.partCode) != null ||
    optionalText(input.partName) != null ||
    optionalText(input.cavityLabel) != null ||
    optionalText(String(input.cavityCount ?? "")) != null ||
    optionalText(input.notes) != null
  );
}

function parseCavityCount(value: number | string | null | undefined, field: string, issues: ValidationIssue[]): number | null {
  if (value == null || value === "") {
    return null;
  }

  const parsed = typeof value === "number" ? value : Number.parseInt(String(value), 10);

  if (!Number.isInteger(parsed) || parsed < 1) {
    issues.push({
      field,
      message: "Cavity count must be a positive whole number."
    });
    return null;
  }

  return parsed;
}

export function normalizeMoldTrialParts(
  inputs: readonly MoldTrialPartInput[],
  options: {
    fallbackPartCode?: string | null;
    requireAtLeastOne?: boolean;
  } = {}
): NormalizeResult {
  const issues: ValidationIssue[] = [];
  const rows = inputs.filter(rowHasAnyValue);
  const sourceRows =
    rows.length > 0 || optionalText(options.fallbackPartCode) == null
      ? rows
      : [{ partCode: options.fallbackPartCode }];
  const seenActiveKeys = new Set<string>();
  const parts: NormalizedMoldTrialPart[] = [];

  sourceRows.forEach((input, index) => {
    const partCode = optionalText(input.partCode);
    const cavityLabel = optionalText(input.cavityLabel);
    const active = input.active ?? true;

    if (partCode == null) {
      issues.push({
        field: `partCode.${index}`,
        message: "Part code is required for each part/cavity row."
      });
      return;
    }

    if (partCode.includes(",")) {
      issues.push({
        field: `partCode.${index}`,
        message: "Use one part/cavity row per part code; do not store comma-separated part codes."
      });
    }

    const duplicateKey = `${partCode.toUpperCase()}::${(cavityLabel ?? "").toUpperCase()}`;
    if (active && seenActiveKeys.has(duplicateKey)) {
      issues.push({
        field: `partCode.${index}`,
        message: "Duplicate active part/cavity rows are not allowed for the same part code and cavity label."
      });
    }

    if (active) {
      seenActiveKeys.add(duplicateKey);
    }

    parts.push({
      id: optionalText(input.id) ?? undefined,
      partCode,
      partName: optionalText(input.partName),
      cavityLabel,
      cavityCount: parseCavityCount(input.cavityCount, `cavityCount.${index}`, issues),
      notes: optionalText(input.notes),
      sortOrder: parts.length,
      active
    });
  });

  const activePartCount = parts.filter((part) => part.active).length;
  if ((options.requireAtLeastOne ?? true) && activePartCount === 0) {
    issues.push({
      field: "parts",
      message: "At least one active part/cavity row is required."
    });
  }

  return validationResult(issues, parts);
}

export function formatPartSummary(
  parts: readonly Pick<NormalizedMoldTrialPart, "partCode" | "sortOrder" | "active">[],
  fallbackPartCode: string
): string {
  const activeParts = parts
    .filter((part) => part.active)
    .sort((left, right) => left.sortOrder - right.sortOrder);
  const primaryPartCode = activeParts[0]?.partCode ?? fallbackPartCode;
  const additionalCount = Math.max(0, activeParts.length - 1);

  return additionalCount === 0 ? primaryPartCode : `${primaryPartCode} +${additionalCount}`;
}

export function validateIssueAffectedPart(input: IssueAffectedPartInput): ValidationResult {
  const issues: ValidationIssue[] = [];

  if (input.affectedScope === "Part" && optionalText(input.affectedPartId) == null) {
    issues.push({
      field: "affectedPartId",
      message: "Affected part is required when issue scope is Part."
    });
  }

  if (input.affectedScope === "Mold" && optionalText(input.affectedPartId) != null) {
    issues.push({
      field: "affectedPartId",
      message: "Affected part should be blank when issue scope is Mold."
    });
  }

  return {
    ok: issues.length === 0,
    issues
  };
}
