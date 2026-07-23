import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  createTranslator,
  dictionaries,
  normalizeLanguage,
  translateLabel,
  translatePermissionGroup,
  translatePermissionName,
  translateWorkflowMessage
} from "../../src/i18n/index.ts";
import {
  formatMyPlateTrialTitle,
  localeFromLanguage
} from "../../src/domain/mold-trial/labels.ts";
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
  assert.equal(translateLabel(dictionary, "trialStatus", "Auto Missed - Reason Required"), "自动漏试 - 需填写原因");
  assert.equal(translateLabel(dictionary, "reason", "Mold Correction Not Complete"), "修模未完成");
  assert.equal(translateLabel(dictionary, "responsibleArea", "Injection"), "注塑");
  assert.equal(translateLabel(dictionary, "changeRequester", "Marketing"), "营销");
});

test("My Tasks trial titles follow the selected language", () => {
  assert.equal(formatMyPlateTrialTitle("T0", localeFromLanguage("zh-CN")), "T0 试模");
  assert.equal(formatMyPlateTrialTitle("T0", localeFromLanguage("en")), "T0 trial");
});

test("known My Tasks action feedback switches between Chinese and English", () => {
  const message = "Trial date confirmed.";

  assert.equal(translateWorkflowMessage(dictionaries["zh-CN"], message), "试模日期已确认。");
  assert.equal(translateWorkflowMessage(dictionaries.en, message), message);
  assert.equal(translateWorkflowMessage(dictionaries["zh-CN"], "Unmapped server detail"), "Unmapped server detail");
});

test("task translation leaves user-entered business content unchanged", () => {
  const dictionary = dictionaries["zh-CN"];
  const enteredValues = ["M-2407", "DAT", "Packing window unstable during T0", "Keep gate note unchanged"];

  for (const value of enteredValues) {
    assert.equal(translateLabel(dictionary, "businessData", value), value);
  }
});

test("My Tasks uses the cookie/provider language instead of User.locale", async () => {
  const pageSource = await readFile("src/app/me/page.tsx", "utf8");
  const sectionsSource = await readFile("src/app/me/my-plate-sections.tsx", "utf8");

  assert.equal(pageSource.includes("getCurrentLanguage()"), true);
  assert.equal(pageSource.includes("<LanguageSwitcher"), true);
  assert.equal(pageSource.includes("currentUser.locale"), false);
  assert.equal(sectionsSource.includes("useI18n()"), true);
  assert.equal(sectionsSource.includes("translateLabel(dictionary, group, option.label)"), true);
  assert.equal(sectionsSource.includes("formatMyPlateTrialTitle(row.trialCode, locale)"), true);
});

test("standalone and dashboard My Tasks panels share the reactive provider language", async () => {
  const dashboardSource = await readFile("src/app/page.tsx", "utf8");
  const pageSource = await readFile("src/app/me/page.tsx", "utf8");
  const sectionsSource = await readFile("src/app/me/my-plate-sections.tsx", "utf8");

  assert.equal((dashboardSource.match(/<MyPlateSections/g) ?? []).length, 1);
  assert.equal((pageSource.match(/<MyPlateSections/g) ?? []).length, 1);
  assert.equal(dashboardSource.includes("<MyPlateSections\n            data={myPlate}\n            locale="), false);
  assert.equal(pageSource.includes("locale={locale}"), false);
  assert.match(sectionsSource, /const \{ dictionary, language \} = useI18n\(\)/);
});

test("My Tasks mobile header groups navigation and language without horizontal overflow styles", async () => {
  const pageSource = await readFile("src/app/me/page.tsx", "utf8");
  const cssSource = await readFile("src/app/globals.css", "utf8");

  assert.equal(pageSource.includes('className="myTasksPageHeader"'), true);
  assert.equal(pageSource.includes('className="myTasksHeaderActions"'), true);
  assert.match(cssSource, /\.myTasksHeaderActions\s*\{[^}]*flex-wrap:\s*wrap/s);
  assert.match(cssSource, /\.myTasksHeaderActions \.languageSwitcher select\s*\{[^}]*width:\s*auto/s);
  assert.match(cssSource, /@media \(min-width: 440px\)/);
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
    readFile("src/app/login/page.tsx", "utf8"),
    readFile("src/app/me/page.tsx", "utf8"),
    readFile("src/app/me/my-plate-sections.tsx", "utf8")
  ]);
  const joined = sources.join("\n");

  assert.equal(joined.includes("dashboard.title"), true);
  assert.equal(joined.includes("project.trialPanel"), true);
  assert.equal(joined.includes("admin.rolesPermissions"), true);
  assert.equal(joined.includes("auth.login"), true);
  assert.equal(joined.includes("getCurrentLanguage"), true);
  assert.equal(joined.includes("useI18n"), true);
});
