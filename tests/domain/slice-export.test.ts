import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";

import {
  formatIntegrityCode,
  snapshotIntegrityHash
} from "../../src/domain/security/snapshot-integrity.ts";
import {
  SLICE_BLOB_FILE_TYPE,
  SLICE_BLOB_MAX_BYTES,
  SLICE_EXPORT_ORDER,
  SLICE_REDACTED_MARKER,
  sliceModelsInCategory
} from "../../src/domain/slice/classification.ts";
import {
  decideProjectWindowMembership,
  decideProjectWindowMemberships,
  includedProjectIds,
  type ProjectActivitySummary
} from "../../src/domain/slice/project-window.ts";
import { looksSecretBearing, redactSecretJsonKeys, sanitizeSliceRow } from "../../src/domain/slice/sanitize.ts";
import {
  isWithinSliceWindow,
  sliceDirectoryName,
  sliceWindowFromDates,
  sliceWindowFromMonths
} from "../../src/domain/slice/window.ts";

/**
 * Pure-function coverage for the dev slice, plus the structural guards that keep
 * the export a server-side CLI.
 */

function repoFile(relativePath: string): string {
  return readFileSync(new URL(`../../${relativePath}`, import.meta.url), "utf8");
}

function sha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

/** 2026-07-27 10:00 Asia/Shanghai. */
const midMorningShanghai = new Date("2026-07-27T02:00:00.000Z");

describe("slice window boundary math (Asia/Shanghai)", () => {
  test("--months N starts on the 1st of the month N-1 months back and ends today", () => {
    const oneMonth = sliceWindowFromMonths(1, midMorningShanghai);
    assert.equal(oneMonth.fromDateKey, "2026-07-01");
    assert.equal(oneMonth.toDateKey, "2026-07-27");
    assert.equal(oneMonth.mode, "months");
    assert.equal(oneMonth.months, 1);

    const threeMonths = sliceWindowFromMonths(3, midMorningShanghai);
    assert.equal(threeMonths.fromDateKey, "2026-05-01");
    assert.equal(threeMonths.toDateKey, "2026-07-27");
  });

  test("month arithmetic rolls back over a year boundary", () => {
    const window = sliceWindowFromMonths(12, new Date("2026-02-15T04:00:00.000Z"));
    assert.equal(window.fromDateKey, "2025-03-01");
    assert.equal(window.toDateKey, "2026-02-15");
  });

  test("the business day is Shanghai's, not UTC's", () => {
    // 2026-07-31 16:30 UTC is already 2026-08-01 00:30 in Shanghai.
    const window = sliceWindowFromMonths(1, new Date("2026-07-31T16:30:00.000Z"));
    assert.equal(window.fromDateKey, "2026-08-01");
    assert.equal(window.toDateKey, "2026-08-01");

    // ...and 15:30 UTC on the same date is still 23:30 on 2026-07-31 there.
    const earlier = sliceWindowFromMonths(1, new Date("2026-07-31T15:30:00.000Z"));
    assert.equal(earlier.fromDateKey, "2026-07-01");
    assert.equal(earlier.toDateKey, "2026-07-31");
  });

  test("instants are +08:00 midnights and the range is half-open", () => {
    const window = sliceWindowFromDates("2026-05-01", "2026-07-27");

    assert.equal(window.start.toISOString(), "2026-04-30T16:00:00.000Z");
    assert.equal(window.end.toISOString(), "2026-07-27T16:00:00.000Z");

    assert.equal(isWithinSliceWindow(window, window.start), true);
    assert.equal(isWithinSliceWindow(window, new Date(window.end.getTime() - 1)), true);
    assert.equal(isWithinSliceWindow(window, window.end), false);
    assert.equal(isWithinSliceWindow(window, new Date(window.start.getTime() - 1)), false);
    assert.equal(isWithinSliceWindow(window, null), false);
  });

  test("the last day of the window is included in full", () => {
    const window = sliceWindowFromDates("2026-07-01", "2026-07-27");
    // 2026-07-27 23:59:59 Shanghai = 15:59:59 UTC.
    assert.equal(isWithinSliceWindow(window, new Date("2026-07-27T15:59:59.000Z")), true);
    // 2026-07-28 00:00 Shanghai = 16:00 UTC.
    assert.equal(isWithinSliceWindow(window, new Date("2026-07-27T16:00:00.000Z")), false);
  });

  test("--months is refused outside 1..12", () => {
    assert.throws(() => sliceWindowFromMonths(0, midMorningShanghai), /between 1 and 12/);
    assert.throws(() => sliceWindowFromMonths(13, midMorningShanghai), /between 1 and 12/);
    assert.throws(() => sliceWindowFromMonths(1.5, midMorningShanghai), /whole number/);
  });

  test("explicit dates are validated and capped", () => {
    assert.throws(() => sliceWindowFromDates("2026-13-01", "2026-12-01"), /--from must be a real calendar date/);
    assert.throws(() => sliceWindowFromDates("2026-02-30", "2026-03-01"), /--from must be a real calendar date/);
    assert.throws(() => sliceWindowFromDates("2026-01-01", "2026-1-2"), /--to must be a real calendar date/);
    assert.throws(() => sliceWindowFromDates("2026-06-01", "2026-05-31"), /is after --to/);
    assert.throws(() => sliceWindowFromDates("2025-01-01", "2026-01-02"), /capped at 366/);

    const wholeYear = sliceWindowFromDates("2026-01-01", "2026-12-31");
    assert.equal(wholeYear.mode, "explicit");
    assert.equal(wholeYear.months, null);
  });

  test("the directory name carries the window", () => {
    assert.equal(
      sliceDirectoryName(sliceWindowFromDates("2026-05-01", "2026-07-27")),
      "moldpilot-slice-2026-05-01_2026-07-27"
    );
  });
});

