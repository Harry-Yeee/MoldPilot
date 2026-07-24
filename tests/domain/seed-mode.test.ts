import assert from "node:assert/strict";
import test from "node:test";
import {
  assertFreshProductionBootstrap,
  resolveMoldPilotSeedMode
} from "../../src/domain/mold-trial/seed-mode.ts";

test("seed mode defaults to demo and accepts the production mode explicitly", () => {
  assert.equal(resolveMoldPilotSeedMode(undefined), "demo");
  assert.equal(resolveMoldPilotSeedMode(""), "demo");
  assert.equal(resolveMoldPilotSeedMode("demo"), "demo");
  assert.equal(resolveMoldPilotSeedMode(" PRODUCTION "), "production");
});

test("seed mode rejects unknown values", () => {
  assert.throws(() => resolveMoldPilotSeedMode("live"), /Unsupported MOLDPILOT_SEED_MODE/);
});

test("production bootstrap accepts only a fresh operational database", () => {
  assert.doesNotThrow(() =>
    assertFreshProductionBootstrap({
      users: 0,
      projects: 0,
      activityLogs: 0
    })
  );

  for (const counts of [
    { users: 1, projects: 0, activityLogs: 0 },
    { users: 0, projects: 1, activityLogs: 0 },
    { users: 0, projects: 0, activityLogs: 1 }
  ]) {
    assert.throws(() => assertFreshProductionBootstrap(counts), /requires a fresh database/);
  }
});
