import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

import {
  assemblyGroupDisplayName,
  assemblyGroupLeaderName,
  formatAssemblyGroupOption,
  neutralAssemblyGroupName
} from "../../src/domain/mold-trial/assembly-groups.ts";
import { validateFactoryUserRoster } from "../../src/domain/mold-trial/factory-user-roster.ts";

describe("assembly group naming", () => {
  test("names a group after its leader's surname", () => {
    assert.equal(
      assemblyGroupDisplayName("assembly-a", { displayName: "Zhong", chineseName: "江忠" }),
      "江组"
    );
    assert.equal(
      assemblyGroupDisplayName("assembly-b", { displayName: "Pei", chineseName: "刘振培" }),
      "刘组"
    );
    // A two-character full name still yields the surname, not the whole name.
    assert.equal(assemblyGroupDisplayName("assembly-a", { displayName: "Mei", chineseName: "梅兰" }), "梅组");
  });

  test("falls back to the display name when the leader has no Chinese name", () => {
    assert.equal(assemblyGroupDisplayName("assembly-a", { displayName: "Zhong", chineseName: null }), "Zhong组");
    assert.equal(assemblyGroupDisplayName("assembly-b", { displayName: "Pei" }), "Pei组");
    assert.equal(
      assemblyGroupDisplayName("assembly-a", { displayName: "  Zhong  ", chineseName: "   " }),
      "Zhong组"
    );
  });

  test("falls back to a neutral name when there is no leader at all", () => {
    assert.equal(assemblyGroupDisplayName("assembly-a", null), "装配A组");
    assert.equal(assemblyGroupDisplayName("assembly-b", undefined), "装配B组");
    assert.equal(assemblyGroupDisplayName("assembly-c", null), "装配C组");
    assert.equal(assemblyGroupDisplayName("assembly-a", { displayName: "  ", chineseName: null }), "装配A组");
    // An unexpected code degrades to a plain group name, never a raw code.
    assert.equal(assemblyGroupDisplayName("assembly-team-1", null), "装配组");
    assert.equal(neutralAssemblyGroupName("ASSEMBLY-B"), "装配B组");
  });

  test("the reviewed roster names the two crews after the real leaders", () => {
    const roster = validateFactoryUserRoster(
      JSON.parse(readFileSync(new URL("../../prisma/fixtures/factory-users-2026-07-27.json", import.meta.url), "utf8"))
    );
    const names = ["assembly-a", "assembly-b"].map((code) => {
      const leader = roster.people.find((person) => person.teamLeader && person.kpiTeamCode === code);
      assert.ok(leader != null, `${code} has no roster leader`);
      return assemblyGroupDisplayName(code, leader);
    });

    assert.deepEqual(names, ["江组", "刘组"]);
    // The retired dev-era names must not come back through the roster.
    assert.ok(!names.includes("钟组"));
    assert.ok(!names.includes("裴组"));
  });

  test("the seed derives every assembly group name instead of hardcoding one", () => {
    const seedSource = readFileSync(new URL("../../prisma/seed.ts", import.meta.url), "utf8");

    assert.match(seedSource, /assemblyGroupDisplayName/);
    assert.doesNotMatch(seedSource, /name:\s*"钟组"/);
    assert.doesNotMatch(seedSource, /name:\s*"裴组"/);
  });
});

describe("assembly group option labels", () => {
  test("prints the leader in front of the group name", () => {
    assert.equal(formatAssemblyGroupOption({ name: "江组", leaderName: "Zhong" }), "Zhong · 江组");
    assert.equal(formatAssemblyGroupOption({ name: "Zhong组", leaderName: "Zhong" }), "Zhong · Zhong组");
  });

  test("degrades to the group name alone when no leader can be shown", () => {
    assert.equal(formatAssemblyGroupOption({ name: "装配A组", leaderName: null }), "装配A组");
    assert.equal(formatAssemblyGroupOption({ name: "装配A组" }), "装配A组");
    assert.equal(formatAssemblyGroupOption({ name: "江组", leaderName: "   " }), "江组");
    // Never a dangling separator, whichever half is missing.
    assert.equal(formatAssemblyGroupOption({ name: "  ", leaderName: "Zhong" }), "Zhong");
    assert.equal(formatAssemblyGroupOption({ name: "", leaderName: null }), "");
  });

  test("only an ACTIVE leader with a real name is shown", () => {
    assert.equal(assemblyGroupLeaderName({ displayName: "Zhong", status: "ACTIVE" }), "Zhong");
    assert.equal(assemblyGroupLeaderName({ displayName: "  Zhong  ", status: "ACTIVE" }), "Zhong");
    assert.equal(assemblyGroupLeaderName({ displayName: "Zhong", status: "INACTIVE" }), null);
    assert.equal(assemblyGroupLeaderName({ displayName: "", status: "ACTIVE" }), null);
    assert.equal(assemblyGroupLeaderName(null), null);
    assert.equal(assemblyGroupLeaderName(undefined), null);
  });

  test("an archived leader leaves the group readable", () => {
    const label = formatAssemblyGroupOption({
      name: "江组",
      leaderName: assemblyGroupLeaderName({ displayName: "Zhong", status: "INACTIVE" })
    });

    assert.equal(label, "江组");
  });
});
