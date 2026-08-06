import Link from "next/link";
import { AccountMenu } from "@/app/account-menu";
import { AppHeader } from "@/components/layout/AppHeader";
import { BlockedAction, hasAllPermissionCodes, hasPermissionCode } from "@/app/permission-ui";
import { PartsCavitiesEditor } from "@/app/parts-cavities-editor";
import { AttachmentList } from "@/components/attachments/AttachmentList";
import { AttachmentUploader } from "@/components/attachments/AttachmentUploader";
import { ImageCaptureField } from "@/components/attachments/image-capture-field";
import { IssuePhotoCountChip, IssuePhotoGallery, type IssuePhoto } from "@/components/attachments/issue-photo-gallery";
import { StatusBadge, SubmitButton, sectionHueVars, statusToneClasses, toneForStatus } from "@/components/ui";
import { ProjectSectionNav, type ProjectSectionNavItem } from "@/components/project/ProjectSectionNav";
import { InsertTypeChips, InsertTypesField } from "@/components/project/InsertTypesField";
import { AssemblyGroupChip, IntakeDetailsFields } from "@/components/project/IntakeDetailsFields";
import { IssueTrialDeadlineChip } from "@/components/project/TrialDeadlineChip";
import { AddPlannedTrialPanelForm } from "@/app/projects/[projectCode]/add-planned-trial-form";
import { ClientNotesSection } from "@/app/projects/[projectCode]/client-notes-section";
import { CustomerFilesSection } from "@/app/projects/[projectCode]/customer-files-section";
import { ExportProcessSheetPdfButton } from "@/app/projects/[projectCode]/export-process-sheet-pdf-button";
import { MeasurementReportPanel } from "@/app/projects/[projectCode]/measurement-report-panel";
import { ProcessSheetEditor } from "@/app/projects/[projectCode]/process-sheet-editor";
import { TrialIssueRowActions } from "@/app/projects/[projectCode]/trial-issue-row-actions";
import { formatPartSummary } from "@/domain/mold-trial/parts";
import { formatMoldWorkingIdentifier } from "@/domain/mold-trial/identifiers";
import { insertTypeFieldLabels, projectInsertTypes } from "@/domain/mold-trial/insert-types";
import { intakeDetailLabels, projectIntakeDetails } from "@/domain/mold-trial/intake-details";
import {
  archiveReasonMaxLength,
  isProjectArchived,
  projectArchiveLabels,
  projectArchiveState
} from "@/domain/mold-trial/project-archive";
import { projectNoteLabels } from "@/domain/mold-trial/project-notes";
import {
  DEFAULT_PROCESS_SHEET_TEMPLATE_CODE,
  formatInjectionMachineLabel,
  isProcessSheetSummaryParameter
} from "@/domain/mold-trial/process-sheet";
import {
  buildTrialPanels,
  trialStageLabel,
  trialVerificationStatusOptions
} from "@/domain/mold-trial/trial-panel";
import { formatBilingualUserOption, formatIssueOwnerUserOption } from "@/domain/mold-trial/users";
import {
  attachmentLabels,
  issueFormLabels,
  issuePhotoLabels,
  measurementReportLabels,
  myPlateLabels,
  localeFromLanguage,
  pickLabel,
  projectSectionLabels,
  type BilingualLabel,
  type Locale
} from "@/domain/mold-trial/labels";
import {
  computeProjectStage,
  projectStages,
  type ProjectStageTrial
} from "@/domain/mold-trial/project-stage";
import {
  daysBetweenProposedAndTarget,
  isProposedDateAfterTarget,
  participatesInDateConfirmation,
  type DateConfirmationStatus
} from "@/domain/mold-trial/date-confirmation";
import { createTranslator, dictionaries, translateLabel, translateWorkflowMessage, type Dictionary, type Language } from "@/i18n";
import {
  formatLocalizedDate,
  formatLocalizedDaysAway,
  formatLocalizedTrialCountBadge,
  translateActivityAction,
  translateActivityEntity,
  translateDefaultProcessSection,
  translateSystemRole
} from "@/i18n/display";
import { getCurrentLanguage } from "@/i18n/server";
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
import { archiveMoldTrialProject } from "@/server/admin-actions";
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
import {
  activeAssemblyGroupOptions,
  assemblyGroupLabel,
  getAssemblyGroupOptions
} from "@/server/department-group-options";
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
      databaseError: "PROJECT_DETAIL_UNAVAILABLE"
    };
  }
}

