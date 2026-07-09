# MoldPilot Development Log

This file records implementation attempts, failures, removals, fixes, and lessons learned.

Use it as engineering memory. The decision log explains product direction; this file explains what we tried in the build and why it worked, failed, or needs replacement.

## When To Add An Entry

Add an entry when work changes how future development should proceed, especially when:

- A coding prompt produces a meaningful milestone.
- A technical approach works and should be reused.
- A technical approach fails or is removed.
- Code passes but does not test the real workflow enough.
- A docs/code mismatch is found.
- A future Coder prompt should avoid repeating a mistake.

Small typo fixes and ordinary styling tweaks do not need entries unless they reveal a larger lesson.

## Entry Format

```text
### YYYY-MM-DD: Short Title

Context:

Tried:

Result:

Why:

Decision:

Verification:

Related Docs:
```

## Entries

### 2026-07-07: KPI Phase-1 Data Layer (Rules Registry, Scoring Engine, Scoreboard)

Context:

The KPI system design (`docs/06-kpi/`) needed its data machinery before the pilot baseline month could start. Owner also wanted admin-editable deadline rules and a staff scoreboard that stays hidden during data gathering.

Tried:

New `KpiRule` + `SystemSetting` tables (hand-authored migration); pure scoring engine (`kpi-scoring.ts`) + event extraction from real records (`kpi-events.ts`); admin Rules tab (hours editable, changes logged, mid-month-rescore warning); admin Scores tab with item-level audit drilldown; `/score` personal page matching the scorecard poster, gated by `scoreboard_enabled` (default off, admins preview); `scripts/run-kpi-snapshot.mjs` and `scripts/simulate-kpi-data.mjs` (persona test data).

Result:

Works after one fix round: ActivityLog `entity_id` is uuid — two call sites passed the setting KEY string (crash on toggle); boolean rules initially rendered nonsense "Due at pending" copy; Admin polluted scorecards because the simulator created issues as admin; some simulated timestamps preceded their anchors; Rules tab headings clipped and behavior names looked editable.

Why:

Event attribution and layout details matter as much as the engine. Non-scored roles must be excluded at the engine level, not hidden in UI.

Decision:

Deadlines are literal hours (weekends count). Rule changes re-score the current month (no versioning yet). ADMIN/GM/VIEWER are never scored. Exclude-over-guess for unreliable event timestamps — the <5-events floor makes undercounting safe. Never pass non-uuid strings as ActivityLog entity ids.

Verification:

tsc clean; 387 domain tests; simulator reproduces personas (zhong 92% hit, wang 75% miss, bill 92%, gong 100%); toggle round-trip logged.

Related Docs:

`docs/06-kpi/kpi-system-design.md` section 9, decision log 2026-07-07 entry, `docs/07-training/monthly-scorecard-example-poster.html` (UI spec for /score).

### 2026-07-05: Trial Date Confirmation Handshake And Trial Calendar

Context:

Owner workflow decision: PM proposes a trial date; Injection must confirm it with a machine or counter-propose; Marketing guards the customer target date on changes; rejections return to the PM. Injection also needed a machine-load view for planning.

Tried:

`TrialDateConfirmationStatus` state machine on TrialEvent (pure domain + five server actions); three new phone task sections (Confirm trial dates / Approve date changes / Returned dates — the Marketing card shows current date, proposed date, customer target, and the day gap); trial-panel badges; then `/calendar` month grid with per-day per-machine load warnings (amber at 3, red at 4+ on one machine), a day detail panel reusing the propose-change flow, and a 7-day phone agenda shared with the mobile dashboard.

Result:

Implemented. All PM date-set call sites reset the handshake (create, first T0, add trial, missed-record, auto-missed resolve, re-date).

Why:

Dates only become trustworthy when the machine owner confirms them, and the calendar is only useful over confirmed dates. The workflow must never block reality — results stay recordable in any confirmation state.

Decision:

Approval writes `proposed_date` into `planned_date` in the same transaction so the auto-missed cutoff follows automatically. No drag-and-drop on the calendar; phones get an agenda, never a month grid.

Verification:

360 domain tests at the time; full walkthrough bill to wang to yvonne to bill to wang.

Related Docs:

`docs/05-feature-prompts/06-trial-date-confirmation.md`, `07-trial-calendar.md`.

### 2026-07-04: Attachment Infrastructure, Issue Photos, Lightbox, Extended File Types, QC Reports

Context:

Phase 1 needed evidence: photos on issues, customer-facing QC measurement reports, and industry file types (CAD/video) with IP-safe visibility rules.

Tried:

Generic attachment layer (disk storage under `MOLDPILOT_STORAGE_DIR`, soft delete, per-type allowlists and size caps, streaming download route with visibility enforcement); photos riding the issue form with client-side canvas downscale; thumbnail grids plus one shared Lightbox; CAD (STEP/IGS/DWG/DXF), video (Range streaming, inline player), ppt/zip; measurement-report workflow (amber Missing until QC uploads; Marketing downloads customer-safe files named `project_trial_measurement-report.ext`; dashboard missing-report count).

Result:

Works. Two findings changed course: Next.js server actions default to a 1 MB body limit — uploads over ~1 MB were silently doomed until `bodySizeLimit: "320mb"`; and browsers send generic MIME types for CAD, so those validate by extension.

Why:

A defect without a photo is a story; with a photo it is evidence. Customer Safe must never be a default — native CAD leaking to a customer is the worst incident the file system could cause.

Decision:

Visibility defaults by type (CAD/video default Technical); photo failures never roll back the issue they ride on; measurement reports get their fixed filename at upload time.

Verification:

256 to 300 domain tests across the three builds; manual walkthroughs including Marketing receiving 403 on Technical files.

Related Docs:

`docs/05-feature-prompts/01-file-attachments.md`, `03-trial-photos.md`, `04-qc-measurement-report.md`; schema-v0 FileAttachment section.

### 2026-07-04: Environment Lessons — Turbopack Cache, Offline Store, Sync-Conflict Duplicates

Context:

Three environment incidents cost real debugging time and will recur if forgotten.

Tried:

Investigated a forever-hanging `/me` compile, repeated Prisma "Unknown argument" runtime errors, and mystery files named like `client 2.js`.

Result:

(1) The Turbopack persistent cache had bloated to 763 MB with 30-50 second compactions, largely because the 1.1 GB, 25k-file `.moldpilot-offline` store lived inside the watched project root. Fixed by deleting `.next` and relocating the offline cache to `~/.moldpilot-offline` (scripts now default there and refuse to write inside the repo). (2) The dev server holds the old generated Prisma client after migrations — always restart `pnpm dev` after `prisma generate`. (3) Files with a ` 2.` suffix appear when the Cowork sandbox and the Mac write the same path concurrently — the sync layer saves conflict copies and the canonical file may be stale; fix by stopping the dev server, deleting the affected generated directory, and regenerating on the Mac.

Why:

Build tooling treats the project root as its world; anything huge or externally mutated inside it becomes tooling pain.

Decision:

Keep multi-gigabyte artifacts out of the project root. Treat restart-after-generate as a rule. Treat any ` 2.` suffixed file as a sync-conflict smell worth investigating immediately.

Verification:

`/me` compiles in seconds after the fix; the KPI tabs loaded after clean regeneration.

Related Docs:

README offline dependency cache section.

### 2026-07-05: Trial Issue Owner Labels And Dashboard Action Group Polish

Context:

The trial issue owner dropdown was showing display name, Chinese name, and username, which made normal issue assignment harder to scan. On the dashboard, Admin and My tasks appeared as separate header rows for Admin users instead of a single action group.

Tried:

Added an issue-specific owner label helper that renders active users as `Role / Display Name / Chinese Name` and wired it into the Add Trial Issue form plus the Edit Trial Issue modal. Grouped the dashboard Admin and My tasks buttons in one flex nav action area without changing permission visibility, login behavior, or server-side workflow rules.

Result:

Implemented as UI polish only.

Why:

Issue assignment should quickly show who belongs to which role/department while keeping usernames out of normal labels. Header actions should feel like one compact nav cluster when both actions are available.

Decision:

Keep the existing bilingual user option helper for Admin/client/PM selectors that still need username clarity, and use the new owner-specific helper only for TrialIssue ownership selectors.

Verification:

- `CI=true node --test tests/domain/*.test.ts` passed.
- `pnpm exec prisma validate` passed.
- `pnpm typecheck` passed.
- `pnpm pilot:check` passed after rerunning outside the sandbox for localhost/PostgreSQL access.

Related Docs:

- `docs/03-ui/phase-1-screen-specs.md`
- `docs/02-schema/permissions-matrix.md`

### 2026-07-03: Bilingual UI Foundation

Context:

The pilot needs English and Simplified Chinese UI support without creating separate routes, duplicate screens, or translated business records.

Tried:

