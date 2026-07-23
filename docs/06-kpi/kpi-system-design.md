# MoldPilot KPI System Design v2

Owner: Harry · v1 2026-07-05 · v2 2026-07-06 (leader-first structure, referee tier, Design onboarding, no-allies adaptation)
Companion decisions: `docs/00-product/decision-log.md` (2026-07-05 — "Owner Is The Fixer, Not The Culprit").

## 1. What this system is for

1. Make good work visible (invisible work is why avoiding it is free today).
2. Build habits through small, frequent, winnable rewards — habits first, outcomes later.
3. Turn mistakes into process improvements instead of blame.
4. Give the CEO a referee role based on facts and fixed rules instead of mood.
5. Slowly dissolve the silo culture ("every group for itself") through shared rituals and handoff metrics — a system that pays dividends over time, not a script-flip.

Floor: even if motivation never moves, twelve months of honest operational data is a complete map of the company's real problems. Digitalization is the guaranteed return; culture change is the upside.

**KPI vs OKR (owner question, answered):** neither, pure. OKRs assume self-set ambitious goals — veterans sandbag those. Pure KPIs measure without inspiring. This system = a **habit scorecard** (binary, role-controlled, monthly) + **one improvement objective per department per quarter** (proposed by the leader, agreed in the monthly meeting, visible on the board). The quarterly objective layer is the slow-dividend engine: eight permanent workflow improvements per year.

## 2. Non-negotiable floor rules (apply to every user, prize-eligible or not)

1. **Owner = fixer, not culprit.** Claiming an issue is positive work. Fault lives only in category trends read at department level.
2. **Amnesty at launch.** Everything before day one is baseline; the first month is calibration, never referenced, never punished.
3. **No automatic discipline.** The system informs; humans decide.
4. **The CEO follows the same rules.** His approvals, overrides, and response times are logged and visible. Weekly meeting question: "what do you need from me to clear this?" — never public fault-finding.
5. **Honest data is protected — for everyone, including non-prize crew.** Nobody is ever penalized for a truthful reason, delay, or self-reported problem. This rule is what keeps the data real; break it once and the whole map goes dark.
6. **Every number is auditable** down to raw records. No black-box scores.

## 3. Who is in the system (v2 structure, ~32 people)

| Tier | Who | Treatment |
|---|---|---|
| **Award tier (7)** | Design leader · PM ×2 · PM assistant · Assembly leaders ×2 · Injection leader | Habit scorecard + prize pools below |
| **Referee tier (2)** | QC leader · Marketing leader | Fixed referee allowance tied to service bars; **never** in competitive pools — QC operates the verification gate and Marketing approves date changes; their neutrality must not be purchasable |
| **Crew (system users, no prizes yet)** | designers, assembly groups, injection operators, QC staff, marketing staff | Use the system; protected by all floor rules; their data completeness feeds their leader's bar. Tier-2 rewards designed after the leader phase proves out |
| **Outside the system for now** | CEO, EDM/machining, warehouse | CEO = referee-of-referees (see §7). EDM/machining and warehouse join with the ERP |

Phase-1 scope decision (owner): keep it narrow. One clear goal for leaders — "your group's workflow data is complete and on time" — no crew-level objectives yet. Leaders manage their groups their own way; the board judges outcomes. What softens this from becoming a pure whip: the department objective prize is spent **on the group** (below), honest-data protection covers the crew, and tier-2 is publicly promised once leaders prove the system.

## 4. What we measure

### Phase 1 — leader habit scorecard (monthly, binary per event, ≥85% = hit the bar)

A leader's bar covers **their group's** events — personally doing everything right is not enough; the group's data must be complete. Teaching the crew the system is the winning move.

