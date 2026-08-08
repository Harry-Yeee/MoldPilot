"use client";

import { useActionState, useEffect, useMemo, useRef, useState } from "react";
import {
  copyPreviousTrialProcessSheetValues,
  isCopyableProcessSheetParameter,
  isProcessSheetSummaryParameter,
  nextProcessSheetInputIndex
} from "@/domain/mold-trial/process-sheet";
import {
  buildProcessSheetZoneMatrix,
  deserializeProcessSheetFlagValues,
  isTransposedProcessSheetSection,
  parseProcessSheetFlagValues,
  parseProcessSheetParameterKind,
  parseProcessSheetZoneCount,
  processSheetCellKey,
  processSheetNavigationCellKeys,
  processSheetOptionValueView,
  processSheetSectionAnchorId,
  processSheetSectionFill,
  processSheetSectionZoneCaptionKind,
  processSheetTrialCellKey,
  processSheetZoneCaption,
  serializeProcessSheetFlagValues,
  type ProcessSheetParameterKind,
  type ProcessSheetSectionFill,
  type ProcessSheetZoneCaptionKind
} from "@/domain/mold-trial/process-sheet-catalog";
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
  kind: string;
  zoneCount: number | null;
  options: string[];
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
  zoneIndex: number;
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

/** A parameter with its shape already parsed — every render path reads this. */
type ShapedParameter = ProcessSheetParameterInput & {
  parameterKind: ProcessSheetParameterKind;
  zones: number[];
};

/**
 * One band of the sheet: the catalog's own run of same-section parameters plus
 * everything the chip and the block both read, so the two can never disagree.
 */
