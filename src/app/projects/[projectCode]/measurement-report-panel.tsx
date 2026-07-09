"use client";

import { useState } from "react";
import { Button, StatusBadge, BottomSheet, FormField, Select, Textarea } from "@/components/ui";
import {
  fileVisibilityLabels,
  measurementReportLabels,
  pickLabel,
  type Locale
} from "@/domain/mold-trial/labels";
import { uploadMeasurementReport } from "@/server/qc-report-actions";

/** Visibilities the uploader may pick: customer-safe (default) or an internal draft. */
const REPORT_VISIBILITIES = ["CUSTOMER_SAFE", "INTERNAL"] as const;

/** QC_REPORT accept list — mirrors the document allowlist (pdf/office/csv/slides). */
const REPORT_ACCEPT = "application/pdf,.pdf,.xlsx,.xls,.docx,.csv,.pptx,.ppt";

export type MeasurementReportPanelState =
  | { kind: "MISSING" }
  | { kind: "UPLOADED"; attachmentId: string; uploadedAt: string; uploadedBy: string };

export type MeasurementReportPanelProps = {
  state: MeasurementReportPanelState;
  trialLabel: string;
  trialEventId: string;
  projectCode: string;
  redirectTo: string;
  /** True when the viewer may upload (and, for an existing report, replace) it. */
  canUpload: boolean;
  locale: Locale;
};

function label(key: keyof typeof measurementReportLabels, locale: Locale): string {
  return pickLabel(measurementReportLabels[key], locale);
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "2-digit", year: "numeric" }).format(
    new Date(value)
  );
}

/**
 * The measurement-report status line for one completed trial: an amber "Missing"
 * badge or a green "Uploaded · date · uploader" badge with a Download link, plus
 * an Upload/Replace button (opening a BottomSheet with file + visibility + note)
 * for holders of the upload permission. Planned/missed trials never render this —
 * the page only mounts it for eligible trials.
 */
export function MeasurementReportPanel({
  state,
  trialLabel,
  trialEventId,
  projectCode,
  redirectTo,
  canUpload,
  locale
}: MeasurementReportPanelProps) {
  const [sheetOpen, setSheetOpen] = useState(false);
  const uploaded = state.kind === "UPLOADED";

  return (
    <section className="panelActionBlock" aria-label={`${trialLabel} measurement report`}>
      <h3>{label("title", locale)}</h3>
      <div className="flex flex-wrap items-center gap-3">
        {uploaded ? (
          <>
            <StatusBadge tone="completed">{label("uploaded", locale)}</StatusBadge>
            <span className="text-sm text-neutral-600">
              {formatDate(state.uploadedAt)} · {state.uploadedBy}
            </span>
            <a
              href={`/api/attachments/${state.attachmentId}`}
              className="inline-flex min-h-9 items-center justify-center rounded-lg border border-neutral-400 bg-white px-3.5 text-sm font-bold text-brand-600 no-underline hover:bg-neutral-100"
            >
              {label("download", locale)}
            </a>
          </>
        ) : (
          <StatusBadge tone="at-risk">{label("missing", locale)}</StatusBadge>
        )}
        {canUpload ? (
          <Button type="button" variant="secondary" size="lg" onClick={() => setSheetOpen(true)}>
            {uploaded ? label("replace", locale) : label("upload", locale)}
          </Button>
        ) : null}
      </div>

      {canUpload ? (
        <BottomSheet
          open={sheetOpen}
          onClose={() => setSheetOpen(false)}
          title={`${uploaded ? label("replace", locale) : label("upload", locale)} · ${trialLabel}`}
        >
          <form action={uploadMeasurementReport} className="grid gap-3" encType="multipart/form-data">
            <input type="hidden" name="trialEventId" value={trialEventId} />
            <input type="hidden" name="projectCode" value={projectCode} />
            <input type="hidden" name="redirectTo" value={redirectTo} />

            <FormField label={label("file", locale)} htmlFor={`report-file-${trialEventId}`} hint={label("reportHint", locale)}>
              <input
                id={`report-file-${trialEventId}`}
                name="file"
                type="file"
                required
                accept={REPORT_ACCEPT}
                className="w-full min-h-11 rounded-lg border border-neutral-400 bg-white px-2.5 py-2 text-neutral-900 font-normal file:mr-3 file:rounded-lg file:border-0 file:bg-neutral-100 file:px-3 file:py-1.5 file:font-bold file:text-brand-600"
              />
            </FormField>

            <FormField label={label("visibility", locale)} htmlFor={`report-visibility-${trialEventId}`}>
              <Select id={`report-visibility-${trialEventId}`} name="visibility" defaultValue="CUSTOMER_SAFE" required>
                {REPORT_VISIBILITIES.map((option) => (
                  <option key={option} value={option}>
                    {pickLabel(fileVisibilityLabels[option], locale)}
                  </option>
                ))}
              </Select>
            </FormField>

            <FormField label={label("note", locale)} htmlFor={`report-note-${trialEventId}`}>
              <Textarea id={`report-note-${trialEventId}`} name="note" rows={2} />
            </FormField>

            <div className="pt-1">
              <Button type="submit" variant="primary" size="lg" className="w-full">
                {label("submit", locale)}
              </Button>
            </div>
          </form>
        </BottomSheet>
      ) : null}
    </section>
  );
}
