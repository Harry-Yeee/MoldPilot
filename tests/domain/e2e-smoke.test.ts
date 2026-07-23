import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("E2E smoke page sweep bypasses only the first-login gate and restores it", async () => {
  const source = await readFile("scripts/e2e-smoke.mjs", "utf8");

  assert.match(source, /select:\s*\{[^}]*forcePasswordChange:\s*true[^}]*\}/s);
  assert.match(source, /\.filter\(\(user\) => user\.forcePasswordChange\)/);
  assert.match(
    source,
    /temporarilyAllowSmokePageSweep[\s\S]*?data:\s*\{\s*forcePasswordChange:\s*false\s*\}/
  );
  assert.match(
    source,
    /restoreSmokePageSweepUsers[\s\S]*?data:\s*\{\s*forcePasswordChange:\s*true\s*\}/
  );
  assert.match(source, /finally\s*\{[\s\S]*?restoreSmokePageSweepUsers\(/);
  assert.doesNotMatch(source, /data:\s*\{[^}]*passwordHash/s);
  assert.doesNotMatch(source, /data:\s*\{[^}]*roleId/s);
});

test("E2E smoke visible-text matching decodes rendered HTML entities", async () => {
  const source = await readFile("scripts/e2e-smoke.mjs", "utf8");

  assert.match(source, /return decodeHtmlEntities\(/);
  assert.match(source, /amp:\s*"&"/);
  assert.equal(source.includes(".replace(/&#x([0-9a-f]+);/gi"), true);
  assert.equal(source.includes(".replace(/&#(\\d+);/g"), true);
  assert.match(source, /"Accounts & Permissions"/);
});
