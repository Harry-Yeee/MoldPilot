"use client";

import { useState } from "react";
import { useI18n } from "@/i18n/language-provider";

export type PartEditorRow = {
  id?: string;
  partCode: string;
  partName?: string | null;
  cavityLabel?: string | null;
  cavityCount?: number | string | null;
  notes?: string | null;
};

type PartsCavitiesEditorProps = {
  initialRows?: readonly PartEditorRow[];
};

function emptyRow(): PartEditorRow {
  return {
    partCode: "",
    partName: "",
    cavityLabel: "",
    cavityCount: null,
    notes: ""
  };
}

function rowValue(value: string | number | null | undefined): string {
  return value == null ? "" : String(value);
}

export function PartsCavitiesEditor({ initialRows = [emptyRow()] }: PartsCavitiesEditorProps) {
  const { t } = useI18n();
  const [rows, setRows] = useState<PartEditorRow[]>(initialRows.length === 0 ? [emptyRow()] : [...initialRows]);

  function updateRow(index: number, patch: Partial<PartEditorRow>) {
    setRows((current) => current.map((row, rowIndex) => (rowIndex === index ? { ...row, ...patch } : row)));
  }

  function addRow() {
    setRows((current) => [...current, emptyRow()]);
  }

  function removeRow(index: number) {
    setRows((current) => (current.length === 1 ? current : current.filter((_, rowIndex) => rowIndex !== index)));
  }

  return (
    <div className="partsEditor fullSpan">
      <div className="partsEditorHeader">
        <span>{t("project.partsCavities")}</span>
        <button className="secondaryButton" type="button" onClick={addRow}>
          {t("common.addRow")}
        </button>
      </div>
      <div className="partsEditorRows">
        {rows.map((row, index) => (
          <div className="partsEditorRow" key={`${row.id ?? "new"}-${index}`}>
            <input type="hidden" name="partId" value={row.id ?? ""} />
            <label>
              {t("field.partCode")}
              <input
                name="partCode"
                placeholder="P-014-A"
                required={index === 0}
                value={row.partCode}
                onChange={(event) => updateRow(index, { partCode: event.target.value })}
              />
            </label>
            <label>
              {t("field.partName")}
              <input
                name="partName"
                value={row.partName ?? ""}
                onChange={(event) => updateRow(index, { partName: event.target.value })}
              />
            </label>
            <label>
              {t("field.cavity")}
              <input
                name="cavityLabel"
                placeholder="A, B, 1, 2"
                value={row.cavityLabel ?? ""}
                onChange={(event) => updateRow(index, { cavityLabel: event.target.value })}
              />
            </label>
            <label>
              {t("field.count")}
              <input
                name="cavityCount"
                type="number"
                min="1"
                value={rowValue(row.cavityCount)}
                onChange={(event) => updateRow(index, { cavityCount: event.target.value })}
              />
            </label>
            <label className="partNotesField">
              {t("field.notes")}
              <input
                name="partNotes"
                value={row.notes ?? ""}
                onChange={(event) => updateRow(index, { notes: event.target.value })}
              />
            </label>
            <button
              className="secondaryButton"
              type="button"
              onClick={() => removeRow(index)}
              disabled={rows.length === 1}
            >
              {t("common.remove")}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
