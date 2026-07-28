/**
 * Where is this project in the workflow, and who moves it next?
 *
 * The six stages here are the six stages of the training poster
 * (`docs/07-training/roles-responsibilities-poster.html`) — same order, same
 * wording, both languages — so the stepper on the project page and the poster on
 * the wall are literally the same mental model. New users learned the poster in
 * training; the page must not teach a second vocabulary.
 *
 * Pure and dependency-free: project status + trials + an issue summary in, a
 * stage index and one bilingual next action out. No Prisma, no React, no clock.
 * Every field it reads is already loaded by the project detail page, so the
 * stepper adds zero queries. When a caller cannot supply a piece (no trials
 * loaded, no date-confirmation state), the result is the nearest honest stage
 * with `approximate: true` rather than a confident guess.
 */

import { selectCurrentPlannedTrial } from "./current-trial.ts";
import { trialStageLabel } from "./trial-panel.ts";
import type { DateConfirmationStatus } from "./date-confirmation.ts";
import type { DateLike, ProjectStatus, TrialResult, TrialStatus } from "./types.ts";

/** Stable ids for the six poster stages, in order. */
export type ProjectStageId =
  | "INTAKE"
  | "DATE_CONFIRMATION"
  | "TRIAL_DAY"
  | "CORRECTION"
  | "VERIFY_REPORT"
  | "COUNT_CLOSE";

export type ProjectStageDescriptor = {
  id: ProjectStageId;
  /** 0-5, matching the poster's "STAGE 1".."STAGE 6". */
  index: number;
  /** Poster Chinese heading, verbatim. */
  labelZh: string;
  /** Poster English heading, verbatim. */
  labelEn: string;
};

/**
 * The six stages, verbatim from the poster's stage headings. Order is the
 * workflow order; `index` is what {@link computeProjectStage} returns.
 */
export const projectStages: readonly ProjectStageDescriptor[] = [
  { id: "INTAKE", index: 0, labelZh: "项目立项", labelEn: "Project intake" },
  { id: "DATE_CONFIRMATION", index: 1, labelZh: "排期确认", labelEn: "Date confirmation" },
  { id: "TRIAL_DAY", index: 2, labelZh: "试模当天", labelEn: "Trial day" },
  { id: "CORRECTION", index: 3, labelZh: "整改循环", labelEn: "Correction loop" },
  { id: "VERIFY_REPORT", index: 4, labelZh: "验证与报告", labelEn: "Verify & report" },
  { id: "COUNT_CLOSE", index: 5, labelZh: "计数与收尾", labelEn: "Count & close" }
];

/** The role that owns the next action, using the poster's role vocabulary. */
export type ProjectStageRole =
  | "PM"
  | "MARKETING"
  | "INJECTION"
  | "ASSEMBLY"
  | "QC"
  | "DESIGN"
  | "ALL"
  | "SYSTEM";

/** One bilingual instruction naming the responsible role. */
export type ProjectStageNextAction = {
  en: string;
  zh: string;
  role: ProjectStageRole;
};

/** The trial slice the stage rules read (all of it is already on the page). */
export type ProjectStageTrial = {
  id?: string;
  sequenceNumber: number;
  plannedDate?: DateLike | null;
  /** Domain status label, e.g. "Planned" / "Completed". */
  status: TrialStatus;
  result?: TrialResult | null;
  /** Date-confirmation handshake state; omit when it was not loaded. */
  dateConfirmationStatus?: DateConfirmationStatus | null;
  /** True when this trial requires a measurement report and none is uploaded. */
  measurementReportMissing?: boolean;
};

/**
 * Counts only — the stage never needs issue rows. `unclaimedCount` counts open
 * issues with no owner user (the department inbox); `openCount` counts every
 * issue that is neither Verified nor Closed.
 */
export type ProjectStageIssueSummary = {
  openCount: number;
  unclaimedCount: number;
  awaitingVerificationCount: number;
};

export type ProjectStageInput = {
  /** Domain project-status label, e.g. "In Correction". */
  projectStatus: ProjectStatus;
  trials?: readonly ProjectStageTrial[];
  issues?: ProjectStageIssueSummary;
};

export type ProjectStageResult = {
  /** 0-5 index into {@link projectStages}. */
  stageIndex: number;
  stageId: ProjectStageId;
  nextAction: ProjectStageNextAction;
  /** The trial the stepper considers current (the one that renders expanded). */
  currentTrialId: string | null;
  /** True when a needed input was missing and the stage is a nearest-honest guess. */
  approximate: boolean;
};

const emptyIssueSummary: ProjectStageIssueSummary = {
  openCount: 0,
  unclaimedCount: 0,
  awaitingVerificationCount: 0
};

