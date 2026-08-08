import { en } from "./locales/en.ts";
import { zhCN } from "./locales/zh-CN.ts";

export const languageCookieName = "moldpilot_language";
export const supportedLanguages = ["en", "zh-CN"] as const;

export type Language = (typeof supportedLanguages)[number];
export type TranslationKey = keyof typeof en;
export type Dictionary = Record<TranslationKey, string>;

export const dictionaries: Record<Language, Dictionary> = {
  en,
  "zh-CN": zhCN
};

export function isSupportedLanguage(value: unknown): value is Language {
  return typeof value === "string" && supportedLanguages.some((language) => language === value);
}

export function normalizeLanguage(value: unknown): Language {
  return isSupportedLanguage(value) ? value : "en";
}

export function createTranslator(dictionary: Dictionary) {
  return (key: TranslationKey, values?: Record<string, string | number>): string => {
    let text = dictionary[key] ?? en[key] ?? key;

    if (values == null) {
      return text;
    }

    for (const [name, value] of Object.entries(values)) {
      text = text.replaceAll(`{${name}}`, String(value));
    }

    return text;
  };
}

export function translateDynamic(
  dictionary: Dictionary,
  key: string,
  fallback: string,
  values?: Record<string, string | number>
): string {
  if (key in dictionary) {
    return createTranslator(dictionary)(key as TranslationKey, values);
  }

  return fallback;
}

export function translateLabel(dictionary: Dictionary, group: string, value: string | null | undefined): string {
  if (value == null || value.trim().length === 0) {
    return createTranslator(dictionary)("common.notSet");
  }

  return translateDynamic(dictionary, `label.${group}.${value}`, value);
}

export function translatePermissionName(dictionary: Dictionary, permissionCode: string, fallback: string): string {
  return translateDynamic(dictionary, `permission.${permissionCode}`, fallback);
}

export function translatePermissionGroup(dictionary: Dictionary, processGroup: string): string {
  return translateDynamic(dictionary, `permission.group.${processGroup}`, processGroup);
}

const workflowMessageKeyByText = {
  "Auto-missed trial resolved as missed.": "workflow.autoMissedResolved",
  "Project marked blocked.": "workflow.projectBlocked",
  "Project marked paused.": "workflow.projectPaused",
  "Trial date confirmed.": "workflow.trialDateConfirmed",
  "Proposed a different trial date. Awaiting Marketing approval.": "workflow.trialDateProposed",
  "Approved the new trial date.": "workflow.trialDateApproved",
  "Returned the trial date to the PM.": "workflow.trialDateReturned",
  "Trial re-dated. Awaiting confirmation again.": "workflow.trialRedated",
  "Trial issue closed.": "workflow.issueClosed",
  "Trial issue updated.": "workflow.issueUpdated",
  "File uploaded.": "workflow.fileUploaded",
  "Measurement report uploaded.": "workflow.measurementReportUploaded",
  "Measurement report replaced.": "workflow.measurementReportReplaced",
  "Invalid username or password.": "workflow.invalidCredentials",
  "Invalid username or password. Please wait and try again.": "workflow.invalidCredentialsWait",
  "Change your temporary password before continuing.": "workflow.changeTemporaryPassword",
  "Logged out.": "workflow.loggedOut",
  "Password updated.": "workflow.passwordUpdated",
  "Current password is incorrect.": "workflow.currentPasswordIncorrect",
  "Username may use lowercase letters, numbers, dots, underscores, or hyphens.": "workflow.usernameFormat",
  "New password must be at least 8 characters.": "workflow.passwordMinimum",
  "Password confirmation does not match.": "workflow.passwordMismatch",
  "Choose a non-temporary password.": "workflow.nonTemporaryPassword",
  "Username is already in use.": "workflow.usernameInUse",
  "Password update could not be verified. Try again.": "workflow.passwordVerificationFailed",
  "Unable to update password.": "workflow.passwordUpdateFailed",
  "Saved role permission matrix.": "workflow.savedPermissionMatrix",
  "Project intake created. Planning PM can set T0 next.": "workflow.projectIntakeCreated",
  "Mold trial project created.": "workflow.projectCreated",
  "Parts / cavities updated.": "workflow.partsUpdated",
  "First T0 planned date set.": "workflow.firstT0Set",
  "Missed trial recorded.": "workflow.missedTrialRecorded",
  "Auto-missed trial already resolved.": "workflow.autoMissedAlreadyResolved",
  "Completed trial recorded.": "workflow.completedTrialRecorded",
  "Process sheet saved.": "workflow.processSheetSaved",
  "New planned trial added.": "workflow.plannedTrialAdded",
  "Trial issue created.": "workflow.issueCreated",
  "Trial issue edited.": "workflow.issueEdited",
  "Trial issue already closed.": "workflow.issueAlreadyClosed",
  "PM custom trial limit saved.": "workflow.customLimitSaved",
  "Design change saved.": "workflow.designChangeSaved",
  "Design change saved with extra trial allowance.": "workflow.designChangeAllowanceSaved",
  "File deleted.": "workflow.fileDeleted",
  "Upload complete.": "workflow.uploadComplete",
  "Upload failed.": "workflow.uploadFailed",
  "Upload could not reach the server.": "workflow.uploadServerUnavailable",
  "Upload could not be completed.": "workflow.uploadCouldNotComplete",
  "Authentication is required.": "workflow.uploadAuthenticationRequired",
  "Change your password before uploading files.": "workflow.uploadPasswordChangeRequired",
  "Too many uploads are already in progress.": "workflow.uploadBusy",
  "Measurement report was already uploaded.": "workflow.measurementReportAlreadyUploaded",
  "The downloaded Excel workbook is empty.": "workflow.workbookEmpty",
  "The downloaded attachment is not an Excel workbook.": "workflow.workbookNotAttachment",
  "The downloaded attachment is not a valid Excel workbook.": "workflow.workbookInvalid",
  "The protected Excel download was rejected.": "workflow.workbookRejected",
  "Unable to create project.": "workflow.createProjectFailed",
  "Unable to update parts / cavities.": "workflow.updatePartsFailed",
  "Unable to update identifiers.": "workflow.updateIdentifiersFailed",
  "Unable to set first T0 date.": "workflow.setFirstT0Failed",
  "Unable to record missed trial.": "workflow.recordMissedFailed",
  "Unable to resolve auto-missed trial.": "workflow.resolveAutoMissedFailed",
  "Unable to record completed trial.": "workflow.recordCompletedFailed",
  "Unable to add planned trial.": "workflow.addPlannedTrialFailed",
  "Unable to create trial issue.": "workflow.createIssueFailed",
  "Unable to edit trial issue.": "workflow.editIssueFailed",
  "Unable to close trial issue.": "workflow.closeIssueFailed",
  "Unable to update trial issue.": "workflow.updateIssueFailed",
  "Unable to set custom trial limit.": "workflow.customLimitFailed",
  "Unable to create design change.": "workflow.designChangeFailed",
  "Unable to delete file.": "workflow.deleteFileFailed"
} as const satisfies Record<string, TranslationKey>;

