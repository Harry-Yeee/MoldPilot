import { daysAwayFromDate } from "../domain/mold-trial/trial-panel.ts";
import type { TrialLimitState, TrialLimitSummary } from "../domain/mold-trial/types.ts";
import {
  createTranslator,
  translateDynamic,
  translateLabel,
  type Dictionary,
  type Language,
  type TranslationKey
} from "./index.ts";

type DateValue = Date | string | null | undefined;

export type DashboardNextTrialDisplay =
  | { kind: "WAITING_T0_SCHEDULE"; sequenceNumber: null }
  | { kind: "NO_TRIAL_PLANNED"; sequenceNumber: null }
  | { kind: "COMPLETED"; sequenceNumber: number }
  | { kind: "PLANNED"; sequenceNumber: number };

export type DashboardLimitBasis = "DEFAULT" | "CUSTOM_PM" | "DESIGN_CHANGE";

const localeByLanguage: Record<Language, string> = {
  en: "en-US",
  "zh-CN": "zh-CN"
};

const systemRoleCodes = new Set([
  "admin",
  "gm",
  "pm",
  "marketing",
  "assembly",
  "injection",
  "qc",
  "design",
  "viewer"
]);

const systemGroupCodes = new Set([
  "admin",
  "pm",
  "planning",
  "technical",
  "marketing",
  "assembly",
  "injection",
  "qc",
  "design",
  "machining",
  "purchasing"
]);

const defaultProcessSectionKey: Record<string, TranslationKey> = {
  "Material Information": "process.section.materialInformation",
  "Machine Information": "process.section.machineInformation",
  "Process Information": "process.section.processInformation",
  "Barrel Settings": "process.section.barrelSettings",
  "Velocity Profile": "process.section.velocityProfile",
  "Hold Pressure": "process.section.holdPressure",
  "Other Settings": "process.section.otherSettings",
  "Tool Data": "process.section.toolData"
};

/**
 * The factory catalog sections (2026-08-07). Translated for EVERY template, not
 * only the seeded default one: the data migration puts the same catalog into
 * every template that exists, so a customer template shows 注塑 / 保压 too. The
 * map above stays gated on the default template, because those section names
 * were only ever the default template's.
 */
const catalogProcessSectionKey: Record<string, TranslationKey> = {
  // 热流道设置 moved up from the gated map on 2026-08-08: the reconciliation
  // migration puts the ZONED 热流道温度 row into EVERY template, so the band has
  // to read in 中文 on a customer template too.
  "Hot Runner Settings": "process.section.hotRunnerSettings",
  // 连续六啤产品重量 moved up the same way on 2026-08-09, for the same reason: the
  // 20260808130000 migration puts the ZONED shot-weight row into EVERY template,
  // so the band has to read in 中文 on a customer template too.
  "Six Consecutive Shots Part Weight": "process.section.sixShotWeight",
  "Injection Profile": "process.section.injectionProfile",
  "Hold Profile": "process.section.holdProfile",
  Plasticizing: "process.section.plasticizing",
  Ejector: "process.section.ejector",
  "Mold Temperature": "process.section.moldTemperature",
  "Gate Type": "process.section.gateType",
  "Cooling Circuit": "process.section.coolingCircuit",
  "Operation Mode": "process.section.operationMode",
  "Core Pull A": "process.section.corePullA",
  "Core Return A": "process.section.coreReturnA",
  "Core Pull B": "process.section.corePullB",
  "Core Return B": "process.section.coreReturnB"
};

const activityEntityKey: Record<string, TranslationKey> = {
  Customer: "activity.entity.customer",
  DESIGN_CHANGE_EVENT: "activity.entity.designChange",
  DesignChangeEvent: "activity.entity.designChange",
  FileAttachment: "activity.entity.fileAttachment",
  InjectionMachine: "activity.entity.injectionMachine",
  KpiRule: "activity.entity.kpiRule",
  KpiSnapshot: "activity.entity.kpiSnapshot",
  MOLD_TRIAL_PROJECT: "activity.entity.project",
  MoldTrialProject: "activity.entity.project",
  MissedTrialEvent: "activity.entity.missedTrial",
  PROCESS_SHEET_EXPORT: "activity.entity.processSheetExport",
  ProjectNote: "activity.entity.projectNote",
  Role: "activity.entity.role",
  SystemSetting: "activity.entity.systemSetting",
  TRIAL_EVENT: "activity.entity.trial",
  TrialEvent: "activity.entity.trial",
  TRIAL_ISSUE: "activity.entity.issue",
  TrialIssue: "activity.entity.issue",
  TrialLimitAdjustment: "activity.entity.limitAdjustment",
  User: "activity.entity.user"
};