function messageValue(searchParams: Record<string, string | string[] | undefined>, key: string): string | null {
  const value = searchParams[key];
  return typeof value === "string" ? value : null;
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
function MissingDash({ title }: { title: string }) {
  return (
    <span className="valueMissing" title={title}>
      —
    </span>
  );
}

function optionalText(value: string | null | undefined, notSetLabel: string) {
  const trimmed = typeof value === "string" ? value.trim() : "";
  return trimmed.length === 0 ? <MissingDash title={notSetLabel} /> : trimmed;
}

function optionalDate(value: Date | string | null | undefined, language: Language, notSetLabel: string) {
  return value == null ? <MissingDash title={notSetLabel} /> : formatLocalizedDate(value, language);
}

function labelForTranslated<T extends string>(
  dictionary: Dictionary,
  group: string,
  labels: Record<string, T>,
  value: string | null | undefined
): string {
  if (value == null) {
    return createTranslator(dictionary)("common.notSet");
  }
  return translateLabel(dictionary, group, labelFor(labels, value));
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
  language,
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
  language: Language;
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
    <section className="panelActionBlock" aria-label={cLabel("confirmTrialDates")}>
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
            <strong>{formatLocalizedDate(trial.plannedDate, language, "—")}</strong>
          </span>
          <span>
            {cLabel("proposedDate")}
            <strong>{formatLocalizedDate(trial.proposedDate, language, "—")}</strong>
          </span>
          <span>
            {cLabel("customerTargetDate")}
            <strong>{formatLocalizedDate(customerTargetDate, language, "—")}</strong>
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
        <ImageCaptureField name="photos" />
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
  const defaultTemplate = project.processSheetTemplateCode === DEFAULT_PROCESS_SHEET_TEMPLATE_CODE;

  return (
    <section
      className="workSurface processSheetSurface sectionHue sectionAnchor"
      id="section-process-sheet"
      style={sectionHueVars("paused")}
      aria-labelledby="process-sheet-heading"
    >
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
            section: translateDefaultProcessSection(dictionary, parameter.section, defaultTemplate),
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
          statusLabel: labelForTranslated(dictionary, "trialStatus", trialStatusLabels, trial.status),
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
  const language = await getCurrentLanguage();
  const dictionary = dictionaries[language];
  const t = createTranslator(dictionary);
  const { detail } = await loadProjectDetail(projectCode, currentUser.id);
  const activeUserOptions = detail == null ? [] : await getActiveUserOptions();
  const activePmUserOptions = activeUserOptions.filter((user) => user.role.code === "pm");
  // Assembly working groups, active AND inactive: the select offers the active
  // ones, the overview needs the whole list to name a project already assigned
  // to a group that was later retired.
  const assemblyGroupOptions = detail == null ? [] : await getAssemblyGroupOptions().catch(() => []);
  const permissionCodes = new Set(await getEffectivePermissionCodes(currentUser.id));
  const nav = await getNavVisibility({
    permissionCodes,
    roleCode: currentUser.roleCode,
    dbRoleCode: currentUser.role.code
  });
  const error =
    resolvedSearchParams == null
      ? null
      : translateWorkflowMessage(dictionary, messageValue(resolvedSearchParams, "error"));
  const success =
    resolvedSearchParams == null
      ? null
      : translateWorkflowMessage(dictionary, messageValue(resolvedSearchParams, "success"));

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
          <span>{t("project.loadFailed")}</span>
        </section>
      </main>
    );
  }

  const { project, activityLogs, limit, issuePhotosByIssueId, measurementReportByTrialId } = detail;
  const redirectTo = `/projects/${project.projectCode}`;
  // Archive state, read through the stale-client seam. `isArchived` is the ONE
  // switch that turns this page read-only: every `can*` flag below is gated on
  // it, so no mutating form can be rendered by accident, and the matching server
  // actions refuse the same write anyway (assertProjectNotArchived).
  const archiveState = projectArchiveState(project);
  const isArchived = isProjectArchived(project);
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
  const insertTypes = projectInsertTypes(project);
  // Material / colour / trial quantity / assembly group, read through the
  // stale-client seam (the columns arrive with the 2026-08-05 migration).
  const intakeDetails = projectIntakeDetails(project);
  // "<leader> · <group>" — the chip names the crew by the person leading it,
  // the same label the intake/edit select offers.
  const assignedAssemblyGroupName = assemblyGroupLabel(
    assemblyGroupOptions,
    intakeDetails.assignedAssemblyGroupId
  );
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
  const requestNow = new Date();
  const displayDate = (value: Date | string | null | undefined): string =>
    formatLocalizedDate(value, language, t("common.notSet"));
  const trialCountBadge = formatLocalizedTrialCountBadge(limit, dictionary);
  const nextTrialDaysAway = formatLocalizedDaysAway(
    defaultCurrentTrial?.plannedDate ?? project.nextPlannedTrialDate,
    requestNow,
    dictionary
  );
  // The date the trial-deadline chips count down to — the same value the header
  // already shows as "Next trial", so a chip and the header can never disagree.
  const nextPlannedTrialDate = defaultCurrentTrial?.plannedDate ?? project.nextPlannedTrialDate ?? null;
  // Non-blocking scheduling notice: nothing stops the PM planning the next trial
  // while issues are open (see `validateNextTrialStageCreation`, which gates on
  // prior-trial closure, never on issue closure), and nothing should — the
  // schedule is often what forces the fixes. Saying the number out loud is the
  // whole intervention.
  const openIssueCountForNotice = project.trialIssues.filter(
    (issue) => issue.status !== "CLOSED" && issue.status !== "VERIFIED"
  ).length;
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
      type: t("project.history.missedTrial"),
      subject: `${displayDate(event.plannedDate)} -> ${displayDate(event.newPlannedDate)}`,
      detail: `${labelForTranslated(dictionary, "reason", missedTrialReasonLabels, event.reasonCategory)} / ${labelForTranslated(
        dictionary,
        "responsibleArea",
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
        type: t("project.history.newPlannedTrial"),
        subject: `${trialStageLabel(trial.sequenceNumber)} - ${displayDate(trial.plannedDate)}`,
        detail:
          trial.planReasonCategory == null
            ? trial.planReasonDetail ?? t("project.history.noReason")
            : `${labelForTranslated(dictionary, "newTrialReason", newTrialReasonLabels, trial.planReasonCategory)}: ${
                trial.planReasonDetail ?? t("project.history.noReason")
              }`
      })),
    ...project.designChanges.map((change) => ({
      id: `design-${change.id}`,
      sortDate: change.changeDate,
      date: change.changeDate,
      type: t("project.history.designChange"),
      subject: change.title,
      detail: `${labelForTranslated(dictionary, "changeRequester", changeRequesterLabels, change.requestedBy)} / ${
        change.grantsExtraTrial
          ? t("project.history.extraTrial", { count: change.extraTrialCount ?? 1 })
          : t("project.history.noExtraAllowance")
      } / ${change.approvalReason ?? change.description}`
    })),
    ...project.trialLimitAdjustments.map((adjustment) => ({
      id: `limit-${adjustment.id}`,
      sortDate: adjustment.createdAt,
      date: adjustment.createdAt,
      type: t("project.history.limitAdjustment"),
      subject: labelForTranslated(
        dictionary,
        "limitAdjustmentType",
        limitAdjustmentTypeLabels,
        adjustment.adjustmentType
      ),
      detail: t("project.history.delta", {
        delta: adjustment.deltaTrials ?? t("common.notSet"),
        limit: adjustment.newLimit ?? t("common.notSet"),
        reason: adjustment.reason
      })
    }))
  ].sort((left, right) => new Date(right.sortDate).getTime() - new Date(left.sortDate).getTime());
  /**
   * Permission AND liveness. An archived project is read only, so every write
   * capability is `!isArchived && <permission>` — one rule, applied at the one
   * place the page decides what a viewer may do, instead of a hidden condition
   * sprinkled over twenty forms. Read capabilities (downloads, the customer-files
   * section) are NOT gated: an archived project stays fully readable.
   */
  const writeAllowed = (code: Parameters<typeof hasPermissionCode>[1]): boolean =>
    !isArchived && hasPermissionCode(permissionCodes, code);
  const canSetFirstT0 = writeAllowed("trial.schedule.first_t0");
  const canEditProjectBasics = writeAllowed("project.basic.edit");
  const canResolveAutoMissedWithNewDate =
    !isArchived &&
    hasAllPermissionCodes(permissionCodes, ["trial.missed.record", "trial.schedule.reschedule"]);
  const canResolveAutoMissedBlockedOrPaused = writeAllowed("trial.missed.record");
  const canRecordCompletedTrial = writeAllowed("trial.record.completed");
  const canAddNewPlannedTrial = writeAllowed("trial.schedule.reschedule");
  const canConfirmTrialDate = writeAllowed("trial.date.confirm");
  const canProposeTrialDateChange = writeAllowed("trial.date.propose_change");
  const canApproveTrialDateChange = writeAllowed("trial.date.approve_change");
  const canRedateReturnedTrial = writeAllowed("trial.schedule.reschedule");
  const canCreateIssue = writeAllowed("trial.issue.create");
  const canEditProcessSheet = writeAllowed("trial.process_sheet.edit");
  // Exporting writes a PROCESS_SHEET_EXPORT attachment, so it counts as a write.
  const canExportProcessSheet = writeAllowed("trial.process_sheet.export_pdf");
  const canUploadAttachment = writeAllowed("attachment.upload");
  const canAdminDeleteAttachment = writeAllowed("attachment.delete");
  // Client notes 客户备注: Marketing / PM / Admin, and never on an archived project.
  const canWriteClientNotes = writeAllowed("project.client_note.write");
  // Archiving is the one write an archived project does not offer (there is no
  // un-archive; see project-archive.ts).
  const canArchiveProject = writeAllowed("admin.archive_projects");
  // R5: only oversight roles pick a file visibility; workers get the safe default
  // (applied server-side in attachment-actions.ts when the field is omitted). UI
  // hiding only — the server still re-checks upload permission regardless.
  const canChooseAttachmentVisibility =
    currentUser.roleCode === "ADMIN" || currentUser.roleCode === "GM" || currentUser.roleCode === "PM";
  const canUploadMeasurementReport = writeAllowed("qc.measurement_report.upload");
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
    label: formatIssueOwnerUserOption({
      displayName: user.displayName,
      chineseName: user.chineseName,
      role: {
        name: translateSystemRole(dictionary, user.role.code, user.role.name)
      }
    })
  }));
  const todayInputDate = inputDate(requestNow);

  /* -------------------------------------------------------------------------
   * Desktop orientation (lg+ rail, md+ stepper).
   *
   * Everything below is derived from data this page already loaded — no new
   * queries — and every element it feeds is hidden below its breakpoint, so the
   * phone renders exactly what it rendered before. The rail is built from the
   * sections this render actually produces (permission-gated ones included),
   * never from a hard-coded list that could drift.
   * ---------------------------------------------------------------------- */
  const locale = localeFromLanguage(language);
  const bilingual = (label: BilingualLabel) => ({ labelEn: label.en, labelZh: label.zh });
  const openProjectIssues = project.trialIssues.filter(
    (issue) => issue.status !== "CLOSED" && issue.status !== "VERIFIED"
  );
  /** Per-panel facts shared by the rail dots and the stage function. */
  const trialPanelFacts = trialPanels.map((panel) => {
    const rawTrialEvent =
      panel.trial?.id == null
        ? null
        : project.trialEvents.find((event) => event.id === panel.trial?.id) ?? null;
    const panelIssues =
      panel.trial?.id == null
        ? []
        : openProjectIssues.filter((issue) => issue.foundAtTrialEventId === panel.trial?.id);

    return {
      panel,
      rawTrialEvent,
      openIssueCount: panelIssues.length,
      reportMissing: measurementReportPanelState(panel.trial?.id)?.kind === "MISSING"
    };
  });
  // Every DB status has a label, so the fallback is unreachable; it only keeps
  // the stage input honestly typed.
  const projectStageStatus = projectStatusLabels[project.status] ?? "Active";
  // Every trial event, not just the paneled ones, so the stage's "current trial"
  // is selected from the same candidate set as `defaultCurrentTrialId` and the
  // two can never disagree about which panel is the open one.
  const stageTrials: ProjectStageTrial[] = project.trialEvents.map((trial) => ({
    id: trial.id,
    sequenceNumber: trial.sequenceNumber,
    plannedDate: trial.plannedDate,
    status: trialStatusLabels[trial.status],
    result: trial.result == null ? null : trialResultLabels[trial.result],
    dateConfirmationStatus: trial.dateConfirmationStatus,
    measurementReportMissing: measurementReportByTrialId.get(trial.id)?.kind === "MISSING"
  }));
  const projectStage = computeProjectStage({
    projectStatus: projectStageStatus,
    trials: stageTrials,
    issues: {
      openCount: openProjectIssues.length,
      unclaimedCount: openProjectIssues.filter((issue) => issue.ownerUserId == null).length,
      awaitingVerificationCount: project.trialIssues.filter((issue) => issue.status === "WAITING_VERIFICATION")
        .length
    }
  });
  const currentStage = projectStages[projectStage.stageIndex] ?? projectStages[0];
  /** One pending-action dot per trial entry, highest-priority reason only. */
  const trialNavBadge = (fact: (typeof trialPanelFacts)[number]): ProjectSectionNavItem["badge"] => {
    const trial = fact.panel.trial;
    if (trial == null) {
      return undefined;
    }

    if (trial.status === "Auto Missed - Reason Required") {
      return { tone: "missed", ...bilingual(projectSectionLabels.needsReason) };
    }

    const raw = fact.rawTrialEvent;
    if (
      raw != null &&
      participatesInDateConfirmation(raw.status) &&
      raw.dateConfirmationStatus !== "CONFIRMED"
    ) {
      return {
        tone: raw.dateConfirmationStatus === "RETURNED_TO_PM" ? "missed" : "at-risk",
        ...bilingual(projectSectionLabels.needsDateConfirmation)
      };
    }

    if (fact.reportMissing) {
      return { tone: "at-risk", ...bilingual(projectSectionLabels.needsReport) };
    }

    if (fact.openIssueCount > 0) {
      return { tone: "at-risk", ...bilingual(projectSectionLabels.openIssues) };
    }

    return undefined;
  };
  const trialsSectionTone =
    defaultCurrentTrial == null ? "planned" : toneForStatus(trialStatusLabels[defaultCurrentTrial.status]);
  const showFirstT0Section = project.status === "INTAKE" && canSetFirstT0;
  const navItems: ProjectSectionNavItem[] = [
    { id: "section-overview", tone: "planned", ...bilingual(projectSectionLabels.overview) },
    ...(canEditProjectBasics
      ? [{ id: "section-identifiers", tone: "paused" as const, ...bilingual(projectSectionLabels.identifiers) }]
      : []),
    // Client notes sit high on purpose: special requests must be read before
    // anyone scrolls into the technical sections (owner request, 2026-08-06).
    { id: "section-client-notes", tone: "in-correction", ...bilingual(projectNoteLabels.sectionTitle) },
    { id: "section-parts", tone: "paused", ...bilingual(projectSectionLabels.parts) },
    ...(showFirstT0Section
      ? [
          {
            id: "section-first-t0",
            tone: "at-risk" as const,
            ...bilingual(projectSectionLabels.firstT0),
            badge: { tone: "at-risk" as const, ...bilingual(projectSectionLabels.needsFirstDate) }
          }
        ]
      : []),
    { id: "section-trials", tone: trialsSectionTone, ...bilingual(projectSectionLabels.trials) },
    ...trialPanelFacts.map((fact): ProjectSectionNavItem => ({
      id: `trial-panel-${fact.panel.sequenceNumber}`,
      labelEn: `${fact.panel.title} ${myPlateLabels.trial.en}`,
      labelZh: `${fact.panel.title} ${myPlateLabels.trial.zh}`,
      tone: fact.panel.trial == null ? "paused" : toneForStatus(fact.panel.trial.status),
      badge: trialNavBadge(fact)
    })),
    { id: "section-process-sheet", tone: "paused", ...bilingual(projectSectionLabels.processSheet) },
    { id: "section-files", tone: "paused", ...bilingual(attachmentLabels.filesTitle) },
    ...(canDownloadCustomerSafe
      ? [
          {
            id: "section-customer-files",
            tone: "in-correction" as const,
            ...bilingual(measurementReportLabels.customerFilesTitle)
          }
        ]
      : []),
    { id: "section-history", tone: "paused", ...bilingual(projectSectionLabels.history) },
    { id: "section-activity", tone: "paused", ...bilingual(projectSectionLabels.activity) }
  ];

  function canEditSimpleIssue(issue: ProjectDetail["project"]["trialIssues"][number]): boolean {
    if (isArchived) {
      return false;
    }

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
    if (isArchived || issue.status === "CLOSED" || currentUser.roleCode === "VIEWER") {
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
    <main className="shell shellWide">
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
          <div className="trialBadgeGroup" aria-label={t("project.trialStatusAria")}>
            <span className={`trialCountBadge state${limit.warningState.replaceAll(" ", "")}`}>{trialCountBadge}</span>
            <span className="nextTrialBadge">
              {t("project.nextTrial")} {displayDate(defaultCurrentTrial?.plannedDate ?? project.nextPlannedTrialDate)} ({nextTrialDaysAway})
            </span>
          </div>
        </div>
      </section>

      {/* Archived banner. Deliberately NEUTRAL, not an alarm: archiving is a
          correction, not a failure, and the page below it is a perfectly good
          historical record. Placed above the status band because "this project
          is read only" outranks "this project is Waiting Trial". */}
      {isArchived ? (
        <section
          className="mb-2 grid w-full gap-1 rounded-lg border-2 border-neutral-400 bg-neutral-100 px-4 py-3"
          role="status"
          aria-label={pickLabel(projectArchiveLabels.bannerTitle, locale)}
        >
          <p className="m-0 text-base font-bold text-neutral-800">
            {projectArchiveLabels.bannerTitle.zh} · {projectArchiveLabels.bannerTitle.en}
          </p>
          <p className="m-0 text-sm text-neutral-600">{pickLabel(projectArchiveLabels.bannerBody, locale)}</p>
          <p className="m-0 text-sm text-neutral-600">
            {pickLabel(projectArchiveLabels.archivedAt, locale)}: {displayDate(archiveState.archivedAt)}
            {archiveState.archiveReason == null ? null : ` · ${archiveState.archiveReason}`}
          </p>
        </section>
      ) : null}

      <div
        className={`${statusToneClasses[projectStatusTone].pill} flex w-full items-center justify-center gap-2 rounded-lg px-4 py-2 text-base font-bold`}
        role="status"
        aria-label={t("project.statusAria")}
      >
        <span className="font-normal opacity-70">{t("field.status")}</span>
        <span>{projectStatusDisplay}</span>
      </div>

      {/* Poster stepper (md and up). The six stages, wording and order, are the
          six stages of the training poster, so the page and the wall teach one
          workflow. One next-action line names the role that moves it. */}
      <section
        className="mt-2 mb-4 hidden gap-2 rounded-lg border border-neutral-300 bg-white px-4 py-3 md:grid"
        aria-label={pickLabel(projectSectionLabels.stageTitle, locale)}
      >
        <ol className="m-0 grid list-none grid-cols-6 gap-2 p-0">
          {projectStages.map((stage) => {
            const done = stage.index < projectStage.stageIndex;
            const isCurrent = stage.index === projectStage.stageIndex;
            const marker = done
              ? "bg-status-completed text-white"
              : isCurrent
                ? "bg-white text-brand-600 ring-2 ring-brand-600"
                : "bg-neutral-100 text-neutral-500";
            const text = done ? "text-status-completed" : isCurrent ? "text-brand-600" : "text-neutral-500";

            return (
              <li
                key={stage.id}
                className="flex min-w-0 items-center gap-2"
                aria-current={isCurrent ? "step" : undefined}
              >
                <span
                  className={`flex h-6 w-6 flex-none items-center justify-center rounded-full text-xs font-bold ${marker}`}
                >
                  {stage.index + 1}
                </span>
                {/* Poster convention: both languages always visible (rail does the
                    same) — the stepper is a teaching device, not locale-bound. */}
                <span className={`grid min-w-0 gap-px leading-tight ${text}`}>
                  <span className="text-xs font-bold">{stage.labelZh}</span>
                  <span className="text-[0.6875rem] font-normal opacity-80">{stage.labelEn}</span>
                </span>
              </li>
            );
          })}
        </ol>
        <p className="m-0 text-sm font-bold text-neutral-800">
          <span className="font-normal text-neutral-500">
            {projectSectionLabels.stageNext.zh} · {projectSectionLabels.stageNext.en}:{" "}
          </span>
          {projectStage.nextAction.zh}
          <span className="font-normal text-neutral-500"> · {projectStage.nextAction.en}</span>
          {projectStage.approximate ? (
            <span className="font-normal text-neutral-500">
              {" "}
              ({pickLabel(projectSectionLabels.stageEstimated, locale)})
            </span>
          ) : null}
          <span className="sr-only">
            {" "}
            — {pickLabel({ en: currentStage.labelEn, zh: currentStage.labelZh }, locale)}
          </span>
        </p>
      </section>

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

      {/* Two-column shell: sticky section rail + content. Both wrappers are
          plain blocks below lg (the grid rules are inside a min-width query and
          the rail is `hidden`), so the phone keeps today's single column and the
          sections keep their exact order. */}
      <div className="projectLayout">
      <ProjectSectionNav
        items={navItems}
        locale={locale}
        title={`${projectSectionLabels.navTitle.zh} · ${projectSectionLabels.navTitle.en}`}
      />
      <div className="projectLayoutMain">

      <section
        className="workSurface detailSurface sectionHue sectionAnchor"
        id="section-overview"
        style={sectionHueVars("planned")}
        aria-labelledby="project-overview-heading"
      >
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
            {/* Inserts sit right after Parts — same question ("what is in this
                mold?"), and only when the project actually carries inserts. No
                inserts renders no row at all, so the overview keeps its density
                for the projects this does not apply to. */}
            {insertTypes.length === 0 ? null : (
              <div>
                <dt>{`${insertTypeFieldLabels.title.en} ${insertTypeFieldLabels.title.zh}`}</dt>
                <dd>
                  <InsertTypeChips codes={insertTypes} />
                </dd>
              </div>
            )}
            {/* Material / colour / quantity answer "what does this mold shoot,
                and how much of it": the same question as Parts and Inserts, so
                they sit in the same column. Unlike the insert chips these rows
                always render — an unanswered material is itself information —
                and fall back to the house muted "—". */}
            <div>
              <dt>{`${intakeDetailLabels.material.en} ${intakeDetailLabels.material.zh}`}</dt>
              <dd>{optionalText(intakeDetails.material, t("common.notSet"))}</dd>
            </div>
            <div>
              <dt>{`${intakeDetailLabels.color.en} ${intakeDetailLabels.color.zh}`}</dt>
              <dd>{optionalText(intakeDetails.color, t("common.notSet"))}</dd>
            </div>
            <div>
              <dt>{`${intakeDetailLabels.trialQuantity.en} ${intakeDetailLabels.trialQuantity.zh}`}</dt>
              <dd>
                {intakeDetails.trialQuantity == null ? (
                  <MissingDash title={t("common.notSet")} />
                ) : (
                  String(intakeDetails.trialQuantity)
                )}
              </dd>
            </div>
            <div>
              <dt>{`${intakeDetailLabels.assemblyGroup.en} ${intakeDetailLabels.assemblyGroup.zh}`}</dt>
              <dd>
                {assignedAssemblyGroupName == null ? (
                  <MissingDash title={t("common.notSet")} />
                ) : (
                  <AssemblyGroupChip name={assignedAssemblyGroupName} />
                )}
              </dd>
            </div>
            <div>
              <dt>{t("field.moldCode")}</dt>
              <dd>{optionalText(project.moldCode, t("common.notSet"))}</dd>
            </div>
            <div>
              <dt>{t("project.clientProjectRef")}</dt>
              <dd>{optionalText(project.clientProjectRef, t("common.notSet"))}</dd>
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
              <dd>{optionalDate(project.firstPlannedTrialDate, language, t("common.notSet"))}</dd>
            </div>
            <div>
              <dt>{t("project.nextPlannedTrial")}</dt>
              <dd>
                {displayDate(defaultCurrentTrial?.plannedDate ?? project.nextPlannedTrialDate)} ({nextTrialDaysAway})
              </dd>
            </div>
            <div>
              <dt>{t("project.customerTargetDate")}</dt>
              <dd>{optionalDate(project.customerTargetDate, language, t("common.notSet"))}</dd>
            </div>
          </dl>
        </div>
        <div className="noteGrid">
          <div>
            <dt>{t("project.intakeNote")}</dt>
            <dd>{optionalText(project.intakeNote, t("common.notSet"))}</dd>
          </div>
          <div>
            <dt>{t("project.initialCustomerNote")}</dt>
            <dd>{optionalText(project.initialCustomerNote, t("common.notSet"))}</dd>
          </div>
        </div>
      </section>

      {canEditProjectBasics ? (
        <section
          className="workSurface formSurface sectionHue sectionAnchor"
          id="section-identifiers"
          style={sectionHueVars("paused")}
          aria-labelledby="identifier-heading"
        >
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
            {/* The same intake checkbox group, so an intake omission is
                correctable here. Desktop-only, exactly like intake: `hidden`
                keeps the phone's Identifiers form pixel-identical, and the
                boxes still POST their stored values, so a phone save can never
                silently clear the list. */}
            <div className="fullSpan hidden md:block">
              <InsertTypesField selected={insertTypes} />
            </div>
            {/* Material / colour / quantity / assembly group are correctable
                here for the same reason inserts are: intake often does not know
                them yet. Desktop-only like the checkbox group above — the inputs
                still POST their stored values, so a phone save can never blank
                them. */}
            <div className="fullSpan hidden md:block">
              {/* Inner grid uses utilities only — `.formGrid` is the form itself
                  and re-declaring it here would fight the `hidden` display. The
                  labels still inherit `.formGrid label` as descendants. */}
              <div className="grid grid-cols-2 gap-x-4 gap-y-3.5">
                <IntakeDetailsFields
                  assemblyGroups={activeAssemblyGroupOptions(assemblyGroupOptions)}
                  material={intakeDetails.material}
                  color={intakeDetails.color}
                  trialQuantity={intakeDetails.trialQuantity}
                  assignedAssemblyGroupId={intakeDetails.assignedAssemblyGroupId}
                />
              </div>
            </div>
            <div className="formActions">
              {/* V5b: identifier edits are a secondary action, not the page's primary. */}
              <button type="submit" className="secondaryButton">{t("project.saveIdentifiers")}</button>
            </div>
          </form>
        </section>
      ) : null}

      {/* Client notes 客户备注 — append-only ledger. Sits directly after the
          identifiers so client special requests are read before anyone scrolls
          into the technical sections (owner request, 2026-08-06). Read-only for
          anyone without the permission (and for everyone once archived); the
          phone gets the same markup in one column. */}
      <ClientNotesSection
        projectCode={project.projectCode}
        notes={detail.clientNotes}
        locale={locale}
        canWrite={canWriteClientNotes}
        redirectTo={redirectTo}
        sectionId="section-client-notes"
        sectionClassName="sectionHue sectionAnchor"
        sectionStyle={sectionHueVars("in-correction")}
      />

      <section
        className="workSurface sectionHue sectionAnchor"
        id="section-parts"
        style={sectionHueVars("paused")}
        aria-labelledby="parts-cavities-heading"
      >
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
        <section
          className="workSurface formSurface sectionHue sectionAnchor"
          id="section-first-t0"
          style={sectionHueVars("at-risk")}
          aria-labelledby="first-t0-heading"
        >
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

      <section
        className="workSurface trialPanelSurface sectionHue sectionAnchor"
        id="section-trials"
        style={sectionHueVars(trialsSectionTone)}
        aria-labelledby="trial-panel-heading"
      >
        <div className="surfaceHeader">
          <div>
            <h2 id="trial-panel-heading">{t("project.trialPanel")}</h2>
            <p className="surfaceSubtext">
              {t("project.trialPanelNext", {
                date: displayDate(defaultCurrentTrial?.plannedDate ?? project.nextPlannedTrialDate),
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

            const isCurrentTrialPanel =
              panel.trial?.id != null && panel.trial.id === projectStage.currentTrialId;

            return (
            <details
              className="trialPanel sectionAnchor"
              id={`trial-panel-${panel.sequenceNumber}`}
              key={panel.sequenceNumber}
              /* Progressive disclosure: finished trials stay folded to their
                 summary line, the current trial (per the stage function, which
                 selects it with the same rule that drives `defaultCurrentTrialId`)
                 opens. The completed-count guard is deliberately unchanged — it
                 is what the phone renders today. */
              open={isCurrentTrialPanel && limit.completedTrialCount > 0}
            >
              <summary>
                <span>
                  <strong>{panel.title}</strong>
                  <small>
                    {panel.trial == null
                      ? t("project.noTrialRecord")
                      : `${translateLabel(dictionary, "trialStatus", panel.trial.status)} / ${displayDate(panel.trial.plannedDate)}`}
                  </small>
                </span>
                {/* Desktop-only fold summary: what a folded trial must still say
                    out loud — result, the date it ran, the machine it ran on.
                    `hidden` below lg, so the phone summary is untouched. */}
                {panel.trial == null ? null : (
                  <span className="hidden flex-wrap items-center gap-2 lg:flex">
                    {isCurrentTrialPanel ? (
                      <StatusBadge tone="planned">{pickLabel(projectSectionLabels.trialCurrent, locale)}</StatusBadge>
                    ) : null}
                    {panel.trial.result == null ? null : (
                      <StatusBadge status={panel.trial.result}>
                        {translateLabel(dictionary, "trialResult", panel.trial.result)}
                      </StatusBadge>
                    )}
                    <small className="text-neutral-600">
                      {displayDate(panel.trial.actualDate ?? panel.trial.plannedDate)}
                    </small>
                    {(() => {
                      const machine = rawTrialEvent?.machineNoSnapshot ?? panel.trial.machine;
                      return machine == null || machine.length === 0 ? null : (
                        <small className="text-neutral-600">
                          {pickLabel(projectSectionLabels.trialMachine, locale)} {machine}
                        </small>
                      );
                    })()}
                  </span>
                )}
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
                    <strong>{displayDate(panel.trial?.plannedDate)}</strong>
                  </span>
                  <span>
                    {t("field.actualDate")}
                    <strong>{displayDate(panel.trial?.actualDate)}</strong>
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
                    language={language}
                    locale={locale}
                    projectCode={project.projectCode}
                    redirectTo={redirectTo}
                    trial={rawTrialEvent}
                  />
                ) : null}

                {panel.trial != null &&
                (panel.trial.status === "Planned" ||
                  panel.trial.status === "At Risk" ||
                  panel.trial.status === "Auto Missed - Reason Required") ? (
                  <section
                    className="panelActionBlock"
                    aria-label={t("project.resultEntryAria", { trial: panel.title })}
                  >
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
                                  <IssuePhotoCountChip count={issuePhotos.length} />
                                </div>
                                {issuePhotos.length === 0 ? null : (
                                  <div className="pt-2">
                                    <IssuePhotoGallery photos={issuePhotos} />
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
                              {/* Due date + the trial wall. An issue's own due
                                  date says nothing about the date the shop is
                                  scheduled around; the chip states it, toned by
                                  whichever comes first. Closed/verified issues
                                  have nothing left to beat, so they get none. */}
                              <td>
                                <div className="flex flex-wrap items-center gap-2">
                                  <span>{displayDate(issue.dueDate)}</span>
                                  {issue.status === "CLOSED" || issue.status === "VERIFIED" ? null : (
                                    <IssueTrialDeadlineChip
                                      dueDate={issue.dueDate}
                                      nextTrialDate={nextPlannedTrialDate}
                                      now={requestNow}
                                      locale={locale}
                                    />
                                  )}
                                </div>
                              </td>
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
                                  locale={locale}
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
                          <h3>{t("project.addTrialIssue")}</h3>
                          <TrialIssuePanelForm
                            activeParts={activeParts}
                            dictionary={dictionary}
                            locale={locale}
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
                                    {translateLabel(dictionary, "verificationStatus", option)}
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
          {/* Information, not a gate: the form below stays fully usable. */}
          {openIssueCountForNotice === 0 ? null : (
            <p className="notice noticeWarning" role="status">
              <span>
                {locale === "ZH_CN"
                  ? `有${openIssueCountForNotice}${projectSectionLabels.openIssuesBeforeTrial.zh}`
                  : `${openIssueCountForNotice} ${projectSectionLabels.openIssuesBeforeTrial.en}`}
              </span>
            </p>
          )}
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


      <section
        className="workSurface sectionHue sectionAnchor"
        id="section-files"
        style={sectionHueVars("paused")}
        aria-labelledby="files-heading"
      >
        <details>
          <summary className="surfaceHeader cursor-pointer list-none">
            <div>
              <h2 id="files-heading">{pickLabel(attachmentLabels.filesTitle, locale)}</h2>
              <span>
                {pickLabel(attachmentLabels.filesSubtitle, locale)} ({projectAttachments.length})
              </span>
            </div>
          </summary>
          <div className="grid gap-4 p-4 sm:p-[18px]">
            <AttachmentList
              attachments={projectAttachments}
              currentUserId={currentUser.id}
              canAdminDelete={canAdminDeleteAttachment}
              redirectTo={redirectTo}
            />
            {canUploadAttachment ? (
              <AttachmentUploader
                projectId={project.id}
                entityType="MOLD_TRIAL_PROJECT"
                entityId={project.id}
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
          locale={locale}
          sectionId="section-customer-files"
          sectionClassName="sectionHue sectionAnchor"
          sectionStyle={sectionHueVars("in-correction")}
        />
      ) : null}

      <section
        className="workSurface sectionHue sectionAnchor"
        id="section-history"
        style={sectionHueVars("paused")}
        aria-labelledby="planning-history-heading"
      >
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
                    <td>{displayDate(history.date)}</td>
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

      <section
        className="workSurface sectionHue sectionAnchor"
        id="section-activity"
        style={sectionHueVars("paused")}
        aria-labelledby="activity-heading"
      >
        <div className="surfaceHeader">
          <h2 id="activity-heading">{t("project.activityTimeline")}</h2>
        </div>
        <ol className="activityList">
          {activityLogs.length === 0 ? (
            <li className="emptyTimeline">{t("project.noActivity")}</li>
          ) : (
            activityLogs.map((activity) => (
              <li key={activity.id}>
                <span>{displayDate(activity.createdAt)}</span>
                <span className="activityEntity">{translateActivityEntity(dictionary, activity.entityType)}</span>
                <strong>{translateActivityAction(dictionary, activity.action)}</strong>
                <small>{activity.actorUser.displayName}</small>
              </li>
            ))
          )}
        </ol>
      </section>

      {/* Admin archive. Last on the page and behind a closed <details>, because
          it is the one irreversible thing here: the code is renamed and released
          the moment it commits. Required reason + required confirm checkbox,
          both re-checked server-side (archiveMoldTrialProject). No rail entry —
          this is not a place anyone should be navigating to. */}
      {canArchiveProject ? (
        <section className="workSurface" aria-labelledby="archive-project-heading">
          <details>
            <summary className="surfaceHeader cursor-pointer list-none">
              <div>
                <h2 id="archive-project-heading">
                  {projectArchiveLabels.archiveProject.zh} · {projectArchiveLabels.archiveProject.en}
                </h2>
                <span>{pickLabel(projectArchiveLabels.confirm, locale)}</span>
              </div>
            </summary>
            <form action={archiveMoldTrialProject} className="grid gap-3 p-4 sm:p-[18px]">
              <input type="hidden" name="projectCode" value={project.projectCode} />
              <input type="hidden" name="redirectTo" value="/admin?tab=archived" />
              <label className="grid gap-1">
                {pickLabel(projectArchiveLabels.reason, locale)}
                <textarea name="archiveReason" rows={2} required maxLength={archiveReasonMaxLength} />
                <span className="text-[0.8125rem] text-neutral-500">
                  {pickLabel(projectArchiveLabels.reasonHint, locale)}
                </span>
              </label>
              <label className="flex items-start gap-2 text-sm">
                <input type="checkbox" name="confirmArchive" value="yes" required />
                <span>{pickLabel(projectArchiveLabels.confirm, locale)}</span>
              </label>
              <div className="formActions">
                <SubmitButton variant="danger">
                  {pickLabel(projectArchiveLabels.archiveProject, locale)}
                </SubmitButton>
              </div>
            </form>
          </details>
        </section>
      ) : null}

      </div>
      </div>
    </main>
  );
}
