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
import { trialStageLabel, trialVerificationStatusOptions } from "../../src/domain/mold-trial/trial-panel.ts";
import { priorityOptions } from "../../src/server/dev-options.ts";
import {
  formatDashboardLimitBasis,
  formatDashboardNextTrial,
  formatLocalizedDate,
  formatLocalizedDaysAway,
  formatLocalizedTrialCountBadge,
  translateDefaultProcessSection,
  translateSystemGroup,
  translateSystemRole
} from "../../src/i18n/display.ts";

test("English and Simplified Chinese dictionaries have exact key parity", () => {
  assert.deepEqual(Object.keys(dictionaries.en).sort(), Object.keys(dictionaries["zh-CN"]).sort());
});

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

test("required static dropdown options have English and Chinese display labels", () => {
  for (const option of priorityOptions) {
    assert.equal(translateLabel(dictionaries.en, "priority", option.label), option.label);
    assert.notEqual(translateLabel(dictionaries["zh-CN"], "priority", option.label), option.label);
  }

  for (const option of trialVerificationStatusOptions) {
    assert.equal(translateLabel(dictionaries.en, "verificationStatus", option), option);
    assert.notEqual(translateLabel(dictionaries["zh-CN"], "verificationStatus", option), option);
  }
});

test("dashboard next-trial and limit states render semantically in both languages", () => {
  assert.equal(
    formatDashboardNextTrial({ kind: "WAITING_T0_SCHEDULE", sequenceNumber: null }, dictionaries.en),
    "Waiting T0 schedule"
  );
  assert.equal(
    formatDashboardNextTrial({ kind: "WAITING_T0_SCHEDULE", sequenceNumber: null }, dictionaries["zh-CN"]),
    "等待安排 T0"
  );
  assert.equal(
    formatDashboardNextTrial({ kind: "PLANNED", sequenceNumber: 4 }, dictionaries.en),
    "T3 planned"
  );
  assert.equal(
    formatDashboardNextTrial({ kind: "COMPLETED", sequenceNumber: 4 }, dictionaries["zh-CN"]),
    "T3 已完成"
  );
  assert.equal(formatDashboardLimitBasis("DEFAULT", dictionaries.en), "Default Limit");
  assert.equal(formatDashboardLimitBasis("DESIGN_CHANGE", dictionaries["zh-CN"]), "设变增加次数");
});

test("project dates, days-away text, and trial-count badges follow selected language", () => {
  const enDate = formatLocalizedDate("2026-07-03", "en");
  const zhDate = formatLocalizedDate("2026-07-03", "zh-CN");

  assert.match(enDate, /2026/);
  assert.match(zhDate, /2026/);
  assert.notEqual(enDate, zhDate);
  assert.equal(formatLocalizedDaysAway("2026-07-15", "2026-07-10", dictionaries.en), "+5 days");
  assert.equal(formatLocalizedDaysAway("2026-07-08", "2026-07-10", dictionaries["zh-CN"]), "-2 天（逾期）");
  assert.equal(
    formatLocalizedTrialCountBadge(
      {
        baseTrialLimit: 3,
        completedTrialCount: 3,
        currentTrialLimit: 4,
        designChangeExtraTrialCount: 1,
        warningState: "Healthy"
      },
      dictionaries["zh-CN"]
    ),
    "3 / 4 设变增加次数"
  );
});

test("system role and group names translate by code while custom names remain unchanged", () => {
  assert.equal(translateSystemRole(dictionaries["zh-CN"], "pm", "PM"), "项目管理");
  assert.equal(translateSystemGroup(dictionaries["zh-CN"], "technical", "Technical"), "技术");
  assert.equal(
    translateSystemRole(dictionaries["zh-CN"], "custom_lead", "Molding Lead"),
    "Molding Lead"
  );
  assert.equal(
    translateSystemGroup(dictionaries["zh-CN"], "custom_cell", "Cell A"),
    "Cell A"
  );
});

