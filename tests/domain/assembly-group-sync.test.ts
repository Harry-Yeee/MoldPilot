import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

/**
 * The PURE half of `scripts/sync-assembly-group-names.mjs`: the per-row verdict
 * machine `--diagnose` prints, and the connection resolution whose silence
 * caused the 2026-08-06 incident (the tool "ran" and the mini never changed).
 * The script's I/O half stays behind `main()`, which only runs when the file is
 * executed directly, so importing it here opens no database connection.
 *
 * Naming is NOT retested here — `assemblyGroupDisplayName` owns it and
 * tests/domain/assembly-groups.test.ts covers it. These tests only assert which
 * ROW STATE each combination of database row + fixture leader produces.
 *
 * The import is a runtime URL rather than a static specifier because the repo
 * compiles with `allowJs: false`: a `.ts` file cannot statically import a `.mjs`
 * one without a declaration file. The shape is asserted locally instead, so the
 * test is still fully typed.
 */

type GroupRow = {
  name: string;
  active: boolean;
  kpiLeaderId: string | null;
  parentGroupCode: string | null;
  leader: { id: string; username: string; chineseName: string | null; status: string } | null;
};
type Verdict = "MATCHES" | "NEEDS RENAME" | "NEEDS LEADER" | "GROUP MISSING" | "FIXTURE MISSING";
type DiagnosedRow = {
  code: string;
  verdict: Verdict;
  expectedName: string | null;
  expectedLeaderUsername: string | null;
  nameChanged: boolean;
  leaderChanged: boolean;
  writable: boolean;
  blocking: string | null;
  details: string[];
};
type SyncModule = {
  diagnoseAssemblyGroupRow: (input: {
    code: string;
    group: GroupRow | null;
    expectedLeader: { username: string; displayName: string; chineseName: string | null } | null;
    expectedLeaderAccount: { id: string; username: string; chineseName: string | null; status: string } | null;
  }) => DiagnosedRow;
  summarizeAssemblyGroupDiagnosis: (rows: readonly DiagnosedRow[]) => {
    total: number;
    counts: Record<Verdict, number>;
    writable: number;
    blocked: number;
    deltas: number;
    allMatch: boolean;
  };
  resolveDatabaseUrl: (input: {
    envFileContents: string | null | undefined;
    inheritedDatabaseUrl: string | null | undefined;
  }) => {
    connectionString: string | null;
    source: "env-file" | "environment" | "none";
    inherited: string | null;
    overrodeEnvironment: boolean;
  };
  describeDatabaseTarget: (connectionString: string) => string;
  parseSyncArguments: (argv: readonly string[]) => { mode: string; unknown: string[] };
  modeWrites: (mode: string) => boolean;
  displayWidth: (text: string) => number;
  renderTable: (header: readonly string[], rows: readonly (readonly string[])[]) => string[];
};

const {
  describeDatabaseTarget,
  diagnoseAssemblyGroupRow,
  displayWidth,
  modeWrites,
  parseSyncArguments,
  renderTable,
  resolveDatabaseUrl,
  summarizeAssemblyGroupDiagnosis
}: SyncModule = (await import(
  new URL("../../scripts/sync-assembly-group-names.mjs", import.meta.url).href
)) as SyncModule;

const leaderA = { username: "jiang.zhong", displayName: "Zhong", chineseName: "江忠" };
const accountA = { id: "user-a", username: "jiang.zhong", chineseName: "江忠", status: "ACTIVE" };

function group(overrides: Partial<GroupRow> = {}): GroupRow {
  return {
    name: "江组",
    active: true,
    kpiLeaderId: "user-a",
    parentGroupCode: "assembly",
    leader: accountA,
    ...overrides
  };
}

type DiagnoseInput = Parameters<SyncModule["diagnoseAssemblyGroupRow"]>[0];

function diagnose(input: Partial<DiagnoseInput> = {}): DiagnosedRow {
  return diagnoseAssemblyGroupRow({
    code: "assembly-a",
    group: group(),
    expectedLeader: leaderA,
    expectedLeaderAccount: accountA,
    ...input
  });
}

/** `blocking` is nullable; narrow it before matching so strict TS is happy. */
function blockingReason(row: DiagnosedRow): string {
  assert.ok(row.blocking != null, `${row.code} was expected to be blocked`);
  return row.blocking;
}

