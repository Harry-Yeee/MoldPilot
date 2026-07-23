/**
 * KPI rule registry — the admin-editable catalog of habit behaviors that the
 * monthly scorecard measures. This module is PURE (no Prisma import): it holds
 * the seed defaults, the stable rule-code union, the role-scope grouping, the
 * severity weights, and the bilingual copy used by the Rules panel and the
 * personal scoreboard.
 *
 * Design authority: docs/06-kpi/kpi-system-design.md (v2). Deadlines are
 * configured in literal HOURS (weekends count). Boolean rules (self-check,
 * photo-on-defect, process-values) carry `hours: null`.
 */

import type { BilingualLabel } from "./labels.ts";

/** Every rule code the scoring engine understands. Stable, never renamed. */
export const kpiRuleCodes = [
  "pm.missed_reason",
  "pm.result_recorded",
  "pm.returned_redate",
  "inj.date_confirm",
  "inj.process_values",
  "asm.acknowledge",
  "asm.self_check",
  "mkt.date_decision",
  "qc.report_upload",
  "all.inbox_claim",
  "all.photo_on_defect",
  "design.change_revision",
  "design.inbox_claim"
] as const;

export type KpiRuleCode = (typeof kpiRuleCodes)[number];

export function isKpiRuleCode(value: string): value is KpiRuleCode {
  return (kpiRuleCodes as readonly string[]).includes(value);
}

/**
 * Which leader's bar a rule feeds. `all` is everyone's shared line; `design`
 * is dormant until the Design role ships. These match `DepartmentGroup.code`
 * where a real department exists so the leader rollup can join on them.
 */
export type KpiRoleScope = "pm" | "injection" | "assembly" | "marketing" | "qc" | "all" | "design";

/**
 * Role scopes whose rules are DORMANT until their role exists (grayed in the
 * panel). Empty since the Design role was onboarded (2026-07-08) and its two
 * rules went active — nothing is pending a role anymore.
 */
export const dormantRoleScopes: readonly KpiRoleScope[] = [];

export function isDormantRoleScope(roleScope: string): boolean {
  return (dormantRoleScopes as readonly string[]).includes(roleScope);
}

/**
 * The DB role codes whose users receive a monthly scorecard. Everyone else —
 * ADMIN, GM, VIEWER — is never scored: not listed in the Scores tab, not
 * persisted in snapshots, and shown an "admins are not scored" note on /score.
 * `design` is included so its scorecard turns on automatically once the Design
 * role ships (the rules are already registered, dormant). Values are the
 * lowercase `Role.code` strings stored on the user, not the display labels.
 */
export const scoredRoleCodes: readonly string[] = [
  "pm",
  "injection",
  "assembly",
  "qc",
  "marketing",
  "design"
];

/**
 * Pure predicate: does a user with this DB role code get a scorecard? Accepts
 * the lowercase `Role.code` (e.g. "pm", "admin"); case-insensitive so a display
 * label ("PM") also resolves. ADMIN / GM / VIEWER return false.
 */
export function isScoredRole(dbRoleCode: string): boolean {
  return scoredRoleCodes.includes(dbRoleCode.toLowerCase());
}

/** Inclusive bounds for an editable hours deadline. */
export const kpiRuleMinHours = 1;
export const kpiRuleMaxHours = 336;

export function isValidKpiRuleHours(hours: number): boolean {
  return Number.isInteger(hours) && hours >= kpiRuleMinHours && hours <= kpiRuleMaxHours;
}

/**
 * Severity -> verified-issue point weight (v2 §4 phase-2 scale, used now for
 * the points column). Only issues with a verification trial count.
 */
export const severityPointWeight = {
  LOW: 1,
  MEDIUM: 2,
  HIGH: 3,
  CRITICAL: 5
} as const;

export type SeverityDbValue = keyof typeof severityPointWeight;

export function severityWeight(severity: SeverityDbValue): number {
  return severityPointWeight[severity];
}

