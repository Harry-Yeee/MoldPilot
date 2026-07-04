/**
 * Lightweight bilingual label scaffolding (no i18n framework).
 *
 * The app already has a full runtime i18n layer in `src/i18n`. This module is a
 * simpler, dependency-free way to co-locate an English + Chinese string on a
 * value and pick one by the user's `User.locale` (`EN_US | ZH_CN`). Upcoming
 * mobile/QC features will use it for short, data-adjacent labels.
 */

export type Locale = "EN_US" | "ZH_CN";

export type BilingualLabel = {
  en: string;
  zh: string;
};

export function pickLabel(label: BilingualLabel, locale: Locale): string {
  return locale === "ZH_CN" ? label.zh : label.en;
}

/** Dashboard summary-card titles — first usage of the bilingual scaffolding. */
export const dashboardSummaryLabels = {
  activeMolds: { en: "Active molds", zh: "在产模具" },
  waitingT0: { en: "Waiting T0", zh: "等待 T0" },
  delayed: { en: "Delayed", zh: "延误" },
  nearAtLimit: { en: "Near / at limit", zh: "接近 / 达到上限" },
  overLimit: { en: "Over limit", zh: "超出上限" },
  upcomingPlanned: { en: "Upcoming planned", zh: "即将安排" },
  completed: { en: "Completed", zh: "已完成" },
  highCriticalOpen: { en: "High / critical open", zh: "高 / 严重未关闭" },
  pendingFollowUp: { en: "Pending follow-up", zh: "待跟进" }
} as const satisfies Record<string, BilingualLabel>;

/** Main nav labels — first usage of the bilingual scaffolding. */
export const navLabels = {
  admin: { en: "Admin", zh: "管理" },
  createIntake: { en: "Create intake", zh: "新建立项" },
  myTasks: { en: "My tasks", zh: "我的任务" },
  dashboard: { en: "Dashboard", zh: "仪表板" }
} as const satisfies Record<string, BilingualLabel>;

/** Phone-first "My Plate" (/me) labels. */
export const myPlateLabels = {
  pageTitle: { en: "My tasks", zh: "我的任务" },
  pageSubtitle: { en: "Everything waiting on you", zh: "所有等待你处理的事项" },
  allCaughtUp: { en: "You're all caught up", zh: "全部处理完毕" },
  allCaughtUpHint: { en: "Nothing is waiting on you right now.", zh: "目前没有等待你处理的事项。" },
  needsReason: { en: "Needs a reason", zh: "需要填写原因" },
  myOpenIssues: { en: "My open issues", zh: "我的未结问题" },
  departmentInbox: { en: "Department inbox", zh: "部门待领" },
  assemblyAcknowledge: { en: "Assembly: acknowledge", zh: "装配：确认接收" },
  assemblySelfCheck: { en: "Assembly: self-check", zh: "装配：自检" },
  pmConfirmReady: { en: "PM: confirm ready", zh: "PM：确认就绪" },
  comingUp: { en: "Coming up", zh: "即将进行" },
  // Row + sheet actions
  resolve: { en: "Resolve", zh: "处理" },
  done: { en: "Done", zh: "完成" },
  claim: { en: "Claim", zh: "认领" },
  updateStatus: { en: "Update status", zh: "更新状态" },
  acknowledge: { en: "Acknowledge", zh: "确认接收" },
  selfCheck: { en: "Self-check done", zh: "自检完成" },
  confirmReady: { en: "Confirm ready", zh: "确认就绪" },
  submit: { en: "Submit", zh: "提交" },
  cancel: { en: "Cancel", zh: "取消" },
  // Field labels
  reason: { en: "Reason", zh: "原因" },
  responsibleArea: { en: "Responsible area", zh: "责任区域" },
  explanation: { en: "Explanation", zh: "说明" },
  newPlannedDate: { en: "New planned date", zh: "新计划日期" },
  fixSummary: { en: "What did you fix?", zh: "你修复了什么？" },
  timeSpent: { en: "Time spent (minutes)", zh: "耗时（分钟）" },
  status: { en: "Status", zh: "状态" },
  estimatedFinishDate: { en: "Estimated finish date", zh: "预计完成日期" },
  acknowledgeDate: { en: "Acknowledged date", zh: "确认日期" },
  selfCheckDate: { en: "Self-check date", zh: "自检日期" },
  selfCheckNote: { en: "Self-check note", zh: "自检备注" },
  confirmReadyDate: { en: "Ready confirmed date", zh: "就绪确认日期" },
  dueDate: { en: "Due", zh: "截止" },
  plannedDate: { en: "Planned", zh: "计划" },
  description: { en: "Description", zh: "描述" },
  partCavity: { en: "Part / cavity", zh: "零件 / 型腔" },
  overdue: { en: "Overdue", zh: "已逾期" }
} as const satisfies Record<string, BilingualLabel>;
