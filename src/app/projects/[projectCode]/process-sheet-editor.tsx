"use client";

import { useActionState, useEffect, useMemo, useRef, useState } from "react";
import {
  copyPreviousTrialProcessSheetValues,
  isCopyableProcessSheetParameter,
  isProcessSheetSummaryParameter,
  nextProcessSheetInputIndex
} from "@/domain/mold-trial/process-sheet";
import { useI18n } from "@/i18n/language-provider";
import { formatLocalizedTime } from "@/i18n/display";
import type { Language } from "@/i18n";
import { saveTrialProcessSheetValues, type ProcessSheetSaveState } from "@/server/mold-trial-actions";

type ProcessSheetParameterInput = {
  id: string;
  section: string;
  parameterKey: string;
  labelEn: string;
  labelZh: string | null;
  unit: string | null;
  valueType: string;
};

type ProcessSheetTrialInput = {
  id: string;
  label: string;
  statusLabel: string;
  injectionMachineId: string;
};

type ProcessSheetValueInput = {
  trialEventId: string;
  processSheetParameterId: string;
  displayValue: string;
};

type ProcessSheetMachineInput = {
  id: string;
  label: string;
};

type ProcessSheetEditorProps = {
  canEdit: boolean;
  currentEditableTrialId: string | null;
  projectCode: string;
  redirectTo: string;
  templateName: string;
  parameters: ProcessSheetParameterInput[];
  trials: ProcessSheetTrialInput[];
  values: ProcessSheetValueInput[];
  machines: ProcessSheetMachineInput[];
};

const initialSaveState: ProcessSheetSaveState = {
  ok: false,
  message: null,
  savedAt: null,
  changedCount: 0,
  savedFieldCount: 0
};

function processValueInputType(valueType: string): "date" | "number" | "text" {
  if (valueType === "DATE") {
    return "date";
  }

  if (valueType === "NUMBER") {
    return "number";
  }

  return "text";
}

function editableValue(displayValue: string | undefined): string {
  return displayValue == null || displayValue === "-" ? "" : displayValue;
}

function displayValue(value: string | undefined): string {
  return value == null || value.trim().length === 0 ? "-" : value;
}

function savedAtLabel(value: string | null, language: Language): string | null {
  return formatLocalizedTime(value, language);
}

function SaveButton({ changedCount }: { changedCount: number }) {
  const { t } = useI18n();

  return (
    <button type="submit" disabled={changedCount === 0}>
      {t("process.saveProcessSheet")}
    </button>
  );
}

