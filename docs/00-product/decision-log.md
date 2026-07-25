# MoldPilot Phase 1 Decision Log

This file records product decisions that changed or clarified the original mold pilot vision.

Use this file when implementation details conflict across docs, prompts, or older code.

## Current Direction

Phase 1 remains a focused Mold Trial Tracker.

It is not a full ERP, full project control tower, customer portal, CRM, purchasing tracker, or department task board.

The live Phase 1 loop is:

```text
Marketing creates intake -> PM schedules T0 -> Trial happens or is missed
-> Record result/reason -> Track issues and correction readiness
-> Authorized scheduler sets next trial date -> Count trial against limit
-> Repeat until approved or closed
```

## Decisions

### 2026-07-25: Docker D1 Is A Parallel Runtime Foundation, Not A Production Cutover

MoldPilot needs a repeatable container runtime before the wider LJ_ERP platform
can own per-application deployment, storage, proxying, backup, and rollback.
That foundation must not silently replace the working native Mac mini path or
touch live data while container upload scanning is incomplete.

Decision:

- Build Next.js with standalone output and provide a pinned, multi-architecture
  Node 24 Debian-slim image that runs the application as a non-root user.
- Keep migration execution operator-controlled and separate from application
  startup. The production image never migrates, seeds, resets, or invokes local
  pilot setup.
- Expose unauthenticated, non-sensitive liveness and readiness endpoints.
  Readiness checks PostgreSQL plus writable upload/quarantine directories, but
  intentionally excludes ClamAV until D2.
- Prove D1 only against a uniquely named disposable Compose project and
  disposable PostgreSQL volume. Do not modify the parent LJ_ERP Compose file,
  live database, native launchd scripts, Caddy, backups, or rollback path.
- D1 is not approved for production cutover. The native Homebrew/launchd Mac
  mini deployment remains the accepted runtime and rollback path.

Reason:

Separating image/runtime proof from infrastructure cutover keeps a container
build from becoming an accidental production migration. D2 must add a
container-compatible malware-scanning service and persistent-storage tests
before platform integration can be evaluated safely.

### 2026-07-25: Session Cookie Security Follows The Actual Deployment Scheme

The current Mac mini pilot may temporarily run over plain HTTP on an isolated,
trusted factory LAN while managed HTTPS rollout remains the preferred target.
Production mode must not infer the cookie `Secure` flag from `NODE_ENV` alone,
because a Secure cookie cannot be returned over an HTTP connection.

Decision:

- `MOLDPILOT_SESSION_COOKIE_SECURE` supports `auto`, `true`, or `false`; missing
  or blank means `auto`.
- `auto` follows `MOLDPILOT_BASE_URL`: HTTPS uses Secure cookies and HTTP does
  not. Without a base URL, production fails safe to Secure cookies.
- Production launchers require `MOLDPILOT_DEPLOYMENT_MODE=production`, a valid
  HTTP/HTTPS base URL, and a cookie setting that matches its scheme.
- Temporary HTTP mode must print a prominent warning, bind only to the
  configured LAN address, and must never be internet-exposed. HTTPS behind the
  approved Caddy proxy remains the preferred deployment.
- Local pilot launchers refuse production deployment mode before migrations or
  seed execution.
- Reseeding may refresh seed-managed user profile/role data but must never
  reset an existing user's password hash, first-login state, password-update
  timestamp, or last-login timestamp.

Reason:

The production server was intentionally using HTTP while production cookies
were always marked Secure, which broke the forced-password-change session.
Separately, demo reseeding could overwrite real credentials. Configuration
must describe the connection users actually have, and seed operations must be
idempotent without becoming credential-reset operations.

### 2026-07-14: Manager-Facing Reports Replace Manager-Facing My Score

Management needs a monthly operational view of mold-trial workload, workflow health, issue resolution, trial-limit pressure, and team habit trends. The planned GM/Admin KPI dashboard is therefore presented as **Reports** rather than sending non-scored manager accounts to a personal **My Score** page.

Decision:

- Add a top-level `/reports` management view with `Overview`, `Issues`, and `Scorecards` tabs.
- Admin and GM receive `reports.management.view` by default. Every report query and route must enforce that permission server-side.
- Admin/GM navigation shows `Reports`. Scored staff keep `My Score` when the staff scoreboard is enabled. `/score` remains the personal staff scorecard and is not replaced globally.
- The `Scorecards` tab reuses the existing KPI scoring service and scorecard UI. It does not create a second scoring engine. Viewing every individual's score still requires `kpi.scores.view_all`.
- Reports are an internal management tool. They must not expose customer country, contacts, email, phone, quote value, sales pipeline, or other CRM data.
- Operational report metrics describe process and workload, not personal blame. A TrialIssue owner remains the fixer, not the person who caused the issue. Cause trends are grouped by issue type, reason, process, or department, never by individual culprit counts.
- Phase 1 calculates reports from existing operational records and KPI snapshots. Do not add a generic Report table or stored duplicate report rows unless measured performance later requires it.

Locked metric definitions:

- **Completed trial runs:** actual TrialEvents completed during the selected calendar month. This measures mold-trial workload; planned trials are not counted as completed workload.
- **New molds reaching T0:** projects whose first actual completed trial is T0 during the selected month.
- **Unique molds trialed:** distinct mold projects represented by completed trial runs during the selected month.
- **Month comparison:** show the selected month's absolute value and change from the immediately previous calendar month. Use the `Asia/Shanghai` business timezone and half-open month boundaries.
- **Critical issues:** TrialIssues with Critical severity whose current status is neither Closed nor Verified.
- **Finished early - target measure:** projects first approved during the selected month on or before their customer target date. Projects without a customer target date are excluded from the eligible denominator and shown as missing-target data, not treated as failures.
- **Finished early - low-loop measure:** projects first approved during the selected month within their first two counted completed trials, corresponding to T0 or T1.
- **Over-limit molds:** active/non-terminal mold projects whose counted completed-trial total is greater than `currentTrialLimit`. Approved, Cancelled, and Closed projects are not current over-limit attention items.
- **On-time trial rate:** among non-cancelled/non-skipped trial stages due in the selected month up to the report's as-of date, the share completed on or before their planned date. Delayed or missed due trials remain in the denominator.
- **Issue reporting:** issues created and closed are counted by their own timestamps. Current open backlog and aging are explicitly labeled as current-state measures; Phase 1 does not pretend to reconstruct historical month-end issue status from today's row state.
- **Factory activity wording:** use `Mold-trial workload`, not `Factory utilization`, because MoldPilot does not track normal production capacity.

The Overview also shows planned trials for the next 30 days, approvals, near/at/over-limit counts, missed trials, missing trial/process/QC records, and a Management Attention list. The Issues tab shows severity, status, fix owner, due/overdue state, fix summary, approximate fix time, close/verification details, and filters. Open issues show that no resolution exists yet instead of requiring a false resolution.

Reason:

- Admin, GM, and Viewer are intentionally not scored, so `My Score` is the wrong manager destination.
- Management needs an operational picture before opening individual scorecard audits.
- Keeping operational reports and personal scorecards distinct avoids turning ordinary workload or issue counts into automatic employee judgment.

### 2026-07-07: KPI Phase-1 Implementation Decisions (Rules Panel + Scoreboard)

Locked while building the KPI data layer (see `docs/06-kpi/kpi-system-design.md` §9 for what shipped):

- **Deadlines are configured in literal HOURS** (admin Rules tab, range 1–336). Weekends and holidays count; "24h" means 24 clock hours, not one workday. Revisit with a rest-day pause option only if the pilot shows weekend unfairness.
- **Mid-month rule changes re-score the entire current month.** The nightly recompute always uses current rule values; there is no per-month rule versioning yet. The Rules panel states this warning; every change is ActivityLogged with before/after.
- **The staff scoreboard launches OFF.** `scoreboard_enabled` defaults to false for ~2 months of quiet baseline gathering; admins always preview `/score` with a visible badge; the toggle lives in the admin Scores tab and is logged.
- **Scored roles only**: PM, Injection, Assembly, QC, Marketing (Design when the role exists). ADMIN, GM, and VIEWER are never scored — the referee-of-referees does not play, and system accounts must not pollute scorecards.
- **No cash price on individual issues** (reaffirmed in implementation): points are severity-weighted and verified-only; the Hot-3 double-points multiplier is stubbed at 1 until the weekly Hot-3 vote ships.
- **Design KPI rules are seeded dormant** (`design.change_revision`, `design.inbox_claim`) and activate with the Design role onboarding (prompt 08).
- Event extraction prefers **excluding an event over guessing a timestamp** — undercounting is safe under the <5-events floor; guessing corrupts fairness.

### 2026-07-05: KPI Design Principles — Owner Is The Fixer, Not The Culprit

Core principle for the future KPI system (owner decision, recorded before any KPI implementation):

- The issue owner is the person responsible for FIXING the problem, never a fault attribution. Claiming an issue from the Department Inbox is positive work, not a confession.
- Individual metrics reward claiming and resolving: issues resolved, fix time, verification pass rate. A person who claims and closes many issues is a top performer.
- Fault/cause data lives ONLY at the category level (missed-trial reason categories, issue types, responsible areas) and is read as DEPARTMENT/PROCESS trends for management, never as personal blame counts.
- Rationale: any metric that punishes the fixer teaches people to hide problems, which poisons the honest data the entire tracker exists to collect.