function descriptor(id: ProjectStageId): ProjectStageDescriptor {
  const found = projectStages.find((stage) => stage.id === id);
  if (found == null) {
    throw new Error(`Unknown project stage: ${id}`);
  }

  return found;
}

function result(
  id: ProjectStageId,
  nextAction: ProjectStageNextAction,
  currentTrialId: string | null,
  approximate: boolean
): ProjectStageResult {
  return {
    stageIndex: descriptor(id).index,
    stageId: id,
    nextAction,
    currentTrialId,
    approximate
  };
}

/** Poster stage 2: whoever owes the date handshake its next move. */
function dateConfirmationNextAction(
  trialLabel: string,
  status: DateConfirmationStatus
): ProjectStageNextAction {
  switch (status) {
    case "RESCHEDULE_PROPOSED":
      return {
        role: "MARKETING",
        zh: `市场部对照客户交期批准或退回 ${trialLabel} 的日期变更（≤24小时）`,
        en: `Marketing approves or returns the ${trialLabel} date change against the customer deadline (≤24h)`
      };
    case "RETURNED_TO_PM":
      return {
        role: "PM",
        zh: `项目管理为 ${trialLabel} 重新设定日期`,
        en: `PM sets a new ${trialLabel} date`
      };
    case "CONFIRMED":
      return trialDayNextAction(trialLabel);
    case "PENDING_CONFIRMATION":
    default:
      return {
        role: "INJECTION",
        zh: `注塑确认 ${trialLabel} 日期与机台（≤24小时）`,
        en: `Injection confirms the ${trialLabel} date + machine (≤24h)`
      };
  }
}

/** Poster stage 3: the trial is scheduled and confirmed — run it, record it. */
function trialDayNextAction(trialLabel: string): ProjectStageNextAction {
  return {
    role: "INJECTION",
    zh: `注塑执行 ${trialLabel} 试模并录入工艺参数；项目管理 24 小时内录入结果`,
    en: `Injection runs ${trialLabel} and enters the process values; PM records the result within 24h`
  };
}

/** Poster stage 4: claim first, then acknowledge/fix, then PM confirms ready. */
function correctionNextAction(issues: ProjectStageIssueSummary): ProjectStageNextAction {
  if (issues.unclaimedCount > 0) {
    const plural = issues.unclaimedCount === 1 ? "issue" : "issues";
    return {
      role: "ALL",
      zh: `各部门在收件箱点「我来处理」认领 ${issues.unclaimedCount} 个未领问题（≤48小时）`,
      en: `Each department claims ${issues.unclaimedCount} unassigned ${plural} with "I'll take this" (≤48h)`
    };
  }

  if (issues.openCount > 0) {
    return {
      role: "ASSEMBLY",
      zh: "装配确认整改并给出预计完成日（≤24小时），下次试模前完成自检",
      en: "Assembly acknowledges with an estimated finish (≤24h) and self-checks before the next trial"
    };
  }

  return {
    role: "PM",
    zh: "项目管理确认整改就绪并安排下一次试模",
    en: "PM confirms the fixes are ready and plans the next trial"
  };
}

/** Poster stage 5: QC's verdict + the measurement report. */
function verifyNextAction(trials: readonly ProjectStageTrial[]): ProjectStageNextAction {
  const missingReport = trials.find((trial) => trial.measurementReportMissing === true);

  if (missingReport != null) {
    const label = trialStageLabel(missingReport.sequenceNumber);
    return {
      role: "QC",
      zh: `质检记录验证结论并上传 ${label} 测量报告（≤48小时）`,
      en: `QC records the verification verdicts and uploads the ${label} measurement report (≤48h)`
    };
  }

  return {
    role: "QC",
    zh: "质检在下次试模现场验证整改并记录结论",
    en: "QC verifies the fixes at the next trial and records the verdicts"
  };
}

function hasCompletedTrial(trials: readonly ProjectStageTrial[]): boolean {
  return trials.some((trial) => trial.status === "Completed" || trial.status === "Pending Follow-Up");
}

/**
 * Map one project onto the six poster stages plus a single next action.
 *
 * Reading order: the project status decides first (it is the workflow's own
 * verdict), and only the "the trial is in front of us" statuses (Active /
 * Waiting Trial / Trial Delayed) fall through to the current trial's own state.
 * The current trial is chosen with {@link selectCurrentPlannedTrial}, the same
 * rule the trial panel and dashboard already use, so the stage and the expanded
 * panel can never disagree.
 */
