"use client";

import { useRef, type RefObject } from "react";
import { translateLabel } from "@/i18n";
import { useI18n } from "@/i18n/language-provider";
import { closeTrialIssue, editTrialIssue } from "@/server/mold-trial-actions";

type Option = {
  value: string;
  label: string;
};

type UserOption = {
  username: string;
  label: string;
};

type PartOption = {
  id: string;
  label: string;
};

type IssueActionInput = {
  id: string;
  title: string;
  affectedPartId: string;
  issueType: string;
  source: string;
  severity: string;
  status: string;
  ownerUsername: string;
  dueDate: string;
  description: string;
};

type TrialIssueRowActionsProps = {
  activeParts: readonly PartOption[];
  activeUserOptions: readonly UserOption[];
  canClose: boolean;
  canEdit: boolean;
  issue: IssueActionInput;
  issueSourceOptions: readonly Option[];
  issueStatusOptions: readonly Option[];
  issueTypeOptions: readonly Option[];
  projectCode: string;
  redirectTo: string;
  requiresNonOwnerCloseReason: boolean;
  severityOptions: readonly Option[];
  todayInputDate: string;
};

function openDialog(ref: RefObject<HTMLDialogElement | null>) {
  if (ref.current != null && !ref.current.open) {
    ref.current.showModal();
  }
}

function closeDialog(ref: RefObject<HTMLDialogElement | null>) {
  ref.current?.close();
}

export function TrialIssueRowActions({
  activeParts,
  activeUserOptions,
  canClose,
  canEdit,
  issue,
  issueSourceOptions,
  issueStatusOptions,
  issueTypeOptions,
  projectCode,
  redirectTo,
  requiresNonOwnerCloseReason,
  severityOptions,
  todayInputDate
}: TrialIssueRowActionsProps) {
  const { dictionary, t } = useI18n();
  const editDialogRef = useRef<HTMLDialogElement>(null);
  const closeDialogRef = useRef<HTMLDialogElement>(null);
  const issueIsClosed = issue.status === "CLOSED";

  return (
    <div className="issueRowActions">
      <button type="button" className="secondaryButton" disabled={!canEdit} onClick={() => openDialog(editDialogRef)}>
        {t("common.edit")}
      </button>
      <button
        type="button"
        className="secondaryButton"
        disabled={issueIsClosed || !canClose}
        onClick={() => openDialog(closeDialogRef)}
      >
        {issueIsClosed ? t("common.closed") : t("common.closeIssue")}
      </button>

      <dialog ref={editDialogRef} className="modalDialog issueActionDialog">
        <div className="modalHeader">
          <h3>{issueIsClosed ? t("issue.closedOverride") : t("issue.editIssue")}</h3>
          <button type="button" className="iconButton" aria-label={t("issue.closeEditDialog")} onClick={() => closeDialog(editDialogRef)}>
            x
          </button>
        </div>
        {issueIsClosed ? <p className="modalNote">{t("issue.closedOverrideNote")}</p> : null}
        <form action={editTrialIssue} className="formGrid compactPanelForm issueModalForm">
          <input type="hidden" name="projectCode" value={projectCode} />
          <input type="hidden" name="redirectTo" value={redirectTo} />
          <input type="hidden" name="issueId" value={issue.id} />
          <label className="fullSpan">
            {t("field.title")}
            <input name="title" defaultValue={issue.title} required />
          </label>
          <label>
            {t("field.affectedPart")}
            <select name="affectedPartId" defaultValue={issue.affectedPartId}>
              <option value="">{t("common.notSet")}</option>
              {activeParts.map((part) => (
                <option key={part.id} value={part.id}>
                  {part.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t("field.issueType")}
            <select name="issueType" defaultValue={issue.issueType} required>
              {issueTypeOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {translateLabel(dictionary, "issueType", option.label)}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t("field.source")}
            <select name="source" defaultValue={issue.source} required>
              {issueSourceOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {translateLabel(dictionary, "issueSource", option.label)}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t("field.severity")}
            <select name="severity" defaultValue={issue.severity} required>
              {severityOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {translateLabel(dictionary, "severity", option.label)}
                </option>
              ))}
            </select>
          </label>
          {issueIsClosed ? (
            <label>
              {t("field.status")}
              <input value={t("common.closed")} disabled />
              <input type="hidden" name="status" value="CLOSED" />
            </label>
          ) : (
            <label>
              {t("field.status")}
              <select name="status" defaultValue={issue.status} required>
                {issueStatusOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {translateLabel(dictionary, "issueStatus", option.label)}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label>
            {t("field.owner")}
            <select name="ownerUsername" defaultValue={issue.ownerUsername} required>
              {activeUserOptions.map((user) => (
                <option key={user.username} value={user.username}>
                  {user.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t("field.dueDate")}
            <input name="dueDate" type="date" defaultValue={issue.dueDate} />
          </label>
          <label className="fullSpan">
            {t("field.description")}
            <textarea name="description" rows={3} defaultValue={issue.description} />
          </label>
          <div className="formActions fullSpan">
            <button type="button" className="secondaryButton" onClick={() => closeDialog(editDialogRef)}>
              {t("common.cancel")}
            </button>
            <button type="submit">{t("issue.saveIssue")}</button>
          </div>
        </form>
      </dialog>

      {issueIsClosed ? null : (
        <dialog ref={closeDialogRef} className="modalDialog issueActionDialog">
          <div className="modalHeader">
            <h3>{t("common.closeIssue")}</h3>
            <button type="button" className="iconButton" aria-label={t("issue.closeCloseDialog")} onClick={() => closeDialog(closeDialogRef)}>
              x
            </button>
          </div>
          <form action={closeTrialIssue} className="formGrid compactPanelForm issueModalForm">
            <input type="hidden" name="projectCode" value={projectCode} />
            <input type="hidden" name="redirectTo" value={redirectTo} />
            <input type="hidden" name="issueId" value={issue.id} />
            <label className="fullSpan">
              {t("field.fixSummary")}
              <textarea name="fixSummary" rows={3} required />
            </label>
            <label>
              {t("field.fixTimeMinutes")}
              <input name="fixTimeMinutes" type="number" min="1" step="1" required />
            </label>
            <label>
              {t("field.closedDate")}
              <input name="closedAt" type="date" defaultValue={todayInputDate} required />
            </label>
            {requiresNonOwnerCloseReason ? (
              <label className="fullSpan">
                {t("field.nonOwnerCloseReason")}
                <textarea name="nonOwnerCloseReason" rows={2} required />
              </label>
            ) : null}
            <div className="formActions fullSpan">
              <button type="button" className="secondaryButton" onClick={() => closeDialog(closeDialogRef)}>
                {t("common.cancel")}
              </button>
              <button type="submit">{t("common.closeIssue")}</button>
            </div>
          </form>
        </dialog>
      )}
    </div>
  );
}
