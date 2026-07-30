/**
 * Insert types 嵌件类型 — what a mold carries besides the plastic itself.
 *
 * Many molds shoot over an insert (a threaded nut, a magnet, a metal terminal,
 * an IML label). Whether a project has inserts changes who has to prepare what
 * before T0, so the team must see it from intake onward rather than discovering
 * it at the machine. Intake collects the list as checkboxes; the project page
 * shows it back as chips.
 *
 * The stored column (`mold_trial_projects.insert_types`, a Postgres `text[]`)
 * is deliberately a plain string list, not a Prisma enum: this vocabulary is
 * shop-floor terminology that will keep growing, and growing an enum costs a
 * migration plus a client regeneration every time. `parseInsertTypes` is the
 * one gate that keeps the free-form column honest — nothing outside the
 * allowlist below is ever written or displayed.
 */

import type { BilingualLabel } from "./labels.ts";

/**
 * Canonical codes, in the order the checkboxes and chips render. The order is
 * part of the contract: `parseInsertTypes` returns this order regardless of the
 * order the form posted, so two projects with the same inserts always read the
 * same way.
 */
export const insertTypeCodes = [
  "IML",
  "IMD",
  "THREADED_NUT",
  "MAGNET",
  "METAL_TERMINAL",
  "STAMPED_METAL",
  "GLASS_LENS",
  "OTHER"
] as const;

export type InsertTypeCode = (typeof insertTypeCodes)[number];

/** Bilingual display labels (labels.ts scaffolding — no i18n dictionary keys). */
export const insertTypeLabels = {
  IML: { en: "IML", zh: "模内贴标" },
  IMD: { en: "IMD", zh: "模内装饰膜" },
  THREADED_NUT: { en: "Threaded nut", zh: "螺母嵌件" },
  MAGNET: { en: "Magnet", zh: "磁铁" },
  METAL_TERMINAL: { en: "Metal terminal / pin", zh: "金属端子/插针" },
  STAMPED_METAL: { en: "Stamped metal", zh: "五金嵌件" },
  GLASS_LENS: { en: "Glass / lens", zh: "玻璃/镜片" },
  OTHER: { en: "Other", zh: "其他" }
} as const satisfies Record<InsertTypeCode, BilingualLabel>;

/** Field-level labels for the intake/edit checkbox group and the overview chips. */
export const insertTypeFieldLabels = {
  title: { en: "Inserts", zh: "嵌件" },
  selectAll: { en: "select all that apply", zh: "可多选" }
} as const satisfies Record<string, BilingualLabel>;

const insertTypeCodeSet: ReadonlySet<string> = new Set<string>(insertTypeCodes);

export function isInsertTypeCode(value: string): value is InsertTypeCode {
  return insertTypeCodeSet.has(value);
}

/** The bilingual label for a stored code, or null if the code is not canonical. */
export function insertTypeLabel(code: string): BilingualLabel | null {
  return isInsertTypeCode(code) ? insertTypeLabels[code] : null;
}

/**
 * Normalize submitted or stored values into the canonical stored list:
 * allowlisted, de-duplicated, and always in `insertTypeCodes` order.
 *
 * Unknown values are dropped silently rather than rejected — the only producers
 * are our own checkboxes, so an unknown value means stale/hand-edited data, not
 * a user mistake worth an error banner.
 */
export function parseInsertTypes(values: string[]): string[] {
  const submitted = new Set(values.map((value) => value.trim()));

  return insertTypeCodes.filter((code) => submitted.has(code));
}

/**
 * Read the insert types off a project row.
 *
 * `insertTypes` is optional in the parameter type on purpose: the column is
 * plain `text[]` with no database-level constraint, so display always goes
 * through `parseInsertTypes`, and a checkout whose generated Prisma client
 * predates the 2026-07-30 `insert_types` migration still typechecks here
 * (the field simply reads as absent until `prisma generate` runs).
 */
export function projectInsertTypes(project: { id: string; insertTypes?: string[] | null }): string[] {
  return parseInsertTypes(project.insertTypes ?? []);
}
