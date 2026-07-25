import Link from "next/link";
import { AccountMenu } from "@/app/account-menu";
import { AppHeader } from "@/components/layout/AppHeader";
import { BlockedAction, hasAllPermissionCodes, hasPermissionCode } from "@/app/permission-ui";
import { PartsCavitiesEditor } from "@/app/parts-cavities-editor";
import { AttachmentList } from "@/components/attachments/AttachmentList";
import { AttachmentUploader } from "@/components/attachments/AttachmentUploader";
import { ImageCaptureField } from "@/components/attachments/image-capture-field";
import { IssuePhotoCountChip, IssuePhotoGallery, type IssuePhoto } from "@/components/attachments/issue-photo-gallery";
import { StatusBadge, SubmitButton, statusToneClasses, toneForStatus } from "@/components/ui";
import { AddPlannedTrialPanelForm } from "@/app/projects/[projectCode]/add-planned-trial-form";
import { CustomerFilesSection } from "@/app/projects/[projectCode]/customer-files-section";
import { ExportProcessSheetPdfButton } from "@/app/projects/[projectCode]/export-process-sheet-pdf-button";
import { MeasurementReportPanel } from "@/app/projects/[projectCode]/measurement-report-panel";
import { ProcessSheetEditor } from "@/app/projects/[projectCode]/process-sheet-editor";
import { TrialIssueRowActions } from "@/app/projects/[projectCode]/trial-issue-row-actions";
import { formatPartSummary } from "@/domain/mold-trial/parts";
import { formatMoldWorkingIdentifier } from "@/domain/mold-trial/identifiers";
import { formatInjectionMachineLabel, isProcessSheetSummaryParameter } from "@/domain/mold-trial/process-sheet";
import {
  buildTrialPanels,
  formatDaysAway,
  formatTrialCountBadge,
  trialStageLabel,
  trialVerificationStatusOptions
} from "@/domain/mold-trial/trial-panel";
import { formatBilingualUserOption, formatIssueOwnerUserOption } from "@/domain/mold-trial/users";
import { attachmentLabels, issueFormLabels, issuePhotoLabels, myPlateLabels, pickLabel, type Locale } from "@/domain/mold-trial/labels";
import {
  daysBetweenProposedAndTarget,
  isProposedDateAfterTarget,
  type DateConfirmationStatus
} from "@/domain/mold-trial/date-confirmation";
import { createTranslator, translateLabel, type Dictionary } from "@/i18n";
import { getDictionary } from "@/i18n/server";
import {
  createTrialIssue,
  recordCompletedTrial,
  resolveAutoMissedTrial,
  setFirstPlannedTrialDate,
  updateMoldTrialProjectIdentifiers,
  updateMoldTrialParts
} from "@/server/mold-trial-actions";
import {
  approveTrialDateChange,
  confirmTrialDate,
  proposeTrialDateChange,
  redateReturnedTrial,
  rejectTrialDateChange
} from "@/server/date-confirmation-actions";
import {
  issueSourceOptions,
  issueStatusOptions,
  issueTypeOptions,
  missedTrialReasonOptions,
  responsibleAreaOptions,
  severityOptions,
  trialResultOptions
} from "@/server/dev-options";
import { selectCurrentPlannedTrial } from "@/domain/mold-trial/current-trial";
import { getMoldTrialProjectDetail } from "@/server/mold-trial-detail";
import {
  changeRequesterLabels,
  issueStatusLabels,
  issueTypeLabels,
  limitAdjustmentTypeLabels,
  missedTrialReasonLabels,
  newTrialReasonLabels,
  outcomeDispositionLabels,
  projectStatusLabels,
  responsibleAreaLabels,
  severityLabels,
  trialCodeLabels,
  trialResultLabels,
  trialStatusLabels
} from "@/server/mold-trial-codecs";
import { getCurrentUser } from "@/server/current-user";
import { getEffectivePermissionCodes } from "@/server/permissions";
import { getNavVisibility } from "@/server/nav";
import { getActiveUserOptions } from "@/server/user-options";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ projectCode: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

type ProjectDetail = Awaited<ReturnType<typeof getMoldTrialProjectDetail>>;

async function loadProjectDetail(projectCode: string, autoMissActorUserId: string): Promise<{
  detail: ProjectDetail | null;
  databaseError: string | null;
}> {
  try {
    return {
      detail: await getMoldTrialProjectDetail(projectCode, { autoMissActorUserId }),
      databaseError: null
    };
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "digest" in error &&
      String((error as { digest: unknown }).digest).startsWith("NEXT_HTTP_ERROR_FALLBACK;404")
    ) {
      throw error;
    }

    return {
      detail: null,
      databaseError: error instanceof Error ? error.message : "Unable to load project detail records."
    };
  }
}

function messageValue(searchParams: Record<string, string | string[] | undefined>, key: string): string | null {
  const value = searchParams[key];
  return typeof value === "string" ? value : null;
}

function formatDate(value: Date | string | null | undefined): string {
  if (value == null) {
    return "Not set";
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "2-digit",
    year: "numeric"
  }).format(new Date(value));
}

function inputDate(value: Date | string | null | undefined): string {
  if (value == null) {
    return "";
  }

  return new Date(value).toISOString().slice(0, 10);
}

function labelFor<T extends string>(labels: Record<string, T>, value: string | null | undefined): string {
  if (value == null) {
    return "Not set";
  }

  return labels[value] ?? value.replaceAll("_", " ");
}

/**
 * V7 (quiet the absence): render a missing project-overview value as a quiet
 * muted dash instead of a bold dark "Not set". The "Not set / 未设置" meaning is
 * preserved as a hover tooltip on the dash.
 */
function MissingDash() {
  return (
    <span className="valueMissing" title="Not set / 未设置">
      —
    </span>
  );
}

function optionalText(value: string | null | undefined) {
  const trimmed = typeof value === "string" ? value.trim() : "";
  return trimmed.length === 0 ? <MissingDash /> : trimmed;
}

function optionalDate(value: Date | string | null | undefined) {
  return value == null ? <MissingDash /> : formatDate(value);
}

function labelForTranslated<T extends string>(
  dictionary: Dictionary,
  group: string,
  labels: Record<string, T>,
  value: string | null | undefined
): string {
  return translateLabel(dictionary, group, labelFor(labels, value));
}

function formatActivityEntity(value: string): string {
  return value.replace(/([a-z])([A-Z])/g, "$1 $2");
}

function formatActivityAction(value: string): string {
  return value.replaceAll("_", " ");
}

function trialIssueRowStatusClass(status: string): string {
  if (
    status === "OPEN" ||
    status === "IN_PROGRESS" ||
    status === "WAITING_INTERNAL" ||
    status === "WAITING_CUSTOMER" ||
    status === "WAITING_SUPPLIER" ||
    status === "WAITING_VERIFICATION"
  ) {
    return "trialIssueRow trialIssueRowWarning";
  }

  if (status === "CLOSED") {
    return "trialIssueRow trialIssueRowClosed";
  }

  return "trialIssueRow";
}

function partOptionLabel(part: {
  partCode: string;
  partName: string | null;
  cavityLabel: string | null;
  cavityCount: number | null;
}): string {
  const cavity = part.cavityLabel == null ? "" : ` / cavity ${part.cavityLabel}`;
  const count = part.cavityCount == null ? "" : ` / ${part.cavityCount} cavities`;
  const name = part.partName == null ? "" : ` - ${part.partName}`;

  return `${part.partCode}${cavity}${count}${name}`;
}