type SheetSection = {
  section: string;
  parameters: ShapedParameter[];
  anchorId: string;
  captionKind: ProcessSheetZoneCaptionKind;
  fill: ProcessSheetSectionFill;
  /** `> 0` means the section prints a zone matrix — the one fact the layout reads. */
  zoneCount: number;
  /**
   * A one-parameter matrix, printed zones-across / trials-down
   * (`isTransposedProcessSheetSection`). Derived here so the block, the Enter
   * order and the export can never disagree about which shape a section takes.
   */
  transposed: boolean;
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
  const visibleParameters = useMemo<ShapedParameter[]>(
    () =>
      parameters
        .filter((parameter) => !isProcessSheetSummaryParameter(parameter.parameterKey))
        .map((parameter) => {
          const parameterKind = parseProcessSheetParameterKind(parameter.kind);
          const zoneCount = parseProcessSheetZoneCount(parameter.zoneCount, parameterKind) ?? 0;

          return {
            ...parameter,
            parameterKind,
            zones: Array.from({ length: zoneCount }, (_unused, index) => index + 1)
          };
        }),
    [parameters]
  );
  /**
   * Every editable cell of the sheet, in render order. A zoned parameter
   * contributes one entry per zone; everything else contributes one. This list
   * is what the value state, the change count, Enter navigation and Copy
   * Previous Trial all work over — which is why zones copy forward without
   * changing the copy helper at all.
   */
  const parameterCells = useMemo(
    () =>
      visibleParameters.flatMap((parameter) =>
        parameter.parameterKind === "ZONED"
          ? parameter.zones.map((zoneIndex) => ({
              parameter,
              zoneIndex,
              cellKey: processSheetCellKey(parameter.id, zoneIndex)
            }))
          : [{ parameter, zoneIndex: 0, cellKey: processSheetCellKey(parameter.id) }]
      ),
    [visibleParameters]
  );
  const valueByCell = useMemo(
    () =>
      new Map(
        values.map((value) => [
          processSheetTrialCellKey(
            value.trialEventId,
            processSheetCellKey(value.processSheetParameterId, value.zoneIndex)
          ),
          value.displayValue
        ])
      ),
    [values]
  );
  const initialEditableValues = useMemo(
    () =>
      Object.fromEntries(
        parameterCells.map((cell) => [
          cell.cellKey,
          editableTrial == null ? "" : editableValue(valueByCell.get(processSheetTrialCellKey(editableTrial.id, cell.cellKey)))
        ])
      ),
    [editableTrial, parameterCells, valueByCell]
  );
  const previousValues = useMemo(
    () =>
      Object.fromEntries(
        parameterCells.map((cell) => [
          cell.cellKey,
          previousTrial == null ? "" : editableValue(valueByCell.get(processSheetTrialCellKey(previousTrial.id, cell.cellKey)))
        ])
      ),
    [parameterCells, previousTrial, valueByCell]
  );
  const copyableCellKeys = useMemo(
    () =>
      parameterCells
        .filter((cell) => isCopyableProcessSheetParameter(cell.parameter.parameterKey))
        .map((cell) => cell.cellKey),
    [parameterCells]
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
      visibleParameters.reduce<Array<{ section: string; parameters: ShapedParameter[] }>>((groups, parameter) => {
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
  /**
   * THE SECTION MAP (2026-08-09, corrected 2026-08-10) — one entry per band,
   * carrying everything both the chip and the band need so the two can never
   * disagree. There is no open/closed state any more: the owner reverted the
   * collapse, so every band is always open and the map is purely a jump list.
   *
   * The fill count is computed from the STORED values, never from
   * `currentValues`: the chip is a statement about what is SAVED, and a count
   * that flickered on every keystroke would be reporting something else.
   *
   * `zoneCount > 0` is the one fact the layout reads — it decides which of the
   * two regions below a section lands in. Derived, not stored, so the band and
   * the matrix can never claim different shapes.
   */
  const sections = useMemo<SheetSection[]>(() => {
    const trialEventIds = trials.map((trial) => trial.id);

    return sectionRows.map((section, index) => {
      const cellKeys = section.parameters.flatMap((parameter) =>
        parameter.parameterKind === "ZONED"
          ? parameter.zones.map((zoneIndex) => processSheetCellKey(parameter.id, zoneIndex))
          : [processSheetCellKey(parameter.id)]
      );
      const fill = processSheetSectionFill({ cellKeys, trialEventIds, valueByTrialCellKey: valueByCell });
      // The section's matrix is as wide as its WIDEST zoned parameter; a
      // parameter with fewer zones leaves its extra columns empty.
      const zoneCount = buildProcessSheetZoneMatrix({
        parameters: section.parameters.map((parameter) => ({ ...parameter, kind: parameter.parameterKind }))
      }).zoneCount;

      return {
        ...section,
        anchorId: processSheetSectionAnchorId(index),
        captionKind: processSheetSectionZoneCaptionKind(
          section.parameters.map((parameter) => ({
            parameterKey: parameter.parameterKey,
            kind: parameter.parameterKind
          }))
        ),
        fill,
        zoneCount,
        transposed: isTransposedProcessSheetSection({
          zoneCount,
          parameterCount: section.parameters.length
        })
      };
    });
  }, [sectionRows, trials, valueByCell]);
  /**
   * THE TWO REGIONS (2026-08-10, the owner's final call on this layout).
   *
   * The sheet is PARTITIONED BY KIND, not packed by width. Every SCALAR /
   * CHOICE / FLAGS section goes first, full width, one under the other — one
   * continuous spreadsheet where T0/T1/T2 sit at the same x through every
   * section, so any row can be read across the trials without moving the eye
   * sideways. Every ZONED section follows, each its own full-width matrix,
   * compared table by table.
   *
   * A partition, not a sort: catalog order is preserved INSIDE each group, so
   * the only thing that ever moves is the group a section belongs to.
   */
  const scalarSections = useMemo(() => sections.filter((section) => section.zoneCount === 0), [sections]);
  const zonedSections = useMemo(() => sections.filter((section) => section.zoneCount > 0), [sections]);
  /** Chip order IS visual order — a map that pointed elsewhere would be a lie. */
  const orderedSections = useMemo(
    () => [...scalarSections, ...zonedSections],
    [scalarSections, zonedSections]
  );
  /**
   * Enter walks the sheet AS RENDERED. `parameterCells` above is the CATALOG's
   * order and stays that way — it is the right order for values, the change
   * count and Copy Previous Trial, none of which care where a field sits. This
   * map is the other question: where the field IS. Same cells, same count,
   * ordered by the two regions, so Enter never jumps out of the part of the page
   * the operator is looking at and never disagrees with Tab.
   *
   * The order itself is `processSheetNavigationCellKeys` — pure, tested — because
   * a TRANSPOSED section (2026-08-10) lays its cells out trials-down, and the
   * walk has to be row-major over that grid rather than the flat run of zones the
   * catalog list happens to be.
   */
  const cellIndexByKey = useMemo(
    () =>
      new Map(
        processSheetNavigationCellKeys({
          sections: orderedSections.map((section) => ({
            zoneCount: section.zoneCount,
            parameters: section.parameters.map((parameter) => ({
              id: parameter.id,
              kind: parameter.parameterKind,
              zoneCount: parameter.zones.length
            }))
          })),
          trialEventIds: trials.map((trial) => trial.id),
          editableTrialEventId: editableTrial?.id ?? null
        }).map((cellKey, index) => [cellKey, index] as const)
      ),
    [editableTrial, orderedSections, trials]
  );
  const changedFieldCount =
    parameterCells.filter((cell) => (currentValues[cell.cellKey] ?? "") !== (baselineValues[cell.cellKey] ?? "")).length +
    (machineId !== baselineMachineId ? 1 : 0);
  const savedAt = savedAtLabel(state.savedAt, language);

  function handleInputKeyDown(index: number, event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key !== "Enter") {
      return;
    }

    event.preventDefault();
    const nextIndex = nextProcessSheetInputIndex({
      currentIndex: index,
      fieldCount: parameterCells.length,
      shiftKey: event.shiftKey
    });
    inputRefs.current[nextIndex]?.focus();
  }

  function setCellValue(cellKey: string, value: string) {
    setCurrentValues((current) => ({ ...current, [cellKey]: value }));
    setOverwriteAvailable(false);
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
      copyableKeys: copyableCellKeys,
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

  // Plain render functions, NOT nested components: a component declared inside
  // the render body gets a new identity every keystroke, which would remount the
  // input and steal focus mid-typing.
  function renderScalarCell(parameter: ShapedParameter) {
    const cellKey = processSheetCellKey(parameter.id);
    const inputIndex = cellIndexByKey.get(cellKey) ?? -1;

    // LEGACY TOLERANCE (2026-08-08): 入水 / 运水 / 操作 became FLAGS/CHOICE by data
    // migration on rows that already held free text. An allowlist alone renders
    // such a value as nothing, so it is shown here and normalised by the next
    // save — never hidden, never silently dropped.
    const optionView = processSheetOptionValueView({
      raw: currentValues[cellKey] ?? "",
      kind: parameter.parameterKind,
      options: parameter.options
    });

    if (parameter.parameterKind === "CHOICE") {
      return (
        <select
          className="processChoiceSelect"
          name={`value:${cellKey}`}
          value={currentValues[cellKey] ?? ""}
          onChange={(event) => setCellValue(cellKey, event.target.value)}
        >
          <option value="">{t("process.noOptionSelected")}</option>
          {parameter.options.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
          {/* The stored value, listed so the select can actually show it. It
              posts verbatim, so an untouched save keeps it; picking a real
              option replaces it and it disappears. */}
          {optionView.legacy == null ? null : (
            <option value={optionView.legacy}>{optionView.legacy}</option>
          )}
        </select>
      );
    }

    if (parameter.parameterKind === "FLAGS") {
      const selected = deserializeProcessSheetFlagValues(currentValues[cellKey] ?? "", parameter.options);

      return (
        <div className="processFlagOptions">
          {/* The boxes drive state; ONE hidden field posts the canonical text,
              so the server parses every kind through the same `value:<cell>`. */}
          <input type="hidden" name={`value:${cellKey}`} value={currentValues[cellKey] ?? ""} />
          {parameter.options.map((option) => (
            <label key={option}>
              <input
                type="checkbox"
                checked={selected.includes(option)}
                onChange={(event) => {
                  const next = event.target.checked
                    ? [...selected, option]
                    : selected.filter((value) => value !== option);
                  setCellValue(
                    cellKey,
                    serializeProcessSheetFlagValues(parseProcessSheetFlagValues(next, parameter.options))
                  );
                }}
              />
              <span>{option}</span>
            </label>
          ))}
          {optionView.legacy == null ? null : (
            <span className="processLegacyValue">{optionView.legacy}</span>
          )}
        </div>
      );
    }

    return (
      <input
        ref={(element) => {
          if (inputIndex >= 0) {
            inputRefs.current[inputIndex] = element;
          }
        }}
        name={`value:${cellKey}`}
        type={processValueInputType(parameter.valueType)}
        step={parameter.valueType === "NUMBER" ? "any" : undefined}
        value={currentValues[cellKey] ?? ""}
        onChange={(event) => setCellValue(cellKey, event.target.value)}
        onKeyDown={(event) => handleInputKeyDown(inputIndex, event)}
      />
    );
  }

  /** One zoned parameter's zones for one trial column — the matrix row body. */
  function renderZoneCells({
    captionKind,
    parameter,
    sectionZoneCount,
    editable,
    fluid = false,
    trialEventId
  }: {
    captionKind: ProcessSheetZoneCaptionKind;
    parameter: ShapedParameter;
    sectionZoneCount: number;
    editable: boolean;
    /** Transposed sections only: equal fractions of the row, not fixed tracks. */
    fluid?: boolean;
    trialEventId: string;
  }) {
    const matrix = buildProcessSheetZoneMatrix({
      parameters: [{ ...parameter, kind: parameter.parameterKind }],
      valueByCellKey: editable
        ? currentValues
        : Object.fromEntries(
            parameter.zones.map((zoneIndex) => {
              const cellKey = processSheetCellKey(parameter.id, zoneIndex);
              return [cellKey, valueByCell.get(processSheetTrialCellKey(trialEventId, cellKey)) ?? ""];
            })
          )
    });
    const row = matrix.rows[0];
    const cells = row?.cells ?? [];

    return (
      <div
        className={`processZoneCells${fluid ? " processZoneCellsFluid" : ""}`}
        style={{ "--processZoneCount": sectionZoneCount } as React.CSSProperties}
      >
        {Array.from({ length: sectionZoneCount }, (_unused, index) => {
          const cell = cells[index];
          const zoneIndex = index + 1;

          if (cell == null || !cell.available) {
            return (
              <span className="processZoneCellUnavailable" key={`${parameter.id}-zone-${zoneIndex}`} aria-hidden="true" />
            );
          }

          if (!editable) {
            return (
              <span className="processZoneCellValue" key={cell.cellKey}>
                {displayValue(cell.value)}
              </span>
            );
          }

          const inputIndex = cellIndexByKey.get(cell.cellKey) ?? -1;

          return (
            <input
              key={cell.cellKey}
              ref={(element) => {
                if (inputIndex >= 0) {
                  inputRefs.current[inputIndex] = element;
                }
              }}
              aria-label={`${parameter.labelEn} ${processSheetZoneCaption(zoneIndex, captionKind, language)}`}
              name={`value:${cell.cellKey}`}
              type={processValueInputType(parameter.valueType)}
              step={parameter.valueType === "NUMBER" ? "any" : undefined}
              value={currentValues[cell.cellKey] ?? ""}
              onChange={(event) => setCellValue(cell.cellKey, event.target.value)}
              onKeyDown={(event) => handleInputKeyDown(inputIndex, event)}
            />
          );
        })}
      </div>
    );
  }

  function readOnlyCellContent(parameter: ShapedParameter, trialEventId: string) {
    return displayValue(valueByCell.get(processSheetTrialCellKey(trialEventId, processSheetCellKey(parameter.id))));
  }

  /** The band strip every section carries, transposed or not. */
  function renderSectionBand(section: SheetSection) {
    return (
      <h3 className="processSectionBand">
        <span className="processSectionBandName">{section.section}</span>
        <span className="processSectionBandFill">
          {section.fill.filled}/{section.fill.total}
        </span>
      </h3>
    );
  }

  /**
   * A ONE-PARAMETER MATRIX, TRANSPOSED (2026-08-10, the owner's refinement).
   *
   * 热流道 and 连续六啤 hold a single zoned row each, so printed the ordinary way
   * they repeat that row's zone boxes once per TRIAL COLUMN — twelve tips across
   * three trials is thirty-six boxes on one line, and comparing T0 with T1 means
   * scrolling sideways past everything in between.
   *
   * Here the zone captions ARE the header row, spanning the full sheet width in
   * equal fractions, and each trial is a ROW labelled with its own code and
   * status. The comparison then runs DOWN the page, which is the direction this
   * page already scrolls. Every trial row prints, including the empty ones: an
   * empty row is where the next trial's numbers get typed, and a row that
   * appeared only once it had data would be a row nobody could fill.
   *
   * Same cell keys, same `value:<cell>` field names, same fill count — the save
   * cannot tell the two layouts apart, because only the arrangement moved.
   */
  function renderTransposedSectionBlock(section: SheetSection, parameter: ShapedParameter) {
    return (
      <div
        className="processSectionBlock sectionAnchor processSectionZoned processSectionTransposed"
        key={section.anchorId}
        id={section.anchorId}
      >
        {renderSectionBand(section)}
        <div className="tableWrap processSheetWrap">
          {/* The zone count rides on the TABLE as well as on each grid below it:
              the table's own min-width floor (label column + 3rem per zone) is
              what makes a narrow window scroll the row instead of crushing it. */}
          <table
            className="processSheetTable processTransposedTable"
            style={{ "--processZoneCount": section.zoneCount } as React.CSSProperties}
          >
            <thead>
              <tr>
                {/* The label column names the PARAMETER once, because every row
                    beneath it is that parameter — the trial is the row now. */}
                <th className="processParameterCell">
                  <span>{parameter.labelEn}</span>
                  <small>
                    {[parameter.labelZh, parameter.unit].filter(Boolean).join(" / ") || parameter.parameterKey}
                  </small>
                </th>
                <th className="processZoneHeaderCell">
                  <div
                    className="processZoneCells processZoneCellsFluid"
                    style={{ "--processZoneCount": section.zoneCount } as React.CSSProperties}
                  >
                    {Array.from({ length: section.zoneCount }, (_unused, index) => (
                      <span className="processZoneCaption" key={`zone-caption-${index + 1}`}>
                        {/* 一区…十二区 for a machine axis, 第1啤…第6啤 for a shot
                            axis — the same function the ordinary matrix calls. */}
                        {processSheetZoneCaption(index + 1, section.captionKind, language)}
                      </span>
                    ))}
                  </div>
                </th>
              </tr>
            </thead>
            <tbody>
              {trials.length === 0 ? (
                <tr>
                  <th className="processParameterCell">
                    <span>{t("process.noTrialColumns")}</span>
                  </th>
                  <td>-</td>
                </tr>
              ) : (
                trials.map((trial) => {
                  const editable = canEdit && editableTrial != null && trial.id === editableTrial.id;

                  return (
                    <tr key={trial.id}>
                      <th className="processParameterCell processTrialRowLabel">
                        <span>{trial.label}</span>
                        <small>{trial.statusLabel}</small>
                      </th>
                      <td className={editable ? "processEditableCell" : "processReadonlyCell"}>
                        {editable ? <input type="hidden" name="processParameterId" value={parameter.id} /> : null}
                        {renderZoneCells({
                          captionKind: section.captionKind,
                          editable,
                          fluid: true,
                          parameter,
                          sectionZoneCount: section.zoneCount,
                          trialEventId: trial.id
                        })}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  /** One always-open band: its header strip and its own short table. */
  function renderSectionBlock(section: SheetSection) {
    const onlyParameter = section.parameters[0];

    if (section.transposed && onlyParameter != null) {
      return renderTransposedSectionBlock(section, onlyParameter);
    }

    return (
      <div
        className={`processSectionBlock sectionAnchor${section.zoneCount > 0 ? " processSectionZoned" : ""}`}
        key={section.anchorId}
        id={section.anchorId}
      >
        {renderSectionBand(section)}
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
              {section.zoneCount === 0 || trials.length === 0 ? null : (
                <tr className="processSectionRow">
                  <th className="processParameterCell processSectionLabelCell" />
                  {trials.map((trial) => (
                    <th key={`${section.anchorId}-${trial.id}`} className="processZoneHeaderCell">
                      <div
                        className="processZoneCells"
                        style={{ "--processZoneCount": section.zoneCount } as React.CSSProperties}
                      >
                        {Array.from({ length: section.zoneCount }, (_unused, index) => (
                          <span className="processZoneCaption" key={`zone-caption-${index + 1}`}>
                            {/* 一区…七区 for a machine axis, 第1啤…第6啤 for
                                a shot axis — same matrix, different axis. */}
                            {processSheetZoneCaption(index + 1, section.captionKind, language)}
                          </span>
                        ))}
                      </div>
                    </th>
                  ))}
                </tr>
              )}
            </thead>
            <tbody>
              {section.parameters.map((parameter) => (
                <tr key={parameter.id}>
                  <th className="processParameterCell">
                    <span>{parameter.labelEn}</span>
                    <small>
                      {[parameter.labelZh, parameter.unit].filter(Boolean).join(" / ") || parameter.parameterKey}
                    </small>
                  </th>
                  {trials.length === 0 ? (
                    <td>-</td>
                  ) : (
                    trials.map((trial) => {
                      const editable = canEdit && editableTrial != null && trial.id === editableTrial.id;

                      return (
                        <td
                          key={`${trial.id}-${parameter.id}`}
                          className={editable ? "processEditableCell" : "processReadonlyCell"}
                        >
                          {editable ? <input type="hidden" name="processParameterId" value={parameter.id} /> : null}
                          {parameter.parameterKind === "ZONED"
                            ? renderZoneCells({
                                captionKind: section.captionKind,
                                editable,
                                parameter,
                                sectionZoneCount: section.zoneCount,
                                trialEventId: trial.id
                              })
                            : editable
                              ? renderScalarCell(parameter)
                              : readOnlyCellContent(parameter, trial.id)}
                        </td>
                      );
                    })
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  /**
   * THE SHEET — a map, then TWO REGIONS, all on ONE page.
   *
   * NOT TABS, and that is the owner's own call: he reads this sheet line by
   * line, comparing T0 against T1 against T2 on the same row, and tabs put the
   * line he is on and the line he is comparing it to on different screens.
   *
   * NOT COLLAPSIBLE EITHER (2026-08-10). Folding empty sections was tried and
   * REVERTED by the owner on sight of it: a band that may or may not be open is
   * a band whose contents he cannot find by eye, and hunting for a section is
   * worse than scrolling past one. Every section is open, always. What survives
   * from that attempt is the chip strip — it was the part he liked — now a pure
   * jump list with a fill count.
   *
   * AND NOT PACKED TWO-UP EITHER (2026-08-10, final). Every non-matrix section
   * is FULL WIDTH, stacked, one continuous spreadsheet — which is the only way
   * the trial columns of one section sit at the same x as the trial columns of
   * the next, and reading a row across T0/T1/T2 is what this screen is for. Two
   * lanes bought a shorter page and cost that alignment. The matrices follow,
   * behind one divider, each full width and compared table by table — and a
   * matrix with only ONE parameter is TRANSPOSED (zones across, trials down),
   * see `renderTransposedSectionBlock`.
   *
   * Each section is still its own <table> rather than a band inside one giant
   * table: one repeated trial-column header per section, which on a sheet this
   * long is a gain — the column you are reading is always labelled — and the
   * shared declared widths on `.processSheetTable` are what keep the separate
   * tables in line with each other.
   */
  const sheet =
    visibleParameters.length === 0 ? (
      <p className="processSheetEmpty">{t("process.noTemplateAssigned")}</p>
    ) : (
      <>
        <nav className="processSectionStrip" aria-label={t("process.sectionMap")}>
          {orderedSections.map((section) => (
            <a
              className="processSectionChip"
              key={section.anchorId}
              href={`#${section.anchorId}`}
              title={t("process.sectionFill", { filled: section.fill.filled, total: section.fill.total })}
            >
              <span>{section.section}</span>
              <small className={section.fill.filled === 0 ? "processSectionChipEmpty" : undefined}>
                {section.fill.filled}/{section.fill.total}
              </small>
            </a>
          ))}
        </nav>
        <div className="processSheetSections">
          {scalarSections.map((section) => renderSectionBlock(section))}
          {zonedSections.length === 0 ? null : (
            <h3 className="processZonedDivider">{t("process.zonedGroup")}</h3>
          )}
          {zonedSections.map((section) => renderSectionBlock(section))}
        </div>
      </>
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
        {sheet}
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
      {sheet}
    </form>
  );
}