const workflowMessagePatterns = [
  { pattern: /^Saved account (.+)\.$/, key: "workflow.savedAccount", valueName: "item" },
  { pattern: /^Archived account (.+)\.$/, key: "workflow.archivedAccount", valueName: "item" },
  { pattern: /^Restored account (.+)\.$/, key: "workflow.restoredAccount", valueName: "item" },
  { pattern: /^Reset password for (.+)\.$/, key: "workflow.resetAccountPassword", valueName: "item" },
  { pattern: /^Saved client (.+)\.$/, key: "workflow.savedClient", valueName: "item" },
  { pattern: /^Archived client (.+)\.$/, key: "workflow.archivedClient", valueName: "item" },
  { pattern: /^Restored client (.+)\.$/, key: "workflow.restoredClient", valueName: "item" },
  { pattern: /^Saved injection machine (.+)\.$/, key: "workflow.savedMachine", valueName: "item" },
  { pattern: /^Deleted injection machine (.+)\.$/, key: "workflow.deletedMachine", valueName: "item" },
  {
    pattern: /^Hid injection machine (.+) from future selectors\.$/,
    key: "workflow.hiddenMachine",
    valueName: "item"
  },
  { pattern: /^Saved role (.+)\.$/, key: "workflow.savedRole", valueName: "item" },
  { pattern: /^Updated permissions for (.+)\.$/, key: "workflow.updatedRolePermissions", valueName: "item" },
  { pattern: /^Updated identifiers for (.+)\.$/, key: "workflow.identifiersUpdated", valueName: "item" },
  { pattern: /^Saved 1 user row\.$/, key: "workflow.savedOneUserRow", valueName: null },
  { pattern: /^Saved (\d+) user rows\.$/, key: "workflow.savedUserRows", valueName: "count" },
  { pattern: /^Saved 1 client row\.$/, key: "workflow.savedOneClientRow", valueName: null },
  { pattern: /^Saved (\d+) client rows\.$/, key: "workflow.savedClientRows", valueName: "count" }
] as const satisfies readonly {
  pattern: RegExp;
  key: TranslationKey;
  valueName: "item" | "count" | null;
}[];

export function translateWorkflowMessage(dictionary: Dictionary, message: string | null): string | null {
  if (message == null) {
    return null;
  }

  const key = workflowMessageKeyByText[message as keyof typeof workflowMessageKeyByText];
  if (key != null) {
    return createTranslator(dictionary)(key);
  }

  for (const candidate of workflowMessagePatterns) {
    const match = candidate.pattern.exec(message);
    if (match == null) {
      continue;
    }

    return createTranslator(dictionary)(
      candidate.key,
      candidate.valueName == null ? undefined : { [candidate.valueName]: match[1] }
    );
  }

  return message;
}