describe("project in/out verdict", () => {
  const window = sliceWindowFromDates("2026-05-01", "2026-05-31");
  const inside = new Date("2026-05-14T03:00:00.000Z");
  const alsoInside = new Date("2026-05-20T03:00:00.000Z");
  const before = new Date("2026-04-30T03:00:00.000Z");
  const after = new Date("2026-06-02T03:00:00.000Z");

  test("a project with no activity at all is OUT", () => {
    const verdict = decideProjectWindowMembership(
      { projectId: "p1", signals: [{ source: "TrialEvent.createdAt", at: null }] },
      window
    );

    assert.equal(verdict.included, false);
    assert.equal(verdict.matchedSource, null);
    assert.equal(verdict.matchedAt, null);
  });

  test("activity only outside the window is OUT", () => {
    const verdict = decideProjectWindowMembership(
      {
        projectId: "p2",
        signals: [
          { source: "MoldTrialProject.createdAt", at: before },
          { source: "TrialEvent.updatedAt", at: after }
        ]
      },
      window
    );

    assert.equal(verdict.included, false);
  });

  test("ONE child row inside the window pulls the whole project IN", () => {
    const verdict = decideProjectWindowMembership(
      {
        projectId: "p3",
        signals: [
          { source: "MoldTrialProject.createdAt", at: before },
          { source: "MoldTrialProject.updatedAt", at: before },
          { source: "TrialIssue.updatedAt", at: inside },
          { source: "FileAttachment.uploadedAt", at: null }
        ]
      },
      window
    );

    assert.equal(verdict.included, true);
    assert.equal(verdict.matchedSource, "TrialIssue.updatedAt");
    assert.deepEqual(verdict.matchedAt, inside);
  });

  test("an activity-log row alone is enough", () => {
    const verdict = decideProjectWindowMembership(
      {
        projectId: "p4",
        signals: [
          { source: "MoldTrialProject.updatedAt", at: before },
          { source: "ActivityLog.createdAt", at: inside }
        ]
      },
      window
    );

    assert.equal(verdict.included, true);
    assert.equal(verdict.matchedSource, "ActivityLog.createdAt");
  });

  test("the newest in-window signal is reported, ties break on source name", () => {
    const newest = decideProjectWindowMembership(
      {
        projectId: "p5",
        signals: [
          { source: "TrialEvent.createdAt", at: inside },
          { source: "TrialIssue.createdAt", at: alsoInside }
        ]
      },
      window
    );
    assert.equal(newest.matchedSource, "TrialIssue.createdAt");

    const tied = decideProjectWindowMembership(
      {
        projectId: "p6",
        signals: [
          { source: "TrialIssue.createdAt", at: inside },
          { source: "ActivityLog.createdAt", at: new Date(inside.getTime()) }
        ]
      },
      window
    );
    assert.equal(tied.matchedSource, "ActivityLog.createdAt");
  });

  test("window edges: start counts, the exclusive end does not", () => {
    const atStart = decideProjectWindowMembership(
      { projectId: "p7", signals: [{ source: "TrialEvent.createdAt", at: window.start }] },
      window
    );
    const atEnd = decideProjectWindowMembership(
      { projectId: "p8", signals: [{ source: "TrialEvent.createdAt", at: window.end }] },
      window
    );

    assert.equal(atStart.included, true);
    assert.equal(atEnd.included, false);
  });

  test("many projects come back in stable id order with only the IN ones selected", () => {
    const summaries: ProjectActivitySummary[] = [
      { projectId: "p-c", signals: [{ source: "TrialEvent.createdAt", at: inside }] },
      { projectId: "p-a", signals: [{ source: "TrialEvent.createdAt", at: after }] },
      { projectId: "p-b", signals: [{ source: "ActivityLog.createdAt", at: alsoInside }] }
    ];

    const verdicts = decideProjectWindowMemberships(summaries, window);
    assert.deepEqual(
      verdicts.map((verdict) => verdict.projectId),
      ["p-a", "p-b", "p-c"]
    );
    assert.deepEqual(includedProjectIds(verdicts), ["p-b", "p-c"]);
  });
});

