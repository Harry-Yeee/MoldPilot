import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  KPI_SNAPSHOT_FORMAT,
  buildSnapshotFile,
  canonicalizeForIntegrity,
  formatIntegrityCode,
  snapshotIntegrityHash,
  verifySnapshotFile
} from "../../src/domain/security/snapshot-integrity.ts";

function sha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

function source(relativePath: string): string {
  return readFileSync(new URL(`../../${relativePath}`, import.meta.url), "utf8");
}

type SnapshotRow = {
  month: string;
  scopeType: string;
  scopeId: string | null;
  metrics: Record<string, unknown>;
};

type SnapshotData = {
  snapshotDate: string;
  months: string[];
  rowCount: number;
  rows: SnapshotRow[];
};

type MutableSnapshotFile = {
  format?: string;
  generatedAt?: string;
  integrity?: { algorithm?: string; canonicalization?: string; code?: string; hash?: string };
  data: SnapshotData;
};

/** The synthetic prize-meeting payload used as the documented worked example. */
const syntheticData: SnapshotData = {
  snapshotDate: "2026-07-25",
  months: ["2026-06", "2026-07"],
  rowCount: 3,
  rows: [
    {
      month: "2026-06",
      scopeType: "COMPANY",
      scopeId: null,
      metrics: { month: "2026-06", applicable: 40, onTime: 36, percent: 90, userCount: 7 }
    },
    {
      month: "2026-06",
      scopeType: "DEPARTMENT_GROUP",
      scopeId: "group-assembly-zhong",
      metrics: {
        month: "2026-06",
        groupCode: "assembly-zhong",
        leaderUserId: "user-zhong",
        memberCount: 3,
        applicable: 12,
        onTime: 11,
        percent: 92,
        barHit: true,
        barHitByFloor: false
      }
    },
    {
      month: "2026-06",
      scopeType: "USER",
      scopeId: "user-wang",
      metrics: {
        month: "2026-06",
        username: "wang",
        roleCode: "injection",
        roleScope: "injection",
        scorecard: {
          applicable: 6,
          onTime: 5,
          percent: 83,
          barHit: false,
          barHitByFloor: false,
          totalPoints: 4,
          lines: [
            {
              ruleCode: "inj.date_confirm",
              applicable: 6,
              onTime: 5,
              items: [
                {
                  ref: "MP-2026-014 · T1",
                  dueAt: "2026-06-12T09:00:00.000Z",
                  doneAt: "2026-06-13T01:20:00.000Z",
                  onTime: false
                }
              ]
            }
          ],
          points: [
            {
              issueRef: "MP-2026-014 · flash on rib",
              severity: "MAJOR",
              weight: 4,
              verified: true,
              counted: true
            }
          ]
        }
      }
    }
  ]
};

/** A JSON round-trip of the archive, freely mutable for tamper tests. */
function archivedFile(): MutableSnapshotFile {
  const written = buildSnapshotFile(syntheticData, "2026-07-25T02:30:00.000Z", sha256Hex);
  return JSON.parse(JSON.stringify(written)) as MutableSnapshotFile;
}

describe("KPI snapshot canonicalization", () => {
  it("sorts object keys and preserves array order", () => {
    assert.equal(
      canonicalizeForIntegrity({ zulu: 1, alpha: 2, mike: [3, 1, 2] }),
      '{"alpha":2,"mike":[3,1,2],"zulu":1}'
    );
  });

  it("hashes identically regardless of key insertion order", () => {
    const one = { month: "2026-07", rows: [{ b: 2, a: 1 }] };
    const two = { rows: [{ a: 1, b: 2 }], month: "2026-07" };
    assert.equal(canonicalizeForIntegrity(one), canonicalizeForIntegrity(two));
    assert.equal(snapshotIntegrityHash(one, sha256Hex), snapshotIntegrityHash(two, sha256Hex));
  });

  it("drops undefined members instead of emitting them", () => {
    assert.equal(canonicalizeForIntegrity({ a: 1, b: undefined }), '{"a":1}');
  });

  it("normalises negative zero and keeps null distinct from missing", () => {
    assert.equal(canonicalizeForIntegrity({ a: -0 }), '{"a":0}');
    assert.equal(canonicalizeForIntegrity({ a: null }), '{"a":null}');
  });

  it("refuses values that could hash inconsistently", () => {
    assert.throws(() => canonicalizeForIntegrity({ a: Number.NaN }), /non-finite number/);
    assert.throws(() => canonicalizeForIntegrity({ a: new Date() }), /ISO strings/);
    assert.throws(() => canonicalizeForIntegrity({ a: 1n }), /unsupported bigint/);
  });

  it("changes the hash when any scored value changes", () => {
    const before = snapshotIntegrityHash(syntheticData, sha256Hex);
    const tampered = structuredClone(syntheticData);
    tampered.rows[0].metrics.onTime = 37;
    assert.notEqual(snapshotIntegrityHash(tampered, sha256Hex), before);
  });
});

