import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  noActivePlanningPmMessage,
  resolveDefaultPlanningPm
} from "../../src/domain/mold-trial/users.ts";

const planningPm = { id: "planning-pm-id", username: "long.shiyuan", status: "ACTIVE" };
const technicalPm = { id: "technical-pm-id", username: "liu.zhijun", status: "ACTIVE" };
const rosterPm = { id: "roster-pm-id", username: "li.dacheng", status: "ACTIVE" };

test("an assigned planning PM keeps the project's planning slot", () => {
  const resolution = resolveDefaultPlanningPm({
    projectPlanningPm: planningPm,
    projectTechnicalPm: technicalPm,
    firstActivePm: rosterPm
  });

  assert.equal(resolution.ok, true);
  assert.equal(resolution.ok && resolution.source, "PROJECT_PLANNING_PM");
  assert.equal(resolution.ok && resolution.user.id, "planning-pm-id");
});

test("the technical PM covers a project whose planning slot is empty", () => {
  const resolution = resolveDefaultPlanningPm({
    projectPlanningPm: null,
    projectTechnicalPm: technicalPm,
    firstActivePm: rosterPm
  });

  assert.equal(resolution.ok, true);
  assert.equal(resolution.ok && resolution.source, "PROJECT_TECHNICAL_PM");
  assert.equal(resolution.ok && resolution.user.id, "technical-pm-id");
});

test("an archived assignee is skipped rather than reassigned to an inactive account", () => {
  const resolution = resolveDefaultPlanningPm({
    projectPlanningPm: { ...planningPm, status: "ARCHIVED" },
    projectTechnicalPm: { ...technicalPm, status: "ARCHIVED" },
    firstActivePm: rosterPm
  });

  assert.equal(resolution.ok, true);
  assert.equal(resolution.ok && resolution.source, "FIRST_ACTIVE_PM");
  assert.equal(resolution.ok && resolution.user.id, "roster-pm-id");
});

test("an unassigned project falls back to the first active PM of the loaded roster", () => {
  const resolution = resolveDefaultPlanningPm({ firstActivePm: rosterPm });

  assert.equal(resolution.ok, true);
  assert.equal(resolution.ok && resolution.source, "FIRST_ACTIVE_PM");
  assert.equal(resolution.ok && resolution.user.username, "li.dacheng");
});

test("no active PM anywhere fails with a bilingual message instead of throwing on a missing username", () => {
  const resolution = resolveDefaultPlanningPm({
    projectPlanningPm: null,
    projectTechnicalPm: null,
    firstActivePm: null
  });

  assert.equal(resolution.ok, false);
  assert.equal(resolution.ok === false && resolution.message, noActivePlanningPmMessage);
  assert.match(noActivePlanningPmMessage, /No active PM exists/);
  assert.match(noActivePlanningPmMessage, /没有可用的项目管理员/);
});

test("an archived roster PM is not a usable fallback", () => {
  const resolution = resolveDefaultPlanningPm({ firstActivePm: { ...rosterPm, status: "ARCHIVED" } });

  assert.equal(resolution.ok, false);
});

test("server code assigns workflow users by role, never by a hardcoded username", () => {
  const retiredSeedUsernames = /"(bill|wang|zhong|pei|yvonne|lin|gong|xie|jun|cheng)"/;

  for (const file of ["../../src/server/mold-trial-actions.ts", "../../src/server/dev-options.ts"]) {
    const source = readFileSync(new URL(file, import.meta.url), "utf8");
    assert.doesNotMatch(source, retiredSeedUsernames, `${file} still hardcodes a retired seed username`);
  }
});