Added a lightweight typed translation dictionary, server cookie reader, client language provider, and visible language switcher. Wired high-priority screens and widgets: login, account/change-password, dashboard/intake, Mold Trial List, project overview/trial panels/Record Result/Add Issue/Add Planned Trial/Digital Process Sheet controls, and Admin tabs/users/clients/machines/roles/permission matrix.

Result:

- English remains the default.
- `zh-CN` can be selected from the header/login switcher.
- Selection is persisted with cookie and localStorage and refreshes server-rendered pages.
- Enum/status and permission/process display labels translate while stored enum values, permission codes, and business records remain unchanged.
- User-entered mold/client/part/issue/machine/report data is not translated.

Known gaps:

- Arbitrary server-action error strings passed through URL messages may still include English details. The UI headings are translated, but a later hardening pass should convert common server-action failures to stable error codes for full message translation.
- Some low-priority historical ActivityLog action/entity strings remain generated from stored technical names.

Verification:

- Added `tests/domain/i18n.test.ts`.

Related Docs:

- `docs/00-product/decision-log.md`
- `docs/03-ui/phase-1-screen-specs.md`
- `docs/03-build/acceptance-tests.md`
- `docs/03-build/pilot-acceptance-checklist.md`

### 2026-07-02: Trial Issue Row Actions And Lightweight Closure

Context:

User reviewed the current Trial Issues area and found it too complicated. The page showed a large update issue panel with many lifecycle fields, while real Phase 1 use needs the issues to stay inside the trial panel where they were introduced.

Tried:

Reviewed the issue workflow after the Record Result simplification. The current UI still leaned toward a full quality-management form with root cause, corrective action, verification, Assembly dates, PM readiness, and closed date all visible in one large editor.

Result:

Product direction changed:

- Trial issues live inside the trial panel where they were found.
- Remove the large global Update Issue panel from normal Mold Trial Detail.
- Each issue row shows Edit and Close Issue actions.
- Edit opens a modal for the simple issue fields.
- Close Issue opens a focused modal with fix summary, approximate time spent, and closed date defaulting to today.
- Issue owner can close their own issue.
- PM and GM can close any issue because they oversee the project.
- If the closer is not the issue owner, the close flow requires a reason explaining why the owner did not close it.
- Closure stores closed by user, closed date, fix summary, fix time, and non-owner reason when applicable.
- Add Trial Issue must use the full available trial-panel width.
- Closed issues lock for normal users: Edit and Close Issue are gray/disabled for non-GM users.
- GM can edit a closed issue through an explicit override path with ActivityLog history.
- Add Next Planned Trial defaults design change source to No / None.
- Design-change fields are hidden/disabled unless the reason is design-change related.
- Reason detail and design change title are optional for new planned trials.

Why:

The pilot needs a fast follow-up loop more than a full QA lifecycle. Fix summary and time spent give useful later analytics without forcing PM or workers to fill root-cause/verification forms too early.

Decision:

Add lightweight issue row actions and closure fields, move issue edit/close into modals, remove/hide the global update panel, enforce owner/PM/GM closure permissions server-side, make non-owner closure auditable, lock closed issues for non-GM users, and simplify new-trial design-change fields.

Verification:

Passed:

- `CI=true node --test tests/domain/*.test.ts`
- `pnpm exec prisma validate`
- `pnpm typecheck`
- `pnpm pilot:check`

Notes:

- Added migration `20260702093000_trial_issue_simple_closure`.
- Local `pnpm pilot:check` initially failed because the running Next dev server had loaded the old generated Prisma client before the new `closedBy` relation existed. Restarting the dev server after `pnpm typecheck` / Prisma generate fixed the HTTP smoke.

2026-07-02 implementation update:

- Patched the closed-issue row actions so normal users see disabled Edit and Closed buttons.
- Added the GM-only closed-issue override modal path and `gm_edited_closed_trial_issue` ActivityLog action.
- Blocked non-GM server-side edits to closed issues, including the older lifecycle update action.
- Moved Add Next Planned Trial into a small client form so design-change fields appear only for design-change-related reasons.
- Added `No / None` as the default design-change source and made reason detail/design-change title optional.
- Updated validation so the new-planned-trial minimum fields are planned date, reason category, requester, and source area.
- `pnpm pilot:check` first hit sandbox `EPERM` for localhost checks; rerunning outside the sandbox passed PostgreSQL reachability and HTTP smoke.

Related Docs:

- `docs/00-product/decision-log.md`
- `docs/00-product/mvp-definition.md`
- `docs/01-domain/workflow-stages.md`
- `docs/02-schema/schema-v0.md`
- `docs/02-schema/permissions-matrix.md`
- `docs/03-ui/phase-1-screen-specs.md`
- `docs/03-build/acceptance-tests.md`
- `docs/03-build/pilot-acceptance-checklist.md`

### 2026-07-03: Remove Digital Process Sheet Summary Duplication And Color Issue Rows

Context:

User reviewed the Digital Process Sheet and Trial Issues UI. The sheet still showed a Trial Summary section even though trial result and issue information now live in the Record Result panel and TrialIssue tables. Trial Issues also needed clearer visual scanning by status.

Tried:

Scoped the patch as a UI/workflow cleanup rather than a new module. Removed the generated issue-summary block from the Digital Process Sheet, filtered legacy Trial Summary parameters out of the editor/server save/PDF export paths, and deactivated legacy summary parameters during seed without deleting historical TrialProcessValue rows. Added subtle status row colors to trial-panel issue tables while keeping the visible status chip.

Result:

Implemented.

- Digital Process Sheet normal UI now shows machine/process parameters only.
- Trial Summary parameters are excluded from the editor, server-side process-sheet save, seed process values, and customer-safe PDF process rows.
- New default process-sheet templates no longer create Trial Summary parameters; seed deactivates any legacy default-template rows non-destructively.
- Customer-safe PDF keeps generated TrialEvent/TrialIssue summary content and ignores duplicated/manual process-sheet summary rows.
- TrialIssue rows inside trial panels now use warning/success row backgrounds by status and retain visible status text/chips.

Why:

This keeps Digital Process Sheet focused on process parameters and keeps the trial workflow source-of-truth clean: Trial Result for result, TrialIssue for issues and corrections, Process Sheet for process parameters.

Decision:

Proceed with a small patch plus tests/docs verification.

Verification:

- `CI=true node --test tests/domain/*.test.ts` passed.
- `pnpm exec prisma validate` passed.
- `pnpm typecheck` passed.
- `pnpm pilot:seed` passed and refreshed local template rows.
- `pnpm pilot:check` passed.

Related Docs:

- `docs/00-product/decision-log.md`
- `docs/00-product/mvp-definition.md`
- `docs/01-domain/workflow-stages.md`
- `docs/02-schema/schema-v0.md`
- `docs/03-ui/phase-1-screen-specs.md`
- `docs/03-build/acceptance-tests.md`
- `docs/03-build/pilot-acceptance-checklist.md`

### 2026-07-03: Same-Trial Issue Gate For Non-Approved Trial Results

Context:

Review found that non-approved trial results and next-trial planning could be satisfied by project-level issue counts. That allowed a failed T1 to move forward because an unrelated old T0 issue was still open.

Tried:

Moved the gate to same-trial accountability. Record Result now checks issues linked to the selected TrialEvent, and Add Next Planned Trial checks the previous completed actual trial for a linked issue when that previous result is not Approved. Also aligned Add Trial Issue creation so owner user and due date are required in both UI and domain/server validation.

Result:

Implemented.

- Non-approved, pending, conditional, or invalid actual results require at least one TrialIssue under the same trial panel before saving.
- Planning T1/T2/T3/etc. is blocked if the previous completed trial result was not approved and has no same-trial issue.
- Issues from other trials, project-level open issue counts, trial result notes, and new-trial reasons do not satisfy the gate.
- Add Trial Issue no longer defaults to Unassigned and requires Owner plus Due Date.
- The legacy `outcomeDisposition` field remains internal/backward-compatible; normal wording uses trial result and trial result note.

Why:

TrialIssue owns follow-up accountability. Keeping the issue linked to the same T-stage prevents project-level issue count drift and makes each failed trial panel auditable.

Verification:

- `CI=true node --test tests/domain/*.test.ts` passed.
- `pnpm exec prisma validate` passed.
- `pnpm typecheck` passed.
- `pnpm pilot:check` passed after rerunning with local PostgreSQL/localhost access.

Related Docs:

- `docs/00-product/decision-log.md`
- `docs/00-product/mvp-definition.md`
- `docs/01-domain/workflow-stages.md`
- `docs/02-schema/schema-v0.md`
- `docs/02-schema/permissions-matrix.md`
- `docs/03-ui/phase-1-screen-specs.md`
- `docs/03-build/acceptance-tests.md`
- `docs/03-build/pilot-acceptance-checklist.md`

### 2026-07-02: Record Result And Add Issue Forms Simplified

Context:

User reviewed the Record Result and Add Trial Issue panels and found the visible workflow too crowded. `Outcome disposition` duplicated the `Result` decision, while Follow-up Owner and Follow-up Due Date on the trial record could not represent multiple issues owned by different people.

Tried:

Reviewed the current TrialEvent and TrialIssue model. TrialEvent had result, outcome disposition, follow-up owner/date, material, and legacy machine note. TrialIssue already had owner user, due date, issue type, source, severity, status, description, and optional affected part/cavity support.

Result:

Product direction changed:

- Record Result should keep only actual date, result, injection machine, sample quantity, main issue summary, and optional outcome note.
- Visible Result options should cover the needed direction: Approved, Conditional, Not Approved / Rework Required, Pending QC, Pending Customer Feedback, and Invalid Trial.
- Outcome disposition is removed from the normal visible workflow and no longer required for completion.
- Trial-level follow-up owner/date are removed from Record Result; follow-up ownership belongs on TrialIssue rows.
- Legacy machine note and material are hidden from Record Result. Machine uses Injection Machine Master; material belongs in Digital Process Sheet.
- Simple Add Trial Issue becomes wider and shows only title, optional affected part, issue type, source, severity, status, owner, due date, and description.
- Advanced lifecycle fields remain for later edit/acknowledgement/verification/closure workflows, not the simple create form.

Why:

The trial result panel should answer what happened. Trial issues should answer what needs follow-up, who owns it, and when it is due. This better matches real mold-trial work where one trial can create multiple follow-up items for different people.

Decision:

Implemented the result-first trial completion patch. `outcomeDisposition`, follow-up owner/date, legacy machine note, and material stay in the schema only as legacy/backward-compatible data. The server derives legacy outcome disposition from the selected result so old report/status code can keep working while the normal UI uses one visible result field.

Verification:

- Passed: `CI=true node --test tests/domain/*.test.ts`
- Added non-destructive migration `20260702083000_simplify_record_result` to add `PENDING_CUSTOMER_FEEDBACK` and `INVALID_TRIAL` to `TrialResult`.
- Remaining verification in the implementation turn: Prisma validate, typecheck, and pilot check.

Related Docs:

- `docs/00-product/decision-log.md`
- `docs/00-product/mvp-definition.md`
- `docs/01-domain/workflow-stages.md`
- `docs/02-schema/schema-v0.md`
- `docs/02-schema/permissions-matrix.md`
- `docs/03-ui/phase-1-screen-specs.md`
- `docs/03-build/acceptance-tests.md`
- `docs/03-build/pilot-acceptance-checklist.md`

### 2026-07-02: Admin Undo Last Saved Action

Context:

The first attempt added reset/discard controls for unsaved edits, but the intended workflow was to recover from an already-saved Admin action, such as accidentally deleting an Injection Machine.

Result:

- Added one server-backed `Undo last saved action` control for Active Users, Active Clients, Injection Machines, and Roles.
- Undo is scoped by Admin area and uses existing `ActivityLog.beforeJson`/`afterJson` snapshots.
- Server-side permission checks remain authoritative:
  - Users require `admin.manage_users`.
  - Clients require `admin.manage_customers`.
  - Injection Machines require `admin.manage_machines`.
  - Roles and role permissions require `admin.manage_roles`.
- Deleted Injection Machines can be restored from the ActivityLog snapshot. Safe-deleted/historical machines are reactivated without breaking trial snapshots.
- Created rows are removed when safe; if references already exist, undo archives/hides instead of breaking history.

Verification:

- Passed: `pnpm test:domain`
- Passed: `pnpm typecheck`

### 2026-07-02: Digital Process Sheet Usability Patch Scoped

Context:

User tested the Digital Process Sheet after the machine-master work and found practical data-entry issues: saved values lacked clear in-panel feedback, Enter submitted/froze the sheet instead of moving to the next field, and PM needs a way to copy prior trial parameters into the next trial.

Tried:

Reviewed the current implementation in `src/app/projects/[projectCode]/page.tsx` and `src/server/mold-trial-actions.ts`. The sheet is currently rendered as a server form around a comparison table. It saves through `saveTrialProcessSheetValues`, writes structured `TrialProcessValue` rows, and redirects with a generic success message.

Result:

The current structure is correct for data storage, but too rough for PM data entry. Enter currently behaves like form submit because editable fields are normal inputs inside a form. Save feedback is not anchored inside the Digital Process Sheet panel. There is no Copy Previous Trial workflow yet.

Why:

PM will enter many process values during or after a trial. The sheet needs spreadsheet-like keyboard behavior and visible save confidence, otherwise it will feel slower than paper and invite duplicate/offline notes.

Decision:

Next Coder patch should convert the editable Digital Process Sheet area into a client-assisted editor while preserving server-side permission validation and structured `TrialProcessValue` storage. Add visible current-trial/editing state, unsaved-change count, save feedback, Enter/Shift+Enter field navigation, and Copy Previous Trial. Copying should fill blank current-trial machine/process values from the immediate previous trial and must not copy trial result, issues, summaries, next action, Assembly self-check, or accountability fields. Saving/copying process values must not create a new trial.

Verification:

- Passed: direct domain suite with `CI=true node --test tests/domain/*.test.ts` (119 tests).
- Blocked: `pnpm exec prisma validate` and `pnpm typecheck` because local `node_modules/.bin` is missing/corrupted in this environment; `pnpm install` reported already up to date but did not relink binaries.

Related Docs:

- `docs/00-product/decision-log.md`
- `docs/00-product/mvp-definition.md`

### 2026-07-02: Digital Process Sheet Usability Patch Implemented

Context:

The scoped patch needed to make Digital Process Sheet entry usable during a pilot: avoid accidental Enter submits, show save confidence in the sheet, and let PM/Injection copy previous process setup values without copying trial results or accountability fields.

Tried:

Converted the editable process-sheet table into a client-assisted editor component while keeping `saveTrialProcessSheetValues` as the server-side permission and persistence boundary. Added domain helpers for keyboard navigation and Copy Previous Trial behavior.

Result:

- The sheet now shows `Editing: T0/T1/...`, unsaved-change count, saving state, and saved timestamp/count feedback inside the panel.
- Enter moves to the next editable process value and Shift+Enter moves to the previous value instead of submitting the form.
- Copy Previous Trial copies the previous trial machine and copyable process values into blank current fields, with explicit overwrite confirmation for existing values.
- Copy Previous Trial excludes trial-summary/accountability-style process rows such as trial result summary, major issues, correction summary, next action, and internal private note.
- Saving process-sheet values still writes `TrialProcessValue` rows and `saved_trial_process_sheet` ActivityLog, without creating a TrialEvent or advancing the visible stage.
- Admin management Undo now supports a bounded ten-action stack and uses the shorter `Undo` label. The Injection Machines action column was narrowed after removing the old reset control.
- `scripts/pilot-preflight.mjs` now selects `active` before filtering imported machines by active state.

Verification:

- Passed: `CI=true node --test tests/domain/*.test.ts`
- Passed: `pnpm exec prisma validate`
- Passed: `pnpm typecheck`
- Passed: `pnpm pilot:check` after refreshing stale local seed data with `pnpm pilot:seed`

Related Docs:

- `docs/03-ui/phase-1-screen-specs.md`
- `docs/03-build/acceptance-tests.md`
- `docs/01-domain/workflow-stages.md`
- `docs/02-schema/schema-v0.md`
- `docs/03-ui/phase-1-screen-specs.md`
- `docs/03-build/acceptance-tests.md`
- `docs/03-build/pilot-acceptance-checklist.md`

### 2026-07-02: Injection Machine Panel Narrowed

Context:

User asked to handle one issue at a time and simplify the Injection Machine Admin panel. The real pilot only needs machine No., clamping force, brand, and shot weight.

Tried:

Reviewed Coder's current implementation. The seed attempted to parse `RAW/Injection-Machines-2026.07.02.xls`, but the Admin Machines UI still exposed Display Name, Model, Tonnage, Nozzle, Notes, and Active/Archived status. The seed also mapped machine number from a remark/generated label path instead of using a numeric-only No. as the visible machine number.

Result:

Implemented the focused Injection Machine Master patch:

- Visible Admin columns: No., Clamping Force, Brand, Shot Weight, Actions.
- Row actions: Save and Delete.
- No. is numeric only, validated client-side and server-side, and sorted numerically.
- RAW import uses workbook No. as `machineNo`; generated `MACHINE-xx` and remark labels such as `12#` are not created.
- Delete hard-deletes unused rows and safe-deletes/hides referenced historical rows without breaking trial snapshots.
- Process-sheet machine labels/search now use numeric No. and clamping force wording.

Verification:

- Passed: `pnpm exec prisma validate`
- Passed: `pnpm test:domain`
- Passed: `pnpm typecheck`
- Passed: `pnpm pilot:check`

Why:

The machine master is support data for trial/process-sheet entry, not a full equipment-maintenance module. Extra columns make the Admin panel harder to use and distract from the trial tracker.

Decision:

Next Coder patch should narrow schema/server/UI/test behavior around the simplified machine fields while preserving historical trial snapshots.

Verification:

Pending Coder patch.

Related Docs:

- `docs/00-product/decision-log.md`
- `docs/02-schema/schema-v0.md`
- `docs/03-ui/phase-1-screen-specs.md`
- `docs/03-build/acceptance-tests.md`
- `docs/03-build/pilot-acceptance-checklist.md`

### 2026-07-02: Intake Process Sheet, Client Privacy, Trial Stage, And Machine Seed Patch

Context:

Patch blockers from local pilot testing needed to be fixed before the next milestone: new projects missed process-sheet template snapshots, client country was still present in Customer Master/search, missed T0 replans created duplicate visible T0 rows, user-facing pages showed internal `#1/#2/#3` sequence suffixes, and the injection machine master still used three starter records.

Tried:

Removed `customers.country` from Prisma and normal code paths with a cleanup migration. Made `createMoldTrialProject` snapshot the selected customer default process-sheet template or global `default_process_setup`, and backfilled null project template snapshots. Changed missed/auto-missed replanning to update the same TrialEvent/stage instead of creating a new visible T0. Added domain gating so T1/T2/T3 cannot be planned until the prior stage is completed, skipped, cancelled, or aborted. Replaced display labels with generated `T0`, `T1`, `T2`, `T3` labels across detail, process sheet, summaries, and exports. Added a seed-only OLE/BIFF `.xls` reader for `RAW/Injection-Machines-2026.07.02.xls`.

Result:

Implemented. `MP-PILOT-001` now has one visible completed T0, a missed-trial audit row linked to that T0, and planned T1 as sequence 2. Client search no longer uses country and the selector no longer shows the no-match message while a selected customer id is set. The local pilot seed imports the real machine workbook and `pilot:check` fails if it falls back to a tiny starter list.

Why:

Phase 1 needs mold-level trial control, not event-row numbering as a user-facing stage model. Client country is not necessary for Mold Trial Tracker and creates avoidable customer-profile exposure. The process sheet must be available for real newly created projects, not only demo fixtures.

Decision:

Keep process-sheet template snapshots on MoldTrialProject. Keep Customer Master limited to code, short name/display name, owner, aliases, notes, and active state. Keep missed/replanned trial history auditable through MissedTrialEvent while the visible trial panel stage remains stable.

Verification:

- `pnpm exec prisma validate` passed.
- `pnpm test:domain` passed: 116 tests.
- `pnpm typecheck` passed.
- `pnpm build` passed outside sandbox after Turbopack needed local worker/port access.
- `pnpm prisma:migrate` applied `20260702072000_privacy_template_stage_patch`.
- `pnpm pilot:seed` passed and imported real machine workbook records.
- `pnpm pilot:check` passed; HTTP smoke was skipped because no dev server was left running.
- `pnpm pilot:workflow:e2e` passed and now verifies a browser-created intake shows Digital Process Sheet after T0 exists.

Related Docs:

- `docs/00-product/decision-log.md`
- `docs/02-schema/schema-v0.md`
- `docs/03-build/acceptance-tests.md`
- `docs/03-build/pilot-acceptance-checklist.md`

### 2026-07-02: Pilot Intake And Trial Label Bugs Found

Context:

User tested new project intake and Digital Process Sheet locally and found several problems: client selector showed `No active clients match this search` after selecting a client, new user-created projects had no Digital Process Sheet, seeded pilot data showed `T0 #1`, `T0 #2`, `T1 #3`, and the app allowed the workflow to look like it jumped from unresolved T0 to T1. User also requested that customer country not be shown and noted that the injection machine master is still too small.

Tried:

Inspected current code, docs, and local database state. `pnpm exec prisma validate` and `pnpm test:domain` passed. `pnpm pilot:check` passed outside the sandbox and confirmed the local DB is reachable, but direct DB inspection showed newly created `MP-TRK-20260702-887WZ4` has `processSheetTemplateCode = null` while seed fixtures have `default_process_setup`. Local machine master contains only three starter machines.

Result:

The implementation is not ready for the next milestone until these patch blockers are fixed:

- Normal project creation must snapshot the selected customer/default process-sheet template.
- Client selector must preserve selected customer state without showing a contradictory no-match message.
- Country must be removed from normal client UI/search/export and should be nulled/dropped from Customer data when practical.
- Missed/replanned T0 must remain visible as T0; normal UI, process sheet, summaries, and exports must not show `T0 #1`, `T0 #2`, or `T1 #3`.
- The app must not advance to T1 until T0 has a real completion/closure disposition.
- Injection Machine Master must import the real `RAW/Injection-Machines-2026.07.02.xls` data instead of relying on starter records.

Why:

The earlier tests proved seed/demo readiness but did not cover a real new-intake workflow. The visible stage model also drifted toward internal event numbering instead of the business sequence PM expects.

Decision:

Patch docs and tests first, then have Coder fix server actions, selectors, trial panel/process-sheet labeling, missed-trial replanning, seed/import logic, and acceptance tests.

Verification:

- `pnpm exec prisma validate` passed.
- `pnpm test:domain` passed.
- `pnpm pilot:check` passed outside sandbox.
- Remaining verification must be rerun after the patch with a newly created project, not only `MP-PILOT-001`.

Related Docs:

- `docs/00-product/decision-log.md`
- `docs/00-product/mvp-definition.md`
- `docs/01-domain/workflow-stages.md`
- `docs/02-schema/schema-v0.md`
- `docs/02-schema/permissions-matrix.md`
- `docs/03-ui/phase-1-screen-specs.md`
- `docs/03-build/acceptance-tests.md`
- `docs/03-build/pilot-acceptance-checklist.md`

### 2026-07-02: Digital Process Sheet MVP Captured

Context:

The user wants to move the mold trial report online so PM does not record issues/process data on paper and then re-enter them in MoldPilot. The user also provided the current injection machine list and a real process setup sheet.

Tried:

Implemented the staged Digital Process Sheet MVP: Injection Machine Master, machine search by number/tonnage, structured process-sheet values per trial, horizontal T0/T1/T2/extra comparison, Assembly self-check behavior, fixed customer/default process-sheet templates, and customer-safe Process Sheet PDF export.

Added Prisma models/fields for `InjectionMachine`, `ProcessSheetTemplate`, `ProcessSheetParameter`, `TrialProcessValue`, TrialEvent machine snapshots, Customer default template assignment, MoldTrialProject template snapshots, Process Sheet attachment enum values, and TrialIssue Assembly self-check fields.

Added Admin Machines management, process-sheet edit/export permissions, Digital Process Sheet UI on the Mold Trial Detail page, server actions for saving current-trial process values and exporting a customer-safe PDF, and seed data for `MP-PILOT-001` process values/machine snapshots.

Result:

Implementation is in place. The intended scope remains a practical fixed-template report-data module, not a full custom template designer.

`RAW/PROCESS SET UP SHEET.xlsx` was readable and used to shape the fixed template sections/rows. `RAW/Injection-Machines-2026.07.02.xls` is an old OLE `.xls`; local parsing was blocked because `xlrd` was not installed and LibreOffice conversion failed due a missing `little-cms2` dynamic library. The seed now includes a starter machine master, including `12# - LianChuang 408T` from the process setup sheet, and this blocker should be revisited if full workbook import becomes important.

Why:

This reduces duplicate PM entry and makes MoldPilot the source of truth for both internal trial control and customer-safe process-sheet export.

Decision:

Start with fixed templates based on `RAW/PROCESS SET UP SHEET.xlsx`, seed/import machines from `RAW/Injection-Machines-2026.07.02.xls` where practical, and export customer-safe PDFs from structured TrialEvent/TrialIssue/TrialProcessValue data.

Verification:

- `pnpm exec prisma validate` passed.
- `pnpm test:domain` passed, including process-sheet helper tests.
- `pnpm typecheck` passed.
- `pnpm pilot:check` passed after applying the new migrations and reseeding.
- `pnpm pilot:e2e` passed data workflow checks; optional HTTP check skipped because no dev server was already running.
- `pnpm pilot:workflow:e2e` passed browser/server-action workflow checks.
- `pnpm build` passed when rerun outside the sandbox; the sandboxed run failed with Turbopack EPERM while creating a process/binding a port for CSS processing.

Related Docs:

- `docs/00-product/decision-log.md`
- `docs/00-product/mvp-definition.md`
- `docs/01-domain/workflow-stages.md`
- `docs/02-schema/schema-v0.md`
- `docs/02-schema/permissions-matrix.md`
- `docs/03-ui/phase-1-screen-specs.md`
- `docs/03-build/acceptance-tests.md`
- `docs/03-build/pilot-acceptance-checklist.md`

### 2026-07-01: Auto-Missed Resolution And In-Panel Trial Actions Captured

Context:

The user wanted the Mold Trial Detail page simplified further after moving to trial panels. Separate Record Missed Trial and Add Design Change panels still made the page feel heavier than necessary.

Tried:

Added the Prisma/TypeScript support for `Auto Missed - Reason Required`, including nullable auto-missed audit fields and a resolution enum on `TrialEvent`. Added a domain helper for the Asia/Shanghai next-day noon cutoff, wired project detail loading to idempotently apply the auto-missed state, and logged the automatic transition in `ActivityLog`.