| Leader | The bar covers (per applicable event) |
|---|---|
| PM ×2 + assistant | Missed/auto-missed trials resolved with reason ≤1 workday · returned dates re-dated ≤1 workday · results recorded ≤1 workday of trial · required issues filed on failed trials · process sheets complete |
| Injection leader | Trial dates confirmed with machine ≤1 workday · counter-proposals carry real reasons · process values entered for completed trials |
| Assembly leaders ×2 | Corrections acknowledged with estimated finish ≤1 workday · self-checks done before the next trial · estimated dates kept (est vs actual) |
| Design leader | Design-change revisions turned around ≤2 workdays of internal review request · drawings attached (DRAWING file) on design changes · design-attributed issues (DFM/mold-design types) claimed and resolved by the design group |
| Everyone's shared line | Department-inbox issues claimed ≤2 workdays · photos attached where a defect is claimed |

Fewer than 5 applicable events → "not enough data," counts as hitting the bar. PM workload asymmetry (one PM also runs EDM/machining outside the system): bars are rates, never raw counts.

### Referee service bars (QC leader, Marketing leader)

QC: measurement report ≤2 workdays of completed trial · verification verdicts recorded at the verifying trial. Marketing: date-change decisions ≤1 workday · client-feedback issues filed with part + description · intake shells complete. Marketing's commercial KPIs (orders, customers) live outside this system by design.

### Phase 2 — outcome metrics (after 3 healthy months)

Severity-weighted verified issue throughput (LOW 1 · MEDIUM 2 · HIGH 3 · CRITICAL 5, counted only after verification) · median fix time · first-time-verification pass rate · trials-to-approval per mold · on-time trial rate trends. Plus the tier-2 crew reward design.

## 5. Anti-gaming (unchanged from v1, summarized)

Verification gate (fake fixes fail physical reality) · severity weights (trivial farming pays nothing) · medians + minimum-volume rules · no cross-role comparison · full drilldown transparency · monthly 3-item audit ritual · self-dealing flag (creator=claimer surfaced) · repeat-pattern report · credit caps per project · recurrence after verified fix = process gap, not new credit · **prevention pays best**: an accepted workflow/checklist improvement counts as 3 HIGH fixes.

## 6. Monthly money — ¥5,000

| Pool | Amount | Rule |
|---|---|---|
| Leader habit pay | ¥400 × each leader who hits the bar (max 7 → ¥2,800) | Fixed per head, not split — predictable, "my 400". Not zero-sum: helping another leader never costs you |
| Referee allowance | ¥250 × 2 (QC leader, Marketing leader) when their service bar is met | Neutrality is paid, not punished |
| Department objective | ¥1,000 to the department with the best trend vs **its own** 3-month baseline | Spent on the group (meal/outing), handed over by its leader — the leader wins something FOR the crew; this seeds tier-2 goodwill |
| Best fix story | ¥500 | 3 nominees with photos in the monthly meeting; open discussion; CEO decides |
| Rollover pot | unclaimed amounts | Accumulates to a quarterly stretch bonus. Owner note: ¥2,000 in one envelope is "very very attractive" — the quarterly pot is exactly how a consistent leader reaches that number without raising the monthly budget |

If fewer than 3 leaders hit the bar in a month, habit pay still goes to those who did (they should never suffer for others), but the month is flagged as a system-design review, not a people problem.

**Rule-zero: no rules are announced until replayed against a real month of pilot data.** We simulate, see who would have won, and adjust until the result survives a skeptical veteran reading it aloud.

## 7. Launch playbook (adapted: no informal champions exist)

Owner's read: no extraordinary leadership on the floor; groups are silos; the CEO is obeyed, not necessarily loved. So the strategy leans on structure, not charisma:

1. **Baseline month** — snapshots accumulate, amnesty declared, nothing reviewed.
2. **Early months must be winnable.** Month one is designed so most leaders hit the bar and get paid. Paid leaders defend the system; unpaid leaders unite against it. The money recruits where no informal champion can.
3. **The weekly board walk is the anti-silo ritual.** ~25 minutes, all leaders in one room, one screen. The handoff metrics (Injection confirms PM's dates, Marketing approves Injection's changes, Assembly readiness gates PM's next trial) force the silos to look at each other's columns. It ends with the **Hot-3 vote**: the room votes last week's issues into a top-3 priority spotlight (ballot pre-sorted by severity/recurrence; Marketing and QC votes count ×2 as the customer's proxy; CEO override only with a logged written reason). Hot-3 issues must be claimed within the week or the leader assigns; solved+verified Hot-3 fixes earn double severity points, auto-nominate for the best-fix story, and feed the lessons pipeline (see lessons-library-design.md). This meeting — not any speech — is where "every group for itself" slowly erodes.
4. **CEO's role, agreed:** winners are decided mechanically by the data; the CEO may veto only with a written, logged reason. His five public commitments stand (same rules for himself · facts not moods · praise publicly, coach privately · every "what do you need" answered within a week · honest reasons never punished). For a boss who is obeyed but not loved, visibly submitting to his own rules is the fastest respect he can buy.
5. **Quarterly objective, phase 2 twist:** once the rhythm holds, one quarter's objective is deliberately cross-department (e.g., Design + Assembly cut correction loops on one mold family) — the first structural crack in the silo walls.
6. **Announcement** (CEO, bilingual): amnesty · owner = fixer, not culprit (负责人是解决问题的人，不是犯错的人) · honest data never punished · his own numbers on the board · leader phase first, crew rewards after the leaders prove it.

## 8. Management Reports (Admin/GM `/reports`)

The owner decision on 2026-07-14 supersedes the planned `/kpi` route/name. The management surface is called **Reports** because it combines operational workflow health with KPI scorecards; it is not only a score dashboard.

- **Overview** (`reports.management.view`, Admin/GM by default): completed mold-trial workload vs previous month · new molds reaching T0 · unique molds trialed · on-time trial rate with denominator · approvals · target-date/low-loop approval measures · open issues by age/severity · molds near/at/over limit · missing Trial Result/Process Sheet/QC records · date-handshake and missed-trial attention.
- **Issues** (`reports.management.view`): selected-month issue history and current backlog with severity, current status, fix owner, due/overdue state, fix summary, approximate fix time, closure, and verification. Owner means fixer, never culprit; category/process trends must not become individual blame counts.
- **Scorecards** (`kpi.scores.view_all` in addition to report access): reuse the existing leader/group bars, per-user scorecards, and audit drilldowns. Do not implement a second scoring engine.
- **Personal `/score`** remains for scored staff when `scoreboard_enabled` is on. Admin/GM are not scored and navigate to Reports instead of an empty My Score page.
- **Privacy:** Reports are internal and never expose country, customer contacts, email, phone, quote value, sales pipeline, or communication history.
- **Data shape:** Phase 1 uses live aggregates from operational records plus existing KpiSnapshots. No generic Report table or stored duplicate report rows.

Exact operational metric definitions are locked in `docs/00-product/decision-log.md` and `docs/02-schema/schema-v0.md`. Calendar boundaries use `Asia/Shanghai`. Call trial counts **mold-trial workload**, not factory utilization.

## 9. Build order (technical) — status updated 2026-07-14

1. ✅ **BUILT — KPI phase-1 data layer** (2026-07-07):
   - **Rule registry**: `KpiRule` table seeded with 13 rules; admin "Rules" tab edits deadlines in HOURS (owner decision: literal hours, weekends count — stated on the panel). Design rules seeded DORMANT until the Design role exists. Every change ActivityLogged with before/after. Mid-month changes re-score the whole current month (nightly recompute uses current rules; no per-month rule versioning yet — warning shown on panel).
   - **Scoring engine**: pure domain (`kpi-scoring.ts`) + event extraction from real records (`kpi-events.ts`). Implements the 85% bar, the <5-events floor, pending-excluded semantics, severity-weighted verified-only points (Hot-3 multiplier stubbed at 1 until the Hot-3 vote is built). Only scored roles get scorecards: PM, INJECTION, ASSEMBLY, QC, MARKETING (+DESIGN later); ADMIN/GM/VIEWER are never scored.
   - **Admin "Scores" tab**: month picker, per-user rows with full item-level audit drilldown (the auditability promise), boolean rules render pass/fail chips, timed rules show due/done timestamps.
   - **Personal `/score` page**: matches the monthly-scorecard example poster; gated by `SystemSetting scoreboard_enabled` (default OFF — quiet data gathering first; admin toggles from the Scores tab; admins always preview with a badge).
   - **Scripts**: `scripts/run-kpi-snapshot.mjs` (nightly persistence to `KpiSnapshot`, USER/DEPARTMENT_GROUP/COMPANY scopes — schedule via launchd at deployment) and `scripts/simulate-kpi-data.mjs` (6 weeks of MP-SIM- test data reproducing the poster personas; `--reset` idempotent).
   - Permissions: `kpi.rules.manage` (ADMIN), `kpi.scores.view_all` (ADMIN, GM).