function RecordTrialResultForm({
  dictionary,
  injectionMachines,
  projectCode,
  redirectTo,
  trial,
  lateEntry = false
}: {
  dictionary: Dictionary;
  injectionMachines: ProjectDetail["activeInjectionMachines"];
  projectCode: string;
  redirectTo: string;
  trial: {
    id?: string;
    actualDate?: Date | string | null;
    injectionMachineId?: string | null;
    machine?: string | null;
  } | null;
  lateEntry?: boolean;
}) {
  const t = createTranslator(dictionary);

  if (trial?.id == null) {
    return null;
  }

  return (
    <form action={recordCompletedTrial} className="formGrid compactPanelForm">
      <input type="hidden" name="projectCode" value={projectCode} />
      <input type="hidden" name="redirectTo" value={redirectTo} />
      <input type="hidden" name="trialEventId" value={trial.id} />
      <label>
        {t("field.actualDate")}
        <input name="actualDate" type="date" defaultValue={inputDate(trial.actualDate)} required />
      </label>
      <label>
        {t("field.result")}
        <select name="result" defaultValue="APPROVED" required>
          {trialResultOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {translateLabel(dictionary, "trialResult", option.label)}
            </option>
          ))}
        </select>
      </label>
      <label>
        {t("field.injectionMachine")}
        <select name="injectionMachineId" defaultValue={trial.injectionMachineId ?? ""}>
          <option value="">{t("process.noMachineSelected")}</option>
          {injectionMachines.map((machine) => (
            <option key={machine.id} value={machine.id}>
              {formatInjectionMachineLabel(machine)}
            </option>
          ))}
        </select>
      </label>
      <label>
        {t("field.sampleQuantity")}
        <input name="sampleQuantity" type="number" min="0" />
      </label>
      <label className="fullSpan">
        {t("field.mainIssuesSummary")}
        <textarea name="mainIssuesSummary" rows={2} />
      </label>
      <label className="fullSpan">
        {t("field.outcomeNote")}
        <textarea name="outcomeNote" rows={2} />
      </label>
      <div className="formActions">
        <button type="submit">{lateEntry ? t("project.recordLateResult") : t("project.recordResult")}</button>
      </div>
    </form>
  );
}

function AutoMissedResolutionForms({
  canResolveBlockedOrPaused,
  canResolveWithNewDate,
  dictionary,
  projectCode,
  redirectTo,
  trial
}: {
  canResolveBlockedOrPaused: boolean;
  canResolveWithNewDate: boolean;
  dictionary: Dictionary;
  projectCode: string;
  redirectTo: string;
  trial: { id?: string; plannedDate?: Date | string | null } | null;
}) {
  const t = createTranslator(dictionary);

  if (trial?.id == null) {
    return null;
  }

  if (!canResolveBlockedOrPaused && !canResolveWithNewDate) {
    return <div className="blockedAction">{t("common.blockedAction")}</div>;
  }

  return (
    <div className="autoMissedResolution">
      <h4>{t("project.resolveAutoMissed")}</h4>
      {canResolveWithNewDate ? (
        <form action={resolveAutoMissedTrial} className="formGrid compactPanelForm">
          <input type="hidden" name="projectCode" value={projectCode} />
          <input type="hidden" name="redirectTo" value={redirectTo} />
          <input type="hidden" name="trialEventId" value={trial.id} />
          <input type="hidden" name="resolutionMode" value="MISSED" />
          <label>
            {t("project.firstPlannedTrial")}
            <input name="plannedDate" type="date" defaultValue={inputDate(trial.plannedDate)} readOnly />
          </label>
          <label>
            {t("project.nextPlannedTrial")}
            <input name="newPlannedDate" type="date" required />
          </label>
          <label>
            {t("field.reason")}
            <select name="reasonCategory" defaultValue="DESIGN_NOT_READY" required>
              {missedTrialReasonOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {translateLabel(dictionary, "reason", option.label)}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t("field.responsibleArea")}
            <select name="responsibleArea" defaultValue="PLANNING" required>
              {responsibleAreaOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {translateLabel(dictionary, "responsibleArea", option.label)}
                </option>
              ))}
            </select>
          </label>
          <label className="fullSpan">
            {t("field.explanation")}
            <textarea name="explanation" rows={2} required />
          </label>
          <div className="formActions">
            <button type="submit">{t("project.resolveAutoMissed")}</button>
          </div>
        </form>
      ) : null}

      {canResolveBlockedOrPaused ? (
        <form action={resolveAutoMissedTrial} className="formGrid compactPanelForm">
          <input type="hidden" name="projectCode" value={projectCode} />
          <input type="hidden" name="redirectTo" value={redirectTo} />
          <input type="hidden" name="trialEventId" value={trial.id} />
          <label>
            {t("field.state")}
            <select name="resolutionMode" defaultValue="BLOCKED" required>
              <option value="BLOCKED">{t("label.projectStatus.Blocked")}</option>
              <option value="PAUSED">{t("label.projectStatus.Paused")}</option>
            </select>
          </label>
          <label className="fullSpan">
            {t("field.explanation")}
            <textarea name="explanation" rows={2} required />
          </label>
          <div className="formActions">
            <button type="submit">{t("common.saveChanges")}</button>
          </div>
        </form>
      ) : null}
    </div>
  );
}

/** The date-confirmation slice of a trial the desktop confirmation block needs. */
type ConfirmationTrial = {
  id?: string;
  plannedDate?: Date | string | null;
  dateConfirmationStatus: DateConfirmationStatus;
  proposedDate?: Date | string | null;
  proposedReason?: string | null;
  rescheduleRejectReason?: string | null;
  machineNoSnapshot?: string | null;
  machine?: string | null;
  dateConfirmedBy?: { displayName: string } | null;
};

const confirmationBadgeToneClass: Record<"amber" | "green" | "red", string> = {
  amber: "bg-amber-100 text-amber-800",
  green: "bg-green-100 text-green-800",
  red: "bg-red-100 text-red-800"
};

/**
 * Desktop trial-panel confirmation badge + inline actions. The badge reflects the
 * handshake state; the actions offered depend on the state and the viewer's
 * permissions (Injection confirms/proposes on pending trials, Marketing
 * approves/rejects a proposal, the PM re-dates a returned trial). Never blocks
 * result recording — this is advisory only.
 */
