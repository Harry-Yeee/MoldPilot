import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

import {
  SLICE_CLASSIFICATION,
  SLICE_SANITIZATION_RULES,
  sliceClassificationFor,
  sliceModelsInCategory,
  type SliceCategory
} from "../../src/domain/slice/classification.ts";

/**
 * The completeness gate for the dev slice.
 *
 * `prisma/schema.prisma` is parsed HERE, at test time — not copied into a
 * fixture — so adding a model to the schema without classifying it turns this
 * suite red. That is the whole point: a new table must never start (or stop)
 * travelling to a developer's laptop by accident.
 */

function schemaSource(): string {
  return readFileSync(new URL("../../prisma/schema.prisma", import.meta.url), "utf8");
}

/** Model names in schema order, e.g. `model TrialEvent {` -> "TrialEvent". */
function parseModelNames(schema: string): string[] {
  return [...schema.matchAll(/^model\s+([A-Za-z_][A-Za-z0-9_]*)\s*\{/gm)].map((match) => match[1] ?? "");
}

/** Body text of one `model X { ... }` block, or null when absent. */
function parseModelBlock(schema: string, model: string): string | null {
  const header = new RegExp(`^model\\s+${model}\\s*\\{`, "m").exec(schema);
  if (header == null || header.index == null) {
    return null;
  }

  const start = header.index + header[0].length;
  const end = schema.indexOf("\n}", start);
  return end === -1 ? schema.slice(start) : schema.slice(start, end);
}

/** Field names declared in a model block (first token of each field line). */
function parseFieldNames(block: string): string[] {
  return block
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("//") && !line.startsWith("@@"))
    .map((line) => line.split(/\s+/)[0] ?? "")
    .filter((name) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(name));
}

const categories: SliceCategory[] = ["master", "windowed", "excluded"];

describe("dev slice classification covers the whole schema", () => {
  test("every schema model is classified exactly once", () => {
    const schema = schemaSource();
    const schemaModels = parseModelNames(schema);

    assert.ok(schemaModels.length > 0, "parsed no models from prisma/schema.prisma");

    const unclassified = schemaModels.filter((model) => sliceClassificationFor(model) == null);
    assert.deepEqual(
      unclassified,
      [],
      `New Prisma model(s) with no dev-slice classification: ${unclassified.join(", ")}. Add an entry to src/domain/slice/classification.ts and decide master / windowed / excluded.`
    );

    for (const model of schemaModels) {
      const matches = SLICE_CLASSIFICATION.filter((entry) => entry.model === model);
      assert.equal(matches.length, 1, `${model} is classified ${matches.length} times; expected exactly 1.`);
    }
  });

  test("the classification names no model that left the schema", () => {
    const schemaModels = new Set(parseModelNames(schemaSource()));
    const stale = SLICE_CLASSIFICATION.filter((entry) => !schemaModels.has(entry.model)).map(
      (entry) => entry.model
    );

    assert.deepEqual(stale, [], `Classified model(s) no longer in prisma/schema.prisma: ${stale.join(", ")}`);
  });

  test("entry count matches the schema model count", () => {
    assert.equal(SLICE_CLASSIFICATION.length, parseModelNames(schemaSource()).length);
  });

  test("every entry has a real category and a justification", () => {
    for (const entry of SLICE_CLASSIFICATION) {
      assert.ok(categories.includes(entry.category), `${entry.model} has category "${entry.category}".`);
      assert.ok(
        entry.note.trim().length >= 40,
        `${entry.model} needs a real note explaining the category, got "${entry.note}".`
      );
    }
  });

  test("the three categories partition the schema and none is empty", () => {
    const perCategory = categories.map((category) => sliceModelsInCategory(category));
    const total = perCategory.reduce((sum, models) => sum + models.length, 0);

    assert.equal(total, SLICE_CLASSIFICATION.length);
    for (const [index, models] of perCategory.entries()) {
      assert.ok(models.length > 0, `category "${categories[index]}" classifies nothing.`);
    }
  });

  test("the window anchor and the ephemeral throttle table keep their categories", () => {
    // Cheap negative controls: if the parser or the map silently went empty,
    // these two fail loudly instead of everything passing vacuously.
    assert.equal(sliceClassificationFor("MoldTrialProject")?.category, "windowed");
    assert.equal(sliceClassificationFor("LoginThrottleBucket")?.category, "excluded");
    assert.equal(sliceClassificationFor("User")?.category, "master");
    assert.equal(sliceClassificationFor("NotARealModel"), null);
  });
});

