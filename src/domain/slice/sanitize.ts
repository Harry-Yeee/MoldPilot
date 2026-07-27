/**
 * Dev-slice sanitization — applies SLICE_SANITIZATION_RULES to a row on its way
 * out of the database.
 *
 * Split from `classification.ts` on purpose: that file is the declaration of
 * what travels and what is scrubbed (and is what the completeness test and the
 * manifest read), this file is the single place that actually performs the
 * scrub. The export CLI never nulls a column by hand.
 *
 * Pure module: no Prisma, no filesystem, no environment.
 */

import {
  SLICE_REDACTED_MARKER,
  sliceSanitizationRulesFor,
  type SliceSanitizationRule
} from "./classification.ts";

/**
 * Names that make a value secret-bearing. Deliberately broad — a false positive
 * costs a redacted debug field on a dev laptop, a false negative costs a leaked
 * credential.
 *
 * `storageKey` is the one known exception: it is a relative attachment path, and
 * Phase 2 needs it to map `blobs/<storageKey>` back onto the storage root.
 */
const SECRET_KEY_PATTERN = /pass(word|phrase)|secret|token|credential|apikey|api_key|hash|salt|cookie|jwt|bearer|private[_-]?key/i;
const SECRET_KEY_EXCEPTIONS = new Set(["storagekey"]);

/** True when a column or JSON key name looks like it can hold a secret. */
export function looksSecretBearing(name: string): boolean {
  if (SECRET_KEY_EXCEPTIONS.has(name.toLowerCase())) {
    return false;
  }

  return SECRET_KEY_PATTERN.test(name);
}

/**
 * Walks a Json column and replaces the value of every secret-looking key, at any
 * depth, inside objects and inside objects nested in arrays. Structure, key
 * names, and every other value are preserved so the payload still reads as an
 * audit record.
 */
export function redactSecretJsonKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => redactSecretJsonKeys(entry));
  }

  if (value === null || typeof value !== "object" || value instanceof Date) {
    return value;
  }

  const source = value as Record<string, unknown>;
  const result: Record<string, unknown> = {};

  for (const key of Object.keys(source)) {
    result[key] = looksSecretBearing(key)
      ? SLICE_REDACTED_MARKER
      : redactSecretJsonKeys(source[key]);
  }

  return result;
}

export type SliceSanitizationOutcome = {
  row: Record<string, unknown>;
  /** `Model.field` for every rule that actually changed something. */
  applied: string[];
};

/**
 * Applies every rule for `model` to one row. Returns a NEW row — the caller's
 * object is never mutated — plus the list of fields that really changed, so the
 * manifest can report what was scrubbed instead of what was merely configured.
 *
 * A rule whose column is absent from the row (a partial select, or a column
 * dropped by a later migration) is a no-op rather than an error: the export must
 * not fail because a scrub had nothing to scrub.
 */
export function sanitizeSliceRow(
  model: string,
  row: Readonly<Record<string, unknown>>
): SliceSanitizationOutcome {
  const rules: SliceSanitizationRule[] = sliceSanitizationRulesFor(model);
  const result: Record<string, unknown> = { ...row };
  const applied: string[] = [];

  for (const rule of rules) {
    if (rule.action === "model-excluded") {
      continue;
    }

    if (!Object.hasOwn(result, rule.field)) {
      continue;
    }

    const before = result[rule.field];

    if (rule.action === "null-on-export") {
      if (before !== null) {
        result[rule.field] = null;
        applied.push(`${model}.${rule.field}`);
      }
      continue;
    }

    if (rule.action === "redact-json-keys") {
      const after = redactSecretJsonKeys(before);
      if (JSON.stringify(after) !== JSON.stringify(before ?? null)) {
        result[rule.field] = after;
        applied.push(`${model}.${rule.field}`);
      }
      continue;
    }

    if (rule.action === "redact-secret-value") {
      // Key/value tables: the sibling `key` column decides whether the value is
      // a secret. SystemSetting is the only such table today.
      const keyName = typeof result.key === "string" ? result.key : "";
      if (keyName.length > 0 && looksSecretBearing(keyName) && before !== SLICE_REDACTED_MARKER) {
        result[rule.field] = SLICE_REDACTED_MARKER;
        applied.push(`${model}.${rule.field}`);
      }
    }
  }

  return { row: result, applied };
}
