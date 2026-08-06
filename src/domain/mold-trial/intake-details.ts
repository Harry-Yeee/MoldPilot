/**
 * Intake details 试模基础信息 — material, colour, trial quantity, assembly group.
 *
 * Four things the pilot team kept writing on the paper sheet and re-asking for
 * in the group chat: what plastic the mold shoots (材料), what colour (颜色),
 * how many pieces the trial should produce (试模数量), and which assembly
 * working group owns the mold (装配组). All four are captured at intake and
 * correctable afterwards on the project's Identifiers form.
 *
 * Material and colour are FREE TEXT, not enums. `commonMaterialCodes` only
 * populates a native `<datalist>`, so typing "PC" is one keystroke and typing
 * "PPS+GF40" — a grade nobody listed — still saves. Growing that list is a code
 * change with no migration and no client regeneration, the same reasoning the
 * 2026-07-30 `insert_types` allowlist uses, minus the allowlisting: there is no
 * downstream logic keyed on the value, so an unexpected string costs nothing.
 *
 * Pure (no Prisma imports), unit-tested like its domain siblings.
 */

import type { BilingualLabel } from "./labels.ts";

/**
 * Datalist suggestions for the Material field, in the order the pilot names
 * them. NOT an allowlist — `parseMaterial` accepts anything non-blank.
 */
export const commonMaterialCodes = [
  "PC",
  "ABS",
  "PC+ABS",
  "PP",
  "PA66",
  "PA66+GF",
  "POM",
  "TPU",
  "PMMA"
] as const;

/** Field labels for the intake form, the Identifiers edit form and the overview. */
export const intakeDetailLabels = {
  material: { en: "Material", zh: "材料" },
  color: { en: "Color", zh: "颜色" },
  trialQuantity: { en: "Trial quantity", zh: "试模数量" },
  assemblyGroup: { en: "Assembly group", zh: "装配组" },
  unassignedGroup: { en: "Unspecified", zh: "未指定" }
} as const satisfies Record<string, BilingualLabel>;

/** Longest value the free-text fields accept; anything longer is truncated. */
export const intakeTextMaxLength = 120;

/** Smallest meaningful trial quantity. The form posts `min="1"`; this enforces it. */
export const minimumTrialQuantity = 1;

/**
 * Normalize a free-text intake field: trim, collapse a blank to null, and cap
 * the length so a paste accident cannot write an essay into a display cell.
 */
export function parseIntakeText(value: string | null | undefined): string | null {
  if (value == null) {
    return null;
  }

  const trimmed = value.trim();

  if (trimmed.length === 0) {
    return null;
  }

  return trimmed.slice(0, intakeTextMaxLength);
}

/** Material 材料, normalized. Free text — the datalist is only a typing aid. */
export function parseMaterial(value: string | null | undefined): string | null {
  return parseIntakeText(value);
}

/** Color 颜色, normalized. */
export function parseColor(value: string | null | undefined): string | null {
  return parseIntakeText(value);
}

/**
 * Trial quantity 试模数量 as a positive whole number, or null.
 *
 * Blank, non-numeric, zero, negative and fractional inputs all read as "not
 * given" rather than as an error: the field is optional, the form already posts
 * `type="number" min="1" step="1"`, and refusing an intake over a stray keypress
 * would cost more than it saves.
 */
export function parseTrialQuantity(value: string | number | null | undefined): number | null {
  if (value == null) {
    return null;
  }

  const raw = typeof value === "number" ? value : value.trim();

  if (raw === "") {
    return null;
  }

  const parsed = Number(raw);

  if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed < minimumTrialQuantity) {
    return null;
  }

  return parsed;
}

/**
 * The four values a write needs, already normalized. `assignedAssemblyGroupId`
 * is resolved by the caller (it must be an existing active assembly child group
 * or null), because validating it needs the database.
 */
export type IntakeDetails = {
  material: string | null;
  color: string | null;
  trialQuantity: number | null;
  assignedAssemblyGroupId: string | null;
};

/**
 * Read the intake details off a project row.
 *
 * Every field is optional in the parameter type on purpose — the same seam
 * `projectInsertTypes` uses. `mold_trial_projects.material` / `color` /
 * `trial_quantity` / `assigned_assembly_group_id` arrive with the 2026-08-05
 * migration, so a checkout whose generated Prisma client predates it still
 * typechecks here; the fields simply read as absent until `prisma generate`
 * runs. The shape stays correct, unchanged, afterwards.
 */
export function projectIntakeDetails(project: {
  id: string;
  material?: string | null;
  color?: string | null;
  trialQuantity?: number | null;
  assignedAssemblyGroupId?: string | null;
}): IntakeDetails {
  return {
    material: parseMaterial(project.material),
    color: parseColor(project.color),
    trialQuantity: parseTrialQuantity(project.trialQuantity),
    assignedAssemblyGroupId: project.assignedAssemblyGroupId ?? null
  };
}

/**
 * The assigned assembly group id alone — the one thing issue routing needs.
 * Same stale-client seam as {@link projectIntakeDetails}.
 */
export function projectAssignedAssemblyGroupId(project: {
  id: string;
  assignedAssemblyGroupId?: string | null;
}): string | null {
  return project.assignedAssemblyGroupId ?? null;
}