Moved normal trial work into the Trial Panel area: result entry, late-result correction, auto-missed resolution, issue creation, and add-next-planned-trial now live inside the panel workflow. Removed the standalone normal UI blocks for Record Missed Trial and Add Design Change. Design-change extra-trial reasons can still create `DesignChangeEvent` and `TrialLimitAdjustment` records behind the scenes when selected as an extra-trial reason.

Result:

Implementation is in place. The old server actions remain available for compatibility, but the normal detail page no longer exposes separate page-level missed-trial or design-change panels.

Why:

The team should not have to choose among many page-level forms. The page should guide users through the specific trial panel they are working on, while the system detects overdue unreported trials automatically.

Decision:

Use `Auto Missed - Reason Required` as a cleanup state after 12:00 PM on the next calendar day when no trial result exists. Resolve it from the trial panel by entering missed reason/new date, marking blocked/paused, or entering a late completed-trial result with audit history.

Verification:

- Added domain/source tests for auto-missed cutoff behavior, blocked/paused resolution validation, confirmed missed resolution requirements, idempotent service guard, late-completion audit source, current-action selection, in-panel UI source checks, and design-change extra-trial reason counting.
- Remaining gap: this pass did not add a new browser workflow that fills the in-panel forms end to end; the existing pilot workflow should be rerun and adjusted only if selectors changed.

Related Docs:

- `docs/00-product/decision-log.md`
- `docs/00-product/mvp-definition.md`
- `docs/01-domain/workflow-stages.md`
- `docs/02-schema/schema-v0.md`
- `docs/03-ui/phase-1-screen-specs.md`
- `docs/03-build/acceptance-tests.md`
- `docs/03-build/pilot-acceptance-checklist.md`

### 2026-07-01: Mold Trial Detail Simplified Around Trial Panels

Context:

The Mold Trial Detail page risked becoming cluttered because trial count, limit controls, history, missed trials, design changes, and trial records were spread across too many panels.

Tried:

Reworked the detail route around a Trial Panel model: compact trial-count badge, simplified overview, default T0/T1/T2 collapsible panels, prior issue verification inside later panels, and a single Planning & Change History section for missed trials, new-trial reasons, design changes, and limit adjustments.

Added pure domain helpers for trial-panel display behavior and extra-panel prerequisites. Hardened `addNewPlannedTrial` so sequence 4+ requires all prior panels completed and a visible reason before the server creates the next planned trial.

Result:

Implemented. The normal detail UI no longer shows the standalone Trial Limit Panel or Set PM Custom Limit form. Design-change allowance and extra-trial reasons remain visible through Planning & Change History. Existing PM custom-limit server/action support remains in code for audit/admin compatibility, but it is not exposed in normal detail workflow.

Why:

The team should work through the actual trial loop, not a limit-management screen. This keeps trial discipline visible while making the page easier for PM, Injection, QC, Marketing, and GM to understand.

Decision:

Use existing `TrialEvent.planReasonDetail`, approved design-change records, and `TrialLimitAdjustment` history as the visible extra-trial reason source for this milestone. Do not add a new extra-trial-reason table yet; revisit only if real pilot use needs richer reason linking.

Verification:

Passed `pnpm exec prisma validate`, `pnpm test:domain`, `pnpm typecheck`, `pnpm pilot:check`, `pnpm pilot:workflow:e2e`, `pnpm build`, and `pnpm pilot:e2e`. `pilot:check` initially found local seed drift because the `xie` GM account was missing; rerunning `pnpm pilot:seed` restored the expected pilot fixture before final verification.

Related Docs:

- `docs/00-product/decision-log.md`
- `docs/00-product/mvp-definition.md`
- `docs/01-domain/workflow-stages.md`
- `docs/02-schema/schema-v0.md`
- `docs/02-schema/permissions-matrix.md`
- `docs/03-ui/phase-1-screen-specs.md`
- `docs/03-build/acceptance-tests.md`
- `docs/03-build/pilot-acceptance-checklist.md`

### 2026-07-01: Multi-Part And Multi-Cavity Support Added To Phase 1

Context:

Family molds and multi-cavity tools can include more than one tracked part/cavity under one mold-level trial loop.

Tried:

Added `MoldTrialPart` as a child of `MoldTrialProject`, kept project `part_code` as the primary display/migration mirror, and added optional affected scope/part/cavity fields on `TrialIssue`.

Result:

Implemented as an additive schema migration, shared domain helper, server-action validation, dashboard/detail display, project parts editor, issue affected-part selectors, seed backfill, and a multi-part seed fixture.

Why:

Trial events and trial limits remain mold-level in Phase 1, but issues need part/cavity context. Separate part rows avoid comma-separated part codes and avoid incorrectly splitting one mold into multiple projects.

Decision:

Use `MoldTrialPart` as the source of truth for multi-part/multi-cavity data. Keep `MoldTrialProject.part_code` mirrored to the first active part for now. Removed part rows become inactive rather than deleted, preserving issue history.

Verification:

Run Prisma validation, domain tests, typecheck, and relevant pilot checks after this patch. New domain tests cover single-part normalization, multi-part rows, comma-separated part-code rejection, affected-part validation, and dashboard `primary +N` display.

Related Docs:

- `docs/00-product/decision-log.md`
- `docs/02-schema/schema-v0.md`
- `docs/01-domain/workflow-stages.md`
- `docs/03-ui/phase-1-screen-specs.md`
- `docs/03-build/acceptance-tests.md`

### 2026-07-01: User Archive UX Replaces Raw Status Editing

Context:

Admin user setup had a database-style Active/Inactive status field, but the user preferred an ERP-style Archive action and separate active/archived user lists.

Tried:

Updated docs and implementation to hide raw user status from normal Admin forms and define Archive/Restore actions backed by `User.status`.

Result:

Implemented. Active Users and Archived Users appear as separate sections. Archive sets users inactive; restore sets users active. Active assignment dropdowns now load active users from the database instead of static user lists.

Why:

Archive/Restore is clearer for Admin users than exposing a raw status dropdown. It preserves user history while preventing archived users from logging in or being selected for new workflow assignments.

Decision:

Implement archive after Reset Password in the Active Users table, add Restore in the Archived Users table, block archiving the last active Admin path, and write ActivityLog records for archive/restore.

Verification:

Run Prisma validation, domain tests, typecheck/build, and browser workflow E2E after this patch. Browser workflow E2E covers active/archived sections, archive login blocking, restore, assignment dropdown hiding, ActivityLog, and Admin-path guardrails.

Related Docs:

- `docs/00-product/decision-log.md`
- `docs/00-product/mvp-definition.md`
- `docs/02-schema/schema-v0.md`
- `docs/02-schema/permissions-matrix.md`
- `docs/03-build/acceptance-tests.md`

### 2026-07-01: User Account Department Group Removed From Admin Setup

Context:

The real pilot role list already implies department for normal users: PM, Marketing, Assembly, Injection, QC, GM, Viewer, and Admin. Asking Admin to also assign a department group duplicated role meaning and made account setup heavier.

Tried:

Removed Department Group from `/admin` user create/edit forms and stopped writing `User.department_group_id` from Admin account saves or seeded pilot users. Kept DepartmentGroup as TrialIssue owner group / responsibility area.

Result:

Implemented as the lighter schema path. `User.department_group_id` remains nullable in the database for now, but it is deprecated and unused for Phase 1 account setup. TrialIssue owner-group behavior remains intact.

Why:

Role defines what the account can do. Responsibility area defines where an issue belongs. Keeping those concepts separate avoids duplicate account metadata while preserving issue routing for Assembly, QC, Injection, Marketing, PM, and other areas.

Decision:

Do not ask Admin to assign a department group when creating or editing users in Phase 1. Use Role for account permissions and TrialIssue owner group for issue responsibility.

Verification:

Run Prisma validation, domain tests, typecheck/build, seed/pilot checks, and browser workflow E2E after this patch.

Related Docs:

- `docs/00-product/decision-log.md`
- `docs/00-product/mvp-definition.md`
- `docs/02-schema/schema-v0.md`
- `docs/02-schema/permissions-matrix.md`
- `docs/03-build/acceptance-tests.md`

### 2026-07-01: Default Admin First Login Unblocked And Password Save Verified

Context:

The default Admin account was forced through first-login password change during local pilot setup. User testing showed that this added friction, and password-change success needed stronger verification.

Tried:

Kept the change-password flow for employees and normal account self-service, but removed the forced first-login change for the local default Admin. Added a post-update verification read in the password-change server action before returning success.

Result:

Implemented. Seed and pilot checks now expect default Admin to have a hashed password with `force_password_change = false`, while seeded employee accounts still require first-login password change.

Why:

The default Admin exists to unblock local setup and recovery. Employees still need the temporary-password control, and any real deployment must change or disable the local Admin default.

Decision:

Default Admin can log in locally with `admin` / `admin` without first-login password change. The password-change action verifies that the new hash and forced-change flag persisted before redirecting.

Verification:

Run Prisma validation, domain tests, typecheck/build, reseed, and pilot checks after this patch.

Related Docs:

- `docs/00-product/decision-log.md`
- `docs/00-product/mvp-definition.md`
- `docs/02-schema/schema-v0.md`
- `docs/02-schema/permissions-matrix.md`
- `docs/03-build/acceptance-tests.md`

### 2026-07-01: Real Login And Real Pilot User Seed Implemented

Context:

The earlier v0.1 account model used a local current-user selector and did not require passwords. The user provided the actual pilot employee list and asked to simplify roles for easier management.

Tried:

Implemented the real login MVP with minimal active roles: Admin, GM, PM, Marketing, Assembly, Injection, QC, and Viewer. Added the seeded pilot user list, temporary testing passwords, seeded employee first-login password change, Admin password reset, and account self-service username/password changes.

Result:

Worked. Normal pilot pages now require a signed HTTP-only login session. The old current-user selector is no longer used by dashboard/detail/admin pages and remains isolated behind an explicit dev flag path.

Why:

Real login makes pilot testing more realistic and makes activity accountability meaningful. A single PM role is easier to manage than separate Planning PM, Technical PM, and PM Assistant roles while permissions can still be tuned from Admin.

Decision:

Use the real login flow for browser/server-action tests. Seeded users start with temporary passwords (`admin` for default Admin and `123456` for employees), stored as scrypt hashes. Seeded employees must change password before normal app access; default Admin is a local setup exception. The real pilot uses one PM role instead of Planning PM / Technical PM / PM Assistant.

Verification:

Verified with domain tests, Prisma validation, TypeScript, production build, `pilot:check`, direct pilot E2E, and browser/server-action workflow E2E. In this sandbox, direct local binaries were used for package scripts because `pnpm test:domain` repeatedly triggered a dependency-status reinstall and tried to fetch npm packages; the equivalent `node --test tests/domain/*.test.ts` passed.

Related Docs:

- `docs/00-product/decision-log.md`
- `docs/00-product/mvp-definition.md`
- `docs/02-schema/schema-v0.md`
- `docs/02-schema/permissions-matrix.md`
- `docs/03-build/acceptance-tests.md`

### 2026-06-29: Narrowed Broad MoldPilot Vision To Phase 1 Mold Trial Tracker

Context:

The original MoldPilot vision was closer to a broad partial ERP and mold pilot system.

Tried:

Reduced Phase 1 to the mold trial control loop: intake, T0 schedule, trial result or missed reason, open issues, next trial date, and trial-limit visibility.

Result:

Worked as the project foundation.

Why:

The team can adopt one habit first instead of being asked to change the whole project-control process at once.

Decision:

Keep Phase 1 focused on Mold Trial Tracker. Treat wider ERP, purchasing, customer portal, readiness checklist, and task-board features as later expansion.

Verification:

Captured in `docs/00-product/decision-log.md`, `docs/00-product/mvp-definition.md`, and `docs/01-domain/workflow-stages.md`.

Related Docs:

- `docs/00-product/decision-log.md`
- `docs/00-product/mvp-definition.md`
- `docs/01-domain/workflow-stages.md`

### 2026-06-29: Added Marketing/Sales Intake Before T0 Scheduling

Context:

The user clarified that Marketing/Sales starts the real process because they receive the customer/project signal first.

Tried:

Added intake projects that can exist before the first planned trial date is known.

Result:

Worked, with a clear boundary: Marketing/Sales creates sanitized intake, while PM owns T0 scheduling.

Why:

This matches the business flow without giving Marketing/Sales control over trial scheduling or internal correction decisions.

Decision:

Allow Marketing/Sales intake creation using customer code and sanitized notes only. Customer names, contacts, emails, phone numbers, quote values, and sales pipeline fields remain outside Phase 1 core tables.

Verification:

Schema docs and seed scenarios include intake records.

Related Docs:

- `docs/00-product/decision-log.md`
- `docs/02-schema/schema-v0.md`
- `docs/02-schema/permissions-matrix.md`

### 2026-06-29: Hardcoded Role Checks Worked For Scaffold But Need Replacement

Context:

The early app needed server-side authorization quickly, before the full Admin permission-management model was implemented.

Tried:

Implemented role-based permission sets directly in server actions.

Result:

Partially worked for a scaffold, but is now the wrong long-term shape.

Why:

The user clarified that it is too hard to define every role upfront. Admin needs to manage users, roles, and permissions through checkboxes by role or process.

Decision:

Replace hardcoded role checks with named permission codes, role permissions, and user permission overrides. Keep business validation separate from permission checks.

Verification:

Current code still contains hardcoded role sets in `src/server/mold-trial-actions.ts`; this remains a next-milestone implementation item.

Related Docs:

- `docs/00-product/decision-log.md`
- `docs/02-schema/permissions-matrix.md`
- `docs/02-schema/schema-v0.md`

### 2026-06-29: Direct Database Pilot E2E Is Useful But Insufficient

Context:

The pilot E2E script creates realistic data and performs basic HTTP smoke checks.

Tried:

Used a Node script to create the pilot project, trial records, issues, and activity logs directly through Prisma.

Result:

Partially worked. It proves the data shape and page rendering, but not the real server-action workflow.

Why:

Direct database writes can bypass permissions, validation, redirects, and form behavior that users actually rely on.

Decision:

Keep the script as a seed/smoke tool, but add server-action integration tests or Playwright flows for real permission and workflow coverage.

Verification:

`scripts/pilot-e2e.mjs` still writes directly through Prisma.

Related Docs:

- `docs/03-build/acceptance-tests.md`
- `docs/03-build/pilot-acceptance-checklist.md`

### 2026-06-30: Documentation Sync Added To Project Skills

Context:

The user pointed out that the final product may become different from the original idea and that undocumented changes will confuse future coding work.

Tried:

Updated the MoldPilot project skills to require doc updates when accepted product, workflow, schema, permission, UI, or acceptance-rule changes are not already represented in `docs/`.

Result:

Worked as a project operating rule.

Why:

Future conversations and Coder prompts should follow the source-of-truth docs instead of stale memory or scattered chat context.

Decision:

Before implementing confirmed feature changes, update the relevant docs. Add decision-log entries when the change explains why the project moved away from an earlier assumption.

Verification:

Project skill files include a Documentation Sync Protocol.

Related Docs:

- `docs/00-product/decision-log.md`
- `docs/04-agents/skills-list.md`

### 2026-07-01: Customer Master For Intake Captured

Context:

The user confirmed that project creation should select an existing customer instead of letting users type customer codes or names freely.

Tried:

Reviewed the customer/privacy language across product, workflow, schema, permission, UI, acceptance, pilot checklist, and build-plan docs.

Result:

Updated docs to add an Admin-managed Customer Master and searchable customer selector for project intake. `MoldTrialProject` should reference Customer and keep a `customer_code` snapshot. Customer Master includes code, display name, short name, aliases, notes, and active/archive state.

Why:

This prevents duplicate customer spellings and invalid customer codes without turning Phase 1 into CRM.

Decision:

Admin manages Customer Master records from `/admin`. PM and Marketing select active customers during intake/project creation. Customer contact person, email, phone, quote value, sales stage, customer portal, and communication history remain out of Phase 1.

Verification:

Documentation-only update. Code, migrations, seed data, and tests have not been run for this change yet.

Related Docs:

- `docs/00-product/decision-log.md`
- `docs/00-product/mvp-definition.md`
- `docs/01-domain/workflow-stages.md`
- `docs/02-schema/schema-v0.md`
- `docs/02-schema/permissions-matrix.md`
- `docs/03-ui/phase-1-screen-specs.md`
- `docs/03-build/acceptance-tests.md`
- `docs/03-build/pilot-acceptance-checklist.md`
- `docs/03-build/phase-1-build-plan.md`

### 2026-07-01: Client Table Simplified To Match Real Workbook

Context:

The user provided `RAW/Clients-info.xlsx` and clarified that the Admin customer tab was showing too much unnecessary information.

Tried:

Read the workbook sheet `客户简称`. It contains the practical client columns: 序号, 客户代码, 客户简称, 国籍, 负责人, and 备注/成交年份.

Result:

Updated docs so the Admin customer UI is a compact Clients table with English labels: No., Client Code, Client Short Name, Country, Owner, Notes / Deal Year, and Actions. Client owner assignment uses current active users, not roles. User accounts now require support for English display name plus optional Chinese name.

Why:

The pilot needs a simple client lookup/ownership table, not a CRM-like customer profile. The bilingual user name field lets imported owner names map cleanly to active users while keeping current app labels in English.

Decision:

Keep `User.display_name` as the English/current app display name and add `User.chinese_name`. Add client country and owner-user relation. Import workbook owners using 刘婉霞 = Anna, 周娟娥 = Zoe, 彭利满 = Peng.

Verification:

Documentation-only update. Code, migrations, seed/import, and tests have not been run for this change yet.

Related Docs:

- `docs/00-product/decision-log.md`
- `docs/00-product/mvp-definition.md`
- `docs/02-schema/schema-v0.md`
- `docs/02-schema/permissions-matrix.md`
- `docs/03-ui/phase-1-screen-specs.md`
- `docs/03-build/acceptance-tests.md`

### 2026-07-01: Customer Master Implemented For Intake

Context:

Project creation needed to stop accepting free-typed customer text and instead select from Admin-managed active Customer Master records.

Tried:

Added the Customer schema, backfill migration, seed data, Admin Customers tab, searchable intake selector, server-side active-customer enforcement, pilot seed checks, and Customer Master domain/browser workflow tests.

Result:

`MoldTrialProject` now references `Customer` through `customer_id` and still snapshots `customer_code`. `/admin?tab=customers` can create, edit, archive, and restore customers using `admin.manage_customers`. Project intake posts `customerId`, validates the selected Customer is active, and stores the code snapshot from Customer Master.

Why:

This keeps customer identity consistent while preserving the Phase 1 privacy boundary. Customer contacts, email, phone, quote values, sales stages, portal access, and communication history remain outside core Mold Trial Tracker tables and forms.

Verification:

Added Customer Master domain coverage and extended pilot/preflight/browser workflow checks. Commands to run for this implementation are `pnpm exec prisma validate`, `pnpm test:domain`, `pnpm typecheck`, `pnpm pilot:check`, `pnpm pilot:e2e`, and `pnpm pilot:workflow:e2e`.

Related Docs:

- `docs/00-product/decision-log.md`
- `docs/02-schema/schema-v0.md`
- `docs/02-schema/permissions-matrix.md`
- `docs/03-ui/phase-1-screen-specs.md`
- `docs/03-build/acceptance-tests.md`

### 2026-07-01: Clients Workbook Import And Bilingual User Names Implemented

Context:

The Admin customer table still behaved like a generic Customer Master form, while the real pilot data comes from `RAW/Clients-info.xlsx` with client code, short name, country, owner, and notes/deal-year columns.

Tried:

Added `User.chinese_name`, client country, and client owner-user relation. Updated `/admin` to use a compact Clients tab, imported all workbook rows in seed, mapped workbook owners to active users, and updated project intake search/display.

Result:

Implemented. Admin Users can store English display name plus optional Chinese name. Admin Clients now uses workbook-style columns: No., Client Code, Client Short Name, Country, Owner, Notes / Deal Year, and Actions. Client owners are selected from active users, not roles. Project creation searches active clients by code, short name, country, owner English name, and owner Chinese name.

Why:

The pilot needs a practical client master, not CRM fields. Chinese names are required to map workbook owner names while keeping the normal app display in English.

Decision:

Keep `Customer` as the internal model name for now, but label the Admin UI as Clients. Mirror `Customer.display_name` from required `short_name` when importing workbook data. Do not add contact person, email, phone, quote, sales-stage, or communication-history fields.

Verification:

Passed `pnpm exec prisma validate`, `pnpm test:domain`, `pnpm typecheck`, `pnpm pilot:check`, `pnpm pilot:e2e`, and `pnpm pilot:workflow:e2e` after applying the migration, reseeding, and restarting the local dev server for HTTP checks.

Related Docs:

- `docs/00-product/decision-log.md`
- `docs/00-product/mvp-definition.md`
- `docs/02-schema/schema-v0.md`
- `docs/02-schema/permissions-matrix.md`
- `docs/03-ui/phase-1-screen-specs.md`
- `docs/03-build/acceptance-tests.md`

### 2026-07-01: Optional Intake Identifiers And Admin Batch Save Implemented

Context:

Real intake can happen before Sales/Marketing knows the client project reference or the mold code. Admin Users and Clients also needed spreadsheet-like staged edits instead of per-row Save buttons.

Tried:

Added optional `client_project_ref` on MoldTrialProject while keeping `project_code` as the required internal route/tracking key. Loosened intake validation, added generated tracking codes for blank intake records, added a mold-code guard before trial scheduling/activity, and replaced existing Admin Users/Clients row saves with staged batch editors.

Result:

Implemented. Project creation can omit Project Code / Client Ref and Mold Code while the record remains Intake. PM/Admin can update identifiers on the detail page. Setting first T0, scheduling/rescheduling trials, recording missed/completed trials, and creating/updating trial issues now require Mold Code. Dashboard/list shows Mold Code first and optional Client Project Ref second. Admin Users and Clients show sticky Unsaved changes / Save changes / Discard changes bars and submit changed rows through server-side batch actions.

Why:

This keeps early intake lightweight without allowing real trial records against an unidentified mold. Batch saving makes Admin cleanup less repetitive while preserving server-side permission checks and ActivityLog entries per changed row.

Decision:

Do not make `project_code` nullable. Treat it as an internal unique tracking code. Store user-facing references in `client_project_ref`.

Verification:

Run Prisma validation, domain tests, typecheck, pilot checks, and browser workflow E2E after applying this patch.

Related Docs:

- `docs/00-product/decision-log.md`
- `docs/00-product/mvp-definition.md`
- `docs/01-domain/workflow-stages.md`
- `docs/02-schema/schema-v0.md`
- `docs/02-schema/permissions-matrix.md`
- `docs/03-ui/phase-1-screen-specs.md`
- `docs/03-build/acceptance-tests.md`

### 2026-07-01: Multi-Part / Multi-Cavity Mold Support Captured

Context:

The user clarified that some mold projects contain multiple part codes or cavities inside the same mold, so the single project-level `part_code` assumption is not realistic enough.

Tried:

Reviewed the product, workflow, schema, UI, permissions, acceptance, and build-plan docs for single-part assumptions.

Result:

Updated docs to introduce `MoldTrialPart` as a child entity under `MoldTrialProject`. Trial events and trial-limit counting remain mold-level. Trial issues can optionally identify an affected part/cavity.

Why:

This avoids comma-separated part codes, prevents creating separate mold projects for parts inside the same mold, and keeps the Phase 1 tracker focused while allowing realistic family-mold and multi-cavity data.

Decision:

Next implementation should add the schema/model/UI support before deeper workflow polish: migrate existing project `partCode` into the first `MoldTrialPart`, show primary part plus count in lists, add a Parts / Cavities section on detail, and allow optional affected part/cavity on TrialIssue.

Verification:

Documentation-only update. Code, migrations, and tests have not been run for this change yet.

Related Docs:

- `docs/00-product/decision-log.md`
- `docs/00-product/mvp-definition.md`
- `docs/01-domain/workflow-stages.md`
- `docs/02-schema/schema-v0.md`
- `docs/02-schema/permissions-matrix.md`
- `docs/03-ui/phase-1-screen-specs.md`
- `docs/03-build/acceptance-tests.md`
- `docs/03-build/phase-1-build-plan.md`

### 2026-06-30: Permission-Aware UI And Real Browser Workflow E2E

Context:

The named permission foundation worked server-side, but the UI still showed action forms too broadly and the existing pilot E2E mostly verified data shape through Prisma instead of exercising browser-submitted server actions.

Tried:

Added effective-permission loading helpers, permission-aware dashboard/detail/Admin form states, Admin lockout guardrails, and a real browser workflow script using headless Chrome DevTools Protocol. The workflow switches current users, submits the project intake and trial scheduling forms, checks blocked UI states, acknowledges an Assembly issue, and proves an Admin role-permission toggle changes subsequent QC behavior.

Result:

Worked. The browser workflow exposed two useful implementation gaps: the test helper was selecting the wrong container for dashboard forms, and the issue-type option list omitted schema-supported Phase 1 issue types such as Assembly / Fitting Issue. Both were fixed.

Why:

The server remains the source of truth for authorization, but pilot users need clear “Current user cannot perform this action” states instead of discovering permission failures only after submitting. The real browser workflow gives better confidence that cookies, server actions, redirects, and forms work together.

Decision:

Keep `scripts/pilot-e2e.mjs` as the DB/data smoke test and use `pnpm pilot:workflow:e2e` for browser/server-action workflow coverage. Keep the local current-user selector for v0.1 pilot auth; full login remains out of scope.

Verification:

`pnpm exec prisma validate`, `pnpm test:domain`, `pnpm typecheck`, `pnpm build`, `pnpm pilot:check`, and `pnpm pilot:workflow:e2e` passed. `pilot:check` warned only that HTTP smoke was skipped because no dev server was listening on port 3000 during that command.

Related Docs:

- `docs/02-schema/permissions-matrix.md`
- `docs/03-build/acceptance-tests.md`
- `docs/03-build/pilot-acceptance-checklist.md`

### 2026-06-30: Permission-Aware Workflow Review Passed

Context:

The permission-aware UI and browser/server-action workflow milestone was reviewed after implementation.

Tried:

Inspected the project detail UI gates, Admin permission UI, admin lockout guard, effective-permission helpers, server-side permission checks, and the browser workflow E2E script.