/**
 * Hot-3 double-severity multiplier is NOT built yet (the weekly board-walk
 * vote does not exist). This hook keeps the seam explicit: today every counted
 * fix multiplies by 1. When Hot-3 ships, resolve this per issue.
 */
export const HOT_3_MULTIPLIER = 1;

/** The habit-bar threshold and the "not enough data" floor (v2 §4). */
export const barHitPercent = 85;
export const minApplicableForBar = 5;

/**
 * Monthly prize amounts in yuan (v2 §6). A leader whose GROUP hits the bar earns
 * a flat ¥400 ("my 400", not split); a referee (QC / Marketing) whose service
 * bar is met earns a ¥250 allowance. The Leaders section reads these so the money
 * captions have ONE source of truth instead of strings sprinkled around the UI.
 */
export const leaderHabitPrizeYuan = 400;
export const refereeAllowanceYuan = 250;

export type KpiRuleSeed = {
  code: KpiRuleCode;
  labelEn: string;
  labelZh: string;
  /** Literal hours; null for boolean rules. */
  hours: number | null;
  roleScope: KpiRoleScope;
  active: boolean;
  sortOrder: number;
};

/**
 * Default rule catalog seeded on first run. Order within a role scope is the
 * display order. Owner-confirmed defaults (deadlines in hours):
 */
export const defaultKpiRules: readonly KpiRuleSeed[] = [
  // PM group
  { code: "pm.missed_reason", labelEn: "Missed/auto-missed trial resolved with reason", labelZh: "缺失/自动缺失试模填写原因", hours: 24, roleScope: "pm", active: true, sortOrder: 10 },
  { code: "pm.result_recorded", labelEn: "Trial result recorded", labelZh: "试模结果录入", hours: 24, roleScope: "pm", active: true, sortOrder: 20 },
  { code: "pm.returned_redate", labelEn: "Returned date re-dated", labelZh: "退回日期重新排期", hours: 24, roleScope: "pm", active: true, sortOrder: 30 },
  // Injection group
  { code: "inj.date_confirm", labelEn: "Trial date confirmed with machine", labelZh: "试模日期 + 机台确认", hours: 24, roleScope: "injection", active: true, sortOrder: 10 },
  { code: "inj.process_values", labelEn: "Process values entered for completed trial", labelZh: "完成试模录入工艺参数", hours: null, roleScope: "injection", active: true, sortOrder: 20 },
  // Assembly group
  { code: "asm.acknowledge", labelEn: "Correction acknowledged with estimated finish", labelZh: "整改确认 + 预计完成日", hours: 24, roleScope: "assembly", active: true, sortOrder: 10 },
  { code: "asm.self_check", labelEn: "Self-check done before next trial", labelZh: "试模前自检完成", hours: null, roleScope: "assembly", active: true, sortOrder: 20 },
  // Marketing (referee service bar)
  { code: "mkt.date_decision", labelEn: "Date-change decision made", labelZh: "日期变更决定", hours: 24, roleScope: "marketing", active: true, sortOrder: 10 },
  // QC (referee service bar)
  { code: "qc.report_upload", labelEn: "Measurement report uploaded", labelZh: "测量报告上传", hours: 48, roleScope: "qc", active: true, sortOrder: 10 },
  // Everyone's shared line
  { code: "all.inbox_claim", labelEn: "Department-inbox issue claimed", labelZh: "部门问题认领", hours: 48, roleScope: "all", active: true, sortOrder: 10 },
  { code: "all.photo_on_defect", labelEn: "Photo attached where a defect is claimed", labelZh: "缺陷附照片", hours: null, roleScope: "all", active: true, sortOrder: 20 },
  // Design — ACTIVE since the Design role was onboarded (2026-07-08)
  { code: "design.change_revision", labelEn: "Design-change revision turned around", labelZh: "设计变更修订完成", hours: 48, roleScope: "design", active: true, sortOrder: 10 },
  { code: "design.inbox_claim", labelEn: "Design-inbox issue claimed", labelZh: "设计问题认领", hours: 48, roleScope: "design", active: true, sortOrder: 20 }
] as const;