describe("assembly group sync — row verdicts", () => {
  test("MATCHES when the name and the leader already agree with the roster", () => {
    const row = diagnose();

    assert.equal(row.verdict, "MATCHES");
    assert.equal(row.expectedName, "江组");
    assert.equal(row.nameChanged, false);
    assert.equal(row.leaderChanged, false);
    assert.equal(row.writable, false);
    assert.equal(row.blocking, null);
    assert.deepEqual(row.details, []);
  });

  test("NEEDS RENAME is the 钟组 / 裴组 case: right leader, retired display name", () => {
    const row = diagnose({ group: group({ name: "钟组" }) });

    assert.equal(row.verdict, "NEEDS RENAME");
    assert.equal(row.nameChanged, true);
    assert.equal(row.leaderChanged, false);
    assert.equal(row.writable, true);
    assert.equal(row.blocking, null);
    assert.deepEqual(row.details, ["name 钟组 -> 江组"]);
  });

  test("NEEDS LEADER when kpiLeaderId points at somebody else, and it reports the name delta too", () => {
    const row = diagnose({
      group: group({
        name: "钟组",
        kpiLeaderId: "user-old",
        leader: { id: "user-old", username: "old.leader", chineseName: "旧人", status: "ACTIVE" }
      })
    });

    assert.equal(row.verdict, "NEEDS LEADER");
    assert.equal(row.leaderChanged, true);
    assert.equal(row.nameChanged, true);
    assert.equal(row.writable, true);
    assert.deepEqual(row.details, ["name 钟组 -> 江组", "leader old.leader -> jiang.zhong (江忠)"]);
  });

  test("NEEDS LEADER when the group has no leader at all", () => {
    const row = diagnose({ group: group({ kpiLeaderId: null, leader: null }) });

    assert.equal(row.verdict, "NEEDS LEADER");
    assert.equal(row.writable, true);
    assert.deepEqual(row.details, ["leader (none) -> jiang.zhong (江忠)"]);
  });

  test("NEEDS LEADER blocks (never guesses) when the roster leader has no account here", () => {
    const row = diagnose({ expectedLeaderAccount: null });

    assert.equal(row.verdict, "NEEDS LEADER");
    assert.equal(row.writable, false);
    assert.match(blockingReason(row), /jiang\.zhong has no account in this database/);
  });

  test("NEEDS LEADER blocks when the roster leader is archived here", () => {
    const row = diagnose({ expectedLeaderAccount: { ...accountA, status: "INACTIVE" } });

    assert.equal(row.verdict, "NEEDS LEADER");
    assert.equal(row.writable, false);
    assert.match(blockingReason(row), /jiang\.zhong is INACTIVE in this database/);
  });

  test("GROUP MISSING when the code has no row — the never-bootstrapped database", () => {
    const row = diagnose({ group: null });

    assert.equal(row.verdict, "GROUP MISSING");
    assert.equal(row.writable, false);
    assert.match(blockingReason(row), /does not exist/);
    assert.equal(row.expectedName, "江组");
  });

  test("GROUP MISSING when the row exists but hangs off the wrong parent", () => {
    const row = diagnose({ group: group({ parentGroupCode: "injection" }) });

    assert.equal(row.verdict, "GROUP MISSING");
    assert.match(blockingReason(row), /not a child of the assembly department/);

    const orphan = diagnose({ group: group({ parentGroupCode: null }) });
    assert.equal(orphan.verdict, "GROUP MISSING");
  });

  test("FIXTURE MISSING when a real group has no designated roster leader — reported, never written", () => {
    const row = diagnoseAssemblyGroupRow({
      code: "assembly-c",
      group: group({ name: "装配C组", kpiLeaderId: null, leader: null }),
      expectedLeader: null,
      expectedLeaderAccount: null
    });

    assert.equal(row.verdict, "FIXTURE MISSING");
    assert.equal(row.writable, false);
    assert.equal(row.blocking, null);
    assert.equal(row.expectedName, null);
    assert.equal(row.nameChanged, false);
    assert.equal(row.leaderChanged, false);
  });

  test("an inactive group is flagged even when it otherwise matches", () => {
    const row = diagnose({ group: group({ active: false }) });

    assert.equal(row.verdict, "MATCHES");
    assert.deepEqual(row.details, ["group is INACTIVE — the intake picker will not offer it"]);
  });

  test("the verdict derives the expected name from the shared naming helper, not its own rule", () => {
    const roster = JSON.parse(
      readFileSync(new URL("../../prisma/fixtures/factory-users-2026-07-27.json", import.meta.url), "utf8")
    ) as { people: { username: string; displayName: string; chineseName: string | null; kpiTeamCode: string | null; teamLeader: boolean }[] };

    const names = ["assembly-a", "assembly-b"].map((code) => {
      const leader = roster.people.find((person) => person.teamLeader && person.kpiTeamCode === code);
      assert.ok(leader != null, `${code} has no roster leader`);
      return diagnoseAssemblyGroupRow({
        code,
        group: group({ name: "钟组" }),
        expectedLeader: leader,
        expectedLeaderAccount: accountA
      }).expectedName;
    });

    assert.deepEqual(names, ["江组", "刘组"]);
  });
});

describe("assembly group sync — summary", () => {
  const rows = [
    diagnose(),
    diagnose({ group: group({ name: "钟组" }) }),
    diagnose({ group: null }),
    diagnoseAssemblyGroupRow({
      code: "assembly-c",
      group: group({ name: "装配C组" }),
      expectedLeader: null,
      expectedLeaderAccount: null
    })
  ];

  test("counts every verdict and separates fixable rows from blocked ones", () => {
    const summary = summarizeAssemblyGroupDiagnosis(rows);

    assert.equal(summary.total, 4);
    assert.deepEqual(summary.counts, {
      MATCHES: 1,
      "NEEDS RENAME": 1,
      "NEEDS LEADER": 0,
      "GROUP MISSING": 1,
      "FIXTURE MISSING": 1
    });
    assert.equal(summary.writable, 1);
    assert.equal(summary.blocked, 1);
    assert.equal(summary.deltas, 2);
    assert.equal(summary.allMatch, false);
  });

  test("all-match is the exit-0 condition, and a leaderless extra group does not spoil it", () => {
    const clean = summarizeAssemblyGroupDiagnosis([diagnose(), rows[3]]);

    assert.equal(clean.deltas, 0);
    assert.equal(clean.allMatch, true);
    assert.equal(clean.counts["FIXTURE MISSING"], 1);
  });
});