export function ProcessSheetEditor({
  canEdit,
  currentEditableTrialId,
  projectCode,
  redirectTo,
  templateName,
  parameters,
  trials,
  values,
  machines
}: ProcessSheetEditorProps) {
  const { language, t } = useI18n();
  const [state, formAction, pending] = useActionState(saveTrialProcessSheetValues, initialSaveState);
  const editableTrial = trials.find((trial) => trial.id === currentEditableTrialId) ?? null;
  const editableTrialIndex = editableTrial == null ? -1 : trials.findIndex((trial) => trial.id === editableTrial.id);
  const previousTrial = editableTrialIndex > 0 ? trials[editableTrialIndex - 1] : null;
  const visibleParameters = useMemo(
    () => parameters.filter((parameter) => !isProcessSheetSummaryParameter(parameter.parameterKey)),
    [parameters]
  );
  const valueByCell = useMemo(
    () => new Map(values.map((value) => [`${value.trialEventId}:${value.processSheetParameterId}`, value.displayValue])),
    [values]
  );
  const initialEditableValues = useMemo(
    () =>
      Object.fromEntries(
        visibleParameters.map((parameter) => [
          parameter.id,
          editableTrial == null ? "" : editableValue(valueByCell.get(`${editableTrial.id}:${parameter.id}`))
        ])
      ),
    [editableTrial, valueByCell, visibleParameters]
  );
  const previousValues = useMemo(
    () =>
      Object.fromEntries(
        visibleParameters.map((parameter) => [
          parameter.id,
          previousTrial == null ? "" : editableValue(valueByCell.get(`${previousTrial.id}:${parameter.id}`))
        ])
      ),
    [previousTrial, valueByCell, visibleParameters]
  );
  const copyableParameterIds = useMemo(
    () =>
      visibleParameters
        .filter((parameter) => isCopyableProcessSheetParameter(parameter.parameterKey))
        .map((parameter) => parameter.id),
    [visibleParameters]
  );
  const [currentValues, setCurrentValues] = useState(initialEditableValues);
  const [machineId, setMachineId] = useState(editableTrial?.injectionMachineId ?? "");
  const [baselineValues, setBaselineValues] = useState(initialEditableValues);
  const [baselineMachineId, setBaselineMachineId] = useState(editableTrial?.injectionMachineId ?? "");
  const [copyFeedback, setCopyFeedback] = useState<string | null>(null);
  const [overwriteAvailable, setOverwriteAvailable] = useState(false);
  const [sourceEditableValues, setSourceEditableValues] = useState(initialEditableValues);
  const [sourceMachineId, setSourceMachineId] = useState(
    editableTrial?.injectionMachineId ?? ""
  );
  const inputRefs = useRef<Array<HTMLInputElement | null>>([]);
  const valuesRef = useRef(currentValues);
  const machineIdRef = useRef(machineId);

  const nextSourceMachineId = editableTrial?.injectionMachineId ?? "";
  if (
    sourceEditableValues !== initialEditableValues ||
    sourceMachineId !== nextSourceMachineId
  ) {
    setSourceEditableValues(initialEditableValues);
    setSourceMachineId(nextSourceMachineId);
    setCurrentValues(initialEditableValues);
    setBaselineValues(initialEditableValues);
    setMachineId(nextSourceMachineId);
    setBaselineMachineId(nextSourceMachineId);
    setCopyFeedback(null);
    setOverwriteAvailable(false);
  }

  useEffect(() => {
    valuesRef.current = currentValues;
    machineIdRef.current = machineId;
  }, [currentValues, machineId]);

  useEffect(() => {
    if (!state.ok || state.savedAt == null) {
      return;
    }

    setBaselineValues(valuesRef.current);
    setBaselineMachineId(machineIdRef.current);
    window.history.replaceState(null, "", "#process-sheet-heading");
  }, [state.ok, state.savedAt]);

  const sectionRows = useMemo(
    () =>
      visibleParameters.reduce<Array<{ section: string; parameters: ProcessSheetParameterInput[] }>>((groups, parameter) => {
        const last = groups.at(-1);

        if (last != null && last.section === parameter.section) {
          last.parameters.push(parameter);
        } else {
          groups.push({ section: parameter.section, parameters: [parameter] });
        }

        return groups;
      }, []),
    [visibleParameters]
  );
  const changedFieldCount =
    visibleParameters.filter((parameter) => (currentValues[parameter.id] ?? "") !== (baselineValues[parameter.id] ?? "")).length +
    (machineId !== baselineMachineId ? 1 : 0);
  const savedAt = savedAtLabel(state.savedAt, language);

  function handleInputKeyDown(index: number, event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key !== "Enter") {
      return;
    }

    event.preventDefault();
    const nextIndex = nextProcessSheetInputIndex({
      currentIndex: index,
      fieldCount: visibleParameters.length,
      shiftKey: event.shiftKey
    });
    inputRefs.current[nextIndex]?.focus();
  }

  function copyPrevious(overwrite: boolean) {
    if (previousTrial == null) {
      setCopyFeedback(t("process.noPreviousTrial"));
      setOverwriteAvailable(false);
      return;
    }

    const result = copyPreviousTrialProcessSheetValues({
      currentMachineId: machineId,
      previousMachineId: previousTrial.injectionMachineId,
      currentValues,
      previousValues,
      copyableKeys: copyableParameterIds,
      overwrite
    });
    setMachineId(result.machineId);
    setCurrentValues(result.values);
    setOverwriteAvailable(!overwrite && result.skippedExistingKeys.length > 0);
    setCopyFeedback(
      overwrite
        ? t("process.copiedOverwriteFields", { count: result.overwrittenKeys.length })
        : t("process.copiedBlankFields", { count: result.changedCount, trial: previousTrial.label })
    );
  }

  const table = (
    <div className="tableWrap processSheetWrap">
      <table className="processSheetTable">
        <thead>
          <tr>
            <th>{t("process.processRow")}</th>
            {trials.length === 0 ? (
              <th>{t("process.noTrialColumns")}</th>
            ) : (
              trials.map((trial) => (
                <th key={trial.id}>
                  <span>{trial.label}</span>
                  <small>{trial.statusLabel}</small>
                </th>
              ))
            )}
          </tr>
        </thead>
        <tbody>
          {visibleParameters.length === 0 ? (
            <tr>
              <td className="emptyTableCell" colSpan={Math.max(2, trials.length + 1)}>
                {t("process.noTemplateAssigned")}
              </td>
            </tr>
          ) : (
            sectionRows.flatMap((section) => [
              <tr className="processSectionRow" key={`section-${section.section}`}>
                <th colSpan={Math.max(2, trials.length + 1)}>{section.section}</th>
              </tr>,
              ...section.parameters.map((parameter) => (
                <tr key={parameter.id}>
                  <th className="processParameterCell">
                    <span>{parameter.labelEn}</span>
                    <small>{[parameter.labelZh, parameter.unit].filter(Boolean).join(" / ") || parameter.parameterKey}</small>
                  </th>
                  {trials.length === 0 ? (
                    <td>-</td>
                  ) : (
                    trials.map((trial) => {
                      const editable = canEdit && editableTrial != null && trial.id === editableTrial.id;
                      const inputIndex = visibleParameters.findIndex((item) => item.id === parameter.id);

                      return (
                        <td key={`${trial.id}-${parameter.id}`} className={editable ? "processEditableCell" : "processReadonlyCell"}>
                          {editable ? (
                            <>
                              <input type="hidden" name="processParameterId" value={parameter.id} />
                              <input
                                ref={(element) => {
                                  inputRefs.current[inputIndex] = element;
                                }}
                                name={`value:${parameter.id}`}
                                type={processValueInputType(parameter.valueType)}
                                step={parameter.valueType === "NUMBER" ? "any" : undefined}
                                value={currentValues[parameter.id] ?? ""}
                                onChange={(event) => {
                                  setCurrentValues((current) => ({
                                    ...current,
                                    [parameter.id]: event.target.value
                                  }));
                                  setOverwriteAvailable(false);
                                }}
                                onKeyDown={(event) => handleInputKeyDown(inputIndex, event)}
                              />
                            </>
                          ) : (
                            displayValue(valueByCell.get(`${trial.id}:${parameter.id}`))
                          )}
                        </td>
                      );
                    })
                  )}
                </tr>
              ))
            ])
          )}
        </tbody>
      </table>
    </div>
  );

  if (!canEdit || editableTrial == null || visibleParameters.length === 0) {
    return (
      <>
        <div className="processSheetControls processSheetReadOnlyBar">
          <div className="processSheetStatus">
            <strong>
              {editableTrial == null ? t("process.noEditableTrial") : t("process.currentEditing", { trial: editableTrial.label })}
            </strong>
            <span>{templateName}</span>
          </div>
        </div>
        {table}
        {!canEdit ? <div className="blockedAction">{t("common.blockedAction")}</div> : null}
      </>
    );
  }

  return (
    <form action={formAction} className="processSheetForm">
      <input type="hidden" name="projectCode" value={projectCode} />
      <input type="hidden" name="redirectTo" value={`${redirectTo}#process-sheet-heading`} />
      <input type="hidden" name="trialEventId" value={editableTrial.id} />
      <div className="processSheetControls">
        <div className="processSheetStatus">
          <strong>{t("process.currentEditing", { trial: editableTrial.label })}</strong>
          <span>{t("common.unsavedChanges", { count: changedFieldCount })}</span>
          {pending ? <span>{t("process.saving")}</span> : null}
          {state.message == null ? null : (
            <span className={state.ok ? "processSheetSaved" : "processSheetError"}>
              {state.ok && savedAt != null
                ? t("process.savedFields", {
                    changed: state.changedCount,
                    saved: state.savedFieldCount,
                    time: savedAt
                  })
                : state.message}
            </span>
          )}
        </div>
        <div className="processSheetCopyActions">
          <label>
            {t("field.injectionMachine")}
            <select
              name="injectionMachineId"
              value={machineId}
              onChange={(event) => {
                setMachineId(event.target.value);
                setOverwriteAvailable(false);
              }}
            >
              <option value="">{t("process.noMachineSelected")}</option>
              {machines.map((machine) => (
                <option key={machine.id} value={machine.id}>
                  {machine.label}
                </option>
              ))}
            </select>
          </label>
          <button type="button" className="secondaryButton" disabled={previousTrial == null} onClick={() => copyPrevious(false)}>
            {t("process.copyPreviousTrial")}
          </button>
          {overwriteAvailable ? (
            <button type="button" className="secondaryButton" onClick={() => copyPrevious(true)}>
              {t("common.confirmOverwrite")}
            </button>
          ) : null}
          <SaveButton changedCount={changedFieldCount} />
        </div>
      </div>
      {copyFeedback == null ? null : <p className="processSheetFeedback">{copyFeedback}</p>}
      {table}
    </form>
  );
}