describe("KPI snapshot integrity code", () => {
  it("groups the first 12 hex characters for humans", () => {
    assert.equal(formatIntegrityCode("0123456789abcdef0123"), "0123-4567-89AB");
    assert.throws(() => formatIntegrityCode("short"), /at least 12 hexadecimal/);
  });

  it("is stable for the synthetic prize-meeting payload", () => {
    const hash = snapshotIntegrityHash(syntheticData, sha256Hex);
    // Worked example recorded in docs/03-build/development.md.
    assert.equal(hash, "464c39815679d0f85db073d4911e65eea0e87e2867d2ef11172dc9d20e1fd8a9");
    assert.equal(formatIntegrityCode(hash), "464C-3981-5679");
  });
});

describe("KPI snapshot file", () => {
  it("hashes the data section only, excluding generatedAt and the hash itself", () => {
    const early = buildSnapshotFile(syntheticData, "2026-07-25T02:30:00.000Z", sha256Hex);
    const late = buildSnapshotFile(syntheticData, "2026-07-25T23:59:59.000Z", sha256Hex);

    assert.equal(early.format, KPI_SNAPSHOT_FORMAT);
    assert.equal(early.integrity.hash, late.integrity.hash);
    assert.equal(early.integrity.code, late.integrity.code);
    assert.equal(early.integrity.hash, snapshotIntegrityHash(syntheticData, sha256Hex));
  });

  it("verifies a freshly written file", () => {
    const verification = verifySnapshotFile(archivedFile(), sha256Hex);
    assert.equal(verification.ok, true);
    assert.deepEqual(verification.problems, []);
    assert.equal(verification.expectedHash, verification.actualHash);
  });

  it("fails a hand-edited file", () => {
    const file = archivedFile();
    file.data.rows[0].metrics.percent = 100;
    const verification = verifySnapshotFile(file, sha256Hex);
    assert.equal(verification.ok, false);
    assert.match(verification.problems.join(" "), /Recomputed hash does not match/);
  });

  it("fails when only the printed code was edited", () => {
    const file = archivedFile();
    if (file.integrity != null) {
      file.integrity.code = "0000-0000-0000";
    }
    const verification = verifySnapshotFile(file, sha256Hex);
    assert.equal(verification.ok, false);
    assert.match(verification.problems.join(" "), /Printed integrity code does not match/);
  });

  it("reports a missing hash rather than silently passing", () => {
    const file = archivedFile();
    delete file.integrity;
    const verification = verifySnapshotFile(file, sha256Hex);
    assert.equal(verification.ok, false);
    assert.match(verification.problems.join(" "), /no recorded integrity hash/);
  });

  it("rejects a file with no data section", () => {
    assert.throws(() => verifySnapshotFile({ format: KPI_SNAPSHOT_FORMAT }, sha256Hex), /no data section/);
    assert.throws(() => verifySnapshotFile([], sha256Hex), /JSON object/);
  });
});

describe("KPI snapshot runner wiring", () => {
  it("handles --verify without touching Prisma, and archives with the hash", () => {
    const runner = source("scripts/run-kpi-snapshot.mjs");
    assert.ok(runner.indexOf("options.verify != null") < runner.indexOf('await import("@prisma/client")'));
    assert.match(runner, /Integrity code \/ 校验码/);
    assert.match(runner, /\[PASS\]/);
    assert.match(runner, /\[FAIL\]/);
    assert.match(runner, /buildSnapshotFile\(/);
    assert.match(runner, /MOLDPILOT_KPI_SNAPSHOT_DIR/);
    assert.match(runner, /mode: 0o600/);
  });
});
