import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  createTranslator,
  dictionaries,
  normalizeLanguage,
  translateLabel,
  translatePermissionGroup,
  translatePermissionName
} from "../../src/i18n/index.ts";
import { permissionDefinitions } from "../../src/domain/mold-trial/permission-policy.ts";

test("i18n defaults to English and supports Simplified Chinese", () => {
  assert.equal(normalizeLanguage(undefined), "en");
  assert.equal(normalizeLanguage("zh-CN"), "zh-CN");
  assert.equal(normalizeLanguage("fr"), "en");

  const en = createTranslator(dictionaries.en);
  const zh = createTranslator(dictionaries["zh-CN"]);

  assert.equal(en("dashboard.title"), "Trial Dashboard");
  assert.equal(zh("dashboard.title"), "试模看板");
});

test("language provider persists selection with cookie and localStorage", async () => {
  const providerSource = await readFile("src/i18n/language-provider.tsx", "utf8");
  const switcherSource = await readFile("src/i18n/language-switcher.tsx", "utf8");

  assert.equal(providerSource.includes("languageCookieName"), true);
  assert.equal(providerSource.includes("document.cookie"), true);
  assert.equal(providerSource.includes("localStorage"), true);
  assert.equal(switcherSource.includes("router.refresh()"), true);
});

test("enum display labels translate while stored enum values stay unchanged", () => {
  const dictionary = dictionaries["zh-CN"];

  assert.equal(translateLabel(dictionary, "trialResult", "PENDING_QC"), "PENDING_QC");
  assert.equal(translateLabel(dictionary, "trialResult", "Pending QC"), "待 QC");
  assert.equal(translateLabel(dictionary, "issueStatus", "Waiting Customer"), "等客户反馈");
  assert.equal(translateLabel(dictionary, "severity", "Critical"), "严重");
});

test("admin permission process and subtask labels translate", () => {
  const dictionary = dictionaries["zh-CN"];
  const permission = permissionDefinitions.find((item) => item.code === "trial.schedule.reschedule");

  assert.ok(permission);
  assert.equal(translatePermissionGroup(dictionary, permission.processGroup), "试模排期");
  assert.equal(translatePermissionName(dictionary, permission.code, permission.name), "新增或重排试模");
});

test("high-priority pages use the i18n layer", async () => {
  const sources = await Promise.all([
    readFile("src/app/page.tsx", "utf8"),
    readFile("src/app/projects/[projectCode]/page.tsx", "utf8"),
    readFile("src/app/admin/page.tsx", "utf8"),
    readFile("src/app/login/page.tsx", "utf8")
  ]);
  const joined = sources.join("\n");

  assert.equal(joined.includes("dashboard.title"), true);
  assert.equal(joined.includes("project.trialPanel"), true);
  assert.equal(joined.includes("admin.rolesPermissions"), true);
  assert.equal(joined.includes("auth.login"), true);
});