/**
 * Rule codes that are BOOLEAN (pass/fail, no clock) — `hours` is null in the
 * seed. The scoring engine keys on the live `hours` value, but the UI needs to
 * classify a scorecard line (which carries only the code) as pass/fail vs
 * timed, so this derived set is the shared source of truth for that split.
 */
export const booleanKpiRuleCodes: readonly KpiRuleCode[] = defaultKpiRules
  .filter((rule) => rule.hours == null)
  .map((rule) => rule.code);

export function isBooleanKpiRuleCode(code: string): boolean {
  return (booleanKpiRuleCodes as readonly string[]).includes(code);
}

/**
 * Canonical bilingual label per rule code, derived from the seed catalog. The
 * /me deadline-countdown chip's tooltip ("Deadline rule: <label> · <H>h") reads
 * this so the chip names the same behavior the Rules tab lists, without
 * threading DB labels through the plate query (only the HOURS are live/editable).
 */
export const kpiRuleLabelByCode: Record<KpiRuleCode, BilingualLabel> = Object.fromEntries(
  defaultKpiRules.map((rule) => [rule.code, { en: rule.labelEn, zh: rule.labelZh }])
) as Record<KpiRuleCode, BilingualLabel>;

/** Bilingual heading per role scope for grouping in the Rules panel + scores. */
export const kpiRoleScopeLabels: Record<KpiRoleScope, BilingualLabel> = {
  pm: { en: "PM", zh: "PM" },
  injection: { en: "Injection", zh: "注塑" },
  assembly: { en: "Assembly", zh: "装配" },
  marketing: { en: "Marketing (referee)", zh: "市场（裁判）" },
  qc: { en: "QC (referee)", zh: "质检（裁判）" },
  all: { en: "Everyone", zh: "全员" },
  design: { en: "Design", zh: "设计" }
};

/**
 * Bilingual label per KPI leader/referee group code, shown in the Scores tab's
 * Leaders section. Keyed on `DepartmentGroup.code`: the two assembly children
 * (`assembly-a` 钟组 / `assembly-b` 裴组) are the split leader groups, `pm` labels
 * the award-tier individuals, and `qc`/`marketing` name the two referee bars.
 * Groups without a specific entry fall back to their raw name in the server.
 */
export const kpiLeaderGroupLabels: Record<string, BilingualLabel> = {
  design: { en: "Design", zh: "设计" },
  "assembly-a": { en: "Assembly · Zhong", zh: "装配 · 钟组" },
  "assembly-b": { en: "Assembly · Pei", zh: "装配 · 裴组" },
  injection: { en: "Injection", zh: "注塑" },
  pm: { en: "PM", zh: "PM" },
  qc: { en: "QC (referee)", zh: "质检（裁判）" },
  marketing: { en: "Marketing (referee)", zh: "市场（裁判）" }
};

/** Referee group codes — their leader bars pay the ¥250 allowance, never the ¥400 pool. */
export const kpiRefereeGroupCodes: readonly string[] = ["qc", "marketing"];

export function isKpiRefereeGroupCode(code: string): boolean {
  return kpiRefereeGroupCodes.includes(code);
}

/** Order role scopes appear in the Rules panel and Scores rollup. */
export const kpiRoleScopeOrder: readonly KpiRoleScope[] = [
  "pm",
  "injection",
  "assembly",
  "marketing",
  "qc",
  "all",
  "design"
];

/**
 * A rule's role scope maps to the department-group code where a real group
 * exists, so a leader's department rollup can be computed. `all` and `design`
 * have no single owning group.
 */
export const roleScopeDepartmentGroupCode: Partial<Record<KpiRoleScope, string>> = {
  pm: "pm",
  injection: "injection",
  assembly: "assembly",
  marketing: "marketing",
  qc: "qc"
};

