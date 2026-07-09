import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { formatIssueOwnerUserOption } from "../../src/domain/mold-trial/users.ts";

test("trial issue owner option labels show role, English name, and Chinese name", () => {
  assert.equal(
    formatIssueOwnerUserOption({
      displayName: "Bill",
      chineseName: "王比尔",
      username: "bill",
      role: { name: "PM" }
    }),
    "PM / Bill / 王比尔"
  );

  assert.equal(
    formatIssueOwnerUserOption({
      displayName: "Gong",
      chineseName: "",
      username: "gong",
      role: { name: "QC" }
    }),
    "QC / Gong / -"
  );
});

test("trial issue owner option labels do not expose username in normal labels", () => {
  const label = formatIssueOwnerUserOption({
    displayName: "A. Liu",
    chineseName: "刘婉霞",
    username: "anna",
    role: { name: "Marketing" }
  });

  assert.equal(label, "Marketing / A. Liu / 刘婉霞");
  assert.doesNotMatch(label, /anna/i);
  assert.doesNotMatch(label, /\(.+\)/);
});

test("dashboard groups Admin and My tasks buttons in one nav action group", () => {
  const dashboardSource = readFileSync(new URL("../../src/app/page.tsx", import.meta.url), "utf8");
  const stylesSource = readFileSync(new URL("../../src/app/globals.css", import.meta.url), "utf8");
  const classIndex = dashboardSource.indexOf('className="dashboardNavActions"');

  assert.notEqual(classIndex, -1);

  const navStart = dashboardSource.lastIndexOf("<nav", classIndex);
  const navEnd = dashboardSource.indexOf("</nav>", classIndex);
  const navBlock = dashboardSource.slice(navStart, navEnd);

  assert.match(navBlock, /href="\/admin"/);
  assert.match(navBlock, /href="\/me"/);
  assert.match(stylesSource, /\.dashboardNavActions\s*{/);
  assert.match(stylesSource, /\.dashboardNavActions[\s\S]*flex-wrap:\s*wrap/);
});