function TrialDateConfirmationBlock({
  canApprove,
  canConfirm,
  canProposeChange,
  canRedate,
  injectionMachines,
  locale,
  projectCode,
  redirectTo,
  trial,
  customerTargetDate
}: {
  canApprove: boolean;
  canConfirm: boolean;
  canProposeChange: boolean;
  canRedate: boolean;
  injectionMachines: ProjectDetail["activeInjectionMachines"];
  locale: Locale;
  projectCode: string;
  redirectTo: string;
  trial: ConfirmationTrial;
  customerTargetDate: Date | string | null;
}) {
  const cLabel = (key: keyof typeof myPlateLabels): string => pickLabel(myPlateLabels[key], locale);

  if (trial.id == null) {
    return null;
  }

  const status = trial.dateConfirmationStatus;
  const badge = ((): { text: string; tone: "amber" | "green" | "red" } => {
    switch (status) {
      case "CONFIRMED": {
        const who = trial.dateConfirmedBy?.displayName;
        const machine = trial.machineNoSnapshot ?? trial.machine;
        const suffix = [who, machine].filter((part) => part != null && String(part).length > 0).join(" · ");
        return {
          text: suffix.length === 0 ? cLabel("dateConfirmed") : `${cLabel("dateConfirmed")} · ${suffix}`,
          tone: "green"
        };
      }
      case "RESCHEDULE_PROPOSED":
        return { text: cLabel("changeAwaitingMarketing"), tone: "amber" };
      case "RETURNED_TO_PM":
        return { text: cLabel("returnedToPm"), tone: "red" };
      case "PENDING_CONFIRMATION":
      default:
        return { text: cLabel("datePendingConfirmation"), tone: "amber" };
    }
  })();

  const gapDays = daysBetweenProposedAndTarget(trial.proposedDate, customerTargetDate);
  const gapText =
    gapDays == null
      ? null
      : gapDays === 0
        ? cLabel("onTarget")
        : gapDays > 0
          ? `${gapDays} ${cLabel("daysBeforeTarget")}`
          : `${Math.abs(gapDays)} ${cLabel("daysAfterTarget")}`;
  const afterTarget = isProposedDateAfterTarget(trial.proposedDate, customerTargetDate);

  return (
    <section className="panelActionBlock" aria-label="Trial date confirmation">
      <h3>{cLabel("confirmTrialDates")}</h3>
      <p className="m-0">
        <span
          className={`inline-flex items-center rounded-full px-2.5 py-1 text-sm font-bold ${confirmationBadgeToneClass[badge.tone]}`}
        >
          {badge.text}
        </span>
      </p>

      {status === "PENDING_CONFIRMATION" && canConfirm ? (
        <form action={confirmTrialDate} className="formGrid compactPanelForm">
          <input type="hidden" name="projectCode" value={projectCode} />
          <input type="hidden" name="redirectTo" value={redirectTo} />
          <input type="hidden" name="trialEventId" value={trial.id} />
          <label>
            {cLabel("machine")}
            <select name="injectionMachineId" defaultValue="" required>
              <option value="" disabled>
                {cLabel("chooseMachine")}
              </option>
              {injectionMachines.map((machine) => (
                <option key={machine.id} value={machine.id}>
                  {formatInjectionMachineLabel(machine)}
                </option>
              ))}
            </select>
          </label>
          <div className="formActions">
            <button type="submit">{cLabel("confirmDate")}</button>
          </div>
        </form>
      ) : null}

      {status === "PENDING_CONFIRMATION" && canProposeChange ? (
        <form action={proposeTrialDateChange} className="formGrid compactPanelForm">
          <input type="hidden" name="projectCode" value={projectCode} />
          <input type="hidden" name="redirectTo" value={redirectTo} />
          <input type="hidden" name="trialEventId" value={trial.id} />
          <label>
            {cLabel("proposedDate")}
            <input name="proposedDate" type="date" required />
          </label>
          <label className="fullSpan">
            {cLabel("proposeReasonLabel")}
            <textarea name="proposedReason" rows={2} required />
          </label>
          <div className="formActions">
            {/* V5b: secondary to the panel's single primary (Confirm). */}
            <button type="submit" className="secondaryButton">{cLabel("proposeDifferentDate")}</button>
          </div>
        </form>
      ) : null}

      {status === "RESCHEDULE_PROPOSED" ? (
        <div className="trialPanelFacts">
          <span>
            {cLabel("currentPlannedDate")}
            <strong>{formatDate(trial.plannedDate)}</strong>
          </span>
          <span>
            {cLabel("proposedDate")}
            <strong>{formatDate(trial.proposedDate)}</strong>
          </span>
          <span>
            {cLabel("customerTargetDate")}
            <strong>{formatDate(customerTargetDate)}</strong>
          </span>
          <span>
            {cLabel("targetGap")}
            <strong className={afterTarget ? "text-status-missed" : undefined}>{gapText ?? "—"}</strong>
          </span>
        </div>
      ) : null}

      {status === "RESCHEDULE_PROPOSED" && trial.proposedReason != null ? (
        <p className="m-0">
          <strong>{cLabel("proposeReasonLabel")}:</strong> {trial.proposedReason}
        </p>
      ) : null}

      {status === "RESCHEDULE_PROPOSED" && canApprove ? (
        <div className="formActions" style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
          <form action={approveTrialDateChange}>
            <input type="hidden" name="projectCode" value={projectCode} />
            <input type="hidden" name="redirectTo" value={redirectTo} />
            <input type="hidden" name="trialEventId" value={trial.id} />
            <button type="submit">{cLabel("approve")}</button>
          </form>
        </div>
      ) : null}

      {status === "RESCHEDULE_PROPOSED" && canApprove ? (
        <form action={rejectTrialDateChange} className="formGrid compactPanelForm">
          <input type="hidden" name="projectCode" value={projectCode} />
          <input type="hidden" name="redirectTo" value={redirectTo} />
          <input type="hidden" name="trialEventId" value={trial.id} />
          <label className="fullSpan">
            {cLabel("rejectionReason")}
            <textarea name="rescheduleRejectReason" rows={2} required />
          </label>
          <div className="formActions">
            <button type="submit">{cLabel("reject")}</button>
          </div>
        </form>
      ) : null}

      {status === "RETURNED_TO_PM" && trial.rescheduleRejectReason != null ? (
        <p className="m-0">
          <strong>{cLabel("rejectionReason")}:</strong> {trial.rescheduleRejectReason}
        </p>
      ) : null}

      {status === "RETURNED_TO_PM" && canRedate ? (
        <form action={redateReturnedTrial} className="formGrid compactPanelForm">
          <input type="hidden" name="projectCode" value={projectCode} />
          <input type="hidden" name="redirectTo" value={redirectTo} />
          <input type="hidden" name="trialEventId" value={trial.id} />
          <label>
            {cLabel("setNewDate")}
            <input name="plannedDate" type="date" required />
          </label>
          <div className="formActions">
            <button type="submit">{cLabel("setNewDate")}</button>
          </div>
        </form>
      ) : null}
    </section>
  );
}