const activityActionKey: Record<string, TranslationKey> = {
  added_client_note: "activity.action.addedClientNote",
  added_new_planned_trial: "activity.action.addedNewPlannedTrial",
  admin_archived_project: "activity.action.archivedProject",
  approved_trial_date_change: "activity.action.approvedTrialDateChange",
  auto_marked_missed_reason_required: "activity.action.autoMarkedMissed",
  closed_trial_issue: "activity.action.closedIssue",
  confirmed_auto_missed_trial: "activity.action.confirmedAutoMissed",
  confirmed_trial_date: "activity.action.confirmedTrialDate",
  corrected_auto_missed_by_late_completed_trial: "activity.action.correctedAutoMissed",
  created_design_change_extra_trial_adjustment: "activity.action.createdDesignChangeAllowance",
  created_initial_planned_trial: "activity.action.createdInitialTrial",
  created_pm_custom_limit_adjustment: "activity.action.createdCustomLimit",
  created_trial_issue: "activity.action.createdIssue",
  deleted_attachment: "activity.action.deletedAttachment",
  exported_process_sheet_pdf: "activity.action.exportedProcessSheet",
  proposed_trial_date_change: "activity.action.proposedTrialDateChange",
  recorded_completed_trial: "activity.action.recordedCompletedTrial",
  recorded_missed_trial: "activity.action.recordedMissedTrial",
  redated_returned_trial: "activity.action.redatedReturnedTrial",
  rejected_trial_date_change: "activity.action.rejectedTrialDateChange",
  replanned_same_trial_stage: "activity.action.replannedSameStage",
  resolved_auto_missed_as_truly_missed: "activity.action.resolvedAutoMissed",
  retired_client_note: "activity.action.retiredClientNote",
  saved_trial_process_sheet: "activity.action.savedProcessSheet",
  seed_trial_completed: "activity.action.seedTrialCompleted",
  set_first_t0_planned_date: "activity.action.setFirstT0",
  set_pm_custom_trial_limit: "activity.action.setCustomLimit",
  updated_mold_trial_parts: "activity.action.updatedParts",
  updated_project_identifiers: "activity.action.updatedIdentifiers",
  uploaded_attachment: "activity.action.uploadedAttachment"
};