Result:

Worked. No blocking code or documentation drift was found.

Why:

The UI now reflects effective permissions while server actions still enforce authorization. The browser workflow covers real current-user switching, form submission, server actions, redirects, role-permission toggling, and database outcome checks.

Decision:

Accept this milestone and move the next milestone toward photo-backed trial issue evidence and annotation-lite, matching the PM trial-photo workflow in the product vision.

Verification:

`pnpm exec prisma validate`, `pnpm test:domain`, `pnpm typecheck`, `pnpm build`, `pnpm pilot:workflow:e2e`, `pnpm pilot:check` with a temporary dev server, and `pnpm pilot:e2e` with a temporary dev server passed.

Related Docs:

- `docs/01-domain/workflow-stages.md`

### 2026-06-30: Admin Tabs And Safe Role Deletion Added To Scope

Context:

The Admin matrix milestone previously treated hard role deletion as out of scope and relied on role deactivation as the safe path.

Tried:

Updated the source-of-truth docs to split `/admin` into distinct Users and Roles & Permissions areas and to support a delete/remove role action.

Result:

Accepted as the next Admin UX refinement. Role removal should feel like deletion to Admin users, but the server must hard-delete only unused/no-history roles and deactivate/archive roles that have assigned users or preserved history.

Why:

User creation and role/permission design are distinct workflows. Keeping them in separate tabs reduces confusion, while safe deletion keeps the active matrix clean without breaking historical records.

Decision:

Implement Admin tabs plus safe role deletion/removal before continuing deeper workflow modules if Admin setup needs to be polished first. The protected Admin role remains undeletable and cannot lose the last active admin path.

Verification:

Pending implementation. Acceptance tests now define user-tab creation, matrix permission editing, safe role deletion, and protected Admin role behavior.

Related Docs:

- `docs/00-product/decision-log.md`
- `docs/00-product/mvp-definition.md`
- `docs/02-schema/schema-v0.md`
- `docs/02-schema/permissions-matrix.md`
- `docs/03-build/acceptance-tests.md`

### 2026-06-30: Admin Process x Role Permission Matrix

Context:

The Admin role-permission editor worked by opening each role separately, but the preferred product direction is now a spreadsheet-like process x role matrix so Admin can review one workflow step across all roles at once.

Tried:

Updated the permission docs and decision log first, then replaced the `/admin` role-permission editor with a compact matrix grouped by process. Added role create/edit/deactivate support, protected the Admin role from deactivation, kept critical Admin management permissions locked, and made matrix saves write RolePermission and ActivityLog records through server actions that require `admin.manage_roles`.

Result:

Worked. The matrix-backed browser workflow can grant QC the reschedule permission, verify QC gains the Add New Planned Trial UI/action, revoke the permission from the matrix, and verify QC is blocked again. The pure domain tests now cover protected Admin role state and matrix-style lockout safety.

Why:

The matrix matches the source-of-truth permissions matrix better than role-by-role editing and makes cross-role permission drift easier to spot during pilot setup.

Decision:

Use the process x role matrix as the preferred Admin role-permission management view. Keep user-specific permission override UI out of scope for now. This entry originally kept hard delete for roles out of scope; that was superseded by the later safe role deletion/removal decision, where unused roles may be hard-deleted and roles with users/history should be deactivated or archived.

Verification:

Direct local equivalents passed from the restored offline dependency install: Prisma validate, domain tests with 65 passing tests, Prisma generate, Next typegen, `tsc --noEmit`, Next build, `pilot:check`, `pilot:e2e`, and `pilot:workflow:e2e`. Plain bundled `pnpm ...` commands attempted to recreate `node_modules` from the npm registry because the sandbox pnpm default store did not match the project offline store; direct local binaries were used for verification in this offline session.

Related Docs:

- `docs/00-product/decision-log.md`
- `docs/02-schema/permissions-matrix.md`
- `docs/03-build/acceptance-tests.md`

### 2026-06-30: Admin Tabs And Safe Role Removal

Context:

The process x role permission matrix worked, but `/admin` still mixed account-management forms with role and permission configuration on one long page.

Tried:

Split `/admin` into server-rendered Users and Roles & Permissions tabs. Users initially supported department group assignment, which was later removed from Phase 1 account setup. Roles & Permissions keeps the process x role matrix, adds role create/edit/remove controls, protects the Admin role from rename/deactivation/removal, and routes role removal through a server action that hard-deletes unused roles or archives assigned roles.

Result:

Worked. The browser workflow now creates a user from the Users tab, creates and hard-deletes an unused role from the Roles & Permissions tab, then toggles QC reschedule permission through the matrix and verifies the changed UI/server-action behavior.

Why:

Admin setup is easier when account work and permission design are separated. Safe role removal gives Admin a cleanup path without risking user/history integrity.

Decision:

Use tab-separated Admin panels for v0.1. Keep role hard delete limited to roles with no assigned users; otherwise archive by setting inactive. Keep user-specific permission override UI out of scope.

Verification:

Domain tests passed with 69 tests, direct typecheck passed, and `pilot:workflow:e2e` passed with the new Admin tab/user/role paths.

Related Docs:

- `docs/00-product/decision-log.md`
- `docs/02-schema/permissions-matrix.md`
- `docs/02-schema/schema-v0.md`
- `docs/02-schema/permissions-matrix.md`
- `docs/03-build/acceptance-tests.md`
- `docs/03-build/pilot-acceptance-checklist.md`

### 2026-06-30: Named Permission Foundation Implemented

Context:

Phase 1 had hardcoded role checks in server actions and trusted per-form acting-user fields. The docs called for Admin-assigned internal accounts, named permissions, role grants, and user override support.

Tried:

Added Prisma models for Permission, RolePermission, and UserPermissionOverride. Seed now creates the Phase 1 permission codes and default role grants from the permissions matrix. Server actions resolve the actor from a current-user cookie and check named permission codes. A compact `/admin` page manages users and role-permission assignments.

Result:

Worked for the v0.1 permission foundation at that time. QC and Marketing/Sales no longer inherited reschedule access by form choice; Technical PM, PM Assistant, Injection Manager, Planning PM, and Admin had default reschedule permission. This role split was later superseded by the real pilot PM/Injection/Admin default reschedule model on 2026-07-01. Permission changes write ActivityLog records.

Why:

Named permission checks let Admin change workflow authority without editing hardcoded server role sets, while business validators still enforce required dates, reasons, trial-limit rules, closure fields, and privacy boundaries.

Decision:

Use role permissions as the editable default policy. Keep UserPermissionOverride in schema/helpers for exceptions, but user-specific override UI is not built yet. The current-user selector and "password/email login out of v0.1 scope" note was superseded by the 2026-07-01 real login MVP.

Verification:

`pnpm exec prisma validate`, `pnpm test:domain`, `pnpm typecheck`, `pnpm build`, and `pnpm pilot:check` passed. `pilot:check` warned only that HTTP smoke was skipped because the dev server was not running.

Related Docs:

- `docs/02-schema/schema-v0.md`
- `docs/02-schema/permissions-matrix.md`
- `docs/01-domain/workflow-stages.md`

### 2026-06-30: Permission Milestone Review Passed With Real-Workflow Test Gap

Context:

The named permission foundation was reviewed after implementation.

Tried:

Inspected schema, permission helpers, Admin actions, trial server actions, Admin UI, seed data, docs, and pilot scripts. Ran Prisma validation, domain tests, typecheck, production build, pilot preflight, HTTP smoke, and pilot E2E.

Result:

Worked after repairing a corrupted generated `node_modules` tree where pnpm dependency symlinks had been placed into duplicate `node_modules 2` folders. Source checks then passed.

Why:

The code now uses named permissions and a current-user cookie instead of per-form acting-user fields. However, the pilot E2E script still writes most workflow state directly through Prisma, so it proves data shape and page rendering more than real server-action behavior.

Decision:

Treat the permission foundation as accepted for v0.1. The next milestone should make the module more realistically interactive: permission-aware UI states and browser/server-action workflow tests.

Verification:

`pnpm exec prisma validate`, `pnpm test:domain`, `pnpm typecheck`, `pnpm build`, `pnpm pilot:check`, and `pnpm pilot:e2e` passed after dependency repair. HTTP smoke passed with a temporary dev server.

Related Docs:

- `docs/02-schema/permissions-matrix.md`
- `docs/03-build/acceptance-tests.md`
- `docs/03-build/pilot-acceptance-checklist.md`

### 2026-06-30: Development Log Created

Context:

The user approved creating a development log to track what was tried, failed, worked, removed, and why.

Tried:

Created `docs/03-build/development.md`.

Result:

Worked as the engineering companion to the product decision log.

Why:

The decision log should stay focused on product direction. The development log should capture implementation history, test gaps, and lessons for future Coder prompts.

Decision:

Use this file during progress reviews and after meaningful coding milestones.

Verification:

This entry exists.

Related Docs:

- `docs/00-product/decision-log.md`
- `docs/04-agents/skills-list.md`
