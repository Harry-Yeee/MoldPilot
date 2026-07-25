/**
 * Tamper-evident monthly KPI snapshot.
 *
 * The prize meeting prints the monthly snapshot; the CEO and both referees sign
 * the paper. This module makes that paper checkable later:
 *
 *   signed paper  <->  integrity code  <->  archived JSON (nightly encrypted
 *                                          off-machine backup)
 *
 * It EVIDENCES tampering after the fact. It does not prevent anybody with
 * database access from editing rows: a rewritten row simply no longer matches
 * the code on the signed page.
 *
 * Hashing is injected (`Sha256Hex`) so this stays a dependency-free pure module
 * that domain tests can exercise directly.
 */

/** Format marker written into every snapshot file. */
export const KPI_SNAPSHOT_FORMAT = "moldpilot-kpi-snapshot-v1";

/** Hex SHA-256 of a UTF-8 string. Supplied by the caller (node:crypto). */
export type Sha256Hex = (input: string) => string;

export type SnapshotIntegrity = {
  algorithm: "sha256";
  canonicalization: string;
  code: string;
  hash: string;
};

export type SnapshotFile = {
  format: string;
  /** Volatile: deliberately NOT covered by the hash. */
  generatedAt: string;
  integrity: SnapshotIntegrity;
  data: unknown;
};

export type SnapshotVerification = {
  ok: boolean;
  expectedHash: string | null;
  actualHash: string;
  code: string;
  problems: string[];
};

/**
 * Deterministic JSON for hashing.
 *
 * Rules (stable across Node versions and key insertion order):
 *  - objects: keys sorted with a plain code-unit comparison, `undefined`
 *    members and function members dropped;
 *  - arrays: order preserved (callers sort their rows before hashing);
 *  - numbers: `-0` normalised to `0`; non-finite numbers rejected;
 *  - strings/booleans/null: standard JSON;
 *  - Date: rejected. Callers must serialise timestamps to ISO strings first so
 *    the hashed bytes are exactly the bytes stored in the file.
 */
export function canonicalizeForIntegrity(value: unknown): string {
  if (value === null) {
    return "null";
  }

  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error("Snapshot payload contains a non-finite number.");
    }
    return JSON.stringify(value === 0 ? 0 : value);
  }

  if (typeof value === "string") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalizeForIntegrity(entry ?? null)).join(",")}]`;
  }

  if (typeof value === "object") {
    if (value instanceof Date) {
      throw new Error("Snapshot payload must serialise dates to ISO strings before hashing.");
    }

    const source = value as Record<string, unknown>;
    const members = Object.keys(source)
      .filter((key) => {
        const member = source[key];
        return member !== undefined && typeof member !== "function";
      })
      .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0))
      .map((key) => `${JSON.stringify(key)}:${canonicalizeForIntegrity(source[key])}`);

    return `{${members.join(",")}}`;
  }

  throw new Error(`Snapshot payload contains an unsupported ${typeof value} value.`);
}

/** SHA-256 (hex) over the canonicalized `data` section of a snapshot. */
export function snapshotIntegrityHash(data: unknown, sha256Hex: Sha256Hex): string {
  return sha256Hex(canonicalizeForIntegrity(data));
}

/**
 * Human-readable short code: the first 12 hex characters, upper-cased and
 * grouped as XXXX-XXXX-XXXX so it can be read aloud and copied off paper.
 */
export function formatIntegrityCode(hash: string): string {
  const head = hash.trim().toUpperCase().slice(0, 12);

  if (!/^[0-9A-F]{12}$/.test(head)) {
    throw new Error("Integrity hash must be at least 12 hexadecimal characters.");
  }

  return `${head.slice(0, 4)}-${head.slice(4, 8)}-${head.slice(8, 12)}`;
}

/** Builds the on-disk snapshot file: hash covers `data` only. */
export function buildSnapshotFile(
  data: unknown,
  generatedAt: string,
  sha256Hex: Sha256Hex
): SnapshotFile {
  const hash = snapshotIntegrityHash(data, sha256Hex);

  return {
    format: KPI_SNAPSHOT_FORMAT,
    generatedAt,
    integrity: {
      algorithm: "sha256",
      canonicalization: "sorted-keys-json/data-only",
      code: formatIntegrityCode(hash),
      hash
    },
    data
  };
}

/** Recomputes the hash of a parsed snapshot file and compares it. */
export function verifySnapshotFile(parsed: unknown, sha256Hex: Sha256Hex): SnapshotVerification {
  const problems: string[] = [];

  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Snapshot file must contain a JSON object.");
  }

  const file = parsed as Partial<SnapshotFile>;

  if (file.format !== KPI_SNAPSHOT_FORMAT) {
    problems.push(`Unexpected format marker: ${String(file.format)}`);
  }

  if (!("data" in file)) {
    throw new Error("Snapshot file has no data section to verify.");
  }

  const integrity = file.integrity;
  const expectedHash =
    integrity != null && typeof integrity.hash === "string" ? integrity.hash.trim().toLowerCase() : null;

  if (expectedHash == null) {
    problems.push("Snapshot file has no recorded integrity hash.");
  }

  const actualHash = snapshotIntegrityHash(file.data, sha256Hex);

  if (expectedHash != null && expectedHash !== actualHash) {
    problems.push("Recomputed hash does not match the recorded hash.");
  }

  if (
    integrity != null &&
    typeof integrity.code === "string" &&
    integrity.code !== formatIntegrityCode(actualHash)
  ) {
    problems.push("Printed integrity code does not match the recomputed hash.");
  }

  return {
    ok: problems.length === 0,
    expectedHash,
    actualHash,
    code: formatIntegrityCode(actualHash),
    problems
  };
}