Open questions the KPI design must answer before launch (owner's requirements):

1. Fairness / anti-gaming: how do we prevent metric gaming — claiming trivial issues to farm counts, splitting one issue into many, closing without a real fix?
2. Anti-manufactured mistakes: how do we prevent someone intentionally creating (or causing) an issue in order to claim and "heroically" fix it?
3. Mistakes must become process: how do we ensure closed issues feed back into workflow/checklist improvements so the same mistake cannot recur — so the system gets smarter, not just busier?

Candidate mechanisms already in the data model to build on (not yet designed as KPI rules):

- Verification gate: an issue only counts as truly done when VERIFIED at a later trial (`verifiedAtTrialEventId`) — fake fixes fail verification, which naturally punishes close-without-fix gaming.
- Severity weighting: LOW/MEDIUM/HIGH/CRITICAL already recorded; trivial claims can be worth proportionally little.
- Self-dealing flag: issues where creator == reporter == claimer can be surfaced for review in KPI reports (detects manufactured-mistake farming without forbidding legitimate self-reporting).
- Recurrence tracking: same issueType recurring on the same mold/customer signals a process gap, not an individual failure — feeds a periodic lessons review with `rootCause`/`correctiveAction` fields.
- Human final judgment: KPI reports inform managers; no automatic scoring/discipline (Phase 1 non-scope already excludes automatic discipline). Transparency — everyone sees the same numbers — is itself the anti-cheat: peers audit what managers miss.

Pilot quick-start must state in both languages: "The issue owner is the fixer, not the culprit / 负责人是解决问题的人，不是犯错的人."

### 2026-07-03: Phase 1 UI Supports English And Simplified Chinese

MoldPilot Phase 1 supports switching the normal pilot interface between English (`en`) and Simplified Chinese (`zh-CN`).

Decision:

- English remains the default language.
- The selected language is remembered locally with a cookie/local storage.
- Interface text, labels, buttons, tabs, headings, status labels, enum display labels, empty states, and normal pilot workflow messages should be translated.
- MoldPilot does not translate user-entered business records such as mold codes, customer/client names, part codes, issue titles, notes, machine brands, uploaded files, exported business data, or historical ActivityLog payload values.
- Stored enum values, permission codes, role codes, and database records remain unchanged. Only display labels translate.

Reason:

- The pilot team needs both English and Chinese operators to use the same local app without separate URLs or duplicate records.
- Translating business-entered data would create audit ambiguity and is outside Phase 1 scope.

Impact:

- Add a lightweight centralized i18n layer instead of scattered bilingual conditionals.
- Add a visible language switcher in normal app headers and login.
- Future UI text should use translation keys when it is user-facing interface copy.

### 2026-07-03: Failed Trials Require Same-Trial Issues Before Moving Forward

If an actual trial result is Conditional, Not Approved / Rework Required, Pending QC, Pending Customer Feedback, Invalid Trial, or otherwise not clearly approved, MoldPilot must require at least one TrialIssue linked to that same TrialEvent before the result can be saved or the workflow can move forward to the next planned trial.

Reason:

- Project-level open issue counts can drift and let a failed T1 pass because T0 still has an unrelated issue.
- TrialIssue is the accountability record for who owns follow-up and by when.
- Requiring the issue under the same trial keeps the T0/T1/T2 panel history auditable and avoids hidden approval gaps.

Impact:

- Add Trial Issue requires an owner user and due date.
- Affected part stays optional.
- Outcome note and new-trial reason remain useful context, but they do not replace the same-trial issue requirement for non-approved actual results.
- Approved trial results can still be saved and moved forward without issues.

### 2026-06-29: Start With Mold Trial Tracker

The MVP was narrowed from a broad mold pilot/ERP vision to a mold trial tracker.

Reason:

- The team can adopt one control habit first.
- Planned trial dates, missed-trial reasons, open issues, and trial-limit pressure create immediate value.
- Wider ERP modules can grow from real trial data later.

Impact:

- Full project timeline, purchasing, customer portal, customer query workflow, full readiness checklist, and department task board are later roadmap items.

### 2026-06-29: Marketing/Sales Creates Intake, PM Owns Scheduling

Marketing/Sales is the real-world starting point, so Marketing/Sales may create a sanitized project intake shell before T0 is known.

Planning PM owns the first T0 schedule and final schedule cleanliness.

Impact:

- Intake projects can exist without first planned trial date.
- Core tables still use customer code only.
- Customer names, contacts, emails, phones, quote values, and sales pipeline fields stay outside Phase 1 core tables.

2026-07-01 update:

The Customer Master decision below supersedes the strict "customer code only" assumption for lookup data. MoldTrialProject still stores only a Customer reference and customer-code snapshot, while customer display names live in the Admin-managed Customer Master and authorized lookup/display surfaces. Customer contacts, emails, phones, quote values, sales pipeline fields, portals, and communication history remain outside Phase 1.

### 2026-06-29: Trial Limit Rules

Default completed trial limit is 3.

Design-change rule:

- Design change before the first completed counted trial does not add trial allowance.
- Design change after at least one completed counted trial may add one approved extra trial.

Earlier assumption: Planning PM may set a custom difficult-tool limit with visible reason. This is superseded by the 2026-07-01 update below for normal Phase 1 UI.

Impact:

- Trial limit is a control signal, not a punishment workflow.
- Design-change extra allowance and extra-trial reasons must create audit/activity records.

2026-07-01 update:

The normal Mold Trial Detail UI should no longer expose a standalone "Set PM Custom Limit" control. The default working model is three completed trials, shown as T0/T1/T2 panels. If more trials are needed, extra trial panels are added sequentially only after the earlier trial panels are completed, and each extra trial requires a visible reason such as design change, unresolved correction verification, customer feedback, QC failure, invalid/aborted trial, or another documented PM reason.

Impact:

- Trial-limit discipline remains visible through compact count badges and near/at/over-limit states.
- Design-change extra-trial approvals and other extra-trial reasons stay auditable.
- Existing trial-limit adjustment history remains useful for audit/admin correction, but the pilot workflow should not ask PM to set an arbitrary custom limit during normal use.
- The user-facing detail screen should guide the team through trial panels and issue verification instead of a separate trial-limit management panel.

2026-07-01 update 2:

The Mold Trial Detail page should also remove separate page-level "Record Missed Trial" and "Add Design Change" panels/actions from normal use.

Decision:

- If a planned trial has no result by 12:00 PM on the next calendar day in the app business timezone, the system marks it `Auto Missed - Reason Required`.
- `Auto Missed - Reason Required` is not a final business explanation. It is a prompt to resolve the missing record.
- The user resolves the auto-missed trial from that trial panel by either entering the missed-trial reason/new planned date, marking blocked/paused with explanation, or recording a late completed trial if the trial actually happened.
- Late completed trial entry must keep an audit trail that the auto-missed status was corrected by late entry.
- "Record Completed Trial" and "Add Trial Issue" live inside each T0/T1/T2/extra trial panel.
- Standalone "Add Design Change" is removed from normal detail UI. Design change becomes a reason option when planning an extra trial or customer-driven follow-up; if selected, the user enters notes and customer/internal source. The backend may still create DesignChangeEvent/TrialLimitAdjustment records to preserve audit/reporting.

Impact:

- The normal detail page becomes trial-panel-first with fewer top-level actions.
- Missed-trial control remains measurable without asking users to manually open a separate missed-trial panel.
- Design changes stay auditable but no longer need a separate visible workflow in Phase 1.

2026-07-02 update:

The Record Result panel should be simpler than the issue workflow. The trial-level result records what happened in the trial; issue-level records own who follows up and by when.

Decision:

- Remove `Outcome disposition` from the visible Record Result workflow.
- Use one clearer Result field instead, with options that cover the needed business direction: Approved, Conditional, Not Approved / Rework Required, Pending QC, Pending Customer Feedback, and Invalid Trial.
- Keep `Outcome note` for now as a short optional trial-level note.
- Remove Follow-up Owner and Follow-up Due Date from Record Result. Follow-up ownership belongs on TrialIssue rows because one trial can create multiple issues with different owners and due dates.
- Remove Legacy Machine Note and Material from Record Result. Machine uses Injection Machine Master; material belongs in the Digital Process Sheet.
- Add Trial Issue should be wider and focused on: Title, optional Affected Part, Issue Type, Source, Severity, Status, Owner, Due Date, and Description.
- Hide Source Detail, Responsibility Area, root cause, corrective action, verification fields, Assembly acknowledgement/self-check fields, PM readiness fields, and Closed Date from the simple Add Trial Issue create form. Those can remain available later in lifecycle-specific edit/verification flows.
- Affected Part stays available but optional, especially for multi-part/family molds.

Impact:

- Trial result entry becomes fast enough for PM/Injection to use during a real trial.
- Trial issues become the source of truth for follow-up accountability.
- The UI no longer asks users to classify the same trial outcome twice.

2026-07-02 update 2:

The Trial Issue workflow should live inside the trial panel where the issue was introduced. Phase 1 does not need a large global "Update Issue" panel with every lifecycle field visible.

Decision:

- Remove the large global Update Issue panel from the normal Mold Trial Detail view.
- Each trial panel shows the issues found in that trial as a compact table.
- Each issue row has `Edit` and `Close Issue` actions.
- Edit opens a modal/popup for the simple issue fields: Title, optional Affected Part, Issue Type, Source, Severity, Status, Owner, Due Date, and Description.
- Close Issue opens a focused modal with Fix Summary, Approximate Time Spent, Closed Date defaulting to today, and Submit.
- Issue owner may close their own issue.
- PM and GM may close any issue because they oversee the project.
- If someone other than the issue owner closes the issue, the close modal must require a short override reason explaining why the owner did not close it.
- Closure stores who closed the issue, when it was closed, how it was fixed, approximate time spent, and override reason when applicable.
- Root cause, corrective action, verification method/result, Assembly acknowledgement/self-check, PM readiness, and closed-date fields should not appear in the normal issue table/create/edit flow. Advanced quality workflows can revisit them later.
- The Add Trial Issue panel should take the full available trial-panel width instead of only half the display.
- Once an issue is closed, Edit and Close Issue are disabled/gray for normal users. Close Issue may show as `Closed`.
- GM can still edit a closed issue through an explicit GM override path. GM closed-issue edits must create ActivityLog history.

New planned trial form rule:

- Design change source defaults to `No / None`.
- Design change source/date/title fields are hidden or disabled unless the selected new-trial reason is design-change related.
- Design change title is optional and should not block adding a new planned trial unless a later customer/design-change workflow explicitly requires it.
- Reason detail is optional. The minimum required fields for a new planned trial are planned date, reason category, requester, and source area.

Impact:

- Trial issues become faster to create, edit, and close during the pilot.
- Closure produces useful later analytics on fix method and time spent without forcing a full quality-management workflow too early.
- PM/GM override closures remain auditable.

### 2026-06-29: Rescheduling Permission Clarified

Only PM, Injection, and Admin should be able to reschedule trials by default.

Default roles with `trial.schedule.reschedule`:

- PM
- Injection
- Admin

Default roles without reschedule permission:

- Marketing
- QC
- Assembly
- Viewer
- GM, unless explicitly granted by Admin later

Impact:

- Marketing reports customer-driven reasons through intake notes, design-change/customer-feedback reason notes, or client-feedback issues.
- QC can record QC issues/verification and suggest follow-up, but does not schedule trials by default.
- Scheduling actions still require date, reason, requester, source area, and activity log.

2026-07-01 update:

The real pilot role model simplified Planning PM, Technical PM, and PM Assistant into one `PM` role. The default reschedule rule is now PM, Injection, and Admin only.

### 2026-07-02: Digital Process Sheet And Injection Machine Master

The mold trial report should move online in stages so PM does not record the same trial data on paper and then again in MoldPilot.

Decision:

- Add an Admin-managed Injection Machine Master seeded from `RAW/Injection-Machines-2026.07.02.xls`.
- Trial process entry should select an active machine instead of free-typing machine text.
- Machine selector search should match numeric machine No. and clamping force.
- Add a Digital Process Sheet inside each Trial Panel.
- Store process parameters as structured rows/values so MoldPilot can show horizontal trial comparison columns like T0/T1/T2/T3.
- The initial process-sheet template can mirror the process-parameter sections of `RAW/PROCESS SET UP SHEET.xlsx`: material, machine, barrel settings, velocity profile, hold pressure, other settings, tool data, hot runner, and six-shot weights. The source workbook's Trial Summary section is superseded by the 2026-07-03 update below and should not be editable process-sheet rows.
- Customer Master may point to a fixed default report/process-sheet template. Project creation should snapshot the selected customer's default template so later customer-template edits do not rewrite historical project reports.
- Do not build a drag-and-drop report designer in Phase 1.
- Process Sheet PDF export should produce a customer-safe PDF for Marketing to send with measurement reports.
- Internal issue accountability and customer-facing PDF content must be separated.

2026-07-02 update:

- Digital Process Sheet entry should feel like a lightweight spreadsheet, not a normal web form that submits unexpectedly.
- Pressing Enter inside an editable process value should move to the next editable field in the current trial column. Shift+Enter should move to the previous editable field. Enter must not submit the whole sheet.
- The panel should show the current editable trial, such as `Editing: T1`, and show an unsaved-change count while PM/Injection is entering values.
- Saving should give visible feedback inside the Digital Process Sheet panel, including saved state, timestamp, and changed/saved field count. After save, the user should remain at or return to the process-sheet panel instead of losing context.
- Add a `Copy Previous Trial` action for the current editable trial. It should copy the immediate previous trial's machine selection and process parameter values into blank current fields by default.
- If the current trial already has values, overwriting them requires an explicit confirmation path. Copying previous values should not silently replace current entries.
- Copy Previous Trial does not copy trial result, issue records, major issue summary, correction summary, next action, Assembly self-check, or any accountability fields.
- Saving or copying process-sheet values must not auto-create the next trial. Trial creation remains a trial-panel workflow action with date/reason requirements.
- Avoid autosave in Phase 1; keep the explicit Save action so PM knows when a trial sheet was committed.

Issue/checklist rule:

- Trial issues become correction checklist items before the next trial.
- Assembly self-check means Assembly says the correction was completed and checked before loading the tool for the next trial.
- Assembly self-check does not close the issue.
- PM readiness confirmation and next-trial/QC verification remain separate accountability steps.

Impact:

- MoldPilot becomes the source of truth for trial report data instead of duplicating paper entry.
- Customer-facing export becomes a report view generated from TrialEvent, TrialIssue, and process-sheet values.
- The MVP remains trial-report support, not a full document-template designer, measurement-report module, customer portal, or full QC system.

2026-07-03 update:

Digital Process Sheet should no longer show or ask users to edit a `Trial Summary` section.

Decision:

- Digital Process Sheet entry should focus on process setup parameters only.
- Trial result, main issue summary, outcome note, and next action live in the Trial Result panel and TrialIssue records.
- Customer-safe PDF export may still include a generated summary, but it must be assembled from TrialEvent and TrialIssue data instead of separate editable process-sheet summary rows.
- New process-sheet templates and seeds should not create Trial Summary rows such as Trial Result, Major Issues, Correction Summary, Next Action, or Internal Private Note.
- Existing saved values for legacy summary rows should not be destructively deleted; hide them from normal UI/export or ignore them during template cleanup.

Trial Issue rows should visually differentiate status.

Decision:

- Open, In Progress, Waiting Internal, Waiting Customer, Waiting Supplier, and Waiting Verification issue rows should use a subtle warning/yellow treatment.
- Closed issue rows should use a subtle success/green treatment.
- The text status/chip remains visible so the UI does not rely on color alone.

Impact:

- PM does not enter trial summary data twice.
- Digital Process Sheet remains a process-parameter comparison tool.
- Trial Issues become easier to scan during a real pilot run.

2026-07-02 update:

The Injection Machine Admin panel should stay much simpler than the first implementation.

Decision:

- The Admin Machines table should use only these normal visible fields: `No.`, `Clamping Force`, `Brand`, and `Shot Weight`.
- `No.` is the machine number from the real machine list. It must be numeric only, with no `#`, letters, or generated labels such as `MACHINE-01`.
- The Machines table should sort by numeric `No.` ascending, such as 1 through 26, not string order.
- Normal row actions are `Save` and `Delete`.
- Model, display name, nozzle/orifice, notes, active/archive status, and other workbook technical columns should not clutter the normal Admin Machines panel.
- Historical trial snapshots must remain stable if a machine is deleted or hidden.

Impact:

- The first implementation's broader equipment-master fields are too much for Phase 1.
- Coder should patch the machine seed/import, Admin UI, server validation, machine selector labels, tests, and docs to use the simplified machine master.

### 2026-07-02: Pilot Run Fixes For Intake, Trial Labels, And Client Privacy

User pilot testing found that the Digital Process Sheet worked on seeded demo projects but not on newly created intake projects, and that delayed/replanned trial events could show as `T0 #1`, `T0 #2`, `T1 #3`.

Decision:

- Every new MoldTrialProject must snapshot the selected customer's default process-sheet template, or the global default template, during creation. The Digital Process Sheet is not seed-only.
- Visible trial stages must be canonical and sequential: `T0`, `T1`, `T2`, `T3`, etc. Do not display internal sequence suffixes like `#1`, `#2`, or `#3` in normal user-facing labels.
- A missed/delayed `T0` that is replanned remains the `T0` panel with updated planned-date history. It must not create a second visible T0 panel and must not allow the project to jump to `T1` before T0 is actually completed or intentionally closed/skipped with an explicit rule.
- The example `RAW/PROCESS SET UP SHEET.xlsx` contains trial columns that appear to jump from T1 to T3, but MoldPilot should not copy that mistake. MoldPilot uses its own strict sequence.
- Customer country should not appear in project intake lookup, Admin Clients, exports, or normal Customer Master screens. Country is not needed for the Phase 1 workflow and creates unnecessary customer-identification risk if information leaks.
- Injection Machine Master must be seeded/imported from `RAW/Injection-Machines-2026.07.02.xls` for the real pilot. A tiny hardcoded starter list is not acceptable as the final local pilot data set.

Impact:

- Newly created real projects should immediately show the Digital Process Sheet once a trial exists.
- Trial event implementation may still keep internal IDs/history, but the workflow panels and process-sheet comparison must group/display by trial stage.
- Coder prompts should treat the current seed-only template behavior, duplicate T0 display, T1 jump, country display/search, and tiny machine seed as patch blockers before the next milestone.

### 2026-06-29: Admin-Managed Permissions

Hardcoded role rules are not enough because the real organization will clarify responsibilities over time.

Phase 1 should add an Admin-only permission foundation:

- Admin can create/edit internal users.
- Admin can create/edit roles.
- Admin can assign permissions to roles by process.
- Admin can optionally override permissions for an individual user.
- Permission changes must affect server-side authorization, not only UI visibility.

Preferred admin views:

- By role: choose a role and check allowed actions.
- By process: choose a workflow step and check which roles/users can edit.

Impact:

- The system can adapt without rewriting code for every role change.
- Business validation remains separate from permission checks.
- Even a permitted user cannot bypass required reasons, closure fields, trial-limit rules, or customer privacy rules.

### 2026-06-30: Admin Permission Management Prefers Process x Role Matrix

The preferred Admin permission-management UI is now a spreadsheet-like process x role matrix.

Reason:

- Admin needs to review each workflow step across all roles at once.
- A role-by-role editor makes it too easy to miss inconsistent permissions across departments.
- The matrix better matches the source-of-truth permissions matrix and pilot review conversations.

Impact:

- `/admin` should show a Role Permission Matrix grouped by process.
- Active roles appear as columns, with Admin visible and protected.
- Each permission/role intersection is a checkbox saved through server-side authorization.
- Role create/edit/deactivate remains supporting Admin tooling.
- The lockout guard still prevents removing the last active account path with both `admin.manage_users` and `admin.manage_roles`.

### 2026-06-30: Admin Users And Roles Should Be Separate Tabs

Admin account setup and role/permission setup are distinct jobs, so `/admin` should split them into clear panels or tabs.

Preferred tabs:

- Users: create/edit internal accounts, assign roles, reset passwords, archive users, and restore archived users.
- Roles & Permissions: create/edit/delete roles and manage the process x role permission matrix.

User archive rule:

- Admin should not edit a raw status dropdown in normal user setup.
- Active users and archived users should be shown in separate tables.
- Archive user sets `User.status = INACTIVE`.
- Restore user sets `User.status = ACTIVE`.
- Archived users cannot log in and should not appear as active selectable users in new workflow assignments.
- Archived users remain visible in historical records, ActivityLog, issues, and projects by display name.
- Archiving or restoring users must be server-authorized, must create ActivityLog records, and must not break the last active Admin path.

Role removal rule:

- Admin role is protected and cannot be deleted, deactivated, or removed from the active matrix.
- A role can be hard-deleted only when it has no assigned users and no history that needs to be preserved.
- If a role has users or meaningful history, the UI may expose this as "Delete", but the safe system behavior should be deactivate/archive so the role disappears from the active matrix without breaking audit history.
- Deleting or deactivating a role must be server-authorized and must create ActivityLog records.

Impact:

- Admin setup becomes easier to understand.
- Removing roles from the active matrix is supported without forcing risky database deletion.
- Coder prompts should not mix user-creation forms into the role permission matrix.

2026-07-01 update:

User account setup no longer asks Admin to assign department groups. Role is the permission and account classification source for Phase 1 users. DepartmentGroup remains available as TrialIssue owner group / responsibility area so issues can be routed to Assembly, QC, Injection, Marketing, PM, or other internal areas without duplicating user identity fields.

### 2026-07-01: Real Login MVP With Minimal Pilot Roles

The pilot should move from the local current-user selector to a real username/password login before deployment.

Reason:

- The pilot now has a real employee list and should test actual accountability.
- The current role set is too granular for easy management.
- The team wants the minimum useful roles and Admin-tuned permissions instead of many PM subroles.

Current pilot roles:

- Admin
- GM
- PM
- Marketing
- Assembly
- Injection
- QC
- Viewer

PM replaces the earlier Planning PM, Technical PM, and PM Assistant split for the real pilot seed. PM should receive the combined Phase 1 PM permissions by default, including T0 scheduling, rescheduling, trial issue root-cause/corrective-action fields, design-change reporting, eligible extra-trial approval, and documented extra-trial reasons.

Seeded pilot users:

| Role | Users |
| --- | --- |
| Admin | admin |
| GM | Xie |
| PM | Bill, Jun, Cheng |
| Marketing | Yvonne, Anna, Zoe, Peng, Juria, Sahara |
| Assembly | Zhong, Pei |
| Injection | Wang |
| QC | Gong, Shuang |
| Viewer | Viewer |

Password rule:

- For local testing, seeded employee accounts may start with password `123456`.
- The default Admin may start with username `admin` and password `admin` for initial setup.
- Passwords must be stored as hashes, never plaintext.
- Seeded employee users must be forced to change password after first login before using normal app pages.
- The default Admin is not forced through first-login password change in the local pilot so initial setup and troubleshooting are not blocked.
- Admin can reset a user's temporary password.
- Users can change their own username/password after login.

Impact:

- The current-user selector becomes dev-only or is removed from normal pilot UI.
- Acceptance tests should use real login flows.
- Seed scripts should recreate the real pilot roles and users safely.
- Before any real deployment, no seeded/default password may remain unchanged; the local default Admin password must be changed or disabled.

### 2026-07-01: One Mold Project Can Contain Multiple Part/Cavity Records

Some real mold projects are family molds or multi-cavity tools, so a single project/mold may include more than one part code or cavity reference.

Decision:

- Keep one `MoldTrialProject` as the mold-level trial-control record.
- Add child `MoldTrialPart` records under the project for one or more part codes, cavity labels, cavity counts, and notes.
- Treat the existing project-level `part_code` as a temporary primary/display/migration field, not the long-term source of truth for all parts.
- Let `TrialIssue` optionally reference one affected `MoldTrialPart` and/or a freeform cavity note.
- Keep trial events and trial-limit counting mold-level for Phase 1.

Reason:

- The trial loop is still controlled at the mold/project level.
- Issues often need to identify which part or cavity has a defect.
- Comma-separated part codes would block later reporting and issue tracing.
- A full cavity-level QC/BOM system is still too large for Phase 1.

Impact:

- Project intake should allow one or more part/cavity rows.
- Project list and dashboard should show a primary part code plus a count, such as `P-014-A +2`.
- Project detail should include a Parts / Cavities section.
- Trial issue forms should include an optional affected part/cavity selector.
- Future Coder prompts should not create separate MoldTrialProjects for each part inside the same mold unless the tool is truly tracked as a separate mold.

### 2026-07-01: Admin Customer Master For Project Intake

Project creation should not depend on users typing customer codes manually.

Decision:

- Add a small Admin-managed Customer Master for Phase 1.
- Customer Master contains customer code, display name, abbreviation/short name, optional aliases/search keywords, active/archived state, and internal notes.
- Project intake must select an active customer from searchable lookup instead of accepting free-typed customer text.
- The lookup should match customer code, abbreviation/short name, display name, and aliases.
- `MoldTrialProject` should reference the selected Customer and keep a `customer_code` snapshot for stable historical display/reporting.
- Keep CRM fields out of Phase 1: no contact person, customer email, customer phone, quote value, sales stage, customer portal, or communication history.

Reason:

- Admin-controlled customer records prevent duplicate spellings, inconsistent abbreviations, and invalid customer codes.
- Project creation becomes faster for Marketing and PM while still keeping MoldPilot focused on trial tracking.
- A Customer Master is support data, not a CRM module.

Impact:

- `/admin` should include a customer/client management tab alongside Users and Roles & Permissions. The UI label is now preferably Clients.
- Admin can create/edit/archive customers.
- PM and Marketing can search/select active customers during intake/project creation.
- Archived customers cannot be selected for new projects, but historical projects keep the customer code snapshot and customer reference.
- Normal project/trial tables should continue to show customer code by default; customer display name can appear in Admin customer management and authorized customer selectors.

2026-07-01 update:

The Admin customer tab should be presented as a compact Clients table matching the real workbook `RAW/Clients-info.xlsx`, not as a broad CRM-style form. Use English UI column labels first:

- No.
- Client Code
- Client Short Name
- Country
- Owner
- Notes / Deal Year
- Actions

Client owner must be assigned from current active users, not roles. The workbook owner names map to active Marketing users:

- 刘婉霞 = Anna
- 周娟娥 = Zoe
- 彭利满 = Peng

User accounts should support both English and Chinese names. Keep English/current app display names and role names in English for now, and add a Chinese name field for matching owner data and future bilingual display.

### 2026-07-01: Intake Identifier Rules Clarified

Marketing intake can start before every working identifier is known.

Decision:

- Project Code / Client Ref is optional during intake.
- `MoldTrialProject.project_code` remains the internal unique tracking code used for routing and stable records.
- User-facing client/project reference is stored separately as optional Client Project Ref.
- Mold Code may be blank only while the project is Intake/Draft.
- Mold Code is required before PM can set first T0, schedule or reschedule trials, record missed/completed trials, or create/update trial issues.
- Once Mold Code exists, lists and detail pages should use Mold Code as the primary working identifier and show optional Client Project Ref second.
- If both Client Project Ref and Mold Code are blank during intake, the system generates an internal tracking code so the record is still reachable.

Reason:

Early Marketing/Sales intake often has customer, part, and request context before the real mold code is assigned. The tracker should capture that work without allowing trial execution records against an unidentified mold.

Impact:

- Intake creation should not require client/project ref or mold code.
- PM/Admin need a simple way to fill mold code before scheduling T0.
- Dashboard/list display should lead with Mold Code, not the internal tracking code.

### 2026-07-01: Admin Row Editing Uses Batch Save

Admin user and client master data should be reviewed as table edits before saving.

Decision:

- Existing Admin Users and Clients rows use staged edits with a sticky bottom action bar.
- The bar shows changed-row count, Save changes, and Discard changes.
- Archive/Restore for users and clients is staged with the row changes where practical.
- Reset Password remains a separate explicit action because it changes credentials.
- Server actions still enforce `admin.manage_users`, `admin.manage_customers`, and `admin.manage_roles`.
- Each changed user/client row creates an ActivityLog record.

Reason:

The Admin tables now resemble operational spreadsheets. Per-row Save buttons make bulk cleanup slower and easier to forget.

### 2026-06-29: Documentation Sync Is Required For Feature Changes

MoldPilot's final shape may differ from the original idea. To avoid rediscovering decisions or creating code/docs drift, feature changes must be documented when they are accepted.

Rule:

- If the user requests or confirms a product, workflow, schema, permission, UI, or acceptance-rule change that is not already in `docs/`, confirm the exact change before implementation unless already confirmed in the same turn.
- Update the relevant source-of-truth docs before or alongside code.
- Add a decision-log entry when the change explains why the project moved away from an earlier assumption.

Impact:

- Future coder prompts should follow the docs instead of stale conversation context.
- Reviews should flag code-only feature drift.
- This preserves why decisions were made, not just what the current behavior is.

### 2026-06-30: Development Log Tracks Build Attempts And Lessons

The project needs an engineering history in addition to product decisions.

Reason:

- The product direction can change while coding continues.
- Some implementation approaches may pass narrow tests but still miss the real workflow.
- Future Coder prompts should know what worked, what failed, what was removed, and why.

Impact:

- `docs/03-build/development.md` tracks meaningful implementation attempts, failures, removals, fixes, test gaps, and lessons.
- The decision log remains the product-direction source of truth.
- The development log becomes the build-history source of truth.
- Future reviews should update the development log after meaningful milestones or when a code/docs mismatch is found.

### 2026-07-24: Dedicated Mac Mini Intranet Deployment Baseline

MoldPilot will run on a dedicated Mac mini inside the factory network.

Decision:

- Use wired Ethernet and a router-side DHCP reservation as the stable server address.
- Keep the server private to the trusted factory LAN; do not forward port 3000 or PostgreSQL through the internet router.
- Use Homebrew Node.js 24, pnpm 11.5.3, and native PostgreSQL 16. Python and Docker Desktop are not production prerequisites.
- Use a repository-specific read-only GitHub deploy key for the production checkout.
- Run the built Next.js application through a per-user launchd agent with `RunAtLoad` and `KeepAlive`.
- Keep uploads in an absolute persistent directory outside Git and backups on a NAS or external disk.
- Separate production bootstrap from demo seed. Production bootstrap is fresh-database-only, creates real master data without demo projects, forces the default Admin through first-login password change, and refuses to overwrite operational data.
- Future production deployments may pull, back up, migrate, verify, build, and restart, but must never seed or reset the live database.

Reason:

- A stable intranet address makes bookmarked phone and desktop access reliable.
- Native PostgreSQL and launchd fit a Mac mini server without requiring Docker Desktop's GUI session.
- Read-only deployment credentials and fresh-only initialization reduce the damage from a compromised server or an accidental production command.
- Keeping production data, uploads, source, and backups separate makes recovery and audits practical.

Impact:

- `scripts/server-bootstrap-macos.sh` is the one-time installation path.
- `scripts/server-deploy-macos.sh` is the repeatable release path.
- `docs/08-rollout/mac-mini-intranet-server.md` is the server runbook.
- The dedicated macOS server user must stay logged in for the user services to run; the screen may remain locked.

## Conflict Resolution Rule

When docs conflict, prefer this order:

1. This decision log.
2. `docs/02-schema/permissions-matrix.md` for access control.
3. `docs/01-domain/workflow-stages.md` for workflow behavior.
4. `docs/02-schema/schema-v0.md` for data modeling.
5. Older build prompts or generated code.
