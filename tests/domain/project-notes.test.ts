import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  activeProjectNotes,
  decideProjectNoteRetire,
  orderProjectNotes,
  parseProjectNoteBody,
  projectNoteLabels,
  projectNoteMaxLength,
  projectNoteRetireMessages,
  type ProjectNoteRecord
} from "../../src/domain/mold-trial/project-notes.ts";

function note(overrides: Partial<ProjectNoteRecord> & { id: string; createdAt: Date }): ProjectNoteRecord {
  return {
    body: "INFO",
    createdByName: "Amy / 陈美",
    retiredAt: null,
    retiredByName: null,
    ...overrides
  };
}

describe("parseProjectNoteBody", () => {
  test("trims and keeps a real note", () => {
    assert.equal(parseProjectNoteBody("  delivery moved to week 40  "), "delivery moved to week 40");
    assert.equal(parseProjectNoteBody("客户要求改到 40 周"), "客户要求改到 40 周");
  });

  test("keeps interior line breaks — a note is often a short list", () => {
    assert.equal(parseProjectNoteBody("  a\nb  "), "a\nb");
  });

  test("blank, whitespace, null and undefined all read as not given", () => {
    assert.equal(parseProjectNoteBody(""), null);
    assert.equal(parseProjectNoteBody("    "), null);
    assert.equal(parseProjectNoteBody("\n\n"), null);
    assert.equal(parseProjectNoteBody(null), null);
    assert.equal(parseProjectNoteBody(undefined), null);
  });

  test("caps the length", () => {
    const long = "A".repeat(projectNoteMaxLength + 100);
    assert.equal(parseProjectNoteBody(long)?.length, projectNoteMaxLength);
  });
});

describe("orderProjectNotes (the owner's sketch)", () => {
  const info1 = note({
    id: "n1",
    body: "INFO1",
    createdAt: new Date("2026-08-01T09:00:00.000Z"),
    retiredAt: new Date("2026-08-04T09:00:00.000Z"),
    retiredByName: "Bill / 王比"
  });
  const info2 = note({ id: "n2", body: "INFO2", createdAt: new Date("2026-08-04T09:00:01.000Z") });

  test("chronological, retired lines kept IN PLACE (INFO1 struck, INFO2 below)", () => {
    const lines = orderProjectNotes([info2, info1]);

    assert.deepEqual(
      lines.map((line) => [line.body, line.retired]),
      [
        ["INFO1", true],
        ["INFO2", false]
      ]
    );
  });

  test("retired lines are NOT grouped at the bottom", () => {
    const later = note({ id: "n3", body: "INFO3", createdAt: new Date("2026-08-05T09:00:00.000Z") });
    const lines = orderProjectNotes([later, info1, info2]);
    assert.deepEqual(lines.map((line) => line.body), ["INFO1", "INFO2", "INFO3"]);
  });

  test("same-millisecond notes get a stable order from the id", () => {
    const at = new Date("2026-08-05T09:00:00.000Z");
    const a = note({ id: "aaa", body: "A", createdAt: at });
    const b = note({ id: "bbb", body: "B", createdAt: at });
    assert.deepEqual(orderProjectNotes([b, a]).map((line) => line.body), ["A", "B"]);
    assert.deepEqual(orderProjectNotes([a, b]).map((line) => line.body), ["A", "B"]);
  });

  test("does not mutate its input", () => {
    const input = [info2, info1];
    orderProjectNotes(input);
    assert.deepEqual(input.map((line) => line.id), ["n2", "n1"]);
  });

  test("activeProjectNotes drops the struck-through lines only", () => {
    assert.deepEqual(activeProjectNotes([info1, info2]).map((line) => line.body), ["INFO2"]);
  });

  test("an empty ledger renders as an empty list, not an error", () => {
    assert.deepEqual(orderProjectNotes([]), []);
    assert.deepEqual(activeProjectNotes([]), []);
  });
});

describe("decideProjectNoteRetire", () => {
  const live = { id: "n1", projectId: "p1", retiredAt: null };

  test("allows retiring a live note of this project", () => {
    assert.deepEqual(decideProjectNoteRetire({ projectId: "p1", note: live }), {
      ok: true,
      alreadyRetired: false
    });
  });

  test("refuses a missing note", () => {
    assert.deepEqual(decideProjectNoteRetire({ projectId: "p1", note: null }), {
      ok: false,
      reason: "NOT_FOUND"
    });
    assert.deepEqual(decideProjectNoteRetire({ projectId: "p1", note: undefined }), {
      ok: false,
      reason: "NOT_FOUND"
    });
  });

  test("refuses a note from another project (hand-built POST)", () => {
    assert.deepEqual(
      decideProjectNoteRetire({ projectId: "p1", note: { ...live, projectId: "p2" } }),
      { ok: false, reason: "WRONG_PROJECT" }
    );
  });

  test("refuses a second retire, so the first retirer keeps the credit", () => {
    assert.deepEqual(
      decideProjectNoteRetire({
        projectId: "p1",
        note: { ...live, retiredAt: new Date("2026-08-05T09:00:00.000Z") }
      }),
      { ok: false, reason: "ALREADY_RETIRED" }
    );
  });

  test("every refusal has a message", () => {
    for (const reason of ["NOT_FOUND", "WRONG_PROJECT", "ALREADY_RETIRED"] as const) {
      assert.ok(projectNoteRetireMessages[reason].length > 0);
    }
  });
});

describe("labels", () => {
  test("every label carries both languages", () => {
    for (const [key, label] of Object.entries(projectNoteLabels)) {
      assert.equal(typeof label.en, "string", `${key} is missing an English label`);
      assert.equal(typeof label.zh, "string", `${key} is missing a Chinese label`);
      assert.ok(label.en.length > 0 && label.zh.length > 0, `${key} has an empty label`);
    }

    assert.equal(projectNoteLabels.sectionTitle.zh, "客户备注");
    assert.equal(projectNoteLabels.sectionTitle.en, "Client notes");
  });
});