/** Static bilingual copy for the Rules panel and the personal scoreboard. */
export const kpiLabels = {
  // Admin tabs
  rulesTab: { en: "Rules", zh: "规则" },
  scoresTab: { en: "Scores", zh: "成绩" },
  // Rules panel
  rulesTitle: { en: "KPI rule registry", zh: "KPI 规则登记表" },
  behavior: { en: "Behavior", zh: "行为" },
  deadlineHours: { en: "Deadline (hours)", zh: "截止时限（小时）" },
  boolean: { en: "Yes/No", zh: "是/否" },
  active: { en: "Active", zh: "启用" },
  lastChanged: { en: "Last changed", zh: "最近修改" },
  never: { en: "never", zh: "从未" },
  neverChanged: { en: "never changed", zh: "从未修改" },
  changedBy: { en: "by", zh: "修改者" },
  save: { en: "Save", zh: "保存" },
  hourSuffix: { en: "h", zh: "小时" },
  rolePending: { en: "role pending", zh: "角色待建" },
  rolePendingZh: { en: "role pending / 角色未启用", zh: "角色未启用 / role pending" },
  recomputeNow: { en: "Recompute now", zh: "立即重算" },
  weekendsNote: {
    en: "Deadlines are literal hours — weekends and holidays count. 24h means 24 clock hours, not one workday.",
    zh: "截止时限为字面小时数——周末和节假日照算。24 小时即 24 个钟头，而非一个工作日。"
  },
  rescoreWarning: {
    en: "Changing a rule re-scores the entire current month. The nightly recompute always uses the current rules; there is no versioning by month yet.",
    zh: "修改规则将重算整个当月成绩。每晚重算始终使用当前规则；暂无按月版本化。"
  },
  // Scores tab
  scoresTitle: { en: "Monthly scores", zh: "月度成绩" },
  month: { en: "Month", zh: "月份" },
  scoreboardVisibility: { en: "Staff scoreboard visibility", zh: "员工成绩单可见性" },
  scoreboardOn: { en: "On — staff can see their score", zh: "开启——员工可查看自己的成绩" },
  scoreboardOff: { en: "Off — quiet data gathering", zh: "关闭——安静收集数据" },
  name: { en: "Name", zh: "姓名" },
  role: { en: "Role", zh: "角色" },
  applicable: { en: "Applicable", zh: "适用" },
  onTime: { en: "On time", zh: "按时" },
  percent: { en: "Percent", zh: "百分比" },
  verdict: { en: "Bar", zh: "达标" },
  points: { en: "Points", zh: "积分" },
  noData: { en: "No data this month", zh: "本月无数据" },
  department: { en: "department", zh: "部门" },
  hit: { en: "Hit", zh: "达标" },
  miss: { en: "Miss", zh: "未达标" },
  notEnough: { en: "Not enough data (counts as hit)", zh: "数据不足（视为达标）" },
  notEnoughShort: { en: "Not enough data", zh: "数据不足" },
  notEnoughHint: {
    en: "Fewer than 5 applicable events — counts as hit",
    zh: "适用事项不足 5 件——视为达标"
  },
  ref: { en: "Item", zh: "事项" },
  // Scores tab — Leaders section (组长达标): per-leader group bars above the grid.
  leaders: { en: "Leaders", zh: "组长达标" },
  leadersHint: {
    en: "Each leader's bar is their GROUP's combined data — the crew's records must be complete too. ¥400 on a hit; referees earn ¥250.",
    zh: "每位组长的达标线取其「组」的合并数据——组员的记录也要齐全。达标发 ¥400；裁判发 ¥250。"
  },
  leaderColumn: { en: "Leader", zh: "组长" },
  groupColumn: { en: "Group", zh: "组" },
  membersColumn: { en: "Members", zh: "组员" },
  individualTag: { en: "individual", zh: "个人" },
  refereeHeading: { en: "Referees — service bars", zh: "裁判——服务达标线" },
  refereeSuffix: { en: "referee", zh: "裁判" },
  memberBreakdown: { en: "Members, one by one", zh: "组员逐一" },
  dueAt: { en: "Due at", zh: "截止" },
  doneAt: { en: "Done at", zh: "完成" },
  pending: { en: "pending", zh: "待定" },
  due: { en: "due", zh: "截止" },
  completed: { en: "completed", zh: "已完成" },
  notCompleted: { en: "not completed", zh: "未完成" },
  notDone: { en: "not done", zh: "未完成" },
  showMore: { en: "more", zh: "更多" },
  auditDetails: { en: "Audit detail", zh: "查证明细" },
  // Scores tab — column sorting
  sortBy: { en: "Sort by", zh: "排序" },
  ascending: { en: "ascending", zh: "升序" },
  descending: { en: "descending", zh: "降序" },
  // Personal scoreboard
  scoreboardTitle: { en: "My score", zh: "我的成绩" },
  scoreboardSubtitle: {
    en: "Your live scorecard — every line opens to the records behind it.",
    zh: "你的实时成绩单——每一行都能点开查证。"
  },
  navMyScore: { en: "My score", zh: "我的成绩" },
  barBreakdown: { en: "The bar, item by item", zh: "达标线明细" },
  pointsBreakdown: { en: "Points, fix by fix", zh: "积分明细" },
  total: { en: "Total", zh: "合计" },
  monthPoints: { en: "Points this month", zh: "本月积分" },
  verifiedFix: { en: "Verified fix", zh: "已验证修复" },
  severity: { en: "Severity", zh: "严重度" },
  pendingVerification: { en: "pending next-trial verification", zh: "待下次试模验证" },
  provisionalZero: { en: "counts as 0 for now", zh: "暂计 0" },
  twoProtections: { en: "Two protections", zh: "两条保护" },
  protectionFewEvents: {
    en: "Fewer than 5 applicable events this month → counts as hitting the bar. A quiet month never hurts you.",
    zh: "当月适用事项不足 5 件 → 视为达标。安静的月份不吃亏。"
  },
  protectionBaseline: {
    en: "The first month after launch is a baseline — calibration only, never referenced, never rewarded or blamed.",
    zh: "系统启用首月为基准月——只校准，不评价，不发奖也不追责。"
  },
  previewBadge: { en: "Preview — not visible to staff", zh: "预览——员工尚不可见" },
  notScoredRole: { en: "Admins are not scored", zh: "管理员不计成绩" },
  notScoredRoleHint: {
    en: "This account's role has no scorecard — only PM, Injection, Assembly, QC and Marketing are scored. Use the Scores tab to review the team.",
    zh: "此账号的角色不参与评分——仅 PM、注塑、装配、质检、市场计入成绩。请到「成绩」标签查看团队。"
  },
  backToScores: { en: "Open the Scores tab", zh: "打开成绩标签" },
  notEnabled: { en: "The scoreboard is not enabled yet.", zh: "成绩单尚未启用。" },
  notEnabledHint: {
    en: "The first two months after launch are a quiet baseline. Your score will appear here once it opens.",
    zh: "启用后的头两个月为安静的基准期。开启后你的成绩会显示在这里。"
  },
  // "Hope math" — the single path-forward line under the /score verdict banner.
  // Fixes the mid-month give-up cliff: it always reads as a path, never a threat.
  // No red anywhere. `{n}` is filled from the pure bar-math helpers.
  hopeRecovery: {
    en: "Hit your next {n} deadlines on time and you're back over the bar.",
    zh: "再连续按时完成 {n} 件即可达标。"
  },
  hopeBuffer: {
    en: "Over the bar — room to miss {n} more.",
    zh: "已达标 · 还有 {n} 件容错空间。"
  },
  hopeNoRoom: {
    en: "Right on the bar — no room to spare.",
    zh: "刚好达标，别松手。"
  },
  hopeFloorGuidance: {
    en: "If more events come this month: hit your next {n} on time to stay over.",
    zh: "若本月事项增多：接下来按时完成 {n} 件即可保持达标。"
  }
} as const satisfies Record<string, BilingualLabel>;

/** The system-setting key gating the staff scoreboard. */
export const scoreboardEnabledSettingKey = "scoreboard_enabled";