describe("dev slice sanitization rules point at real columns", () => {
  test("every rule names a model that exists in the schema", () => {
    const schemaModels = new Set(parseModelNames(schemaSource()));

    for (const rule of SLICE_SANITIZATION_RULES) {
      assert.ok(
        schemaModels.has(rule.model),
        `Sanitization rule ${rule.model}.${rule.field} names a model that is not in prisma/schema.prisma.`
      );
    }
  });

  test("every rule names a field declared on that model", () => {
    const schema = schemaSource();

    for (const rule of SLICE_SANITIZATION_RULES) {
      const block = parseModelBlock(schema, rule.model);
      assert.ok(block != null, `Could not parse model ${rule.model} from prisma/schema.prisma.`);
      assert.ok(
        parseFieldNames(block ?? "").includes(rule.field),
        `Sanitization rule ${rule.model}.${rule.field} names a field that model does not declare.`
      );
    }
  });

  test("the field parser is not vacuous", () => {
    const block = parseModelBlock(schemaSource(), "User");
    const fields = parseFieldNames(block ?? "");

    assert.ok(fields.includes("passwordHash"));
    assert.ok(fields.includes("username"));
    assert.ok(!fields.includes("thisFieldDoesNotExist"));
  });

  test("password hash and staff email are nulled, and the throttle hash is documented", () => {
    const byField = new Map(SLICE_SANITIZATION_RULES.map((rule) => [`${rule.model}.${rule.field}`, rule]));

    assert.equal(byField.get("User.passwordHash")?.action, "null-on-export");
    assert.equal(byField.get("User.email")?.action, "null-on-export");
    assert.equal(byField.get("LoginThrottleBucket.keyHash")?.action, "model-excluded");
  });

  test("every secret-looking schema column is either sanitized, excluded, or explicitly justified", () => {
    // Walks the schema for hash/secret/token/password-ish column names and
    // requires each one to be accounted for, so a future migration cannot add a
    // secret column that quietly rides along.
    const schema = schemaSource();
    const covered = new Set(SLICE_SANITIZATION_RULES.map((rule) => `${rule.model}.${rule.field}`));
    const excludedModels = new Set(sliceModelsInCategory("excluded"));
    // Reviewed and deliberately not sanitized — see the note block above
    // SLICE_SANITIZATION_RULES in src/domain/slice/classification.ts.
    const justified = new Set([
      "FileAttachment.storageKey",
      "ProcessSheetParameter.parameterKey",
      "SystemSetting.key",
      "TrialProcessValue.parameterKeySnapshot",
      "User.passwordUpdatedAt",
      "User.forcePasswordChange"
    ]);
    const suspicious = /pass(word|phrase)|secret|token|credential|apikey|api_key|hash|salt|private[_-]?key|storagekey|parameterkey/i;

    const unaccounted: string[] = [];
    for (const model of parseModelNames(schema)) {
      const block = parseModelBlock(schema, model);
      for (const field of parseFieldNames(block ?? "")) {
        const qualified = `${model}.${field}`;
        if (!suspicious.test(field)) {
          continue;
        }
        if (covered.has(qualified) || justified.has(qualified) || excludedModels.has(model)) {
          continue;
        }
        unaccounted.push(qualified);
      }
    }

    assert.deepEqual(
      unaccounted,
      [],
      `Secret-looking column(s) with no dev-slice decision: ${unaccounted.join(", ")}. Add a sanitization rule or add it to the reviewed list in this test with a reason.`
    );
  });
});
