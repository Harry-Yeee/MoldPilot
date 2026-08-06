import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  commonMaterialCodes,
  intakeDetailLabels,
  intakeTextMaxLength,
  minimumTrialQuantity,
  parseColor,
  parseIntakeText,
  parseMaterial,
  parseTrialQuantity,
  projectAssignedAssemblyGroupId,
  projectIntakeDetails
} from "../../src/domain/mold-trial/intake-details.ts";

describe("material datalist", () => {
  test("carries the pilot's common materials, in order, with no duplicates", () => {
    assert.deepEqual(
      [...commonMaterialCodes],
      ["PC", "ABS", "PC+ABS", "PP", "PA66", "PA66+GF", "POM", "TPU", "PMMA"]
    );
    assert.equal(new Set(commonMaterialCodes).size, commonMaterialCodes.length);
  });

  test("is only a suggestion list — anything else still parses", () => {
    assert.equal(parseMaterial("PPS+GF40"), "PPS+GF40");
    assert.equal(parseMaterial("尼龙加纤"), "尼龙加纤");
  });
});

describe("parseIntakeText", () => {
  test("trims and keeps a real value", () => {
    assert.equal(parseIntakeText("  PC+ABS  "), "PC+ABS");
    assert.equal(parseColor(" 黑色 "), "黑色");
  });

  test("blank, whitespace, null and undefined all read as not given", () => {
    assert.equal(parseIntakeText(""), null);
    assert.equal(parseIntakeText("    "), null);
    assert.equal(parseIntakeText(null), null);
    assert.equal(parseIntakeText(undefined), null);
    assert.equal(parseMaterial(null), null);
    assert.equal(parseColor(undefined), null);
  });

  test("caps the length so a paste accident cannot fill a display cell", () => {
    const long = "A".repeat(intakeTextMaxLength + 50);
    assert.equal(parseIntakeText(long)?.length, intakeTextMaxLength);
  });
});

describe("parseTrialQuantity", () => {
  test("accepts a positive whole number as string or number", () => {
    assert.equal(parseTrialQuantity("50"), 50);
    assert.equal(parseTrialQuantity(" 200 "), 200);
    assert.equal(parseTrialQuantity(1), 1);
    assert.equal(minimumTrialQuantity, 1);
  });

  test("blank / missing reads as not given, not as an error", () => {
    assert.equal(parseTrialQuantity(""), null);
    assert.equal(parseTrialQuantity("   "), null);
    assert.equal(parseTrialQuantity(null), null);
    assert.equal(parseTrialQuantity(undefined), null);
  });

  test("zero, negative, fractional and non-numeric are dropped", () => {
    assert.equal(parseTrialQuantity("0"), null);
    assert.equal(parseTrialQuantity("-5"), null);
    assert.equal(parseTrialQuantity("12.5"), null);
    assert.equal(parseTrialQuantity("many"), null);
    assert.equal(parseTrialQuantity(Number.NaN), null);
    assert.equal(parseTrialQuantity(Number.POSITIVE_INFINITY), null);
  });
});

describe("projectIntakeDetails (stale-client read seam)", () => {
  test("reads and normalizes a full row", () => {
    assert.deepEqual(
      projectIntakeDetails({
        id: "project-1",
        material: "  PC  ",
        color: "黑色",
        trialQuantity: 100,
        assignedAssemblyGroupId: "group-a"
      }),
      { material: "PC", color: "黑色", trialQuantity: 100, assignedAssemblyGroupId: "group-a" }
    );
  });

  test("a row from a generated client that predates the migration reads as unset", () => {
    // No material / color / trialQuantity / assignedAssemblyGroupId keys at all:
    // exactly the shape a stale Prisma client returns. This is the seam that
    // keeps `tsc --noEmit` clean before Harry regenerates.
    assert.deepEqual(projectIntakeDetails({ id: "project-1" }), {
      material: null,
      color: null,
      trialQuantity: null,
      assignedAssemblyGroupId: null
    });
  });

  test("explicit nulls behave the same as absent fields", () => {
    assert.deepEqual(
      projectIntakeDetails({
        id: "project-1",
        material: null,
        color: null,
        trialQuantity: null,
        assignedAssemblyGroupId: null
      }),
      { material: null, color: null, trialQuantity: null, assignedAssemblyGroupId: null }
    );
  });
});

describe("projectAssignedAssemblyGroupId", () => {
  test("returns the assignment, or null when absent", () => {
    assert.equal(projectAssignedAssemblyGroupId({ id: "p", assignedAssemblyGroupId: "group-b" }), "group-b");
    assert.equal(projectAssignedAssemblyGroupId({ id: "p", assignedAssemblyGroupId: null }), null);
    assert.equal(projectAssignedAssemblyGroupId({ id: "p" }), null);
  });
});

describe("labels", () => {
  test("every field label carries both languages", () => {
    for (const [key, label] of Object.entries(intakeDetailLabels)) {
      assert.equal(typeof label.en, "string", `${key} is missing an English label`);
      assert.equal(typeof label.zh, "string", `${key} is missing a Chinese label`);
      assert.ok(label.en.length > 0 && label.zh.length > 0, `${key} has an empty label`);
    }

    assert.equal(intakeDetailLabels.material.zh, "材料");
    assert.equal(intakeDetailLabels.color.zh, "颜色");
    assert.equal(intakeDetailLabels.trialQuantity.zh, "试模数量");
    assert.equal(intakeDetailLabels.assemblyGroup.zh, "装配组");
    assert.equal(intakeDetailLabels.unassignedGroup.zh, "未指定");
  });
});
