# Backlog — UI polish + feature reduction (2026-07-17)

> **Status 2026-07-17:** Bundles B, A, C, D SHIPPED (three Opus sessions, reviewed + browser-verified same day).
> Done: V1–V9, V10 (reports rows; trial-list sub-item skipped — no raw date in row model), R1, R2, R3, R5, R6, R7.
> Remaining: **Bundle E (R4 phone one-list)** — deliberately last, needs its own session and review.
> Not yet committed — the commit now covers all of this.

Source: live UI review (as admin, all pages) + reduction pass judged against the culture goal
(less blaming, more claiming, united team). Harry picks the order; one Opus prompt per bundle.

Effort: S = hours, M = a session, L = big session. No schema changes anywhere except R1 (one column nullable).

## Visual (V)

| # | Item | Effort | Notes |
|---|------|--------|-------|
| V1 | Dashboard numbers get semantic color — bad numbers on red/amber tinted cards, good green, zero gray | S | Reports "Open Critical" card already shows the pattern; copy it back. Pairs with R2. |
| V2 | Row urgency stripes — 4px left accent on trial-list rows + phone task cards (red = delayed/over-limit, amber = at-risk) + "overdue N days" text | S/M | The single biggest scanning win. |
| V3 | Dashboard hierarchy — collapse Create-Intake behind a "+ New intake" button; mold list above the fold | S | Intake is 2×/week; status checks are 30×/day. |
| V4 | Trial-table diet — 12 → ~7 columns, drop per-column sort chips, default sort by urgency | M | Same file as R3 (they are one job). Table currently truncates at full desktop width. |
| V5 | Button hierarchy + app shell — one primary per screen, others outline; slim brand top bar with active-page state | M | Fixes the floating nav-button cluster; adds color for free. |
| V6 | Project-detail status banner — workflow status as a colored strip in the header; severity chips on prior-issue rows | S | "In Correction" is currently invisible black text; severity (drives KPI weight) invisible entirely. |
| V7 | Quiet the noise — "Not set" → gray "—"; remove empty gray block in trial timeline | S | Bold "Not set" draws the eye to absence. |
| V8 | Calendar legend for entry colors (T0/T1/T2/Extra) | S | Only the load dots are explained today. |
| V9 | CJK font stack — "Segoe UI", "Microsoft YaHei", "PingFang SC" before Arial | S | Floor machines are Windows; default CJK fallback there is dated SimSun. |
| V10 | Desktop hour-countdown chips — reuse the phone deadline logic on trial list + reports attention rows | M | |

## Reduction (R)

| # | Item | Effort | Notes |
|---|------|--------|-------|
| R1 | Issue form: 6 required fields → 2 — title + optional photo; type/source/severity get defaults (QC adjusts severity at verification); owner defaults to department inbox (creator never names a person); due date auto from KPI rule hours | M | **The flagship.** Under-reporting is the pilot's #1 death risk; forced owner-naming contradicts the claiming design. Schema: ownerUserId already nullable — mostly form + action defaults. |
| R2 | Dashboard: 10 numbers → 4 — keep Delayed, High/critical open, This week's trials, Over limit; move Missing-QC count into Reports/QC context | S | A permanently-red number teaches everyone to ignore red. |
| R3 | Trial list column diet (with V4) — cut client ref, internal tracking id, part code duplication | M | |
| R4 | Phone one-list model — merge 11 section types into "Do now / Coming up", sorted by deadline, contextual buttons per card | L | Same data, same KPI events, fewer concepts. Biggest single job; schedule last or split. |
| R5 | Hide attachment visibility dropdown for non-PM/admin — auto-assign by file type (defaults already exist server-side) | S | One less IP decision a worker can get wrong. |
| R6 | Prune worker nav — Calendar visible only to PM/injection/marketing/admin | S | Assembly/design/QC agenda is their task list. |
| R7 | Claiming language — button 我来处理 / "I'll take this"; owner shown as 处理人 (handler), never 责任人; applies phone + desktop + posters | S | Ruling logged in kpi-system-design.md §10. Zero mechanics, pure words. |

## Explicitly NOT doing (rulings)

- No QC/algorithmic issue assignment — referee never prosecutes; escalation ladder is inbox → leader (48h rule already prices this) → GM last resort, logged.
- No assign-to-member button on the phone — crew delegation stays verbal; the system tracks the group's promise.
- No lessons library / Hot-3 / digest / /kpi dashboard before pilot month ends, even if the pilot goes well.
- Severity stays 4-tier in the data model (KPI weights need it) — it just stops being the reporter's required decision (R1).

## Suggested bundles (one Opus prompt each)

- **Bundle A — "the loud dashboard": V1 + V2 + V3 + R2** (one visual language for urgency, dashboard reads in one second)
- **Bundle B — "blame-free reporting": R1 + R7 + V6** (issue entry, wording, severity visibility — the culture bundle)
- **Bundle C — "the diet": V4 + R3 + R5 + R6 + V7 + V9** (removals and small polish, low risk, one sweep)
- **Bundle D — "app shell": V5 + V8 + V10** (navigation and orientation)
- **Bundle E — "one list": R4** (alone — biggest, riskiest, needs its own review)

Recommended order: B → A → C → D → E. B first because wording + form changes need zero retraining
and must be in place before ANY real user touches the issue form — first impressions of "reporting = accusation" are unrecoverable.