test("default process-sheet sections translate while custom template section names remain unchanged", () => {
  assert.equal(
    translateDefaultProcessSection(dictionaries["zh-CN"], "Machine Information", true),
    "注塑机信息"
  );
  assert.equal(
    translateDefaultProcessSection(dictionaries["zh-CN"], "Customer Custom Zone", false),
    "Customer Custom Zone"
  );
});

test("trial sequence 4 is T3 and never the stored EXTRA display label", () => {
  assert.equal(trialStageLabel(1), "T0");
  assert.equal(trialStageLabel(4), "T3");
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

test("project and upload action feedback follows the selected language", () => {
  assert.equal(
    translateWorkflowMessage(dictionaries["zh-CN"], "Project intake created. Planning PM can set T0 next."),
    "项目接单已创建，计划 PM 可继续设置 T0。"
  );
  assert.equal(
    translateWorkflowMessage(dictionaries["zh-CN"], "Updated identifiers for M-2407."),
    "标识 M-2407 已更新。"
  );
  assert.equal(
    translateWorkflowMessage(dictionaries["zh-CN"], "Upload could not reach the server."),
    "无法连接服务器完成上传。"
  );
  assert.equal(
    translateWorkflowMessage(dictionaries["zh-CN"], "The downloaded attachment is not a valid Excel workbook."),
    "下载的附件不是有效的 Excel 文件。"
  );
});

test("client upload feedback and Admin accessibility labels use i18n", async () => {
  const [directUploadSource, uploaderSource, reportSource, exportSource, adminSource] = await Promise.all([
    readFile("src/components/attachments/DirectFileUploadForm.tsx", "utf8"),
    readFile("src/components/attachments/AttachmentUploader.tsx", "utf8"),
    readFile("src/components/attachments/MeasurementReportUploadForm.tsx", "utf8"),
    readFile("src/app/projects/[projectCode]/export-process-sheet-excel-button.tsx", "utf8"),
    readFile("src/app/admin/page.tsx", "utf8")
  ]);

  for (const source of [directUploadSource, uploaderSource, reportSource, exportSource]) {
    assert.equal(source.includes("translateWorkflowMessage"), true);
  }
  assert.equal(adminSource.includes('>MoldPilot Admin<'), false);
  assert.equal(adminSource.includes('aria-label="Machine No."'), false);
  assert.equal(adminSource.includes('t("admin.eyebrow")'), true);
  assert.equal(adminSource.includes('t("field.machineNo")'), true);
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

test("project detail uses the cookie language and never User.locale for display", async () => {
  const source = await readFile("src/app/projects/[projectCode]/page.tsx", "utf8");

  assert.equal(source.includes("getCurrentLanguage()"), true);
  assert.equal(source.includes("localeFromLanguage(language)"), true);
  assert.equal(source.includes("currentUser.locale"), false);
  assert.equal(source.includes("translateDefaultProcessSection"), true);
});

test("Calendar and My Tasks derive trial labels from sequence number", async () => {
  const [calendarSource, myPlateSource] = await Promise.all([
    readFile("src/server/calendar.ts", "utf8"),
    readFile("src/server/my-plate.ts", "utf8")
  ]);

  assert.equal(calendarSource.includes("trialStageLabel(row.sequenceNumber)"), true);
  assert.equal(myPlateSource.includes("trialStageLabel(trial.sequenceNumber)"), true);
  assert.equal(calendarSource.includes("trialCodeLabels[row.trialCode]"), false);
  assert.equal(myPlateSource.includes("trialCodeLabels[trial.trialCode]"), false);
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
    readFile("src/app/me/my-plate-sections.tsx", "utf8"),
    readFile("src/app/reports/page.tsx", "utf8"),
    readFile("src/app/calendar/page.tsx", "utf8"),
    readFile("src/app/score/page.tsx", "utf8")
  ]);
  const joined = sources.join("\n");

  assert.equal(joined.includes("dashboard.title"), true);
  assert.equal(joined.includes("project.trialPanel"), true);
  assert.equal(joined.includes("admin.rolesPermissions"), true);
  assert.equal(joined.includes("auth.login"), true);
  assert.equal(joined.includes("getCurrentLanguage"), true);
  assert.equal(joined.includes("useI18n"), true);
});