export function computeProjectStage(input: ProjectStageInput): ProjectStageResult {
  const trials = input.trials ?? [];
  const issues = input.issues ?? emptyIssueSummary;
  const current = selectCurrentPlannedTrial(trials);
  const currentTrialId = current?.id ?? null;
  const trialsMissing = trials.length === 0;

  switch (input.projectStatus) {
    case "Intake":
      return result(
        "INTAKE",
        {
          role: "PM",
          zh: "项目管理审核立项，录入模具编号，设定首次 T0 日期",
          en: "PM reviews the intake, enters the mold code, and sets the first T0 date"
        },
        currentTrialId,
        false
      );
    case "In Correction":
      return result("CORRECTION", correctionNextAction(issues), currentTrialId, false);
    case "Waiting Verification":
      return result("VERIFY_REPORT", verifyNextAction(trials), currentTrialId, false);
    case "Approved":
      return result(
        "COUNT_CLOSE",
        {
          role: "PM",
          zh: "项目管理在客户批准后结案",
          en: "PM closes the project after customer approval"
        },
        currentTrialId,
        false
      );
    case "Over Limit":
      return result(
        "COUNT_CLOSE",
        {
          role: "PM",
          zh: "项目管理与总经理确认超出试模次数上限的原因与后续安排",
          en: "PM reviews the over-limit trial count with the GM before planning more trials"
        },
        currentTrialId,
        false
      );
    case "Closed":
      return result(
        "COUNT_CLOSE",
        { role: "SYSTEM", zh: "项目已结案，无需操作", en: "Project is closed — no action needed" },
        currentTrialId,
        false
      );
    case "Cancelled":
      return result(
        "COUNT_CLOSE",
        { role: "SYSTEM", zh: "项目已取消，无需操作", en: "Project is cancelled — no action needed" },
        currentTrialId,
        false
      );
    case "Blocked":
      return result(
        "DATE_CONFIRMATION",
        {
          role: "PM",
          zh: "项目管理解除阻塞并重新安排试模日期",
          en: "PM clears the blocker and re-dates the trial"
        },
        currentTrialId,
        false
      );
    case "Paused":
      return result(
        "DATE_CONFIRMATION",
        {
          role: "PM",
          zh: "项目管理恢复项目并重新安排试模日期",
          en: "PM resumes the project and re-dates the trial"
        },
        currentTrialId,
        false
      );
    default:
      break;
  }

  if (current != null) {
    const trialLabel = trialStageLabel(current.sequenceNumber);

    // The trial day came and went without a result: the poster's honest-reason
    // duty. Still stage 3 — the trial is what everyone is looking at.
    if (current.status === "Auto Missed - Reason Required") {
      return result(
        "TRIAL_DAY",
        {
          role: "PM",
          zh: `项目管理补录 ${trialLabel} 结果，或如实填写未试模原因（≤24小时）`,
          en: `PM records the ${trialLabel} result, or files an honest missed-trial reason (≤24h)`
        },
        currentTrialId,
        false
      );
    }

    // A delayed project is back at scheduling regardless of the handshake state.
    if (input.projectStatus === "Trial Delayed") {
      const status = current.dateConfirmationStatus;
      return result(
        "DATE_CONFIRMATION",
        status == null || status === "CONFIRMED"
          ? {
              role: "PM",
              zh: `项目管理为 ${trialLabel} 重新设定日期`,
              en: `PM sets a new ${trialLabel} date`
            }
          : dateConfirmationNextAction(trialLabel, status),
        currentTrialId,
        false
      );
    }

    // Confirmation state was not loaded — the nearest honest stage is "someone
    // still owes this date a decision", flagged as an estimate.
    if (current.dateConfirmationStatus == null) {
      return result(
        "DATE_CONFIRMATION",
        dateConfirmationNextAction(trialLabel, "PENDING_CONFIRMATION"),
        currentTrialId,
        true
      );
    }

    return result(
      current.dateConfirmationStatus === "CONFIRMED" ? "TRIAL_DAY" : "DATE_CONFIRMATION",
      dateConfirmationNextAction(trialLabel, current.dateConfirmationStatus),
      currentTrialId,
      false
    );
  }

  // No trial is waiting to happen. Work out what the project is actually owed.
  if (trials.some((trial) => trial.measurementReportMissing === true)) {
    return result("VERIFY_REPORT", verifyNextAction(trials), null, false);
  }

  if (issues.openCount > 0) {
    return result("CORRECTION", correctionNextAction(issues), null, false);
  }

  if (hasCompletedTrial(trials)) {
    return result(
      "COUNT_CLOSE",
      {
        role: "PM",
        zh: "项目管理确认结案，或安排下一次试模",
        en: "PM closes the project, or plans the next trial"
      },
      null,
      false
    );
  }

  return result(
    "DATE_CONFIRMATION",
    {
      role: "PM",
      zh: "项目管理设定下一次试模日期",
      en: "PM sets the next trial date"
    },
    null,
    trialsMissing
  );
}
