"use client";

import { useState } from "react";
import { formatBilingualUserOption } from "@/domain/mold-trial/users";
import { translateLabel } from "@/i18n";
import { useI18n } from "@/i18n/language-provider";
import { addNewPlannedTrial } from "@/server/mold-trial-actions";
import { changeRequesterOptions, newTrialReasonOptions, sourceAreaOptions } from "@/server/dev-options";

type ActiveUserOption = {
  chineseName: string | null;
  displayName: string;
  username: string;
};

type AddPlannedTrialPanelFormProps = {
  activeUserOptions: readonly ActiveUserOption[];
  currentUsername: string;
  projectCode: string;
  redirectTo: string;
};

const designChangeReasonValues = new Set(["CUSTOMER_DESIGN_CHANGE"]);

export function AddPlannedTrialPanelForm({
  activeUserOptions,
  currentUsername,
  projectCode,
  redirectTo
}: AddPlannedTrialPanelFormProps) {
  const { dictionary, t } = useI18n();
  const [reason, setReason] = useState("PLANNED_NEXT_TRIAL_AFTER_CORRECTION");
  const isDesignChangeReason = designChangeReasonValues.has(reason);

  return (
    <form action={addNewPlannedTrial} className="formGrid compactPanelForm">
      <input type="hidden" name="projectCode" value={projectCode} />
      <input type="hidden" name="redirectTo" value={redirectTo} />
      <label>
        {t("field.plannedDate")}
        <input name="plannedDate" type="date" required />
      </label>
      <label>
        {t("field.reason")}
        <select
          name="planReasonCategory"
          defaultValue="PLANNED_NEXT_TRIAL_AFTER_CORRECTION"
          onChange={(event) => setReason(event.currentTarget.value)}
          required
        >
          {newTrialReasonOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {translateLabel(dictionary, "newTrialReason", option.label)}
            </option>
          ))}
        </select>
      </label>
      <label>
        {t("field.requester")}
        <select name="requesterUsername" defaultValue={currentUsername} required>
          {activeUserOptions.map((user) => (
            <option key={user.username} value={user.username}>
              {formatBilingualUserOption(user)}
            </option>
          ))}
        </select>
      </label>
      <label>
        {t("field.source")}
        <select name="sourceArea" defaultValue="PLANNING" required>
          {sourceAreaOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {translateLabel(dictionary, "sourceArea", option.label)}
            </option>
          ))}
        </select>
      </label>
      {isDesignChangeReason ? (
        <>
          <label>
            {t("project.designChangeSource")}
            <select name="designChangeRequestedBy" defaultValue="NONE">
              {changeRequesterOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {translateLabel(dictionary, "changeRequester", option.label)}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t("project.designChangeDate")}
            <input name="designChangeDate" type="date" />
          </label>
          <label className="fullSpan">
            {t("project.designChangeTitle")}
            <input name="designChangeTitle" placeholder={t("common.optional")} />
          </label>
        </>
      ) : null}
      <label className="fullSpan">
        {t("field.reasonDetail")}
        <textarea name="planReasonDetail" rows={3} />
      </label>
      <div className="formActions">
        <button type="submit">{t("common.addPlannedTrial")}</button>
      </div>
    </form>
  );
}