describe("assembly group sync — connection resolution (the 2026-08-06 incident)", () => {
  test("the repo .env wins over a DATABASE_URL exported into the shell", () => {
    const resolved = resolveDatabaseUrl({
      envFileContents: 'DATABASE_URL="postgresql://u:p@mini.local:5432/moldpilot?schema=public"\n',
      inheritedDatabaseUrl: "postgresql://u:p@localhost:5432/moldpilot_dev"
    });

    assert.equal(resolved.source, "env-file");
    assert.equal(resolved.connectionString, "postgresql://u:p@mini.local:5432/moldpilot?schema=public");
    assert.equal(resolved.overrodeEnvironment, true);
  });

  test("an identical exported value is not reported as an override", () => {
    const resolved = resolveDatabaseUrl({
      envFileContents: "DATABASE_URL=postgresql://u:p@mini.local:5432/moldpilot\n",
      inheritedDatabaseUrl: "postgresql://u:p@mini.local:5432/moldpilot"
    });

    assert.equal(resolved.source, "env-file");
    assert.equal(resolved.overrodeEnvironment, false);
  });

  test("no env file (or no DATABASE_URL in it) falls back to the environment, and says so", () => {
    const missingFile = resolveDatabaseUrl({
      envFileContents: null,
      inheritedDatabaseUrl: "postgresql://u:p@localhost:5432/moldpilot"
    });
    assert.equal(missingFile.source, "environment");
    assert.equal(missingFile.connectionString, "postgresql://u:p@localhost:5432/moldpilot");

    const otherKeys = resolveDatabaseUrl({
      envFileContents: "MOLDPILOT_DEPLOYMENT_MODE=production\n",
      inheritedDatabaseUrl: "postgresql://u:p@localhost:5432/moldpilot"
    });
    assert.equal(otherKeys.source, "environment");
  });

  test("nothing anywhere resolves to nothing — never to a silent dev default", () => {
    const resolved = resolveDatabaseUrl({ envFileContents: "", inheritedDatabaseUrl: undefined });

    assert.equal(resolved.connectionString, null);
    assert.equal(resolved.source, "none");

    const blank = resolveDatabaseUrl({ envFileContents: "DATABASE_URL=   \n", inheritedDatabaseUrl: "   " });
    assert.equal(blank.connectionString, null);
    assert.equal(blank.source, "none");
  });

  test("the printed target names the database and NEVER the credentials", () => {
    const target = describeDatabaseTarget("postgresql://moldpilot:sup3rs3cret@mini.local:5433/moldpilot?schema=public");

    assert.equal(target, "mini.local:5433/moldpilot");
    assert.doesNotMatch(target, /sup3rs3cret/);
    assert.doesNotMatch(target, /moldpilot:/);
    assert.equal(describeDatabaseTarget("postgresql://u:p@localhost/moldpilot"), "localhost:5432/moldpilot");
    assert.equal(describeDatabaseTarget("not a url"), "(unparseable DATABASE_URL)");
  });
});

describe("assembly group sync — modes and report layout", () => {
  test("only the bare invocation writes; every flag is read-only", () => {
    assert.equal(parseSyncArguments([]).mode, "apply");
    assert.equal(modeWrites("apply"), true);

    for (const flag of ["--diagnose", "--dry-run", "--help", "-h"]) {
      const { mode, unknown } = parseSyncArguments([flag]);
      assert.deepEqual(unknown, []);
      assert.equal(modeWrites(mode), false, `${flag} must not write`);
    }

    assert.deepEqual(parseSyncArguments(["--apply-now"]).unknown, ["--apply-now"]);
    assert.equal(parseSyncArguments(["--dry-run"]).mode, "dry-run");
    assert.equal(parseSyncArguments(["--diagnose"]).mode, "diagnose");
  });

  test("the report table stays aligned when the names are Chinese", () => {
    assert.equal(displayWidth("江组"), 4);
    assert.equal(displayWidth("assembly-a"), 10);
    assert.equal(displayWidth("Zhong · 江组"), 12);

    const [header, rule, first] = renderTable(
      ["CODE", "DB NAME"],
      [
        ["assembly-a", "钟组"],
        ["assembly-b", "装配B组"]
      ]
    );

    assert.equal(displayWidth(rule), displayWidth(header.padEnd(displayWidth(header))));
    assert.equal(rule, `${"-".repeat(10)}  ${"-".repeat(7)}`);
    assert.equal(first, "assembly-a  钟组");
  });
});