2. ✅ **BUILT — DESIGN role onboarded 2026-07-08, design rules active**: DESIGN role + department group + users (lin, mei); design inbox mapping (DFM/mold-design issues owned by the design group surface in the Department inbox); "Design: revisions" `/me` section (design-change events awaiting a DRAWING, upload-clears-the-card); the two design rules (`design.change_revision` anchored on the event's createdAt → first DRAWING uploadedAt; `design.inbox_claim` = the design-scoped mirror of `all.inbox_claim`) flipped active and wired into the /me countdown chips.
3. ✅ **BUILT — KPI leader-designation layer (2026-07-11)**: the missing link between the scoring engine and the prize rules ("¥400 to each leader whose GROUP hits the bar"). `DepartmentGroup` gains `kpiLeaderId` (FK users, ON DELETE SET NULL). Owner decision: the `assembly` DEPARTMENT parent splits into two GROUP children — `assembly-a` (钟组, leader Zhong) + `assembly-b` (裴组, leader Pei) — so the two assembly leaders get SEPARATE bars; issue routing (`ownerGroup.code === "assembly"`) and the department inbox stay on the parent, untouched. Every scored user is assigned to exactly one KPI group via `departmentGroupId`. A pure `kpi-leader-bar.ts` (`aggregateGroupScorecard` + `leaderBoardEntries`) sums each group's member scorecards with the SAME 85% + <5-events floor applied to the AGGREGATE (a quiet group floats; a busy group's misses bite). PMs are award-tier individuals — the `pm` group carries no leader, so each PM's bar is their own scorecard. The admin Scores tab gains a "Leaders 组长达标" section above the per-user grid: 7 award rows (Design, PM ×2 + assistant, Assembly A/B, Injection) + a visually separated referee pair (QC ¥250, Marketing ¥250), each with the ¥400/¥250 caption on a hit and an expandable per-member breakdown (whose data is dragging). DEPARTMENT_GROUP snapshots now key on real DepartmentGroup ids (one row per leader group). Money captions read the `leaderHabitPrizeYuan`/`refereeAllowanceYuan` constants, not hardcoded strings.
4. ✅ **BUILT — `/reports` Management Reports (2026-07-14)**: bilingual read-only Overview + Issues over live operational records, with `Asia/Shanghai` month boundaries, locked workload/approval/issue/limit/completeness definitions, source-linked Management Attention, and deterministic current/previous-month pilot fixtures. Scorecards reuse the existing `computeMonthlyScores` service and `KpiScoresPanel` behind the additional `kpi.scores.view_all` gate; Reports has no scoring fork or configuration controls. `reports.management.view` defaults to Admin/GM, while personal `/score` remains for scored staff when enabled. No Report table or migration was added.
5. **Prize simulation script** (NOT yet built): replay pool rules on real months — required before any prize announcement (rule-zero in §6) and after any rule change.
6. **Hot-3 weekly vote** (backing the board-walk ritual) + lessons library per `lessons-library-design.md` — phase 2.

## 10. Verification depth, reward pricing, and rule governance (v2.1 owner Q&A, 2026-07-06)

