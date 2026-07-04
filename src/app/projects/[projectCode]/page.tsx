import Link from "next/link";
import { AccountMenu } from "@/app/account-menu";
import { BlockedAction, hasAllPermissionCodes, hasPermissionCode } from "@/app/permission-ui";
import { PartsCavitiesEditor } from "@/app/parts-cavities-editor";
import { AddPlannedTrialPanelForm } from "@/app/projects/[projectCode]/add-planned-trial-form";
import { ProcessSheetEditor } from "@/app/projects/[projectCode]/process-sheet-editor";
import { TrialIssueRowActions } from "@/app/projects/[projectCode]/trial-issue-row-actions";
import { formatPartSummary } from "@/domain/mold-trial/parts";
import { formatMoldWorkingIdentifier, formatOptionalIdentifier } from "@/domain/mold-trial/identifiers";
import { formatInjectionMachineLabel, isProcessSheetSummaryParameter } from "@/domain/mold-trial/process-sheet";
import {
  buildTrialPanels,
  formatDaysAway,
  formatTrialCountBadge,
  trialStageLabel,
  trialVerificationStatusOptions
} from "@/domain/mold-trial/trial-panel";
import { formatBilingualUserOption } from "@/domain/mold-trial/users";
import { createTranslator, translateLabel, type Dictionary } from "@/i18n";
import { getDictionary } from "@/i18n/server";
import {
  createTrialIssue,
  exportProcessSheetPdf,
  recordCompletedTrial,
  resolveAutoMissedTrial,
  setFirstPlannedTrialDate,
  updateMoldTrialProjectIdentifiers,
  updateMoldTrialParts
} from "@/server/mold-trial-actions";
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
import { getActiveUserOptions, type ActiveUserOption } from "@/server/user-options";

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