function validDate(value: DateValue): Date | null {
  if (value == null) {
    return null;
  }

  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatLocalizedDate(
  value: DateValue,
  language: Language,
  fallback = "-"
): string {
  const date = validDate(value);
  if (date == null) {
    return fallback;
  }

  return new Intl.DateTimeFormat(localeByLanguage[language], {
    timeZone: "UTC",
    year: "numeric",
    month: "short",
    day: "2-digit"
  }).format(date);
}

export function formatLocalizedTimestamp(
  value: DateValue,
  language: Language,
  fallback = "-"
): string {
  const date = validDate(value);
  if (date == null) {
    return fallback;
  }

  return new Intl.DateTimeFormat(localeByLanguage[language], {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

export function formatLocalizedTime(value: DateValue, language: Language): string | null {
  const date = validDate(value);
  if (date == null) {
    return null;
  }

  return new Intl.DateTimeFormat(localeByLanguage[language], {
    timeZone: "Asia/Shanghai",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  }).format(date);
}

export function formatLocalizedDaysAway(
  plannedDate: DateValue,
  today: Date | string,
  dictionary: Dictionary
): string {
  const t = createTranslator(dictionary);
  const delta = daysAwayFromDate(plannedDate, today);

  if (delta == null) {
    return t("common.notSet");
  }
  if (delta < 0) {
    return t("project.daysAway.overdue", { count: Math.abs(delta) });
  }
  if (delta === 0) {
    return t("project.daysAway.today");
  }
  return t("project.daysAway.future", { count: delta });
}

export function formatLocalizedTrialCountBadge(
  summary: Pick<
    TrialLimitSummary,
    "baseTrialLimit" | "completedTrialCount" | "currentTrialLimit" | "designChangeExtraTrialCount" | "warningState"
  >,
  dictionary: Dictionary
): string {
  const t = createTranslator(dictionary);
  const values = {
    completed: summary.completedTrialCount,
    limit: summary.currentTrialLimit
  };

  if (summary.designChangeExtraTrialCount > 0 && summary.currentTrialLimit > summary.baseTrialLimit) {
    return t("project.trialCount.designAllowance", values);
  }
  if (summary.completedTrialCount > summary.baseTrialLimit) {
    return t("project.trialCount.extra", values);
  }
  if (summary.warningState !== "Healthy") {
    return t("project.trialCount.warning", {
      ...values,
      warning: translateLabel(dictionary, "warning", summary.warningState)
    });
  }
  return t("project.trialCount.base", values);
}

export function formatDashboardNextTrial(
  nextTrial: DashboardNextTrialDisplay,
  dictionary: Dictionary
): string {
  const t = createTranslator(dictionary);

  if (nextTrial.kind === "WAITING_T0_SCHEDULE") {
    return t("dashboard.nextTrial.waitingT0");
  }
  if (nextTrial.kind === "NO_TRIAL_PLANNED") {
    return t("dashboard.nextTrial.none");
  }

  const trial = `T${Math.max(0, nextTrial.sequenceNumber - 1)}`;
  return nextTrial.kind === "COMPLETED"
    ? t("dashboard.nextTrial.completed", { trial })
    : t("dashboard.nextTrial.planned", { trial });
}

export function formatDashboardLimitBasis(
  limitBasis: DashboardLimitBasis,
  dictionary: Dictionary
): string {
  const t = createTranslator(dictionary);
  const keyByBasis: Record<DashboardLimitBasis, TranslationKey> = {
    DEFAULT: "dashboard.limitBasis.default",
    CUSTOM_PM: "dashboard.limitBasis.customPm",
    DESIGN_CHANGE: "dashboard.limitBasis.designChange"
  };
  return t(keyByBasis[limitBasis]);
}

export function translateSystemRole(dictionary: Dictionary, code: string, fallback: string): string {
  const normalized = code.trim().toLowerCase();
  return systemRoleCodes.has(normalized)
    ? translateDynamic(dictionary, `system.role.${normalized}`, fallback)
    : fallback;
}

export function translateSystemGroup(dictionary: Dictionary, code: string, fallback: string): string {
  const normalized = code.trim().toLowerCase();
  return systemGroupCodes.has(normalized)
    ? translateDynamic(dictionary, `system.group.${normalized}`, fallback)
    : fallback;
}

export function translateDefaultProcessSection(
  dictionary: Dictionary,
  section: string,
  defaultTemplate: boolean
): string {
  const catalogKey = catalogProcessSectionKey[section];
  if (catalogKey != null) {
    return createTranslator(dictionary)(catalogKey);
  }

  if (!defaultTemplate) {
    return section;
  }

  const key = defaultProcessSectionKey[section];
  return key == null ? section : createTranslator(dictionary)(key);
}

export function translateActivityEntity(dictionary: Dictionary, entityType: string): string {
  const key = activityEntityKey[entityType];
  return key == null
    ? entityType.replace(/([a-z])([A-Z])/g, "$1 $2").replaceAll("_", " ")
    : createTranslator(dictionary)(key);
}

export function translateActivityAction(dictionary: Dictionary, action: string): string {
  const key = activityActionKey[action];
  return key == null ? action.replaceAll("_", " ") : createTranslator(dictionary)(key);
}

export function warningStateDisplay(
  warningState: TrialLimitState,
  dictionary: Dictionary
): string {
  return translateLabel(dictionary, "warning", warningState);
}