**Two clocks on every fix:**
- Fast clock — verification at the next trial (QC verdict). Passing it pays within the month; rewards must land near the behavior.
- Slow clock — automatic recurrence watch: same issue type on the same mold within 90 days of a verified fix. Recurrence never claws back the original credit (clawbacks breed fear and kill honest data); instead it (a) links the new issue to the old with a mandatory why-didn't-it-hold root cause, (b) cancels the fix in the department trend, (c) updates the fixer's **durability rate** (fixes surviving 90 days ÷ verified fixes) — a phase-2 stat separating fixers from patchers. Iterating on a hard problem is normal; hiding recurrence is the offense. Same disease 3+ times = process gap → lessons meeting → checklist change.

**Reward pricing principle: no cash price on individual issues — ever.** Per-issue payments create an issue economy (manufactured problems). Issues earn severity-weighted, verified-only points; points compete for fixed budget-capped pools. Farming cannot grow the pot; it only trips the self-dealing flags.

**Judging is layered, narrowest last:** physics verifies (the part measures or it doesn't) → code counts (points, recurrence, flags — mechanical and auditable) → humans judge the residue (monthly meeting for disputes and root-cause quality; CEO veto only with written reason).

**Rule budget and sunset review (anti-bloat governor):**
- No role's habit scorecard may exceed 5 behaviors. Adding one means retiring or automating one.
- Every quarterly review must challenge at least one existing rule: keep / simplify / delete.
- Double-entry is the real slowdown killer: the week a team fills MoldPilot AND a legacy sheet, the legacy sheet is retired.

**AI's role: clerk and detective, never judge.**
- Clerk (build soon): weekly board summary, monthly lessons pack draft, audit-sample pre-pull, translation.
- Detective (build with care): "issue X resembles issue #123 — same root cause?", anomaly flags, rule-simplification suggestions. Human accepts or rejects.
- Judge (never): pay and blame decisions stay human. The judge's function here is partly social — someone who can be looked in the eye and argued with. An unappealable AI verdict becomes a resentment target and a gaming target at once. Physics verifies, code counts, AI drafts and flags, a human decides and owns it.

**Claiming escalation ladder (ruling, 2026-07-17):** claiming is the bonus behavior; assignment is the backbone. Do not design for volunteer-claiming from 70s/80s crew — pilot claim-actors are the 7 leaders; crew delegation stays verbal on the floor, and the system tracks the group's promise, not which hands.

- 0h — issue enters the department inbox group-owned. The creator never names a person (owner field removed from creation; blame-free entry).
- 0–24h — anyone may claim (我来处理). Voluntary, praised in the weekly meeting, group-framed.
- 24–48h — the group leader claims or assigns. This is normal management, not failure. The existing 48h `all.inbox_claim` rule already routes an unclaimed miss to the leader's bar, so this pressure requires zero new code.
- 48h+ — leader's miss, red on the GM report. GM assignment is last resort and every one is logged as a signal the ladder below broke; GM assigning >~30% of one team's issues in a month = a leader conversation, not more assigning.
- QC never assigns work — the referee cannot also be the prosecutor, or referee-bonus neutrality dies. No algorithmic auto-assignment ever — a machine naming a person reads as an accusation from a robot.
- Language physics: the claim button says 我来处理 ("I'll handle it"), not bare 认领; the UI shows 处理人 (handler), never 责任人 (responsible party). One is a job, the other is a verdict.
- Norm seeding: leaders deliberately claim the first ~10 issues in launch week (the first crab-eater must be a leader, by arrangement — see workbook Conversations 3 and 5).

## 11. Open items

- Workday/holiday calendar for "≤ N workday" math; CNY-month bar adjustments.
- Design leader's turnaround clock: define when the review-request timestamp starts (needs the Design workflow build).
- Tier-2 crew reward design — deliberately deferred; revisit after 3 leader months.
- GM/CEO do not participate in any pool (referee does not play).
