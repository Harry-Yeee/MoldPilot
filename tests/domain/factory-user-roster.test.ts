import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { validateFactoryUserRoster } from "../../src/domain/mold-trial/factory-user-roster.ts";

function fixture(): unknown {
  return JSON.parse(
    readFileSync(
      new URL("../../prisma/fixtures/factory-users-2026-07-27.json", import.meta.url),
      "utf8"
    )
  );
}

test("reviewed factory roster contains the expected employees and KPI leaders", () => {
  const roster = validateFactoryUserRoster(fixture());

  assert.equal(roster.people.length, 18);
  assert.equal(roster.permissionExceptions.length, 0);
  assert.equal(roster.people.every((person) => person.active), true);
  assert.equal(roster.people.every((person) => person.locale === "ZH_CN"), true);
  assert.deepEqual(
    roster.people.filter((person) => person.teamLeader).map((person) => person.username),
    [
      "wang.qunying",
      "jiang.zhong",
      "liu.zhenpei",
      "wang.sheng",
      "gong.jilin",
      "liu.xi"
    ]
  );
  assert.equal(roster.people.some((person) => person.username === "admin"), false);
});

test("factory roster rejects duplicate usernames and role/KPI mismatches", () => {
  const duplicate = structuredClone(fixture()) as {
    people: Array<Record<string, unknown>>;
  };
  duplicate.people[1].username = duplicate.people[0].username;
  assert.throws(
    () => validateFactoryUserRoster(duplicate),
    /duplicates xie\.fengxia/
  );

  const mismatch = structuredClone(fixture()) as {
    people: Array<Record<string, unknown>>;
  };
  mismatch.people[0].kpiTeamCode = "pm";
  assert.throws(
    () => validateFactoryUserRoster(mismatch),
    /kpiTeamCode must be blank for GM/
  );
});

test("factory roster requires one active leader for every leader-scored KPI team", () => {
  const noMarketingLeader = structuredClone(fixture()) as {
    people: Array<Record<string, unknown>>;
  };
  noMarketingLeader.people[4].teamLeader = false;

  assert.throws(
    () => validateFactoryUserRoster(noMarketingLeader),
    /KPI team marketing must have exactly one active leader/
  );
});