describe("sanitization applied to rows", () => {
  const syntheticUser = {
    id: "11111111-1111-1111-1111-111111111111",
    username: "zhong",
    displayName: "Zhong",
    chineseName: "钟",
    email: "zhong@example.com",
    passwordHash: "scrypt-v1$c2FsdA$a2V5",
    forcePasswordChange: false,
    passwordUpdatedAt: new Date("2026-07-01T00:00:00.000Z"),
    roleId: "22222222-2222-2222-2222-222222222222",
    status: "ACTIVE"
  };

  test("a user row loses its password hash and email, and nothing else", () => {
    const { row, applied } = sanitizeSliceRow("User", syntheticUser);

    assert.equal(row.passwordHash, null);
    assert.equal(row.email, null);
    assert.deepEqual(applied.sort(), ["User.email", "User.passwordHash"]);

    assert.equal(row.username, "zhong");
    assert.equal(row.displayName, "Zhong");
    assert.equal(row.chineseName, "钟");
    assert.equal(row.status, "ACTIVE");
    assert.equal(row.forcePasswordChange, false);
    assert.deepEqual(row.passwordUpdatedAt, syntheticUser.passwordUpdatedAt);
    assert.deepEqual(Object.keys(row).sort(), Object.keys(syntheticUser).sort());
  });

  test("the caller's row is never mutated", () => {
    sanitizeSliceRow("User", syntheticUser);
    assert.equal(syntheticUser.passwordHash, "scrypt-v1$c2FsdA$a2V5");
    assert.equal(syntheticUser.email, "zhong@example.com");
  });

  test("already-null secrets are not reported as scrubbed", () => {
    const { applied } = sanitizeSliceRow("User", { ...syntheticUser, passwordHash: null, email: null });
    assert.deepEqual(applied, []);
  });

  test("a model with no rules passes through untouched", () => {
    const trial = { id: "t1", trialCode: "T1", outcomeNote: "hash marks on the part" };
    const { row, applied } = sanitizeSliceRow("TrialEvent", trial);

    assert.deepEqual(row, trial);
    assert.deepEqual(applied, []);
  });

  test("activity-log JSON is key-redacted at any depth, values preserved", () => {
    const { row, applied } = sanitizeSliceRow("ActivityLog", {
      id: "a1",
      action: "admin_reset_user_password",
      beforeJson: { username: "zhong", nested: { passwordHash: "secret-value", note: "keep me" } },
      afterJson: { items: [{ apiToken: "t0ken", label: "keep" }], count: 2 }
    });

    assert.deepEqual(row.beforeJson, {
      username: "zhong",
      nested: { passwordHash: SLICE_REDACTED_MARKER, note: "keep me" }
    });
    assert.deepEqual(row.afterJson, {
      items: [{ apiToken: SLICE_REDACTED_MARKER, label: "keep" }],
      count: 2
    });
    assert.deepEqual(applied.sort(), ["ActivityLog.afterJson", "ActivityLog.beforeJson"]);
  });

  test("clean activity-log JSON is left exactly as it was", () => {
    const clean = { id: "a2", beforeJson: { status: "OPEN" }, afterJson: null };
    const { row, applied } = sanitizeSliceRow("ActivityLog", clean);

    assert.deepEqual(row, clean);
    assert.deepEqual(applied, []);
  });

  test("a system setting is redacted only when its key looks secret", () => {
    const toggle = sanitizeSliceRow("SystemSetting", { key: "scoreboard_enabled", value: "true" });
    assert.equal(toggle.row.value, "true");
    assert.deepEqual(toggle.applied, []);

    const secret = sanitizeSliceRow("SystemSetting", { key: "smtp_password", value: "hunter2" });
    assert.equal(secret.row.value, SLICE_REDACTED_MARKER);
    assert.deepEqual(secret.applied, ["SystemSetting.value"]);
  });

  test("secret-name detection covers the obvious shapes and spares storageKey", () => {
    for (const name of ["passwordHash", "password", "apiToken", "sessionSecret", "keyHash", "privateKey", "salt"]) {
      assert.equal(looksSecretBearing(name), true, `${name} should be treated as secret-bearing`);
    }

    for (const name of ["storageKey", "username", "projectCode", "note", "createdAt"]) {
      assert.equal(looksSecretBearing(name), false, `${name} should not be treated as secret-bearing`);
    }
  });

  test("redaction survives arrays, nulls, and primitives", () => {
    assert.equal(redactSecretJsonKeys(null), null);
    assert.equal(redactSecretJsonKeys("plain"), "plain");
    assert.deepEqual(redactSecretJsonKeys([1, { token: "x" }, null]), [1, { token: SLICE_REDACTED_MARKER }, null]);
  });
});