function TrialIssuePanelForm({
  activeParts,
  dictionary,
  locale,
  marketingIssueDefaults,
  projectCode,
  redirectTo,
  trialEventId
}: {
  activeParts: ProjectDetail["project"]["parts"];
  dictionary: Dictionary;
  locale: Locale;
  marketingIssueDefaults: boolean;
  projectCode: string;
  redirectTo: string;
  trialEventId: string;
}) {
  const t = createTranslator(dictionary);

  // R1 (blame-free intake): the only required decision is a title. The photo
  // control stays encouraged (not required). Type/source/severity/status/due date
  // keep sensible defaults and collapse into an optional "More details" block, so
  // reporting a problem feels like pointing at something, not filing a case. The
  // creator never names a person — the server routes to a department inbox.
  return (
    <form action={createTrialIssue} className="formGrid compactPanelForm widePanelForm">
      <input type="hidden" name="projectCode" value={projectCode} />
      <input type="hidden" name="redirectTo" value={redirectTo} />
      <input type="hidden" name="foundAtTrialEventId" value={trialEventId} />
      <label className="fullSpan">
        {t("field.title")}
        <input name="title" required />
      </label>
      <div className="fullSpan grid gap-1">
        <span className="text-sm font-bold text-neutral-700">{pickLabel(issuePhotoLabels.photos, locale)}</span>
        <ImageCaptureField name="photos" locale={locale} />
      </div>
      <details className="fullSpan issueMoreDetails">
        <summary>{pickLabel(issueFormLabels.moreDetails, locale)}</summary>
        <div className="formGrid compactPanelForm">
          <label>
            {t("field.affectedPart")}
            <select name="affectedPartId" defaultValue="">
              <option value="">{t("common.notSet")}</option>
              {activeParts.map((part) => (
                <option key={part.id} value={part.id}>
                  {partOptionLabel(part)}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t("field.issueType")}
            <select name="issueType" defaultValue={marketingIssueDefaults ? "BAD_CUSTOMER_FEEDBACK" : "MOLD_DESIGN_ISSUE"}>
              {issueTypeOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {translateLabel(dictionary, "issueType", option.label)}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t("field.source")}
            <select name="source" defaultValue={marketingIssueDefaults ? "MARKETING_CLIENT_FEEDBACK" : "INTERNAL_TRIAL"}>
              {issueSourceOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {translateLabel(dictionary, "issueSource", option.label)}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t("field.severity")}
            <select name="severity" defaultValue="MEDIUM">
              {severityOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {translateLabel(dictionary, "severity", option.label)}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t("field.status")}
            <select name="status" defaultValue="OPEN">
              {issueStatusOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {translateLabel(dictionary, "issueStatus", option.label)}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t("field.dueDate")}
            <input name="dueDate" type="date" />
          </label>
          <label className="fullSpan">
            {t("field.description")}
            <textarea name="description" rows={2} />
          </label>
        </div>
      </details>
      <div className="formActions">
        <SubmitButton>{t("common.addTrialIssue")}</SubmitButton>
      </div>
    </form>
  );
}

function verificationStatusForIssue(issue: { status: string; verificationResult?: string | null }): string {
  if (issue.status === "Closed") {
    return "Closed";
  }

  if (issue.verificationResult != null && issue.verificationResult.trim().length > 0) {
    return "Addressed";
  }

  if (issue.status === "Waiting Verification" || issue.status === "Verified") {
    return "Pending";
  }

  return "Not Verified";
}

function processValueDisplay(value: ProjectDetail["project"]["processValues"][number] | undefined): string {
  if (value == null) {
    return "-";
  }

  if (value.valueNumber != null) {
    return String(value.valueNumber);
  }

  if (value.valueDate != null) {
    return inputDate(value.valueDate);
  }

  return value.valueText ?? "-";
}

function ProcessSheetComparison({
  canEdit,
  canExport,
  currentEditableTrialId,
  detail,
  dictionary,
  projectCode,
  redirectTo
}: {
  canEdit: boolean;
  canExport: boolean;
  currentEditableTrialId: string | null;
  detail: ProjectDetail;
  dictionary: Dictionary;
  projectCode: string;
  redirectTo: string;
}) {
  const t = createTranslator(dictionary);
  const { activeInjectionMachines, project } = detail;
  const template = project.processSheetTemplate;
  const trials = project.trialEvents;
  const editableTrial = trials.find((trial) => trial.id === currentEditableTrialId) ?? null;

  return (
    <section className="workSurface processSheetSurface" aria-labelledby="process-sheet-heading">
      <div className="surfaceHeader">
        <div>
          <h2 id="process-sheet-heading">{t("project.digitalProcessSheet")}</h2>
          <span>{template?.name ?? t("process.noTemplateAssigned")}</span>
        </div>
        {canExport ? (
          <ExportProcessSheetPdfButton projectCode={projectCode} />
        ) : (
          <div className="blockedAction compactBlockedAction">{t("common.blockedAction")}</div>
        )}
      </div>

      <ProcessSheetEditor
        canEdit={canEdit}
        currentEditableTrialId={editableTrial?.id ?? null}
        machines={activeInjectionMachines.map((machine) => ({
          id: machine.id,
          label: formatInjectionMachineLabel(machine)
        }))}
        parameters={(template?.parameters ?? [])
          .filter((parameter) => !isProcessSheetSummaryParameter(parameter.parameterKey))
          .map((parameter) => ({
            id: parameter.id,
            section: parameter.section,
            parameterKey: parameter.parameterKey,
            labelEn: parameter.labelEn,
            labelZh: parameter.labelZh,
            unit: parameter.unit,
            valueType: parameter.valueType
          }))}
        projectCode={projectCode}
        redirectTo={redirectTo}
        templateName={template?.name ?? t("process.noTemplateAssigned")}
        trials={trials.map((trial) => ({
          id: trial.id,
          label: trialStageLabel(trial.sequenceNumber),
          statusLabel: labelFor(trialStatusLabels, trial.status),
          injectionMachineId: trial.injectionMachineId ?? ""
        }))}
        values={project.processValues.map((value) => ({
          trialEventId: value.trialEventId,
          processSheetParameterId: value.processSheetParameterId,
          displayValue: processValueDisplay(value)
        }))}
      />
    </section>
  );
}

export default async function MoldTrialProjectPage({ params, searchParams }: PageProps) {
  const { projectCode } = await params;
  const resolvedSearchParams = await searchParams;
  const currentUser = await getCurrentUser();
  const dictionary = await getDictionary();
  const t = createTranslator(dictionary);
  const { detail, databaseError } = await loadProjectDetail(projectCode, currentUser.id);
  const activeUserOptions = detail == null ? [] : await getActiveUserOptions();
  const activePmUserOptions = activeUserOptions.filter((user) => user.role.code === "pm");
  const permissionCodes = new Set(await getEffectivePermissionCodes(currentUser.id));
  const nav = await getNavVisibility({
    permissionCodes,
    roleCode: currentUser.roleCode,
    dbRoleCode: currentUser.role.code
  });
  const error = resolvedSearchParams == null ? null : messageValue(resolvedSearchParams, "error");
  const success = resolvedSearchParams == null ? null : messageValue(resolvedSearchParams, "success");

  if (detail == null) {
    return (
      <main className="shell">
        <AppHeader current="project" nav={nav} currentUser={currentUser} />
        <section className="pageHeader">
          <div>
            <Link className="backLink" href="/">
              {t("common.backToDashboard")}
            </Link>
            <p className="eyebrow">{t("project.moldTrialDetail")}</p>
            <h1>{projectCode}</h1>
          </div>
          <div className="md:hidden">
            <AccountMenu currentUser={currentUser} />
          </div>
        </section>

        <section className="notice" role="status">
          <strong>{t("dashboard.databaseUnavailable")}</strong>
          <span>{databaseError ?? "Unable to load project detail records."}</span>
        </section>
      </main>
    );
  }

  const { project, activityLogs, limit, issuePhotosByIssueId, measurementReportByTrialId } = detail;
  const redirectTo = `/projects/${project.projectCode}`;
  // V6 (state you can see): the workflow status as a prominent band. The English
  // domain label drives the shared status->tone map; the display text is bilingual.
  const projectStatusDomainLabel = projectStatusLabels[project.status] ?? project.status;
  const projectStatusDisplay = labelForTranslated(dictionary, "projectStatus", projectStatusLabels, project.status);
  const projectStatusTone = toneForStatus(projectStatusDomainLabel);
  // Measurement-report status line for a completed trial, or null when the trial
  // is not eligible (planned/missed trials show nothing).
  const measurementReportPanelState = (
    trialEventId: string | undefined
  ): { kind: "MISSING" } | { kind: "UPLOADED"; attachmentId: string; uploadedAt: string; uploadedBy: string } | null => {
    if (trialEventId == null) {
      return null;
    }
    const state = measurementReportByTrialId.get(trialEventId);
    if (state == null || state.kind === "NOT_REQUIRED") {
      return null;
    }
    if (state.kind === "MISSING") {
      return { kind: "MISSING" };
    }
    return {
      kind: "UPLOADED",
      attachmentId: state.attachmentId,
      uploadedAt: state.uploadedAt instanceof Date ? state.uploadedAt.toISOString() : String(state.uploadedAt),
      uploadedBy: state.uploadedBy
    };
  };
  // Display-shaped issue photos keyed by issue id, for the row chip + detail gallery.
  const issuePhotosForIssue = (issueId: string): IssuePhoto[] =>
    (issuePhotosByIssueId.get(issueId) ?? []).map((photo) => ({
      id: photo.id,
      fileName: photo.fileName,
      uploaderName: photo.uploadedBy.displayName,
      uploadedAt:
        photo.uploadedAt instanceof Date ? photo.uploadedAt.toISOString() : String(photo.uploadedAt)
    }));
  const activeParts = project.parts.filter((part) => part.active);
  const partSummary = formatPartSummary(project.parts, project.partCode);
  const workingIdentifier = formatMoldWorkingIdentifier({
    projectCode: project.projectCode,
    clientProjectRef: project.clientProjectRef,
    moldCode: project.moldCode
  });
  const defaultPlanningPmUsername = activePmUserOptions.some((user) => user.username === project.planningPm?.username)
    ? (project.planningPm?.username ?? "")
    : (activePmUserOptions[0]?.username ?? "");
  const currentTrialCandidates = project.trialEvents.map((trial) => ({
    id: trial.id,
    plannedDate: trial.plannedDate,
    status: trialStatusLabels[trial.status]
  }));
  const defaultCurrentTrialId = selectCurrentPlannedTrial(currentTrialCandidates)?.id ?? "";
  const defaultCurrentTrial = project.trialEvents.find((trial) => trial.id === defaultCurrentTrialId);
  const latestProcessSheetTrialId =
    [...project.trialEvents].sort((left, right) => {
      if (left.sequenceNumber !== right.sequenceNumber) {
        return right.sequenceNumber - left.sequenceNumber;
      }

      return new Date(right.plannedDate).getTime() - new Date(left.plannedDate).getTime();
    })[0]?.id ?? null;
  const currentProcessSheetTrialId = defaultCurrentTrialId || latestProcessSheetTrialId;
  const trialCountBadge = formatTrialCountBadge(limit);
  const nextTrialDaysAway = formatDaysAway(project.nextPlannedTrialDate);
  const moldCodeBlank = project.moldCode.trim().length === 0;
  const clientProjectRefBlank = project.clientProjectRef == null || project.clientProjectRef.trim().length === 0;
  const showInternalTrackingId = (moldCodeBlank && clientProjectRefBlank) || currentUser.roleCode === "ADMIN";
  const trialPanels = buildTrialPanels({
    currentTrialId: defaultCurrentTrialId,
    trialEvents: project.trialEvents.map((trial) => ({
      id: trial.id,
      trialCode: trialCodeLabels[trial.trialCode],
      sequenceNumber: trial.sequenceNumber,
      plannedDate: trial.plannedDate,
      actualDate: trial.actualDate,
      status: trialStatusLabels[trial.status],
      result: trial.result == null ? null : trialResultLabels[trial.result],
      outcomeDisposition: trial.outcomeDisposition == null ? null : outcomeDispositionLabels[trial.outcomeDisposition],
      countsAgainstLimit: trial.countsAgainstLimit,
      planReasonCategory: trial.planReasonCategory == null ? null : newTrialReasonLabels[trial.planReasonCategory],
      planReasonDetail: trial.planReasonDetail,
      relatedDesignChangeEventId: trial.relatedDesignChangeEventId,
      injectionMachineId: trial.injectionMachineId,
      machine: trial.machine
    })),
    issues: project.trialIssues.map((issue) => ({
      id: issue.id,
      title: issue.title,
      status: issueStatusLabels[issue.status],
      severity: severityLabels[issue.severity],
      foundAtTrialSequenceNumber: issue.foundAtTrialEvent?.sequenceNumber ?? null,
      verificationResult: issue.verificationResult
    })),
    designChanges: project.designChanges,
    trialLimitAdjustments: project.trialLimitAdjustments
  });
  const planningHistory = [
    ...project.missedTrialEvents.map((event) => ({
      id: `missed-${event.id}`,
      sortDate: event.createdAt,
      date: event.createdAt,
      type: "Missed Trial",
      subject: `${formatDate(event.plannedDate)} -> ${formatDate(event.newPlannedDate)}`,
      detail: `${labelFor(missedTrialReasonLabels, event.reasonCategory)} / ${labelFor(
        responsibleAreaLabels,
        event.responsibleArea
      )}: ${event.explanation}`
    })),
    ...project.trialEvents
      .filter((trial) => trial.planReasonCategory != null || trial.sequenceNumber > 1)
      .map((trial) => ({
        id: `trial-plan-${trial.id}`,
        sortDate: trial.createdAt,
        date: trial.createdAt,
        type: "New Planned Trial",
        subject: `${trialStageLabel(trial.sequenceNumber)} - ${formatDate(trial.plannedDate)}`,
        detail:
          trial.planReasonCategory == null
            ? trial.planReasonDetail ?? "No reason detail recorded"
            : `${labelFor(newTrialReasonLabels, trial.planReasonCategory)}: ${
                trial.planReasonDetail ?? "No reason detail recorded"
              }`
      })),
    ...project.designChanges.map((change) => ({
      id: `design-${change.id}`,
      sortDate: change.changeDate,
      date: change.changeDate,
      type: "Design Change",
      subject: change.title,
      detail: `${labelFor(changeRequesterLabels, change.requestedBy)} / ${
        change.grantsExtraTrial ? `+${change.extraTrialCount ?? 1} extra trial` : "No extra allowance"
      } / ${change.approvalReason ?? change.description}`
    })),
    ...project.trialLimitAdjustments.map((adjustment) => ({
      id: `limit-${adjustment.id}`,
      sortDate: adjustment.createdAt,
      date: adjustment.createdAt,
      type: "Limit Adjustment",
      subject: labelFor(limitAdjustmentTypeLabels, adjustment.adjustmentType),
      detail: `Delta ${adjustment.deltaTrials ?? "Not set"} / New limit ${adjustment.newLimit ?? "Not set"} / ${
        adjustment.reason
      }`
    }))
  ].sort((left, right) => new Date(right.sortDate).getTime() - new Date(left.sortDate).getTime());
  const canSetFirstT0 = hasPermissionCode(permissionCodes, "trial.schedule.first_t0");
  const canEditProjectBasics = hasPermissionCode(permissionCodes, "project.basic.edit");
  const canResolveAutoMissedWithNewDate = hasAllPermissionCodes(permissionCodes, [
    "trial.missed.record",
    "trial.schedule.reschedule"
  ]);
  const canResolveAutoMissedBlockedOrPaused = hasPermissionCode(permissionCodes, "trial.missed.record");
  const canRecordCompletedTrial = hasPermissionCode(permissionCodes, "trial.record.completed");
  const canAddNewPlannedTrial = hasPermissionCode(permissionCodes, "trial.schedule.reschedule");
  const canConfirmTrialDate = hasPermissionCode(permissionCodes, "trial.date.confirm");
  const canProposeTrialDateChange = hasPermissionCode(permissionCodes, "trial.date.propose_change");
  const canApproveTrialDateChange = hasPermissionCode(permissionCodes, "trial.date.approve_change");
  const canRedateReturnedTrial = hasPermissionCode(permissionCodes, "trial.schedule.reschedule");
  const canCreateIssue = hasPermissionCode(permissionCodes, "trial.issue.create");
  const canEditProcessSheet = hasPermissionCode(permissionCodes, "trial.process_sheet.edit");
  const canExportProcessSheet = hasPermissionCode(permissionCodes, "trial.process_sheet.export_pdf");
  const canUploadAttachment = hasPermissionCode(permissionCodes, "attachment.upload");
  const canAdminDeleteAttachment = hasPermissionCode(permissionCodes, "attachment.delete");
  // R5: only oversight roles pick a file visibility; workers get the safe default
  // (applied server-side in attachment-actions.ts when the field is omitted). UI
  // hiding only — the server still re-checks upload permission regardless.
  const canChooseAttachmentVisibility =
    currentUser.roleCode === "ADMIN" || currentUser.roleCode === "GM" || currentUser.roleCode === "PM";
  const canUploadMeasurementReport = hasPermissionCode(permissionCodes, "qc.measurement_report.upload");
  const canDownloadCustomerSafe = hasPermissionCode(permissionCodes, "attachment.download.customer_safe");
  const projectAttachments = detail.projectAttachments.map((attachment) => ({
    id: attachment.id,
    fileName: attachment.fileName,
    fileType: attachment.fileType,
    visibility: attachment.visibility,
    contentType: attachment.contentType,
    sizeBytes: attachment.sizeBytes,
    uploadedAt: attachment.uploadedAt,
    uploaderName: attachment.uploadedBy.displayName,
    uploadedById: attachment.uploadedById
  }));
  const marketingIssueDefaults = currentUser.roleCode === "MARKETING";
  const issueEditStatusOptions = [...issueStatusOptions, { value: "VERIFIED", label: "Verified" }];
  const issueActionPartOptions = activeParts.map((part) => ({
    id: part.id,
    label: partOptionLabel(part)
  }));
  const issueActionUserOptions = activeUserOptions.map((user) => ({
    username: user.username,
    label: formatIssueOwnerUserOption(user)
  }));
  const todayInputDate = inputDate(new Date());

  function canEditSimpleIssue(issue: ProjectDetail["project"]["trialIssues"][number]): boolean {
    if (issue.status === "CLOSED") {
      return currentUser.roleCode === "GM" && hasPermissionCode(permissionCodes, "trial.issue.create");
    }

    if (
      (currentUser.roleCode === "PM" || currentUser.roleCode === "ADMIN") &&
      hasPermissionCode(permissionCodes, "trial.issue.create")
    ) {
      return true;
    }

    return (
      currentUser.roleCode === "MARKETING" &&
      hasPermissionCode(permissionCodes, "trial.issue.create") &&
      (issue.source === "MARKETING_CLIENT_FEEDBACK" || issue.source === "CUSTOMER_DESIGN_CHANGE") &&
      (issue.createdById === currentUser.id || issue.reportedById === currentUser.id)
    );
  }

  function canCloseSimpleIssue(issue: ProjectDetail["project"]["trialIssues"][number]): boolean {
    if (issue.status === "CLOSED" || currentUser.roleCode === "VIEWER") {
      return false;
    }

    const ownerCanClose =
      issue.ownerUserId === currentUser.id &&
      (currentUser.roleCode !== "MARKETING" ||
        issue.source === "MARKETING_CLIENT_FEEDBACK" ||
        issue.source === "CUSTOMER_DESIGN_CHANGE");
    const oversightCanClose =
      (currentUser.roleCode === "PM" || currentUser.roleCode === "GM" || currentUser.roleCode === "ADMIN") &&
      hasPermissionCode(permissionCodes, "trial.issue.close");

    return ownerCanClose || oversightCanClose;
  }

  return (
    <main className="shell">
      <AppHeader current="project" nav={nav} currentUser={currentUser} />
      <section className="pageHeader">
        <div>
            <Link className="backLink" href="/">
              {t("common.backToDashboard")}
            </Link>
          <p className="eyebrow">{t("project.moldTrialDetail")}</p>
          <h1>{workingIdentifier}</h1>
        </div>
        <div className="pageHeaderActions">
          {/* Account moves to the desktop AppHeader; the trial badges stay (project info). */}
          <div className="md:hidden">
            <AccountMenu currentUser={currentUser} />
          </div>
          <div className="trialBadgeGroup" aria-label="Project trial status">
            <span className={`trialCountBadge state${limit.warningState.replaceAll(" ", "")}`}>{trialCountBadge}</span>
            <span className="nextTrialBadge">
              {t("project.nextTrial")} {formatDate(defaultCurrentTrial?.plannedDate ?? project.nextPlannedTrialDate)} ({nextTrialDaysAway})
            </span>
          </div>
        </div>
      </section>

      <div
        className={`${statusToneClasses[projectStatusTone].pill} flex w-full items-center justify-center gap-2 rounded-lg px-4 py-2 text-base font-bold`}
        role="status"
        aria-label="Project status"
      >
        <span className="font-normal opacity-70">{t("field.status")}</span>
        <span>{projectStatusDisplay}</span>
      </div>

      {error == null ? null : (
        <section className="notice noticeError" role="alert">
          <strong>{t("common.actionFailed")}</strong>
          <span>{error}</span>
        </section>
      )}

      {success == null ? null : (
        <section className="notice noticeSuccess" role="status">
          <strong>{t("common.saved")}</strong>
          <span>{success}</span>
        </section>
      )}

      <section className="workSurface detailSurface" aria-labelledby="project-overview-heading">
        <div className="surfaceHeader">
          <h2 id="project-overview-heading">{t("project.projectOverview")}</h2>
          <span className={`state state${limit.warningState.replaceAll(" ", "")}`}>
            {translateLabel(dictionary, "warning", limit.warningState)}
          </span>
        </div>
        <div className="detailGrid">
          <dl>
            <div>
              <dt>{t("project.customerCode")}</dt>
              <dd>{project.customerCode}</dd>
            </div>
            <div>
              <dt>{t("project.parts")}</dt>
              <dd>{partSummary}</dd>
            </div>
            <div>
              <dt>{t("field.moldCode")}</dt>
              <dd>{optionalText(project.moldCode)}</dd>
            </div>
            <div>
              <dt>{t("project.clientProjectRef")}</dt>
              <dd>{optionalText(project.clientProjectRef)}</dd>
            </div>
            {showInternalTrackingId ? (
              <div>
                <dt>{t("project.internalTrackingId")}</dt>
                <dd>{project.projectCode}</dd>
              </div>
            ) : null}
            <div>
              <dt>{t("field.status")}</dt>
              <dd>{labelForTranslated(dictionary, "projectStatus", projectStatusLabels, project.status)}</dd>
            </div>
          </dl>
          <dl>
            <div>
              <dt>PM</dt>
              <dd>
                {project.planningPm == null
                  ? t("common.unassigned")
                  : `${project.planningPm.displayName} (${project.planningPm.username})`}
              </dd>
            </div>
            <div>
              <dt>{t("project.firstPlannedTrial")}</dt>
              <dd>{optionalDate(project.firstPlannedTrialDate)}</dd>
            </div>
            <div>
              <dt>{t("project.nextPlannedTrial")}</dt>
              <dd>
                {formatDate(defaultCurrentTrial?.plannedDate ?? project.nextPlannedTrialDate)} ({nextTrialDaysAway})
              </dd>
            </div>
            <div>
              <dt>{t("project.customerTargetDate")}</dt>
              <dd>{optionalDate(project.customerTargetDate)}</dd>
            </div>
          </dl>
        </div>
        <div className="noteGrid">
          <div>
            <dt>{t("project.intakeNote")}</dt>
            <dd>{optionalText(project.intakeNote)}</dd>
          </div>
          <div>
            <dt>{t("project.initialCustomerNote")}</dt>
            <dd>{optionalText(project.initialCustomerNote)}</dd>
          </div>
        </div>
      </section>

      {canEditProjectBasics ? (
        <section className="workSurface formSurface" aria-labelledby="identifier-heading">
          <div className="surfaceHeader">
            <h2 id="identifier-heading">{t("project.identifierTitle")}</h2>
          </div>
          <form action={updateMoldTrialProjectIdentifiers} className="formGrid">
            <input type="hidden" name="projectCode" value={project.projectCode} />
            <input type="hidden" name="redirectTo" value={redirectTo} />
            <label>
              {t("field.clientProjectRef")}
              <input name="clientProjectRef" defaultValue={project.clientProjectRef ?? ""} placeholder={t("common.optional")} />
            </label>
            <label>
              {t("field.moldCode")}
              <input name="moldCode" defaultValue={project.moldCode} placeholder={t("common.optional")} />
            </label>
            <div className="formActions">
              {/* V5b: identifier edits are a secondary action, not the page's primary. */}
              <button type="submit" className="secondaryButton">{t("project.saveIdentifiers")}</button>
            </div>
          </form>
        </section>
      ) : null}

      <section className="workSurface" aria-labelledby="parts-cavities-heading">
        <div className="surfaceHeader">
          <h2 id="parts-cavities-heading">{t("project.partsCavities")}</h2>
          <span>{partSummary}</span>
        </div>
        <div className="tableWrap">
          <table>
            <thead>
              <tr>
                <th>{t("field.partCode")}</th>
                <th>{t("field.partName")}</th>
                <th>{t("field.cavity")}</th>
                <th>{t("field.count")}</th>
                <th>{t("field.state")}</th>
                <th>{t("field.notes")}</th>
              </tr>
            </thead>
            <tbody>
              {project.parts.length === 0 ? (
                <tr>
                  <td className="emptyTableCell" colSpan={6}>
                    {t("common.noData")}
                  </td>
                </tr>
              ) : (
                project.parts.map((part) => (
                  <tr key={part.id}>
                    <td>{part.partCode}</td>
                    <td>{part.partName ?? t("common.notSet")}</td>
                    <td>{part.cavityLabel ?? t("common.notSet")}</td>
                    <td>{part.cavityCount ?? t("common.notSet")}</td>
                    <td>{part.active ? t("common.active") : t("common.archived")}</td>
                    <td>{part.notes ?? t("common.notSet")}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {canEditProjectBasics ? (
          <form action={updateMoldTrialParts} className="formGrid">
            <input type="hidden" name="projectCode" value={project.projectCode} />
            <input type="hidden" name="redirectTo" value={redirectTo} />
            <PartsCavitiesEditor
              initialRows={activeParts.map((part) => ({
                id: part.id,
                partCode: part.partCode,
                partName: part.partName,
                cavityLabel: part.cavityLabel,
                cavityCount: part.cavityCount,
                notes: part.notes
              }))}
            />
            <div className="formActions">
              <button type="submit">{t("project.savePartsCavities")}</button>
            </div>
          </form>
        ) : (
          <div className="blockedAction">{t("common.blockedAction")}</div>
        )}
      </section>

      {project.status !== "INTAKE" ? null : canSetFirstT0 ? (
        <section className="workSurface formSurface" aria-labelledby="first-t0-heading">
          <div className="surfaceHeader">
            <h2 id="first-t0-heading">{t("project.setFirstT0Date")}</h2>
          </div>
          <form action={setFirstPlannedTrialDate} className="formGrid">
            <input type="hidden" name="projectCode" value={project.projectCode} />
            <input type="hidden" name="redirectTo" value={redirectTo} />
            <label>
              PM
              <select name="planningPmUsername" defaultValue={defaultPlanningPmUsername}>
                {activePmUserOptions.length === 0 ? <option value="">{t("common.noData")}</option> : null}
                {activePmUserOptions.map((user) => (
                  <option key={user.username} value={user.username}>
                    {formatBilingualUserOption(user)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {t("field.plannedT0Date")}
              <input name="plannedDate" type="date" required />
            </label>
            <div className="formActions">
              <button type="submit">{t("project.setT0Date")}</button>
            </div>
          </form>
        </section>
      ) : (
        <BlockedAction headingId="first-t0-heading" title={t("project.setFirstT0Date")} />
      )}

      <section className="workSurface trialPanelSurface" aria-labelledby="trial-panel-heading">
        <div className="surfaceHeader">
          <div>
            <h2 id="trial-panel-heading">{t("project.trialPanel")}</h2>
            <p className="surfaceSubtext">
              {t("project.trialPanelNext", {
                date: formatDate(defaultCurrentTrial?.plannedDate ?? project.nextPlannedTrialDate),
                days: nextTrialDaysAway
              })}
            </p>
          </div>
          <div className="trialPanelActions">
            <span className={`trialCountBadge state${limit.warningState.replaceAll(" ", "")}`}>{trialCountBadge}</span>
            {defaultCurrentTrial == null ? null : (
              <a className="buttonLink secondaryButtonLink" href={`#trial-panel-${defaultCurrentTrial.sequenceNumber}`}>
                {t("common.addTrialResult")}
              </a>
            )}
          </div>
        </div>
        <div className="trialPanelList">
          {trialPanels.map((panel) => {
            const issuesForPanel =
              panel.trial?.id == null
                ? []
                : project.trialIssues.filter((issue) => issue.foundAtTrialEventId === panel.trial?.id);
            const rawTrialEvent =
              panel.trial?.id == null
                ? null
                : project.trialEvents.find((event) => event.id === panel.trial?.id) ?? null;
            const showConfirmationBlock =
              rawTrialEvent != null &&
              (panel.trial?.status === "Planned" || panel.trial?.status === "At Risk");

            return (
            <details
              className="trialPanel"
              id={`trial-panel-${panel.sequenceNumber}`}
              key={panel.sequenceNumber}
              open={panel.isNextActionPanel && limit.completedTrialCount > 0}
            >
              <summary>
                <span>
                  <strong>{panel.title}</strong>
                  <small>
                    {panel.trial == null
                      ? t("project.noTrialRecord")
                      : `${translateLabel(dictionary, "trialStatus", panel.trial.status)} / ${formatDate(panel.trial.plannedDate)}`}
                  </small>
                </span>
                {panel.trial == null ? (
                  <span className="state">{t("project.notPlanned")}</span>
                ) : (
                  <span className="state">{translateLabel(dictionary, "trialStatus", panel.trial.status)}</span>
                )}
              </summary>
              <div className="trialPanelBody">
                <div className="trialPanelFacts">
                  <span>
                    {t("field.plannedDate")}
                    <strong>{formatDate(panel.trial?.plannedDate)}</strong>
                  </span>
                  <span>
                    {t("field.actualDate")}
                    <strong>{formatDate(panel.trial?.actualDate)}</strong>
                  </span>
                  <span>
                    {t("field.result")}
                    <strong>{translateLabel(dictionary, "trialResult", panel.trial?.result ?? null)}</strong>
                  </span>
                  <span>
                    {t("project.counted")}
                    <strong>{panel.trial?.countsAgainstLimit ? t("common.yes") : t("common.no")}</strong>
                  </span>
                  <span>
                    {t("field.reason")}
                    <strong>
                      {panel.trial?.planReasonDetail ??
                        labelForTranslated(dictionary, "newTrialReason", newTrialReasonLabels, panel.trial?.planReasonCategory)}
                    </strong>
                  </span>
                </div>

                {panel.trial?.status === "Auto Missed - Reason Required" ? (
                    <AutoMissedResolutionForms
                      canResolveBlockedOrPaused={canResolveAutoMissedBlockedOrPaused}
                      canResolveWithNewDate={canResolveAutoMissedWithNewDate}
                      dictionary={dictionary}
                      projectCode={project.projectCode}
                    redirectTo={redirectTo}
                    trial={panel.trial}
                  />
                ) : null}

                {showConfirmationBlock && rawTrialEvent != null ? (
                  <TrialDateConfirmationBlock
                    canApprove={canApproveTrialDateChange}
                    canConfirm={canConfirmTrialDate}
                    canProposeChange={canProposeTrialDateChange}
                    canRedate={canRedateReturnedTrial}
                    customerTargetDate={project.customerTargetDate}
                    injectionMachines={detail.activeInjectionMachines}
                    locale={currentUser.locale}
                    projectCode={project.projectCode}
                    redirectTo={redirectTo}
                    trial={rawTrialEvent}
                  />
                ) : null}

                {panel.trial != null &&
                (panel.trial.status === "Planned" ||
                  panel.trial.status === "At Risk" ||
                  panel.trial.status === "Auto Missed - Reason Required") ? (
                  <section className="panelActionBlock" aria-label={`${panel.title} result entry`}>
                    <h3>{t("project.recordResult")}</h3>
                    {canRecordCompletedTrial ? (
                      <RecordTrialResultForm
                        dictionary={dictionary}
                        injectionMachines={detail.activeInjectionMachines}
                        lateEntry={panel.trial.status === "Auto Missed - Reason Required"}
                        projectCode={project.projectCode}
                        redirectTo={redirectTo}
                        trial={panel.trial}
                      />
                    ) : (
                      <div className="blockedAction">{t("common.blockedAction")}</div>
                    )}
                  </section>
                ) : null}

                {(() => {
                  const reportState = measurementReportPanelState(panel.trial?.id);
                  if (reportState == null || panel.trial?.id == null) {
                    return null;
                  }
                  return (
                    <MeasurementReportPanel
                      state={reportState}
                      trialLabel={panel.title}
                      trialEventId={panel.trial.id}
                      canUpload={canUploadMeasurementReport}
                      locale={currentUser.locale}
                    />
                  );
                })()}

                <section className="panelActionBlock issuePanelBlock">
                  <h3>{t("project.trialIssues")}</h3>
                  <div className="tableWrap">
                    <table className="trialIssuePanelTable">
                      <thead>
                        <tr>
                          <th>{t("field.title")}</th>
                          <th>{t("field.issueType")}</th>
                          <th>{t("field.severity")}</th>
                          <th>{t("field.status")}</th>
                          <th>{t("field.handler")}</th>
                          <th>{t("field.dueDate")}</th>
                          <th>{t("common.actions")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {issuesForPanel.length === 0 ? (
                          <tr>
                            <td className="emptyTableCell" colSpan={7}>
                              {t("project.noIssuesForTrial")}
                            </td>
                          </tr>
                        ) : (
                          issuesForPanel.map((issue) => {
                            const issuePhotos = issuePhotosForIssue(issue.id);
                            return (
                            <tr
                              key={issue.id}
                              className={trialIssueRowStatusClass(issue.status)}
                              data-issue-status={issue.status}
                            >
                              <td>
                                <div className="flex flex-wrap items-center gap-2">
                                  <span>{issue.title}</span>
                                  <IssuePhotoCountChip count={issuePhotos.length} locale={currentUser.locale} />
                                </div>
                                {issuePhotos.length === 0 ? null : (
                                  <div className="pt-2">
                                    <IssuePhotoGallery photos={issuePhotos} locale={currentUser.locale} />
                                  </div>
                                )}
                              </td>
                              <td>{labelForTranslated(dictionary, "issueType", issueTypeLabels, issue.issueType)}</td>
                              <td>{labelForTranslated(dictionary, "severity", severityLabels, issue.severity)}</td>
                              <td>
                                <span className={`issueStatusChip state state${labelFor(issueStatusLabels, issue.status).replaceAll(" ", "")}`}>
                                  {labelForTranslated(dictionary, "issueStatus", issueStatusLabels, issue.status)}
                                </span>
                              </td>
                              <td>{issue.ownerUser?.displayName ?? issue.ownerGroup?.name ?? t("common.unassigned")}</td>
                              <td>{formatDate(issue.dueDate)}</td>
                              <td>
                                <TrialIssueRowActions
                                  activeParts={issueActionPartOptions}
                                  activeUserOptions={issueActionUserOptions}
                                  canClose={canCloseSimpleIssue(issue)}
                                  canEdit={canEditSimpleIssue(issue)}
                                  issue={{
                                    id: issue.id,
                                    title: issue.title,
                                    affectedPartId: issue.affectedPartId ?? "",
                                    issueType: issue.issueType,
                                    source: issue.source,
                                    severity: issue.severity,
                                    status: issue.status,
                                    ownerUsername: issue.ownerUser?.username ?? "",
                                    dueDate: inputDate(issue.dueDate),
                                    description: issue.description ?? ""
                                  }}
                                  issueSourceOptions={issueSourceOptions}
                                  issueStatusOptions={issueEditStatusOptions}
                                  issueTypeOptions={issueTypeOptions}
                                  locale={currentUser.locale}
                                  projectCode={project.projectCode}
                                  redirectTo={redirectTo}
                                  requiresNonOwnerCloseReason={issue.ownerUserId !== currentUser.id}
                                  severityOptions={severityOptions}
                                  todayInputDate={todayInputDate}
                                />
                              </td>
                            </tr>
                            );
                          })
                        )}
                      </tbody>
                    </table>
                  </div>
                    {panel.canAddIssue && panel.trial?.id != null ? (
                      canCreateIssue ? (
                        <div className="panelInlineForm">
                          <h3>Add Trial Issue</h3>
                          <TrialIssuePanelForm
                            activeParts={activeParts}
                            dictionary={dictionary}
                            locale={currentUser.locale}
                            marketingIssueDefaults={marketingIssueDefaults}
                            projectCode={project.projectCode}
                            redirectTo={redirectTo}
                            trialEventId={panel.trial.id}
                          />
                        </div>
                      ) : (
                        <div className="blockedAction">{t("common.blockedAction")}</div>
                      )
                    ) : null}
                </section>

                {panel.sequenceNumber <= 1 ? null : (
                    <section className="panelActionBlock">
                      <h3>{t("project.priorIssueVerification")}</h3>
                      {panel.priorVerificationIssues.length === 0 ? (
                        <p className="emptyText">{t("project.noPriorIssues")}</p>
                      ) : (
                        <ul className="verificationList">
                          {panel.priorVerificationIssues.map((issue) => (
                            <li key={issue.id ?? issue.title}>
                              <span className="flex flex-wrap items-center gap-2">
                                {issue.severity == null ? null : (
                                  <StatusBadge status={issue.severity}>
                                    {translateLabel(dictionary, "severity", issue.severity)}
                                  </StatusBadge>
                                )}
                                <span>{issue.title}</span>
                              </span>
                              <select defaultValue={verificationStatusForIssue(issue)} disabled>
                                {trialVerificationStatusOptions.map((option) => (
                                  <option key={option} value={option}>
                                    {option}
                                  </option>
                                ))}
                              </select>
                            </li>
                          ))}
                        </ul>
                      )}
                    </section>
                  )}
              </div>
            </details>
            );
          })}
        </div>
        <section className="panelActionBlock panelPlanner" aria-labelledby="new-trial-heading">
          <div className="surfaceHeader">
            <h3 id="new-trial-heading">{t("project.addNextPlannedTrial")}</h3>
          </div>
          {canAddNewPlannedTrial ? (
            <AddPlannedTrialPanelForm
              activeUserOptions={activeUserOptions}
              currentUsername={currentUser.username}
              projectCode={project.projectCode}
              redirectTo={redirectTo}
            />
          ) : (
            <div className="blockedAction">{t("common.blockedAction")}</div>
          )}
        </section>
      </section>

      <ProcessSheetComparison
        canEdit={canEditProcessSheet}
        canExport={canExportProcessSheet}
        currentEditableTrialId={currentProcessSheetTrialId}
        detail={detail}
        dictionary={dictionary}
        projectCode={project.projectCode}
        redirectTo={redirectTo}
      />

      <section className="workSurface" aria-labelledby="files-heading">
        <details>
          <summary className="surfaceHeader cursor-pointer list-none">
            <div>
              <h2 id="files-heading">{pickLabel(attachmentLabels.filesTitle, currentUser.locale)}</h2>
              <span>
                {pickLabel(attachmentLabels.filesSubtitle, currentUser.locale)} ({projectAttachments.length})
              </span>
            </div>
          </summary>
          <div className="grid gap-4 p-4 sm:p-[18px]">
            <AttachmentList
              attachments={projectAttachments}
              currentUserId={currentUser.id}
              canAdminDelete={canAdminDeleteAttachment}
              redirectTo={redirectTo}
              locale={currentUser.locale}
            />
            {canUploadAttachment ? (
              <AttachmentUploader
                projectId={project.id}
                entityType="MOLD_TRIAL_PROJECT"
                entityId={project.id}
                locale={currentUser.locale}
                canChooseVisibility={canChooseAttachmentVisibility}
              />
            ) : null}
          </div>
        </details>
      </section>

      {canDownloadCustomerSafe ? (
        <CustomerFilesSection
          files={detail.customerSafeAttachments.map((attachment) => ({
            id: attachment.id,
            fileName: attachment.fileName,
            fileType: attachment.fileType,
            sizeBytes: attachment.sizeBytes,
            uploadedAt: attachment.uploadedAt,
            uploaderName: attachment.uploadedBy.displayName
          }))}
          locale={currentUser.locale}
        />
      ) : null}

      <section className="workSurface" aria-labelledby="planning-history-heading">
        <div className="surfaceHeader">
          <h2 id="planning-history-heading">{t("project.planningChangeHistory")}</h2>
        </div>
        <div className="tableWrap">
          <table className="compactHistoryTable">
            <thead>
              <tr>
                <th>{t("field.date")}</th>
                <th>{t("field.type")}</th>
                <th>{t("field.subject")}</th>
                <th>{t("field.description")}</th>
              </tr>
            </thead>
            <tbody>
              {planningHistory.length === 0 ? (
                <tr>
                  <td className="emptyTableCell" colSpan={4}>
                    {t("project.noPlanningHistory")}
                  </td>
                </tr>
              ) : (
                planningHistory.map((history) => (
                  <tr key={history.id}>
                    <td>{formatDate(history.date)}</td>
                    <td>{history.type}</td>
                    <td>{history.subject}</td>
                    <td>{history.detail}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="workSurface" aria-labelledby="activity-heading">
        <div className="surfaceHeader">
          <h2 id="activity-heading">{t("project.activityTimeline")}</h2>
        </div>
        <ol className="activityList">
          {activityLogs.length === 0 ? (
            <li className="emptyTimeline">{t("project.noActivity")}</li>
          ) : (
            activityLogs.map((activity) => (
              <li key={activity.id}>
                <span>{formatDate(activity.createdAt)}</span>
                <span className="activityEntity">{formatActivityEntity(activity.entityType)}</span>
                <strong>{formatActivityAction(activity.action)}</strong>
                <small>{activity.actorUser.displayName}</small>
              </li>
            ))
          )}
        </ol>
      </section>
    </main>
  );
}
