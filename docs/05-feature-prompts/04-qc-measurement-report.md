# Feature 4 — QC Measurement Report Workflow

## Context (read first)

Repo: MoldPilot — internal mold trial tracker. Next.js 16 App Router, TypeScript strict, Prisma 7 + PostgreSQL, Tailwind v4. Path alias `@/`. Domain logic in `src/domain/mold-trial/`, server actions in `src/server/`, tests in `tests/domain/` (node --test). Shared UI in `src/components/ui/`. Permissions: codes in `src/domain/mold-trial/permission-policy.ts`, seeded roles include QC and Marketing. ActivityLog on every mutation.

**Depends on merged attachment infrastructure**: `uploadAttachment` action, `/api/attachments/[id]` download route, `FileVisibility.CUSTOMER_SAFE`, permission codes `attachment.upload` / `attachment.download.customer_safe`, QC_REPORT file rules (pdf/xlsx/xls/docx, ≤25 MB), components in `src/components/attachments/`.

Trial lifecycle: `TrialEvent.status` becomes COMPLETED when a result is recorded (see `src/server/mold-trial-actions.ts`); results include PENDING_QC. Trial panels render on the project detail page (`src/app/projects/[projectCode]/`, domain view logic in `src/domain/mold-trial/trial-panel.ts`).

## Goal

After a trial is completed, QC uploads the finished measurement report (PDF/Excel produced outside the system). Marketing sees it and downloads it to send to the customer. The system tracks whether each completed trial has its report.

## Requirements

1. **Domain rules** (pure, in `src/domain/mold-trial/measurement-report.ts`, unit-tested):
   - `measurementReportState(trial, attachments)` → `NOT_REQUIRED` (trial not completed) | `MISSING` | `UPLOADED { uploadedAt, uploadedBy, attachmentId }`. A trial's measurement report = non-deleted QC_REPORT attachment with entityType TRIAL_EVENT for that trial; newest wins if several.
   - Upload allowed only when trial status is COMPLETED (or PENDING_FOLLOW_UP) — never for planned/missed trials.
2. **Permission codes** (add to policy + seed): `qc.measurement_report.upload` (QC + Admin), `qc.measurement_report.replace` (QC + Admin). Marketing download works through existing `attachment.download.customer_safe`.
3. **Server action** `uploadMeasurementReport` in `src/server/mold-trial-actions.ts` (or a new `qc-report-actions.ts`): wraps `uploadAttachment` with fileType QC_REPORT, entityType TRIAL_EVENT, default visibility CUSTOMER_SAFE (uploader can switch to INTERNAL for drafts not ready for the customer). Enforce the domain rule + permission. Replacing soft-deletes the previous report and logs `MEASUREMENT_REPORT_REPLACED`.
4. **Trial panel UI** (project detail, each completed trial):
   - Status line: `Measurement report: Missing` (amber StatusBadge) or `Uploaded · <date> · <uploader>` (green) with Download link.
   - For users with upload permission: Upload/Replace button (BottomSheet/modal: file + visibility + optional note → ActivityLog note).
5. **Marketing view**:
   - Project detail: "Customer files" section listing CUSTOMER_SAFE attachments (measurement reports first) with download buttons — visible to any role holding `attachment.download.customer_safe`.
   - Dashboard: in the existing summary/row data, add an indicator count "completed trials missing QC report" so PM/GM can chase it (extend `src/domain/mold-trial/dashboard.ts` + its tests).
6. **/me integration** (if /me is merged): QC users get a "QC: reports to upload" section — completed trials in the last 14 days missing a report. Skip cleanly if /me does not exist yet.

## UI quality bar

- The Missing state must be loud enough that QC and PM notice it, but only on completed trials — planned trials show nothing.
- Marketing's download path is the moment this feature earns trust: from project page to downloaded file in two clicks, file named `<projectCode>_<trialCode>_measurement-report.<ext>` via Content-Disposition.

## Out of scope

- Authoring or parsing measurement data inside the system (the MVP definition explicitly excludes this). Emailing the customer. Report templates. Approval workflow on the report itself.

## Acceptance

- `pnpm typecheck && pnpm test` pass; domain tests: report state machine, upload-eligibility per trial status, newest-wins selection.
- Walkthrough: complete a trial as PM → QC account uploads a PDF → Marketing account downloads it from "Customer files" with the correct filename → replace flow soft-deletes the old file and both events appear in ActivityLog.
- A QC upload attempt on a PLANNED trial is rejected server-side; a Viewer sees neither upload controls nor the customer files section.