describe("FK-safe export order", () => {
  const master = sliceModelsInCategory("master");
  const windowed = sliceModelsInCategory("windowed");
  const excluded = sliceModelsInCategory("excluded");

  test("contains every master and windowed model exactly once", () => {
    const expected = [...master, ...windowed].sort();
    const actual = [...SLICE_EXPORT_ORDER].sort();

    assert.deepEqual(actual, expected);
    assert.equal(SLICE_EXPORT_ORDER.length, new Set(SLICE_EXPORT_ORDER).size, "duplicate model in the order");
  });

  test("contains no excluded model", () => {
    for (const model of excluded) {
      assert.equal(SLICE_EXPORT_ORDER.includes(model), false, `${model} is excluded but appears in the order`);
    }
  });

  test("all master models are written before any windowed model", () => {
    const positions = SLICE_EXPORT_ORDER.map((model, index) => ({ model, index }));
    const lastMaster = Math.max(...positions.filter((p) => master.includes(p.model)).map((p) => p.index));
    const firstWindowed = Math.min(...positions.filter((p) => windowed.includes(p.model)).map((p) => p.index));

    assert.ok(lastMaster < firstWindowed, "a windowed model is written before a master model");
  });

  test("required parents precede their children", () => {
    const at = (model: string): number => {
      const index = SLICE_EXPORT_ORDER.indexOf(model);
      assert.notEqual(index, -1, `${model} missing from SLICE_EXPORT_ORDER`);
      return index;
    };

    // NOT NULL foreign keys — these orderings are load-bearing for Phase 2.
    assert.ok(at("Role") < at("User"), "users.role_id is NOT NULL");
    assert.ok(at("Role") < at("RolePermission"));
    assert.ok(at("Permission") < at("RolePermission"));
    assert.ok(at("User") < at("RolePermission"), "role_permissions.updated_by_id references users");
    assert.ok(at("Permission") < at("UserPermissionOverride"));
    assert.ok(at("User") < at("UserPermissionOverride"));
    assert.ok(at("User") < at("DepartmentGroup"), "department_groups.kpi_leader_id references users");
    assert.ok(at("Customer") < at("ProcessSheetTemplate"));
    assert.ok(at("ProcessSheetTemplate") < at("ProcessSheetParameter"));
    assert.ok(at("Customer") < at("MoldTrialProject"), "mold_trial_projects.customer_id is NOT NULL");
    assert.ok(at("User") < at("MoldTrialProject"), "mold_trial_projects.created_by_id is NOT NULL");
    assert.ok(at("MoldTrialProject") < at("MoldTrialPart"));
    assert.ok(at("MoldTrialProject") < at("TrialEvent"));
    assert.ok(at("InjectionMachine") < at("TrialEvent"));
    assert.ok(at("TrialEvent") < at("MissedTrialEvent"));
    assert.ok(at("TrialEvent") < at("TrialIssue"), "trial_issues.found_at_trial_event_id references trial_events");
    assert.ok(at("MoldTrialPart") < at("TrialIssue"), "trial_issues.affected_part_id references mold_trial_parts");
    assert.ok(at("DepartmentGroup") < at("TrialIssue"));
    assert.ok(at("TrialEvent") < at("TrialProcessValue"));
    assert.ok(at("ProcessSheetParameter") < at("TrialProcessValue"));
    assert.ok(at("DesignChangeEvent") < at("TrialLimitAdjustment"));
    assert.ok(at("MoldTrialProject") < at("FileAttachment"));
    assert.ok(at("User") < at("ActivityLog"));
  });

  test("the order is documented as load-bearing for Phase 2", () => {
    const source = repoFile("src/domain/slice/classification.ts");
    assert.match(source, /FK-SAFE EXPORT ORDER/);
    assert.match(source, /DO NOT REORDER/);
    assert.match(source, /NULLABLE/);
  });
});