function UserOptions({
  includeBlank = false,
  dictionary,
  users
}: {
  includeBlank?: boolean;
  dictionary: Dictionary;
  users: readonly ActiveUserOption[];
}) {
  const t = createTranslator(dictionary);

  return (
    <>
      {includeBlank ? <option value="">{t("common.unassigned")}</option> : null}
      {users.map((user) => (
        <option key={user.username} value={user.username}>
          {formatBilingualUserOption(user)}
        </option>
      ))}
    </>
  );
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

function TrialIssuePanelForm({
  activeParts,
  activeUserOptions,
  dictionary,
  defaultOwnerUsername,
  marketingIssueDefaults,
  projectCode,
  redirectTo,
  trialEventId
}: {
  activeParts: ProjectDetail["project"]["parts"];
  activeUserOptions: readonly ActiveUserOption[];
  dictionary: Dictionary;
  defaultOwnerUsername: string;
  marketingIssueDefaults: boolean;
  projectCode: string;
  redirectTo: string;
  trialEventId: string;
}) {
  const t = createTranslator(dictionary);

  return (
    <form action={createTrialIssue} className="formGrid compactPanelForm widePanelForm">
      <input type="hidden" name="projectCode" value={projectCode} />
      <input type="hidden" name="redirectTo" value={redirectTo} />
      <input type="hidden" name="foundAtTrialEventId" value={trialEventId} />
      <label className="fullSpan">
        {t("field.title")}
        <input name="title" required />
      </label>
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
        <select name="issueType" defaultValue={marketingIssueDefaults ? "BAD_CUSTOMER_FEEDBACK" : "MOLD_DESIGN_ISSUE"} required>
          {issueTypeOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {translateLabel(dictionary, "issueType", option.label)}
            </option>
          ))}
        </select>
      </label>
      <label>
        {t("field.source")}
        <select name="source" defaultValue={marketingIssueDefaults ? "MARKETING_CLIENT_FEEDBACK" : "INTERNAL_TRIAL"} required>
          {issueSourceOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {translateLabel(dictionary, "issueSource", option.label)}
            </option>
          ))}
        </select>
      </label>
      <label>
        {t("field.severity")}
        <select name="severity" defaultValue="MEDIUM" required>
          {severityOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {translateLabel(dictionary, "severity", option.label)}
            </option>
          ))}
        </select>
      </label>
      <label>
        {t("field.status")}
        <select name="status" defaultValue="OPEN" required>
          {issueStatusOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {translateLabel(dictionary, "issueStatus", option.label)}
            </option>
          ))}
        </select>
      </label>
      <label>
        {t("field.owner")}
        <select name="ownerUsername" defaultValue={defaultOwnerUsername} required>
          <UserOptions dictionary={dictionary} users={activeUserOptions} />
        </select>
      </label>
      <label>
        {t("field.dueDate")}
        <input name="dueDate" type="date" required />
      </label>
      <label className="fullSpan">
        {t("field.description")}
        <textarea name="description" rows={2} />
      </label>
      <div className="formActions">
        <button type="submit">{t("common.addTrialIssue")}</button>
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
          <form action={exportProcessSheetPdf}>
            <input type="hidden" name="projectCode" value={projectCode} />
            <input type="hidden" name="redirectTo" value={redirectTo} />
            <button type="submit">{t("project.exportCustomerPdf")}</button>
          </form>
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
  const error = resolvedSearchParams == null ? null : messageValue(resolvedSearchParams, "error");
  const success = resolvedSearchParams == null ? null : messageValue(resolvedSearchParams, "success");

  if (detail == null) {
    return (
      <main className="shell">
        <section className="pageHeader">
          <div>
            <Link className="backLink" href="/">
              {t("common.backToDashboard")}
            </Link>
            <p className="eyebrow">{t("project.moldTrialDetail")}</p>
            <h1>{projectCode}</h1>
          </div>
          <AccountMenu currentUser={currentUser} />
        </section>

        <section className="notice" role="status">
          <strong>{t("dashboard.databaseUnavailable")}</strong>
          <span>{databaseError ?? "Unable to load project detail records."}</span>
        </section>
      </main>
    );
  }

  const { project, activityLogs, limit } = detail;
  const redirectTo = `/projects/${project.projectCode}`;
  const activeParts = project.parts.filter((part) => part.active);
  const partSummary = formatPartSummary(project.parts, project.partCode);
  const workingIdentifier = formatMoldWorkingIdentifier({
    projectCode: project.projectCode,
    clientProjectRef: project.clientProjectRef,
    moldCode: project.moldCode
  });
  const moldCodeDisplay = formatOptionalIdentifier(project.moldCode);
  const clientProjectRefDisplay = formatOptionalIdentifier(project.clientProjectRef);
  const defaultPlanningPmUsername = activePmUserOptions.some((user) => user.username === project.planningPm?.username)
    ? (project.planningPm?.username ?? "")
    : (activePmUserOptions[0]?.username ?? "");
  const defaultIssueOwnerUsername = activeUserOptions.some((user) => user.username === currentUser.username)
    ? currentUser.username
    : activeUserOptions.some((user) => user.username === project.planningPm?.username)
      ? (project.planningPm?.username ?? "")
      : "";
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
  const canCreateIssue = hasPermissionCode(permissionCodes, "trial.issue.create");
  const canEditProcessSheet = hasPermissionCode(permissionCodes, "trial.process_sheet.edit");
  const canExportProcessSheet = hasPermissionCode(permissionCodes, "trial.process_sheet.export_pdf");
  const marketingIssueDefaults = currentUser.roleCode === "MARKETING";
  const issueEditStatusOptions = [...issueStatusOptions, { value: "VERIFIED", label: "Verified" }];
  const issueActionPartOptions = activeParts.map((part) => ({
    id: part.id,
    label: partOptionLabel(part)
  }));
  const issueActionUserOptions = activeUserOptions.map((user) => ({
    username: user.username,
    label: formatBilingualUserOption(user)
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
      <section className="pageHeader">
        <div>
            <Link className="backLink" href="/">
              {t("common.backToDashboard")}
            </Link>
          <p className="eyebrow">{t("project.moldTrialDetail")}</p>
          <h1>{workingIdentifier}</h1>
        </div>
        <div className="pageHeaderActions">
          <AccountMenu currentUser={currentUser} />
          <div className="trialBadgeGroup" aria-label="Project trial status">
            <span className={`trialCountBadge state${limit.warningState.replaceAll(" ", "")}`}>{trialCountBadge}</span>
            <span className="nextTrialBadge">
              {t("project.nextTrial")} {formatDate(defaultCurrentTrial?.plannedDate ?? project.nextPlannedTrialDate)} ({nextTrialDaysAway})
            </span>
          </div>
        </div>
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
              <dd>{moldCodeDisplay}</dd>
            </div>
            <div>
              <dt>{t("project.clientProjectRef")}</dt>
              <dd>{clientProjectRefDisplay}</dd>
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
              <dd>{formatDate(project.firstPlannedTrialDate)}</dd>
            </div>
            <div>
              <dt>{t("project.nextPlannedTrial")}</dt>
              <dd>
                {formatDate(defaultCurrentTrial?.plannedDate ?? project.nextPlannedTrialDate)} ({nextTrialDaysAway})
              </dd>
            </div>
            <div>
              <dt>{t("project.customerTargetDate")}</dt>
              <dd>{formatDate(project.customerTargetDate)}</dd>
            </div>
          </dl>
        </div>
        <div className="noteGrid">
          <div>
            <dt>{t("project.intakeNote")}</dt>
            <dd>{project.intakeNote ?? t("common.notSet")}</dd>
          </div>
          <div>
            <dt>{t("project.initialCustomerNote")}</dt>
            <dd>{project.initialCustomerNote ?? t("common.notSet")}</dd>
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
              <button type="submit">{t("project.saveIdentifiers")}</button>
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
                          <th>{t("field.owner")}</th>
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
                          issuesForPanel.map((issue) => (
                            <tr
                              key={issue.id}
                              className={trialIssueRowStatusClass(issue.status)}
                              data-issue-status={issue.status}
                            >
                              <td>{issue.title}</td>
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
                                  projectCode={project.projectCode}
                                  redirectTo={redirectTo}
                                  requiresNonOwnerCloseReason={issue.ownerUserId !== currentUser.id}
                                  severityOptions={severityOptions}
                                  todayInputDate={todayInputDate}
                                />
                              </td>
                            </tr>
                          ))
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
                            activeUserOptions={activeUserOptions}
                            dictionary={dictionary}
                            defaultOwnerUsername={defaultIssueOwnerUsername}
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
                              <span>{issue.title}</span>
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