describe("export CLI stays a read-only server-side tool", () => {
  const script = repoFile("scripts/export-slice.mjs");

  test("no database write appears anywhere in the script", () => {
    const writes = [
      /prisma\.\w+\.create/,
      /prisma\.\w+\.update/,
      /prisma\.\w+\.delete/,
      /prisma\.\w+\.upsert/,
      /\.createMany\(/,
      /\.updateMany\(/,
      /\.deleteMany\(/,
      /\.upsert\(/,
      /\$executeRaw/,
      /\$executeRawUnsafe/,
      /\$transaction/
    ];

    for (const pattern of writes) {
      assert.doesNotMatch(script, pattern, `export-slice.mjs must never write to the database (${pattern})`);
    }
  });

  test("negative control: the pattern list does catch a write", () => {
    assert.match("await prisma.user.update({})", /prisma\.\w+\.update/);
    assert.match("await tx.kpiSnapshot.deleteMany({})", /\.deleteMany\(/);
  });

  test("the CLI-not-web decision is recorded in the script itself", () => {
    assert.match(script, /NEVER A WEB ENDPOINT/);
    assert.match(script, /admin cookie/);
    assert.match(script, /read-only listing panel/);
  });

  test("the script imports nothing from the web layer", () => {
    // Checks the import specifiers themselves, not prose: a comment may name a
    // server module, an import may not.
    const specifiers = [...script.matchAll(/from "([^"]+)"/g)].map((match) => match[1] ?? "");
    assert.ok(specifiers.length >= 5, "no imports parsed — the check would be vacuous");

    for (const specifier of specifiers) {
      assert.doesNotMatch(specifier, /^next(\/|$)/, `web-layer import: ${specifier}`);
      assert.doesNotMatch(specifier, /(^|\/)src\/app\//, `web-layer import: ${specifier}`);
      assert.doesNotMatch(specifier, /\/server\//, `web-layer import: ${specifier}`);
    }
  });

  test("no route or server action references the slice export", () => {
    const roots = ["src/app", "src/server"];
    const offenders: string[] = [];

    for (const root of roots) {
      const directory = new URL(`../../${root}/`, import.meta.url);
      const entries = readdirSync(directory, { recursive: true, encoding: "utf8" });

      for (const entry of entries) {
        if (!entry.endsWith(".ts") && !entry.endsWith(".tsx")) {
          continue;
        }
        const source = readFileSync(new URL(entry, directory), "utf8");
        if (/export-slice|domain\/slice/.test(source)) {
          offenders.push(path.posix.join(root, entry));
        }
      }
    }

    assert.deepEqual(
      offenders,
      [],
      `The dev slice must stay CLI-only; web-layer file(s) reference it: ${offenders.join(", ")}`
    );
  });

  test("the script has a loader for every model in the export order", () => {
    const missing = SLICE_EXPORT_ORDER.filter(
      (model) => !new RegExp(`^\\s{4}${model}:\\s`, "m").test(script)
    );

    assert.deepEqual(
      missing,
      [],
      `SLICE_EXPORT_ORDER lists model(s) with no loader in scripts/export-slice.mjs: ${missing.join(", ")}`
    );
  });

  test("blob policy comes from the domain module, not from a literal in the script", () => {
    assert.equal(SLICE_BLOB_FILE_TYPE, "TRIAL_PHOTO");
    assert.equal(SLICE_BLOB_MAX_BYTES, 400_000);
    assert.match(script, /SLICE_BLOB_MAX_BYTES/);
    assert.doesNotMatch(script, /400_000|400000/);
  });

  test("the manifest reuses the snapshot integrity helpers", () => {
    assert.match(script, /from "\.\.\/src\/domain\/security\/snapshot-integrity\.ts"/);
    assert.match(script, /snapshotIntegrityHash\(data, sha256Hex\)/);
    assert.match(script, /formatIntegrityCode\(hash\)/);
    assert.match(script, /notABackup: true/);
    assert.match(script, /sliceFormatVersion/);
  });

  test("a slice-shaped manifest hashes to a readable integrity code", () => {
    const data = {
      sliceFormatVersion: 1,
      notABackup: true,
      window: { from: "2026-05-01", to: "2026-07-27" },
      rowCountTotal: 1234
    };

    const hash = snapshotIntegrityHash(data, sha256Hex);
    assert.match(formatIntegrityCode(hash), /^[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}$/);
    // Key order must not change the hash: two runs over the same slice agree.
    assert.equal(
      snapshotIntegrityHash({ rowCountTotal: 1234, notABackup: true, sliceFormatVersion: 1, window: { to: "2026-07-27", from: "2026-05-01" } }, sha256Hex),
      hash
    );
  });

  test("package.json exposes the documented pnpm entry point", () => {
    const packageJson = JSON.parse(repoFile("package.json")) as { scripts: Record<string, string> };
    assert.equal(packageJson.scripts["slice:export"], "node scripts/export-slice.mjs");
  });

  test("the repo guard and the not-a-backup warning are present", () => {
    assert.match(script, /resolves inside the project folder/);
    assert.match(script, /A SLICE IS NOT A BACKUP/);
    assert.match(script, /Refusing to overwrite an existing slice/);
  });
});
